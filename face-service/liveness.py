"""Anti-proxy liveness checks: a random colour-flash ("face flashing") response
check and a random head-turn check.

What this defends against: a photo or a pre-recorded video held up to the
camera (they cannot react to a colour sequence the server picked a moment ago).
What it does NOT defend against: a student who modifies the web app to forge
frames, or a high-end real-time deepfake. Treat it as hackathon-grade.
"""
import hashlib
import hmac
import math
import random

import numpy as np

PALETTE = [
    (255, 0, 0), (0, 255, 0), (0, 0, 255),
    (255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 255, 255),
]


def make_challenge(secret, nonce, cfg):
    """Deterministic from (secret, nonce) so the server needs no storage."""
    seed = int.from_bytes(hmac.new(secret.encode(), ("C|" + nonce).encode(), hashlib.sha256).digest()[:8], "big")
    rng = random.Random(seed)
    turn = rng.choice(["left", "right"])
    while True:
        colors = []
        while len(colors) < cfg.light_steps:
            c = rng.choice(PALETTE)
            if not colors or c != colors[-1]:
                colors.append(c)
        arr = np.array(colors)
        if all(len(set(arr[:, j])) > 1 for j in range(3)):
            break
    return {
        "turn": turn,
        "light": {
            "colors": [list(c) for c in colors],
            "stepMs": cfg.light_step_ms,
            "latencyMs": cfg.light_latency_ms,
        },
    }


def face_roi_rgb_mean(img_bgr, bbox):
    """Mean RGB of the central part of the face box (cheeks/nose/forehead)."""
    h, w = img_bgr.shape[:2]
    x, y, bw, bh = bbox
    x0 = int(max(0, x + 0.25 * bw)); x1 = int(min(w, x + 0.75 * bw))
    y0 = int(max(0, y + 0.25 * bh)); y1 = int(min(h, y + 0.75 * bh))
    if x1 <= x0 or y1 <= y0:
        return (0.0, 0.0, 0.0)
    b, g, r = img_bgr[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    return (float(r), float(g), float(b))


LATENCY_OFFSETS_MS = (-60, 0, 60, 120, 180)   # phones/webcams differ in screen->camera delay


def _step_means(samples, n_steps, step_ms, latency_ms, min_frames):
    buckets = [[] for _ in range(n_steps)]
    for t, rgb in samples:
        k = int(math.floor((t - latency_ms) / step_ms))
        if 0 <= k < n_steps:
            buckets[k].append(rgb)
    idx, rows = [], []
    for k, b in enumerate(buckets):
        if len(b) >= min_frames:
            idx.append(k)
            rows.append(np.median(b, axis=0))      # median: robust to a blink / one odd frame
    return idx, rows


def _detrend(values, positions):
    """Remove a straight-line trend (camera auto-exposure drifting up or down during the check)."""
    k = np.asarray(positions, dtype=float)
    a = np.vstack([k, np.ones_like(k)]).T
    coef, *_ = np.linalg.lstsq(a, values, rcond=None)
    return values - a @ coef


def _fit(m, e, idx):
    rs, slopes, variances = [], [], []
    for j in range(3):
        x = _detrend(e[:, j], idx)
        y = _detrend(m[:, j], idx)
        vx, vy = float(x.var()), float(y.var())
        variances.append(vy)
        if vx < 1e-9 or vy < 1e-12:
            rs.append(0.0)
            slopes.append(0.0)
            continue
        cov = float(((x - x.mean()) * (y - y.mean())).mean())
        rs.append(cov / math.sqrt(vx * vy))
        slopes.append(cov / vx)
    return float(np.mean(rs)), float(np.mean(slopes)), float(math.sqrt(np.mean(variances)))


def analyze_light(samples, challenge, cfg):
    """samples: [(t_ms since the first colour was shown, (r, g, b) face mean)].

    status:
      pass          the face's colour changed in step with the server's random sequence
      fail          the face DID change measurably, but not in step with the sequence
                    (replayed video of another session, flicker, someone else's lighting...)
      inconclusive  no measurable response (bright room, strong auto-white-balance, too few frames).
                    This is NOT proof of a spoof - the caller decides what to do (see light_check_mode).
    """
    colors = np.array(challenge["light"]["colors"], dtype=float) / 255.0
    step_ms = challenge["light"]["stepMs"]
    base_latency = challenge["light"]["latencyMs"]
    best, saw_dark = None, False
    for offset in sorted({max(0, base_latency + o) for o in LATENCY_OFFSETS_MS}):
        idx, rows = _step_means(samples, len(colors), step_ms, offset, cfg.light_min_frames_per_step)
        if len(idx) < cfg.light_min_valid_steps:
            continue
        m = np.array(rows, dtype=float)
        overall = float(m.mean())
        if overall < 1.0:
            saw_dark = True
            continue
        score, slope, strength = _fit(m / overall, colors[idx], idx)
        cand = {"score": score, "slope": slope, "strength": strength, "valid_steps": len(idx), "latency_ms": offset}
        if best is None or score > best["score"]:
            best = cand
    if best is None:
        reason = "too_dark" if saw_dark else "insufficient_frames"
        return {"status": "inconclusive", "passed": False, "reason": reason, "score": 0.0, "slope": 0.0,
                "strength": 0.0, "valid_steps": 0, "latency_ms": None}
    if best["strength"] < cfg.light_min_strength:
        status, reason = "inconclusive", "response_too_weak"
    elif best["score"] >= cfg.light_min_score and best["slope"] >= cfg.light_min_slope:
        status, reason = "pass", None
    else:
        status, reason = "fail", "light_pattern_mismatch"
    return {"status": status, "passed": status == "pass", "reason": reason, **best}


def yaw_ratio(landmarks):
    """(nose offset from the eye midpoint) / eye distance, in image x. Order-agnostic."""
    lm = np.asarray(landmarks, dtype=float).reshape(-1, 2)
    d = abs(lm[0, 0] - lm[1, 0])
    if d < 1e-6:
        return None
    return float((lm[2, 0] - (lm[0, 0] + lm[1, 0]) / 2.0) / d)


def analyze_turn(front_yaws, turn_yaws, direction, cfg):
    """direction is the user's own left/right. In an un-mirrored camera frame the user's left
    appears on the image right, so a left turn raises the ratio. Because some front cameras
    deliver mirrored frames, the default mode ("either") accepts a clear turn in either direction."""
    front = [y for y in front_yaws if y is not None]
    turn = [y for y in turn_yaws if y is not None]
    if len(front) < 2 or len(turn) < 2:
        return {"passed": False, "reason": "insufficient_frames", "peak": 0.0}
    base = float(np.median(front))
    if abs(base) > cfg.turn_front_max_yaw:
        return {"passed": False, "reason": "not_facing_camera", "baseline": base, "peak": 0.0}
    shifts = [y - base for y in turn]
    if cfg.turn_direction_mode == "exact":
        sign = 1.0 if direction == "left" else -1.0
        if cfg.turn_sign_flip:
            sign = -sign
        hits = sum(1 for s_ in shifts if s_ * sign >= cfg.turn_min_shift)
        peak = max(s_ * sign for s_ in shifts)
    else:
        hits = max(sum(1 for s_ in shifts if s_ >= cfg.turn_min_shift),
                   sum(1 for s_ in shifts if s_ <= -cfg.turn_min_shift))
        peak = max(abs(s_) for s_ in shifts)
    ok = hits >= 2
    return {"passed": ok, "reason": None if ok else "turn_not_detected", "baseline": base, "peak": float(peak)}
