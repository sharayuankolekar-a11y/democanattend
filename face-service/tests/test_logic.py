import math
import unittest

import numpy as np

import helpers  # noqa: F401  (sets sys.path)
import liveness
import quality
import tokens
from config import Settings

CFG = Settings(qr_signing_secret="s" * 32)


class TokenTests(unittest.TestCase):
    def test_qr_roundtrip_and_expiry(self):
        tok, exp = tokens.issue_qr_token("k" * 20, 1700000000123, 30, now_s=1000)
        self.assertEqual(tokens.verify_qr_token("k" * 20, tok, 0, now_s=1010), (True, 1700000000123, None))
        self.assertEqual(tokens.verify_qr_token("k" * 20, tok, 0, now_s=1031)[2], "expired")
        self.assertTrue(tokens.verify_qr_token("k" * 20, tok, 10, now_s=1035)[0])       # inside grace
        self.assertEqual(tokens.verify_qr_token("k" * 20, tok, 10, now_s=1045)[2], "expired")

    def test_qr_tamper_and_wrong_key(self):
        tok, _ = tokens.issue_qr_token("k" * 20, 5, 30, now_s=1000)
        parts = tok.split(".")
        forged = ".".join([parts[0], "6", parts[2], parts[3]])
        self.assertEqual(tokens.verify_qr_token("k" * 20, forged, 0, now_s=1001)[2], "bad_signature")
        self.assertEqual(tokens.verify_qr_token("x" * 20, tok, 0, now_s=1001)[2], "bad_signature")
        for junk in ["", "abc", "CA2.1.2", None, 12, "CA1.1.2.sig", '{"caId":"x"}', "subject:Math|expiry:9"]:
            self.assertEqual(tokens.verify_qr_token("k" * 20, junk, 0, now_s=1)[2], "malformed")

    def test_payload(self):
        t = tokens.sign_payload("k" * 20, {"a": 1, "exp": 2000})
        self.assertEqual(tokens.verify_payload("k" * 20, t, now_s=1500)[0]["a"], 1)
        self.assertEqual(tokens.verify_payload("k" * 20, t, now_s=2500)[1], "expired")
        self.assertEqual(tokens.verify_payload("z" * 20, t, now_s=1500)[1], "bad_signature")
        body, sig = t.split(".")
        self.assertIsNone(tokens.verify_payload("k" * 20, body + "x." + sig, now_s=1500)[0])


class QualityTests(unittest.TestCase):
    def img(self, mean, noise=12, size=128):
        rng = np.random.RandomState(1)
        return np.clip(rng.randn(size, size, 3) * noise + mean, 0, 255).astype(np.uint8)

    def test_gates(self):
        box = (0, 0, 128, 128)
        self.assertEqual(quality.assess(self.img(130), box, CFG), [])
        self.assertIn("too_dark", quality.assess(self.img(15), box, CFG))
        self.assertIn("too_bright", quality.assess(self.img(245, noise=3), box, CFG))
        self.assertIn("blurry", quality.assess(self.img(130, noise=0), box, CFG))
        self.assertIn("too_small", quality.assess(self.img(130), (0, 0, 40, 40), CFG))


class ChallengeTests(unittest.TestCase):
    def test_deterministic_and_well_formed(self):
        a = liveness.make_challenge("s" * 32, "nonce1", CFG)
        b = liveness.make_challenge("s" * 32, "nonce1", CFG)
        c = liveness.make_challenge("s" * 32, "nonce2", CFG)
        self.assertEqual(a, b)
        self.assertNotEqual(a["light"]["colors"], c["light"]["colors"])
        cols = a["light"]["colors"]
        self.assertEqual(len(cols), CFG.light_steps)
        self.assertTrue(all(cols[i] != cols[i + 1] for i in range(len(cols) - 1)))
        self.assertIn(a["turn"], ("left", "right"))

    def test_every_channel_varies_across_many_nonces(self):
        for i in range(200):
            arr = np.array(liveness.make_challenge("s" * 32, f"n{i}", CFG)["light"]["colors"])
            self.assertTrue(all(len(set(arr[:, j])) > 1 for j in range(3)))


def light_samples(challenge, gain=0.25, noise=2.0, seed=0, colors=None, base=(170, 130, 110), step_hz=100):
    rng = np.random.RandomState(seed)
    colors = colors or challenge["light"]["colors"]
    step, lat = challenge["light"]["stepMs"], challenge["light"]["latencyMs"]
    out, t = [], 0
    while t < len(colors) * step + lat:
        k = int(math.floor((t - lat) / step))
        add = gain * np.array(colors[k], float) if 0 <= k < len(colors) else 0
        out.append((t, tuple(np.array(base, float) + add + rng.randn(3) * noise)))
        t += step_hz
    return out


class LightTests(unittest.TestCase):
    def setUp(self):
        self.ch = liveness.make_challenge("s" * 32, "abc", CFG)

    def test_genuine_passes_with_noise_exposure_drift_and_camera_delay(self):
        import random
        for seed in range(40):
            delay = random.Random(seed).uniform(60, 240)
            s = light_samples(self.ch, gain=0.12, noise=3, seed=seed)
            s = [(t + delay - 120, rgb) for t, rgb in s]                      # camera lags more/less than the server assumes
            s = [(t, tuple(np.array(rgb) * (1 + 0.05 * i / len(s)))) for i, (t, rgb) in enumerate(s)]   # auto-exposure drift
            r = liveness.analyze_light([x for x in s if x[0] >= 0], self.ch, CFG)
            self.assertEqual(r["status"], "pass", r)

    def test_photo_with_no_response_is_inconclusive_never_pass(self):
        for seed in range(100):
            r = liveness.analyze_light(light_samples(self.ch, gain=0.0, noise=3, seed=seed), self.ch, CFG)
            self.assertNotEqual(r["status"], "pass")
            self.assertEqual(r["status"], "inconclusive")
            self.assertEqual(r["reason"], "response_too_weak")

    def test_strong_response_to_a_different_sequence_is_rejected(self):
        passes = 0
        for seed in range(300):
            ch = liveness.make_challenge("s" * 32, f"c{seed}", CFG)
            other = liveness.make_challenge("s" * 32, f"other{seed}", CFG)["light"]["colors"]
            r = liveness.analyze_light(light_samples(ch, gain=0.25, colors=other, noise=2, seed=seed), ch, CFG)
            passes += r["status"] == "pass"
            self.assertNotEqual(r["status"], "inconclusive")          # the response is clearly measurable
        self.assertLessEqual(passes, 3)                                # chance coincidence stays ~1% or less

    def test_inverted_sequence_always_fails(self):
        inv = [[255 - v for v in c] for c in self.ch["light"]["colors"]]
        r = liveness.analyze_light(light_samples(self.ch, gain=0.25, colors=inv), self.ch, CFG)
        self.assertEqual(r["status"], "fail")

    def test_too_few_frames_or_too_dark_is_inconclusive(self):
        r = liveness.analyze_light(light_samples(self.ch)[:6], self.ch, CFG)
        self.assertEqual((r["status"], r["reason"]), ("inconclusive", "insufficient_frames"))
        dark = [(t, (0.1, 0.1, 0.1)) for t, _ in light_samples(self.ch)]
        self.assertEqual(liveness.analyze_light(dark, self.ch, CFG)["reason"], "too_dark")

    def test_old_drifting_timeline_is_the_reason_real_runs_failed(self):
        """Documents the bug in the first capture component: steps that really last 460 ms while the
        server assumes 400 ms. The new client uses a fixed timeline, so this must not recur."""
        ch = self.ch
        step_real = 460
        colors = ch["light"]["colors"]
        out, t = [], 0
        while t < len(colors) * step_real:
            k = int(t // step_real)
            out.append((t, tuple(np.array((170, 130, 110.)) + 0.25 * np.array(colors[k], float))))
            t += 100
        r = liveness.analyze_light(out, ch, CFG)
        self.assertIn(r["status"], ("pass", "fail"))                  # measurable, but the alignment error hurts the score
        exact = liveness.analyze_light(light_samples(ch, gain=0.25, noise=0), ch, CFG)
        self.assertGreater(exact["score"], r["score"])


class TurnTests(unittest.TestCase):
    EXACT = Settings(qr_signing_secret="s" * 32, turn_direction_mode="exact")

    def test_yaw_ratio_order_agnostic(self):
        a = liveness.yaw_ratio([[40, 50], [88, 50], [74, 70], [0, 0], [0, 0]])
        b = liveness.yaw_ratio([[88, 50], [40, 50], [74, 70], [0, 0], [0, 0]])
        self.assertAlmostEqual(a, b)
        self.assertAlmostEqual(a, 10 / 48.0)

    def test_exact_mode_directions(self):
        f, X = [0.0, 0.02, -0.01], self.EXACT
        self.assertTrue(liveness.analyze_turn(f, [0.3, 0.4, 0.35], "left", X)["passed"])
        self.assertFalse(liveness.analyze_turn(f, [0.3, 0.4, 0.35], "right", X)["passed"])
        self.assertTrue(liveness.analyze_turn(f, [-0.3, -0.4, -0.35], "right", X)["passed"])
        self.assertFalse(liveness.analyze_turn(f, [0.02, 0.01, 0.03], "left", X)["passed"])
        self.assertFalse(liveness.analyze_turn(f, [0.4], "left", X)["passed"])
        self.assertEqual(liveness.analyze_turn([0.5, 0.5], [0.9, 0.9], "left", X)["reason"], "not_facing_camera")

    def test_default_either_mode_accepts_any_clear_turn_but_not_a_still_face(self):
        f = [0.0, 0.02, -0.01]
        self.assertTrue(liveness.analyze_turn(f, [0.3, 0.4, 0.35], "right", CFG)["passed"])
        self.assertTrue(liveness.analyze_turn(f, [-0.3, -0.4, -0.35], "right", CFG)["passed"])
        self.assertFalse(liveness.analyze_turn(f, [0.02, 0.05, -0.03], "left", CFG)["passed"])
        self.assertFalse(liveness.analyze_turn(f, [0.4, -0.4, 0.0], "left", CFG)["passed"])       # random wobble, no sustained turn

    def test_sign_flip_setting_in_exact_mode(self):
        flipped = Settings(qr_signing_secret="s" * 32, turn_direction_mode="exact", turn_sign_flip=True)
        self.assertTrue(liveness.analyze_turn([0, 0.01], [0.4, 0.4, 0.4], "right", flipped)["passed"])


if __name__ == "__main__":
    unittest.main()
