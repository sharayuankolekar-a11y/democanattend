import unittest

import helpers
import liveness
from helpers import (FAC, S1, S1_BODY, S2, S2_BODY, auth, begin, build_frames, complete, enroll,
                     make_env, qr_token, start_session)


class Base(unittest.TestCase):
    def setUp(self):
        self.c, self.store, self.cfg, self.clock = make_env()

    def present_rows(self, usn):
        return [v for v in self.store.attendance.values() if v["usn"] == usn]

    def ready(self, enroll_s1=7, enroll_s2=None):
        sid = start_session(self.c, self.store)
        if enroll_s1 is not None:
            self.assertEqual(enroll(self.c, S1, S1_BODY, enroll_s1).status_code, 200)
        if enroll_s2 is not None:
            self.assertEqual(enroll(self.c, S2, S2_BODY, enroll_s2).status_code, 200)
        return sid


class CorsTests(Base):
    def test_only_configured_origins_are_allowed(self):
        c, *_ = make_env(allowed_origins=["https://app.example.com"])
        ok = c.get("/health", headers={"Origin": "https://app.example.com"})
        self.assertEqual(ok.headers.get("Access-Control-Allow-Origin"), "https://app.example.com")
        bad = c.get("/health", headers={"Origin": "https://evil.example.com"})
        self.assertNotIn("Access-Control-Allow-Origin", bad.headers)
        pre = c.options("/attendance/begin", headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "POST"})
        self.assertIn("Authorization", pre.headers.get("Access-Control-Allow-Headers", ""))


class SessionTests(Base):
    def test_health_and_unauthenticated(self):
        self.assertTrue(self.c.get("/health").get_json()["faceEngine"])
        self.assertEqual(self.c.post("/sessions/start", json={}).status_code, 401)
        self.assertEqual(self.c.post("/sessions/start", headers={"Authorization": "Bearer junk"}, json={}).status_code, 401)

    def test_start_session_without_location_and_authorization(self):
        # Students, pending faculty, and unregistered users cannot start sessions
        r = self.c.post("/sessions/start", headers=S1, json={"caId": "t1"})
        self.assertEqual(r.status_code, 403)
        r = self.c.post("/sessions/start", headers=auth("pending@cec.edu"), json={"caId": "t1"})
        self.assertEqual(r.status_code, 403)
        r = self.c.post("/sessions/start", headers=auth("nobody@cec.edu"), json={"caId": "t1"})
        self.assertEqual(r.status_code, 403)
        # Invalid or missing caId rejected
        r = self.c.post("/sessions/start", headers=FAC, json={"caId": "../x"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/sessions/start", headers=FAC, json={"caId": "missing_ca"})
        self.assertEqual(r.status_code, 404)
        # Approved faculty can start session without location
        r = self.c.post("/sessions/start", headers=FAC, json={"caId": "t1", "subject": "DSA"})
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertTrue(data["ok"])
        self.assertIn("sessionId", data)
        self.assertTrue(data["qrToken"].startswith("CA2."))
        self.assertNotIn("radiusMeters", data)
        stored = self.store.get_session(data["sessionId"])
        self.assertNotIn("location", stored)
        # Initial qrToken returned by /sessions/start is immediately accepted for enrolled student
        self.assertEqual(enroll(self.c, S1, S1_BODY, 7).status_code, 200)
        b = begin(self.c, S1, S1_BODY, f"  {data['qrToken']}\n")
        self.assertEqual(b.status_code, 200)
        self.assertEqual(b.get_json()["session"]["sessionId"], data["sessionId"])

    def test_approved_subject_faculty_can_start_for_class_and_only_owner_can_manage(self):
        self.store.appointments["a9"] = {"status": "active", "facultyEmail": "fac@cec.edu", "facultyDocId": "t1"}
        r = self.c.post("/sessions/start", headers=auth("other@cec.edu"), json={"caId": "t1", "appointmentId": "a9", "subject": "CN"})
        self.assertEqual(r.status_code, 200)
        sid = r.get_json()["sessionId"]
        # Another faculty member cannot read status, fetch QR, or end someone else's session
        self.assertEqual(self.c.get(f"/sessions/{sid}", headers=FAC).status_code, 403)
        self.assertEqual(self.c.get(f"/sessions/{sid}/qr", headers=FAC).status_code, 403)
        self.assertEqual(self.c.post(f"/sessions/{sid}/end", headers=FAC).status_code, 403)
        # Session owner can manage their own session
        self.assertEqual(self.c.get(f"/sessions/{sid}/qr", headers=auth("other@cec.edu")).status_code, 200)
        self.assertEqual(self.c.post(f"/sessions/{sid}/end", headers=auth("other@cec.edu")).status_code, 200)

    def test_qr_endpoint_owner_only_and_new_session_closes_old(self):
        sid1 = start_session(self.c, self.store)
        self.assertEqual(self.c.get(f"/sessions/{sid1}/qr", headers=S1).status_code, 403)
        self.assertEqual(self.c.get(f"/sessions/{sid1}/qr", headers=auth("other@cec.edu")).status_code, 403)
        self.clock.advance(5)
        sid2 = start_session(self.c, self.store)
        self.assertNotEqual(sid1, sid2)
        self.assertFalse(self.c.get(f"/sessions/{sid1}", headers=FAC).get_json()["active"])
        self.assertTrue(self.c.get(f"/sessions/{sid2}", headers=FAC).get_json()["active"])

    def test_qr_token_is_compact_signed_ca2(self):
        sid = start_session(self.c, self.store)
        tok = qr_token(self.c, sid)
        self.assertTrue(tok.startswith("CA2."))
        self.assertLess(len(tok), 64)

    def test_1s_qr_rotation_issues_fresh_tokens_and_invalidates_on_end(self):
        r = self.c.post("/sessions/start", headers=FAC, json={"caId": "t1", "subject": "DSA"})
        self.assertEqual(r.status_code, 200)
        start_data = r.get_json()
        sid = start_data["sessionId"]
        self.assertEqual(start_data["qrRefreshMs"], 1000)
        self.assertEqual(start_data["qrTtlSeconds"], self.cfg.qr_ttl_s)
        self.assertEqual(start_data["qrGraceSeconds"], self.cfg.qr_grace_s)

        issued = [start_data["qrToken"]]
        for _ in range(3):
            self.clock.advance(1.0)
            q = self.c.get(f"/sessions/{sid}/qr", headers=FAC)
            self.assertEqual(q.status_code, 200)
            q_data = q.get_json()
            self.assertEqual(q_data["refreshIntervalMs"], 1000)
            self.assertEqual(q_data["qrTtlSeconds"], self.cfg.qr_ttl_s)
            issued.append(q_data["token"])

        self.assertEqual(len(set(issued)), 4)
        self.assertTrue(self.c.get(f"/sessions/{sid}", headers=FAC).get_json()["active"])

        # Ending the session invalidates the cached active-session lookup immediately
        self.assertEqual(self.c.post(f"/sessions/{sid}/end", headers=FAC).status_code, 200)
        closed_qr = self.c.get(f"/sessions/{sid}/qr", headers=FAC)
        self.assertEqual((closed_qr.status_code, closed_qr.get_json()["code"]), (409, "session_inactive"))


class BeginTests(Base):
    def test_invalid_and_forged_qr(self):
        sid = self.ready()
        for junk in ["", "hello", '{"caId":"t1","sessionId":%d,"timestamp":1,"location":{}}' % sid, "subject:Math|expiry:0"]:
            r = begin(self.c, S1, S1_BODY, junk)
            self.assertEqual((r.status_code, r.get_json()["code"]), (400, "qr_invalid"))
        parts = qr_token(self.c, sid).split(".")
        forged = ".".join([parts[0], parts[1], str(int(parts[2]) + 500), parts[3]])
        self.assertEqual(begin(self.c, S1, S1_BODY, forged).get_json()["code"], "qr_invalid")
        self.assertEqual(len(self.present_rows("1CE21CS001")), 1)
        self.assertEqual(self.present_rows("1CE21CS001")[0]["status"], "absent")

    def test_qr_expiry_with_grace(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        self.clock.advance(self.cfg.qr_ttl_s + 1)                 # 3s ttl + inside 2s grace
        self.assertEqual(begin(self.c, S1, S1_BODY, tok).status_code, 200)
        self.clock.advance(self.cfg.qr_grace_s + 1)               # past ttl + grace -> expired
        r = begin(self.c, S1, S1_BODY, tok)
        self.assertEqual((r.status_code, r.get_json()["code"]), (400, "qr_expired"))

    def test_begin_works_without_location_and_returns_session_info(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        r = begin(self.c, S1, S1_BODY, tok)
        self.assertEqual(r.status_code, 200)
        j = r.get_json()
        self.assertNotIn("locationVerified", j)
        self.assertEqual(j["session"]["sessionId"], sid)
        self.assertEqual(j["session"]["subject"], "Maths")
        self.assertEqual(j["session"]["facultyName"], "Prof Fac")

    def test_login_and_enrollment_gates(self):
        sid = self.ready(enroll_s1=None)
        tok = qr_token(self.c, sid)
        self.assertEqual(begin(self.c, S1, S1_BODY, tok).get_json()["code"], "face_not_enrolled")
        self.assertEqual(begin(self.c, S1, {**S1_BODY, "sessionToken": "wrong"}, tok).get_json()["code"], "login_not_approved")
        self.assertEqual(begin(self.c, S1, S2_BODY, tok).get_json()["code"], "login_not_approved")   # someone else's approval
        self.assertEqual(begin(self.c, auth("nobody@cec.edu"), S1_BODY, tok).status_code, 404)
        self.store.login_requests["lr1"]["status"] = "logged_out"
        self.assertEqual(begin(self.c, S1, S1_BODY, tok).get_json()["code"], "login_not_approved")

    def test_ended_session_rejected(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        self.c.post(f"/sessions/{sid}/end", headers=FAC)
        self.assertEqual(begin(self.c, S1, S1_BODY, tok).get_json()["code"], "session_inactive")


class EnrollTests(Base):
    def test_consent_required(self):
        r = self.c.post("/face/enroll/begin", headers=S1, json=S1_BODY)
        self.assertEqual(r.get_json()["code"], "consent_required")

    def test_enroll_success_stores_only_encrypted_embeddings(self):
        self.assertFalse(self.c.post("/face/status", headers=S1, json=S1_BODY).get_json()["enrolled"])
        self.assertEqual(enroll(self.c, S1, S1_BODY, 7).status_code, 200)
        self.assertTrue(self.c.post("/face/status", headers=S1, json=S1_BODY).get_json()["enrolled"])
        doc = self.store.templates["s1"]
        self.assertTrue(doc["enc"])
        self.assertNotIn("embeddings", doc)
        self.assertNotIn("image", str(doc).lower())

    def test_photo_enrollment_blocked_in_enforce_mode(self):
        self.c, self.store, self.cfg, self.clock = make_env(light_check_mode="enforce")
        r = enroll(self.c, S1, S1_BODY, 7, light="static")
        self.assertEqual(r.get_json()["code"], "liveness_light_failed")
        self.assertNotIn("s1", self.store.templates)

    def test_photo_enrollment_still_needs_a_head_turn_in_auto_mode(self):
        r = enroll(self.c, S1, S1_BODY, 7, light="static", turn="none")
        self.assertEqual(r.get_json()["code"], "liveness_turn_failed")
        self.assertNotIn("s1", self.store.templates)

    def test_too_few_or_bad_frames(self):
        r = enroll(self.c, S1, S1_BODY, 7, n_front=3)
        self.assertEqual(r.get_json()["code"], "enroll_not_enough_frames")
        r = enroll(self.c, S1, S1_BODY, 7, front_base=(15, 12, 10))
        self.assertEqual(r.get_json()["code"], "enroll_not_enough_frames")
        self.assertIn("dark", r.get_json()["message"].lower())

    def test_reenroll_with_other_face_blocked_until_admin_reset(self):
        self.assertEqual(enroll(self.c, S1, S1_BODY, 7).status_code, 200)
        r = enroll(self.c, S1, S1_BODY, 9)
        self.assertEqual((r.status_code, r.get_json()["code"]), (403, "reenroll_blocked"))
        self.assertEqual(enroll(self.c, S1, S1_BODY, 7).status_code, 200)       # same person may refresh
        self.assertEqual(self.c.delete("/admin/face/s1").status_code, 404)
        self.assertEqual(self.c.delete("/admin/face/s1", headers={"X-Admin-Key": "adm"}).status_code, 200)
        self.assertEqual(enroll(self.c, S1, S1_BODY, 9).status_code, 200)


class AttendanceTests(Base):
    def test_full_happy_path_and_record_shape(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid))
        self.assertEqual(b.status_code, 200, b.get_json())
        r = complete(self.c, S1, S1_BODY, b.get_json(), 7)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["record"], "updated")
        self.assertEqual(r.get_json()["verified"], {"qr": True, "face": True, "liveness": True})
        rows = self.present_rows("1CE21CS001")
        self.assertEqual(len(rows), 1)                                   # absent row upgraded, no duplicate row
        rec = rows[0]
        self.assertEqual(rec["status"], "present")
        for k in ("faceVerified", "livenessVerified"):
            self.assertTrue(rec[k])
        self.assertNotIn("locationVerified", rec)
        self.assertNotIn("studentLocation", rec)
        self.assertEqual(rec["verifiedBy"], "backend")
        self.assertEqual(rec["sessionId"], sid)
        self.assertEqual(rec["caId"], "t1")
        self.assertEqual(self.present_rows("1CE21CS002")[0]["status"], "absent")

    def test_creates_record_when_no_absent_row_exists(self):
        sid = self.ready()
        self.store.attendance.clear()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 7)
        self.assertEqual(r.get_json()["record"], "created")
        rec = list(self.store.attendance.values())[0]
        self.assertEqual((rec["usn"], rec["status"], rec["studentId"], rec["caId"]), ("1CE21CS001", "present", "s1", "t1"))

    def test_duplicate_attendance_prevented(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).status_code, 200)
        r = begin(self.c, S1, S1_BODY, qr_token(self.c, sid))
        self.assertEqual((r.status_code, r.get_json()["code"]), (409, "already_marked"))
        r = complete(self.c, S1, S1_BODY, b, 7)                           # replaying the old ticket
        self.assertIn(r.get_json()["code"], ("ticket_used",))
        self.assertEqual(len(self.present_rows("1CE21CS001")), 1)

    def test_wrong_person_rejected(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 9)
        j = r.get_json()
        self.assertEqual((r.status_code, j["code"], j["attemptsLeft"]), (422, "face_mismatch", 4))
        self.assertEqual(self.present_rows("1CE21CS001")[0]["status"], "absent")

    def test_replayed_video_reacting_to_other_colours_is_rejected_even_in_auto_mode(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        b = begin(self.c, S1, S1_BODY, tok).get_json()
        inverse = [[255 - v for v in c] for c in b["challenge"]["light"]["colors"]]
        r = complete(self.c, S1, S1_BODY, b, 7, light="wrong", other_colors=inverse)
        self.assertEqual(r.get_json()["code"], "liveness_light_failed")
        self.assertEqual(self.present_rows("1CE21CS001")[0]["status"], "absent")

    def test_still_face_without_head_turn_rejected(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, turn="none").get_json()["code"], "liveness_turn_failed")
        self.assertEqual(self.present_rows("1CE21CS001")[0]["status"], "absent")

    def test_turn_direction_is_tolerant_by_default_and_strict_on_request(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, turn="wrong").status_code, 200)     # mirrored cameras still work
        self.c, self.store, self.cfg, self.clock = make_env(turn_direction_mode="exact")
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, turn="wrong").get_json()["code"], "liveness_turn_failed")

    def test_unmeasurable_light_policy_auto_vs_enforce_vs_off(self):
        # auto: allowed but flagged as reduced (documented trade-off for bright rooms / strong auto white balance)
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 7, light="static")
        self.assertEqual((r.status_code, r.get_json()["livenessLevel"]), (200, "reduced"))
        rec = self.present_rows("1CE21CS001")[0]
        self.assertEqual((rec["livenessLevel"], rec["lightStatus"]), ("reduced", "inconclusive"))
        # enforce: rejected
        self.c, self.store, self.cfg, self.clock = make_env(light_check_mode="enforce")
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 7, light="static")
        self.assertEqual(r.get_json()["code"], "liveness_light_failed")
        self.assertIn("brightness", r.get_json()["message"].lower())
        # off: skipped
        self.c, self.store, self.cfg, self.clock = make_env(light_check_mode="off")
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, light="static").get_json()["livenessLevel"], "skipped")

    def test_face_not_detected_under_colour_cast_does_not_break_a_genuine_check(self):
        self.assertEqual(enroll(self.c, S1, S1_BODY, 7).status_code, 200)       # (ready() would enroll too; keep explicit)
        sid = start_session(self.c, self.store)
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 7, light_flag=1)                   # detector sees no face in any light frame
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["livenessLevel"], "full")                 # ROI fell back to the front-frame face position

    def test_ticket_cannot_be_used_by_another_account(self):
        sid = self.ready(enroll_s2=8)
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S2, S2_BODY, b, 8)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.present_rows("1CE21CS002")[0]["status"], "absent")

    def test_tampered_ticket_rejected(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        frames = build_frames(b["challenge"], 7)
        r = self.c.post("/attendance/complete", headers=S1, json={"ticket": b["ticket"][:-3] + "abc", "frames": frames, "deviceId": S1_BODY["deviceId"]})
        self.assertEqual(r.get_json()["code"], "ticket_invalid")

    def test_ticket_expires(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.clock.advance(self.cfg.ticket_ttl_s + 1)
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).get_json()["code"], "ticket_invalid")

    def test_attempt_limit_locks_student_out(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        for _ in range(self.cfg.max_attempts):
            b = begin(self.c, S1, S1_BODY, tok).get_json()
            self.assertEqual(complete(self.c, S1, S1_BODY, b, 9).get_json()["code"], "face_mismatch")
        r = begin(self.c, S1, S1_BODY, tok)
        self.assertEqual((r.status_code, r.get_json()["code"]), (429, "too_many_attempts"))

    def test_same_face_on_second_account_rejected(self):
        sid = self.ready(enroll_s1=7, enroll_s2=7)             # one person enrolled under two accounts
        tok = qr_token(self.c, sid)
        b = begin(self.c, S1, S1_BODY, tok).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).status_code, 200)
        b = begin(self.c, S2, S2_BODY, tok).get_json()
        r = complete(self.c, S2, S2_BODY, b, 7)
        self.assertEqual((r.status_code, r.get_json()["code"]), (403, "face_reused"))
        self.assertEqual(self.present_rows("1CE21CS002")[0]["status"], "absent")

    def test_same_device_for_two_students_rejected(self):
        sid = self.ready(enroll_s1=7, enroll_s2=8)
        tok = qr_token(self.c, sid)
        b = begin(self.c, S1, S1_BODY, tok).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).status_code, 200)
        shared = {**S2_BODY, "deviceId": S1_BODY["deviceId"]}
        b = begin(self.c, S2, shared, tok).get_json()
        r = complete(self.c, S2, shared, b, 8)
        self.assertEqual((r.status_code, r.get_json()["code"]), (403, "device_reused"))

    def test_two_different_students_on_two_devices_both_succeed(self):
        sid = self.ready(enroll_s1=7, enroll_s2=8)
        tok = qr_token(self.c, sid)
        for hdr, body, ident in ((S1, S1_BODY, 7), (S2, S2_BODY, 8)):
            b = begin(self.c, hdr, body, tok).get_json()
            self.assertEqual(complete(self.c, hdr, body, b, ident).status_code, 200)

    def test_multiple_faces_and_missing_face(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        b = begin(self.c, S1, S1_BODY, tok).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, flag=2).get_json()["code"], "multiple_faces")
        b = begin(self.c, S1, S1_BODY, tok).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7, flag=1).get_json()["code"], "no_face")

    def test_dark_front_frames_give_a_lighting_message(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        r = complete(self.c, S1, S1_BODY, b, 7, front_base=(15, 12, 10))
        self.assertEqual(r.get_json()["code"], "no_face")
        self.assertIn("dark", r.get_json()["message"].lower())

    def test_verification_in_progress_may_finish_after_session_closes(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.c.post(f"/sessions/{sid}/end", headers=FAC)
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).status_code, 200)       # began while open -> may finish

    def test_completion_refused_long_after_session_closed(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.c.post(f"/sessions/{sid}/end", headers=FAC)
        self.clock.advance(self.cfg.ticket_ttl_s - 1)
        self.assertEqual(self.c.post("/attendance/complete", headers=S1, json={"ticket": b["ticket"], "frames": [], "deviceId": S1_BODY["deviceId"]}).get_json()["code"], "no_frames")
        sid2 = self.ready(enroll_s1=None)                       # fresh session so we can test a hard-expired one
        b2 = begin(self.c, S1, S1_BODY, qr_token(self.c, sid2)).get_json()
        self.clock.advance(self.cfg.attendance_window_s + self.cfg.ticket_ttl_s + 5)
        self.assertIn(complete(self.c, S1, S1_BODY, b2, 7).get_json()["code"], ("ticket_invalid", "session_inactive"))

    def test_new_scans_refused_after_window_even_if_not_ended(self):
        sid = self.ready()
        tok = qr_token(self.c, sid)
        self.clock.advance(self.cfg.attendance_window_s + 1)
        self.assertEqual(begin(self.c, S1, S1_BODY, tok).get_json()["code"], "qr_expired")
        self.assertEqual(self.c.get(f"/sessions/{sid}/qr", headers=FAC).get_json()["code"], "session_inactive")
        self.assertFalse(self.c.get(f"/sessions/{sid}", headers=FAC).get_json()["active"])

    def test_temporary_faces_are_purged_after_session_ends(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        self.assertEqual(complete(self.c, S1, S1_BODY, b, 7).status_code, 200)
        self.assertEqual(len(self.store.faces.get(sid, {})), 1)
        self.c.post(f"/sessions/{sid}/end", headers=FAC)
        self.assertEqual(len(self.store.faces.get(sid, {})), 1)             # kept during the short grace period
        self.clock.advance(self.cfg.ticket_ttl_s + 5)
        start_session(self.c, self.store)                                    # next session triggers the purge
        self.assertEqual(len(self.store.faces.get(sid, {})), 0)

    def test_malformed_frames(self):
        sid = self.ready()
        b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()
        for frames in (None, [], [{"phase": "x", "t": 0, "image": "zz"}], [{"phase": "front", "t": "a", "image": "zz"}],
                       [{"phase": "front", "t": 0, "image": "notbase64!!"}]):
            r = self.c.post("/attendance/complete", headers=S1, json={"ticket": b["ticket"], "frames": frames, "deviceId": S1_BODY["deviceId"]})
            self.assertIn(r.status_code, (400, 409), r.get_json())
            b = begin(self.c, S1, S1_BODY, qr_token(self.c, sid)).get_json()


class StudentsCannotSpoofVerificationFields(Base):
    def test_client_supplied_verdicts_are_ignored(self):
        sid = self.ready()
        r = self.c.post("/attendance/complete", headers=S1, json={
            "ticket": "x.y", "faceVerified": True, "livenessVerified": True, "frames": [], "deviceId": S1_BODY["deviceId"]})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.present_rows("1CE21CS001")[0]["status"], "absent")


if __name__ == "__main__":
    unittest.main()
