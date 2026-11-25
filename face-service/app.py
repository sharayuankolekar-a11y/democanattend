"""CanAttend verification service.

The browser never decides that attendance is valid. It only submits evidence
(signed QR token, camera frames); this service checks everything and is the
only writer of 'present' records (Firebase Admin SDK).

Flow:  faculty  POST /sessions/start  ->  GET /sessions/<id>/qr (every 1s)
       student  POST /attendance/begin (QR + login approval)  -> ticket + challenge
                POST /attendance/complete (camera frames) -> face + liveness + duplicates -> record
"""
import base64
import hmac
import logging
import re
import secrets
import time

import cv2
import numpy as np
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

import liveness
import quality
import templates
import tokens
from auth import AuthError
from face_engine import cosine, normalize, prepare
from store import AlreadyMarked

log = logging.getLogger("canattend")

ISSUE_MESSAGES = {
    **quality.ISSUE_MESSAGES,
    "no_face": "No face was detected. Look straight at the camera in good light.",
    "multiple_faces": "More than one face is visible. Only you should be in front of the camera.",
}
ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")
DEVICE_RE = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")


class ApiError(Exception):
    def __init__(self, code, message, status=400, **extra):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def _email(v):
    return str(v or "").strip().lower()


def _usn(v):
    return str(v or "").strip().upper()


def create_app(settings, store, verifier, engine=None, engine_error=None, clock=time.time):
    cfg = settings
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 14 * 1024 * 1024
    qr_session_cache = {}  # sid -> (cached_at_s, session_dict); reduces Firestore reads during 1s QR rotation

    # ------------------------------------------------------------------ plumbing
    @app.after_request
    def cors(resp):
        origin = request.headers.get("Origin")
        if origin and (origin in cfg.allowed_origins or "*" in cfg.allowed_origins):
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(ApiError)
    def _api_error(e):
        return jsonify({"ok": False, "code": e.code, "message": e.message, **e.extra}), e.status

    @app.errorhandler(Exception)
    def _any_error(e):
        if isinstance(e, HTTPException):
            return jsonify({"ok": False, "code": f"http_{e.code}", "message": e.description}), e.code
        log.exception("Unhandled error")
        return jsonify({"ok": False, "code": "server_error", "message": "Something went wrong on the server. Please try again."}), 500

    def json_body():
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}

    def authenticate():
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise ApiError("unauthenticated", "Please sign in again.", 401)
        try:
            claims = verifier.verify(header[7:].strip())
        except AuthError:
            raise ApiError("unauthenticated", "Your sign-in could not be verified. Please sign in again.", 401)
        email = _email(claims.get("email"))
        if not email or not claims.get("uid"):
            raise ApiError("unauthenticated", "Your account has no verified email.", 401)
        return {"uid": claims["uid"], "email": email}

    def need_engine():
        if engine is None:
            raise ApiError("face_engine_unavailable",
                           "Face recognition is not available on the server. " + (engine_error or ""), 503)

    def device_id_from(body, required=True):
        d = str(body.get("deviceId") or "")
        if DEVICE_RE.match(d):
            return d
        if required:
            raise ApiError("bad_device", "This browser could not be identified. Refresh the page and try again.", 400)
        return ""

    # ------------------------------------------------------------ identity checks
    def student_context(claims, body):
        student = store.get_student_by_email(claims["email"])
        if not student:
            raise ApiError("student_not_found", "No student record matches this Google account.", 404)
        if (student.get("status") or "").lower().strip() in ("pending", "rejected"):
            raise ApiError("student_inactive", "Your student registration is not active. Contact your Class Advisor.", 403)
        rid, stok = str(body.get("loginRequestId") or ""), str(body.get("sessionToken") or "")
        req = store.get_login_request(rid) if ID_RE.match(rid) else None
        ok = bool(
            req and stok and req.get("status") == "approved"
            and hmac.compare_digest(str(req.get("sessionToken") or ""), stok)
            and req.get("studentDocId") == student["id"]
            and _email(req.get("email")) == claims["email"]
        )
        if not ok:
            raise ApiError("login_not_approved", "Your login is not approved. Log in again and wait for CA approval.", 403)
        return {"id": student["id"], "usn": _usn(student.get("usn")), "name": student.get("name", "Student"),
                "class": student.get("class", ""), "email": claims["email"], "uid": claims["uid"]}

    def active_session(sid):
        """Session that still accepts NEW scans (QR step)."""
        s = store.get_session(sid)
        if not s or s.get("status") != "active" or clock() > s.get("expiresAtS", 0):
            raise ApiError("session_inactive", "This attendance session is not active. Ask your faculty to start a new one.", 409)
        return s

    def session_for_completion(sid):
        """A verification that BEGAN while the session was open may finish for up to ticket_ttl_s after it closes."""
        s = store.get_session(sid)
        if s:
            closed_at = s.get("endedAtS") if s.get("status") == "ended" else s.get("expiresAtS", 0)
            if closed_at is not None and clock() <= closed_at + cfg.ticket_ttl_s:
                return s
        raise ApiError("session_inactive", "This attendance session has closed. Ask your faculty to mark you manually.", 409)

    def owned_session(claims, sid):
        s = store.get_session(sid)
        if not s:
            raise ApiError("session_not_found", "Session not found.", 404)
        if s.get("facultyEmail") != claims["email"]:
            raise ApiError("not_session_owner", "Only the faculty who started this session can do that.", 403)
        return s

    def cached_active_owned_session(claims, sid):
        now = clock()
        cached = qr_session_cache.get(sid)
        if cached is not None:
            cached_at, s = cached
            if 0 <= now - cached_at < 5.0 and s.get("status") == "active" and now <= s.get("expiresAtS", 0):
                if s.get("facultyEmail") != claims["email"]:
                    raise ApiError("not_session_owner", "Only the faculty who started this session can do that.", 403)
                return s
            qr_session_cache.pop(sid, None)
        s = owned_session(claims, sid)
        if s.get("status") != "active" or now > s.get("expiresAtS", 0):
            raise ApiError("session_inactive", "This attendance session is not active. Ask your faculty to start a new one.", 409)
        qr_session_cache[sid] = (now, s)
        return s

    def verify_ticket(token, kind, claims):
        payload, reason = tokens.verify_payload(cfg.qr_signing_secret, token, clock())
        if not payload:
            raise ApiError("ticket_invalid", "Your verification step expired. Scan the QR code again.", 400)
        if payload.get("k") != kind or payload.get("uid") != claims["uid"]:
            raise ApiError("ticket_invalid", "This verification step does not belong to your account.", 403)
        return payload

    def new_ticket(kind, claims, student, extra=None, sid=None):
        nonce = secrets.token_urlsafe(16)
        payload = {"k": kind, "uid": claims["uid"], "stu": student["id"], "nonce": nonce,
                   "exp": clock() + cfg.ticket_ttl_s, **({"sid": sid} if sid is not None else {}), **(extra or {})}
        return tokens.sign_payload(cfg.qr_signing_secret, payload), nonce

    # ------------------------------------------------------------ frame handling
    def decode_image(data):
        if not isinstance(data, str):
            raise ValueError("not a string")
        if "," in data[:100]:
            data = data.split(",", 1)[1]
        raw = base64.b64decode(data)
        if len(raw) > 1_500_000:
            raise ValueError("frame too large")
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("not an image")
        return prepare(img)

    def parse_frames(raw):
        if not isinstance(raw, list) or not raw:
            raise ApiError("no_frames", "No camera frames were received.", 400)
        if len(raw) > cfg.max_frames:
            raise ApiError("too_many_frames", "Too many camera frames were sent.", 400)
        infos = []
        for item in raw:
            if not isinstance(item, dict) or item.get("phase") not in ("front", "light", "turn"):
                raise ApiError("bad_frame", "A camera frame was malformed.", 400)
            try:
                t = float(item.get("t"))
                img = decode_image(item.get("image"))
            except (TypeError, ValueError):
                raise ApiError("bad_frame", "A camera frame could not be read.", 400)
            faces = engine.detect(img)
            face, issues = None, []
            if not faces:
                issues = ["no_face"]
            elif len(faces) > 1:
                issues = ["multiple_faces"]
            else:
                face = faces[0]
                issues = quality.assess(img, face.bbox, cfg)
            infos.append({"t": t, "phase": item["phase"], "img": img, "face": face, "issues": issues})
        return infos

    def frame_problem(infos):
        if any("multiple_faces" in i["issues"] for i in infos):
            return "multiple_faces"
        # Light-phase frames are excluded: strong colour casts can hide a face from the detector,
        # and the light analysis falls back to the face position seen in the front frames.
        judged = [i for i in infos if i["phase"] != "light"]
        if judged and sum(1 for i in judged if "no_face" in i["issues"]) / len(judged) > 0.3:
            return "no_face"
        return None

    def worst_issue(infos):
        counts = {}
        for i in infos:
            for issue in i["issues"]:
                counts[issue] = counts.get(issue, 0) + 1
        return max(counts, key=counts.get) if counts else "no_face"

    def run_liveness(infos, challenge):
        front = [i for i in infos if i["phase"] == "front" and i["face"] and not i["issues"]]
        turn = [i for i in infos if i["phase"] == "turn" and i["face"]]
        fallback_box = None
        if front:
            boxes = [i["face"].bbox for i in front]
            fallback_box = tuple(int(np.median([b[k] for b in boxes])) for k in range(4))
        samples = []
        for i in infos:
            if i["phase"] != "light":
                continue
            box = i["face"].bbox if i["face"] else fallback_box
            if box:
                samples.append((i["t"], liveness.face_roi_rgb_mean(i["img"], box)))
        light_res = liveness.analyze_light(samples, challenge, cfg)
        turn_res = liveness.analyze_turn(
            [liveness.yaw_ratio(i["face"].landmarks) for i in front],
            [liveness.yaw_ratio(i["face"].landmarks) for i in turn], challenge["turn"], cfg)
        return light_res, turn_res

    def sample(items, limit):
        return items if len(items) <= limit else [items[int(k * len(items) / limit)] for k in range(limit)]

    def load_template(student_id):
        doc = store.get_template(student_id)
        if not doc:
            return None
        try:
            t = templates.decode(cfg, doc)
        except Exception:
            raise ApiError("template_unreadable", "Your stored face profile could not be read. Contact your Class Advisor.", 503)
        return {"mean": normalize(t["mean"]), "embeddings": [normalize(e) for e in t["embeddings"]]}

    def similarity(emb, tpl):
        return max([cosine(emb, tpl["mean"])] + [cosine(emb, e) for e in tpl["embeddings"]])

    def liveness_decision(light_res, turn_res):
        """Returns (failure, level). failure is (code, message) or None.
        level: full (light pass) | reduced (light could not be measured / was ignored) | skipped.
        The head-turn is always enforced. How the light check is enforced depends on light_check_mode."""
        if not turn_res["passed"]:
            msg = {"not_facing_camera": "Face the camera straight on at the start, then follow the turn instruction.",
                   "insufficient_frames": "The camera did not capture enough frames. Keep your face in view for the whole check."}.get(
                turn_res["reason"], "Head turn not detected. Turn your head clearly to one side, then hold for a second.")
            return ("liveness_turn_failed", msg), None
        mode, status = cfg.light_check_mode, light_res["status"]
        if mode == "off":
            return None, "skipped"
        if status == "pass":
            return None, "full"
        if status == "fail" and mode in ("auto", "enforce"):
            return ("liveness_light_failed",
                    "The screen-light check did not match. Keep your face in front of the screen, avoid moving lights or "
                    "a second screen, and try again."), None
        if status == "inconclusive" and mode == "enforce":
            msg = {"too_dark": "It is too dark for the light check. Move to a brighter place and raise screen brightness.",
                   "insufficient_frames": "The camera did not capture enough frames for the light check. Try again."}.get(
                light_res["reason"], "Your face showed no measurable reaction to the screen light. Raise screen brightness to "
                                     "maximum, hold the device about 30 cm away, and avoid bright sunlight behind or on you.")
            return ("liveness_light_failed", msg), None
        return None, "reduced"

    def round_light(res):
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items()}

    # ---------------------------------------------------------------- routes
    @app.get("/health")
    def health():
        return jsonify({"ok": True, "faceEngine": engine is not None, "faceEngineError": engine_error,
                        "templateEncryption": bool(cfg.face_template_key)})

    # ---- faculty ----
    @app.post("/sessions/start")
    def sessions_start():
        claims, body = authenticate(), json_body()
        ca_id = str(body.get("caId") or "").strip()
        appt = str(body.get("appointmentId") or "").strip() or None
        if not ID_RE.match(ca_id) or (appt and not ID_RE.match(appt)):
            raise ApiError("bad_request", "A valid class advisor id is required.", 400)
        if not store.is_approved_faculty(claims["email"]) and claims["email"] not in store.ca_owner_emails(ca_id, appt):
            raise ApiError("not_session_owner", "This account is not authorised to start an attendance session.", 403)
        if not store.ca_exists(ca_id, appt):
            raise ApiError("bad_request", "Class advisor profile was not found.", 404)
        sid = int(clock() * 1000)
        while store.get_session(sid):
            sid += 1
        store.purge_stale_faces(clock() - cfg.ticket_ttl_s)
        store.end_active_sessions_for_ca(ca_id, clock(), faculty_email=claims["email"])
        qr_session_cache.clear()
        now_s = clock()
        store.put_session({
            "sessionId": sid, "caId": ca_id, "appointmentId": appt or "", "facultyEmail": claims["email"],
            "facultyName": str(body.get("facultyName") or "")[:120], "subject": str(body.get("subject") or "")[:120],
            "status": "active", "startedAtS": now_s, "expiresAtS": now_s + cfg.attendance_window_s,
        })
        token, exp = tokens.issue_qr_token(cfg.qr_signing_secret, sid, cfg.qr_ttl_s, now_s)
        log.info("Session started sid=%s caId=%s qrExpiresAt=%s", sid, ca_id, exp)
        return jsonify({
            "ok": True,
            "sessionId": sid,
            "qrToken": token,
            "qrExpiresAt": exp,
            "qrRefreshMs": cfg.qr_refresh_ms,
            "qrTtlSeconds": cfg.qr_ttl_s,
            "qrGraceSeconds": cfg.qr_grace_s,
            "serverTimeMs": int(now_s * 1000),
            "windowSeconds": cfg.attendance_window_s,
        })

    @app.get("/sessions/<int:sid>")
    def sessions_get(sid):
        claims = authenticate()
        s = owned_session(claims, sid)
        live = s.get("status") == "active" and clock() <= s.get("expiresAtS", 0)
        left = max(0, int(s.get("expiresAtS", 0) - clock())) if live else 0
        return jsonify({"ok": True, "active": live, "status": s.get("status"), "secondsLeft": left})

    @app.get("/sessions/<int:sid>/qr")
    def sessions_qr(sid):
        claims = authenticate()
        cached_active_owned_session(claims, sid)
        now_s = clock()
        token, exp = tokens.issue_qr_token(cfg.qr_signing_secret, sid, cfg.qr_ttl_s, now_s)
        log.debug("QR refreshed sid=%s expiresAt=%s", sid, exp)
        return jsonify({
            "ok": True,
            "token": token,
            "expiresAt": exp,
            "serverTime": int(now_s),
            "serverTimeMs": int(now_s * 1000),
            "refreshIntervalMs": cfg.qr_refresh_ms,
            "qrTtlSeconds": cfg.qr_ttl_s,
        })

    @app.post("/sessions/<int:sid>/end")
    def sessions_end(sid):
        claims = authenticate()
        owned_session(claims, sid)
        store.end_session(sid, clock())
        qr_session_cache.pop(sid, None)
        return jsonify({"ok": True})

    # ---- face enrollment ----
    @app.post("/face/status")
    def face_status():
        claims, body = authenticate(), json_body()
        student = student_context(claims, body)
        return jsonify({"ok": True, "enrolled": store.get_template(student["id"]) is not None})

    @app.post("/face/enroll/begin")
    def enroll_begin():
        need_engine()
        claims, body = authenticate(), json_body()
        student = student_context(claims, body)
        if body.get("consent") is not True:
            raise ApiError("consent_required", "You must consent to face enrollment to continue.", 400)
        ticket, nonce = new_ticket("enroll", claims, student)
        return jsonify({"ok": True, "ticket": ticket, "challenge": liveness.make_challenge(cfg.qr_signing_secret, nonce, cfg),
                        "minFrontFrames": cfg.enroll_min_frames, "maxFrontFrames": cfg.enroll_max_frames,
                        "expiresInSec": cfg.ticket_ttl_s})

    @app.post("/face/enroll/complete")
    def enroll_complete():
        need_engine()
        claims, body = authenticate(), json_body()
        ticket = verify_ticket(body.get("ticket"), "enroll", claims)
        student = store.get_student_by_id(ticket["stu"])
        if not student or _email(student.get("email")) != claims["email"]:
            raise ApiError("student_not_found", "No student record matches this Google account.", 404)
        if not store.consume_nonce(ticket["nonce"]):
            raise ApiError("ticket_used", "This enrollment attempt was already used. Start again.", 409)
        infos = parse_frames(body.get("frames"))
        problem = frame_problem(infos)
        if problem:
            raise ApiError(problem, ISSUE_MESSAGES[problem], 422)
        front = [i for i in infos if i["phase"] == "front" and i["face"] and not i["issues"]]
        if len(front) < cfg.enroll_min_frames:
            issue = worst_issue([i for i in infos if i["phase"] == "front"])
            raise ApiError("enroll_not_enough_frames", ISSUE_MESSAGES.get(issue, "Not enough clear face frames."), 422)
        challenge = liveness.make_challenge(cfg.qr_signing_secret, ticket["nonce"], cfg)
        light_res, turn_res = run_liveness(infos, challenge)
        fail, _level = liveness_decision(light_res, turn_res)
        if fail:
            extra = {"debug": {"light": round_light(light_res), "turn": round_light(turn_res)}} if cfg.debug_scores else {}
            raise ApiError(fail[0], fail[1], 422, **extra)
        embs = [engine.embed(i["img"], i["face"]) for i in sample(front, cfg.enroll_max_frames)]
        mean = normalize(np.mean(embs, axis=0))
        keep = [e for e in embs if cosine(e, mean) >= cfg.enroll_consistency]
        if len(keep) < cfg.enroll_min_frames:
            raise ApiError("enroll_inconsistent", "The captured frames did not look like the same person. Make sure only you are in view.", 422)
        mean = normalize(np.mean(keep, axis=0))
        existing = load_template(student["id"])
        if existing and similarity(mean, existing) < cfg.match_threshold:
            raise ApiError("reenroll_blocked", "A different face is already enrolled for this account. Ask your Class Advisor to reset it.", 403)
        try:
            doc = templates.encode(cfg, {"v": 1, "model": getattr(engine, "name", "unknown"),
                                         "embeddings": [e.tolist() for e in keep], "mean": mean.tolist()})
        except templates.TemplateConfigError as exc:
            raise ApiError("server_misconfigured", str(exc), 503)
        store.put_template(student["id"], doc)
        store.log_attempt({"kind": "enroll", "studentId": student["id"], "outcome": "ok"})
        return jsonify({"ok": True, "enrolled": True, "samples": len(keep)})

    # ---- student attendance ----
    @app.post("/attendance/begin")
    def attendance_begin():
        need_engine()
        claims, body = authenticate(), json_body()
        raw_qr = str(body.get("qrToken") or "").strip()
        has_ca2 = raw_qr.startswith(f"{tokens.QR_PREFIX}.")
        ok, sid, reason = tokens.verify_qr_token(cfg.qr_signing_secret, raw_qr, cfg.qr_grace_s, clock())
        if not ok:
            log.warning("QR rejected reason=%s hasCa2=%s len=%d", reason, has_ca2, len(raw_qr))
            msg = {"expired": "This QR code has expired. Scan the refreshed code on the faculty screen.",
                   "bad_signature": "This is not a valid attendance QR code.",
                   "malformed": "This is not a valid attendance QR code."}[reason]
            raise ApiError("qr_expired" if reason == "expired" else "qr_invalid", msg, 400)
        session = active_session(sid)
        student = student_context(claims, body)
        device_id = device_id_from(body)
        if store.get_failures(sid, student["id"]) >= cfg.max_attempts:
            raise ApiError("too_many_attempts", "Too many failed verification attempts. Ask your faculty to mark you manually.", 429)
        if store.is_present(student["usn"], sid):
            raise ApiError("already_marked", "Attendance has already been marked for you in this session.", 409)
        if store.get_template(student["id"]) is None:
            raise ApiError("face_not_enrolled", "Enroll your face first (Dashboard → Face Enrollment).", 412)
        log.info("Attendance begin approved sid=%s student=%s usn=%s", sid, student["id"], student["usn"])
        ticket, nonce = new_ticket("attend", claims, student, sid=sid)
        resp = {
            "ok": True,
            "ticket": ticket,
            "challenge": liveness.make_challenge(cfg.qr_signing_secret, nonce, cfg),
            "expiresInSec": cfg.ticket_ttl_s,
            "session": {
                "sessionId": sid,
                "subject": session.get("subject", ""),
                "facultyName": session.get("facultyName", ""),
                "caId": session.get("caId", ""),
            },
        }
        return jsonify(resp)

    @app.post("/attendance/complete")
    def attendance_complete():
        need_engine()
        claims, body = authenticate(), json_body()
        ticket = verify_ticket(body.get("ticket"), "attend", claims)
        sid = int(ticket["sid"])
        session = session_for_completion(sid)
        student_doc = store.get_student_by_id(ticket["stu"])
        if not student_doc or _email(student_doc.get("email")) != claims["email"]:
            raise ApiError("student_not_found", "No student record matches this Google account.", 404)
        student = {"id": student_doc["id"], "usn": _usn(student_doc.get("usn")), "name": student_doc.get("name", "Student"),
                   "class": student_doc.get("class", ""), "email": claims["email"], "uid": claims["uid"]}
        device_id = device_id_from(body)
        if store.get_failures(sid, student["id"]) >= cfg.max_attempts:
            raise ApiError("too_many_attempts", "Too many failed verification attempts. Ask your faculty to mark you manually.", 429)
        if not store.consume_nonce(ticket["nonce"]):
            raise ApiError("ticket_used", "This verification was already used. Scan the QR code again.", 409)

        debug = {}

        def reject(code, message, status=422):
            n = store.bump_failures(sid, student["id"])
            store.log_attempt({"kind": "attend", "sessionId": sid, "studentId": student["id"], "outcome": code})
            log.warning(
                "Attendance rejected sid=%s student=%s code=%s attemptsLeft=%d",
                sid,
                student["id"],
                code,
                max(0, cfg.max_attempts - n),
            )
            extra = {"attemptsLeft": max(0, cfg.max_attempts - n)}
            if cfg.debug_scores:
                extra["debug"] = debug
            raise ApiError(code, message, status, **extra)

        infos = parse_frames(body.get("frames"))
        problem = frame_problem(infos)
        if problem:
            reject(problem, ISSUE_MESSAGES[problem])
        front = [i for i in infos if i["phase"] == "front" and i["face"] and not i["issues"]]
        if len(front) < 3:
            reject("no_face", ISSUE_MESSAGES[worst_issue([i for i in infos if i["phase"] == "front"])])
        challenge = liveness.make_challenge(cfg.qr_signing_secret, ticket["nonce"], cfg)
        light_res, turn_res = run_liveness(infos, challenge)
        debug.update({"light": round_light(light_res), "turn": round_light(turn_res), "lightMode": cfg.light_check_mode})
        fail, liveness_level = liveness_decision(light_res, turn_res)
        if fail:
            reject(*fail)

        tpl = load_template(student["id"])
        if tpl is None:
            raise ApiError("face_not_enrolled", "Enroll your face first (Dashboard → Face Enrollment).", 412)
        front_embs = [engine.embed(i["img"], i["face"]) for i in sample(front, 6)]
        front_sims = [similarity(e, tpl) for e in front_embs]
        light_faces = [i for i in infos if i["phase"] == "light" and i["face"]]
        light_sims = [similarity(engine.embed(i["img"], i["face"]), tpl) for i in sample(light_faces, 4)]
        debug["faceScore"] = round(float(np.median(front_sims)), 3)
        debug["lightFaceScore"] = round(float(np.median(light_sims)), 3) if light_sims else None
        if float(np.median(front_sims)) < cfg.match_threshold:
            reject("face_mismatch", "Your face does not match the profile registered for this account.")
        # Strong colour casts can stop the detector from seeing the face in some light frames; only judge identity
        # during the flash when enough frames were detected (front + turn frames are always judged).
        if len(light_sims) >= 2 and float(np.median(light_sims)) < cfg.match_threshold - cfg.light_identity_slack:
            reject("face_mismatch", "Your face could not be confirmed during the light check. Try again in steadier light.")

        mean_emb = normalize(np.mean(front_embs, axis=0))
        for other_id, rec in store.session_faces(sid).items():
            if other_id == student["id"]:
                continue
            if cosine(mean_emb, rec["embedding"]) >= cfg.dup_face_threshold:
                reject("face_reused", "This face has already been used to mark attendance for another student in this session.", 403)
            if rec.get("deviceId") == device_id:
                reject("device_reused", "This device has already marked attendance for another student in this session.", 403)

        verification = {
            "faceVerified": True, "faceMatchScore": round(float(np.median(front_sims)), 3),
            "livenessVerified": True, "livenessLevel": liveness_level, "lightStatus": light_res["status"],
            "lightScore": round(light_res["score"], 3),
            "deviceId": device_id, "verifiedBy": "backend", "verificationVersion": 3,
        }
        try:
            outcome = store.mark_present(session, student, verification)
        except AlreadyMarked:
            raise ApiError("already_marked", "Attendance has already been marked for you in this session.", 409)
        store.put_session_face(sid, student["id"], mean_emb, device_id)
        store.log_attempt({"kind": "attend", "sessionId": sid, "studentId": student["id"], "outcome": "present"})
        log.info("Attendance marked sid=%s student=%s usn=%s liveness=%s", sid, student["id"], student["usn"], liveness_level)
        resp = {"ok": True, "status": "present", "record": outcome, "livenessLevel": liveness_level,
                "verified": {"qr": True, "face": True, "liveness": True}}
        if cfg.debug_scores:
            resp["debug"] = debug
        return jsonify(resp)

    # ---- admin (hackathon-grade): reset a student's face profile ----
    @app.delete("/admin/face/<student_id>")
    def admin_reset_face(student_id):
        key = request.headers.get("X-Admin-Key", "")
        if not cfg.admin_key or not hmac.compare_digest(key, cfg.admin_key):
            raise ApiError("not_found", "Not found.", 404)
        if not ID_RE.match(student_id):
            raise ApiError("bad_request", "Invalid student id.", 400)
        store.delete_template(student_id)
        return jsonify({"ok": True})

    return app
