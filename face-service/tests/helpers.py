"""Shared test fixtures: fake auth, fake face engine, synthetic camera frames.

IMPORTANT: the fake engine encodes 'identity' and 'head yaw' into pixels of
synthetic images. These tests prove the SERVER LOGIC (tokens, challenge
analysis, duplicates, attempt limits, record shape). They do NOT prove that real
faces are recognised - that needs the real YuNet/SFace models and real cameras.
"""
import base64
import math
import os
import sys

import cv2
import numpy as np
from cryptography.fernet import Fernet

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app          # noqa: E402
from auth import AuthError          # noqa: E402
from config import Settings         # noqa: E402
from face_engine import Face, normalize   # noqa: E402
from store import MemoryStore       # noqa: E402


class FakeVerifier:
    def verify(self, token):
        if not token.startswith("tok:"):
            raise AuthError("bad token")
        _, uid, email = token.split(":", 2)
        return {"uid": uid, "email": email, "email_verified": True}


class FakeEngine:
    name = "fake"

    def detect(self, img):
        flag = int(img[0, 2, 2])
        if flag == 1:
            return []
        h, w = img.shape[:2]
        yaw = (int(img[0, 1, 1]) - 128) / 100.0
        mid, dist = w / 2.0, 48.0
        lm = np.array([[mid - dist / 2, h * 0.4], [mid + dist / 2, h * 0.4], [mid + yaw * dist, h * 0.55],
                       [mid - 20, h * 0.7], [mid + 20, h * 0.7]], dtype=float)
        faces = [Face(bbox=(0, 0, w, h), landmarks=lm, score=0.99)]
        if flag == 2:
            faces.append(Face(bbox=(0, 0, w // 2, h // 2), landmarks=lm, score=0.9))
        return faces

    def embed(self, img, face):
        base = np.random.RandomState(int(img[0, 0, 0])).randn(128)
        noise = np.random.RandomState(int(img.sum()) % 100000).randn(128) * 0.05
        return normalize(base + noise)


def make_frame(identity, yaw=0.0, screen_rgb=None, gain=0.25, flag=0, seed=0, base=(170, 130, 110)):
    rng = np.random.RandomState(seed)
    rgb = np.array(base, float)
    if screen_rgb is not None:
        rgb = rgb + gain * np.array(screen_rgb, float)
    rgb = np.clip(rgb, 0, 255)
    img = np.empty((128, 128, 3), float)
    img[:] = rgb[::-1]
    img += rng.randn(128, 128, 3) * 12
    img = np.clip(img, 0, 255).astype(np.uint8)
    img[0, 0, 0] = identity
    img[0, 1, 1] = int(128 + round(yaw * 100))
    img[0, 2, 2] = flag
    return img


def data_url(img):
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()


def build_frames(challenge, identity, *, n_front=4, light="genuine", turn="correct", gain=0.25,
                 front_base=(170, 130, 110), flag=0, other_colors=None, light_flag=0):
    """light: genuine | static | wrong ;  turn: correct | wrong | none"""
    frames, seed = [], 0
    for k in range(n_front):
        seed += 1
        frames.append({"phase": "front", "t": k * 100,
                       "image": data_url(make_frame(identity, 0.02, seed=seed, base=front_base, flag=flag))})
    colors = challenge["light"]["colors"]
    if light == "wrong":
        colors = other_colors
    step, lat = challenge["light"]["stepMs"], challenge["light"]["latencyMs"]
    total, t = len(colors) * step + lat, 0
    while t < total:
        seed += 1
        k = int(math.floor((t - lat) / step))
        screen = colors[k] if (0 <= k < len(colors) and light != "static") else None
        frames.append({"phase": "light", "t": t, "image": data_url(make_frame(identity, 0.02, screen, gain, seed=seed, flag=light_flag))})
        t += 100
    sign = 1 if challenge["turn"] == "left" else -1
    yaw = {"correct": 0.4 * sign, "wrong": -0.4 * sign, "none": 0.02}[turn]
    for k in range(3):
        seed += 1
        frames.append({"phase": "turn", "t": k * 100, "image": data_url(make_frame(identity, yaw, seed=seed))})
    return frames


class Clock:
    def __init__(self):
        self.t = 1_700_000_000.0

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


def auth(email):
    return {"Authorization": f"Bearer tok:{email.split('@')[0]}:{email}"}


FAC = auth("fac@cec.edu")
S1 = auth("stu1@cec.edu")
S2 = auth("stu2@cec.edu")
S1_BODY = {"loginRequestId": "lr1", "sessionToken": "tok1", "deviceId": "device-aaaaaa1"}
S2_BODY = {"loginRequestId": "lr2", "sessionToken": "tok2", "deviceId": "device-bbbbbb2"}


def make_env(**overrides):
    settings = Settings(qr_signing_secret="s" * 32, face_template_key=Fernet.generate_key().decode(),
                        admin_key="adm", debug_scores=True, **overrides)
    store = MemoryStore()
    store.teachers["t1"] = {"email": "fac@cec.edu", "name": "Prof Fac", "role": "faculty", "status": "approved"}
    store.teachers["t2"] = {"email": "other@cec.edu", "name": "Prof Other", "role": "faculty", "status": "approved"}
    store.teachers["t_pending"] = {"email": "pending@cec.edu", "name": "Prof Pending", "role": "faculty", "status": "pending"}
    for i, (sid, email, usn, name) in enumerate([("s1", "stu1@cec.edu", "1CE21CS001", "Asha"),
                                                  ("s2", "stu2@cec.edu", "1CE21CS002", "Ravi")], start=1):
        store.students[sid] = {"email": email, "usn": usn, "name": name, "class": "5A", "status": "active"}
        store.login_requests[f"lr{i}"] = {"status": "approved", "sessionToken": f"tok{i}", "studentDocId": sid,
                                          "email": email, "usn": usn}
    clock = Clock()
    app = create_app(settings, store, FakeVerifier(), FakeEngine(), clock=clock)
    return app.test_client(), store, settings, clock


def start_session(client, store, clock=None):
    r = client.post("/sessions/start", headers=FAC, json={
        "caId": "t1", "subject": "Maths", "facultyName": "Prof Fac"})
    assert r.status_code == 200, r.get_json()
    sid = r.get_json()["sessionId"]
    for usn, sidx, name in [("1CE21CS001", "s1", "Asha"), ("1CE21CS002", "s2", "Ravi")]:   # faculty page's markAllAbsent()
        store.add_attendance({"usn": usn, "name": name, "studentId": sidx, "status": "absent", "caId": "t1",
                              "sessionId": sid, "subject": "Maths", "class": "5A"})
    return sid


def qr_token(client, sid):
    r = client.get(f"/sessions/{sid}/qr", headers=FAC)
    assert r.status_code == 200, r.get_json()
    return r.get_json()["token"]


def enroll(client, headers, body, identity, **frame_kwargs):
    b = client.post("/face/enroll/begin", headers=headers, json={**body, "consent": True})
    assert b.status_code == 200, b.get_json()
    j = b.get_json()
    frames = build_frames(j["challenge"], identity, n_front=frame_kwargs.pop("n_front", 8), **frame_kwargs)
    return client.post("/face/enroll/complete", headers=headers, json={"ticket": j["ticket"], "frames": frames,
                                                                       "deviceId": body["deviceId"]})


def begin(client, headers, body, token):
    return client.post("/attendance/begin", headers=headers, json={**body, "qrToken": token})


def complete(client, headers, body, begin_json, identity, **frame_kwargs):
    frames = build_frames(begin_json["challenge"], identity, **frame_kwargs)
    return client.post("/attendance/complete", headers=headers,
                       json={"ticket": begin_json["ticket"], "frames": frames, "deviceId": body["deviceId"]})
