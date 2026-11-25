"""Persistence. MemoryStore powers the tests; FirestoreStore is the real thing.

Collections written by this service (via the Admin SDK, which bypasses client rules):
  attendance_sessions/{sessionId}            session metadata (never sent directly as raw secrets)
  attendance_sessions/{sessionId}/faces/{studentId}   temporary embeddings, deleted when the session ends
  attendance_sessions/{sessionId}/attempts/{studentId} failed-attempt counters
  attendance_nonces/{nonce}                  single-use challenge tickets
  attendance_attempts/{auto}                 audit log of accepted/rejected attempts
  face_templates/{studentDocId}              encrypted embeddings
  attendance/{...}                           the existing collection - same field shape as the app uses
"""
import re
import threading
import time
from datetime import datetime, timezone


class AlreadyMarked(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def _safe(text):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(text))


def present_update_fields(student, verification):
    """Fields set when an existing (absent) record is upgraded to present."""
    return {"status": "present", "time": _now(), "email": student["email"],
            "studentEmail": student["email"], "uid": student.get("uid", ""), **verification}


def present_full_record(session, student, verification):
    """Same shape the faculty page's markAllAbsent() creates, plus verification fields."""
    return {
        "name": student.get("name", "Student"), "usn": student["usn"], "studentId": student["id"],
        "caId": session["caId"], "sessionId": session["sessionId"], "subject": session.get("subject", ""),
        "class": student.get("class", ""), "facultyName": session.get("facultyName", ""),
        "facultyEmail": session.get("facultyEmail", ""),
        **present_update_fields(student, verification),
    }


class MemoryStore:
    def __init__(self):
        self._lock = threading.RLock()
        self.teachers, self.appointments, self.students, self.login_requests = {}, {}, {}, {}
        self.sessions, self.attendance, self.templates = {}, {}, {}
        self.faces, self.nonces, self.failures, self.attempts = {}, set(), {}, []

    # --- identity -------------------------------------------------------
    def is_approved_faculty(self, email):
        for t in self.teachers.values():
            if (t.get("email") or "").strip().lower() != email:
                continue
            role = (t.get("role") or "").strip().lower()
            status = (t.get("status") or t.get("approvalStatus") or "").strip().lower()
            is_fac = role in ("faculty", "ca", "class advisor", "teacher") or bool(t.get("isCA"))
            is_ok = status == "approved" or (not status and bool(t.get("isCA")))
            if is_fac and is_ok and status not in ("pending", "rejected", "revoked", "dismissed"):
                return True
        for a in self.appointments.values():
            if a.get("status") == "active" and (a.get("facultyEmail") or "").strip().lower() == email:
                return True
        return False

    def ca_exists(self, ca_id, appointment_id=None):
        if ca_id in self.teachers:
            return True
        if ca_id in self.appointments or (appointment_id and appointment_id in self.appointments):
            return True
        return any(a.get("status") == "active" and a.get("facultyDocId") == ca_id for a in self.appointments.values())

    def ca_owner_emails(self, ca_id, appointment_id=None):
        emails = set()
        t = self.teachers.get(ca_id)
        if t and t.get("email"):
            emails.add(t["email"].strip().lower())
        for aid, a in self.appointments.items():
            if a.get("status") == "active" and (aid in (ca_id, appointment_id) or a.get("facultyDocId") == ca_id):
                if a.get("facultyEmail"):
                    emails.add(a["facultyEmail"].strip().lower())
        return emails

    def get_student_by_email(self, email):
        for sid, s in self.students.items():
            if (s.get("email") or "").strip().lower() == email:
                return {"id": sid, **s}
        return None

    def get_student_by_id(self, student_id):
        s = self.students.get(student_id)
        return {"id": student_id, **s} if s else None

    def get_login_request(self, request_id):
        r = self.login_requests.get(request_id)
        return dict(r) if r else None

    # --- sessions -------------------------------------------------------
    def put_session(self, session):
        with self._lock:
            self.sessions[session["sessionId"]] = dict(session)

    def get_session(self, sid):
        s = self.sessions.get(sid)
        return dict(s) if s else None

    def end_session(self, sid, ended_at):
        """Marks the session ended. Temporary face data is kept for a short grace period so that
        verifications already in progress can finish; purge_stale_faces() removes it later."""
        with self._lock:
            if sid in self.sessions:
                self.sessions[sid]["status"] = "ended"
                self.sessions[sid]["endedAtS"] = ended_at

    def end_active_sessions_for_ca(self, ca_id, ended_at, faculty_email=None):
        with self._lock:
            for sid, s in list(self.sessions.items()):
                if s["caId"] == ca_id and s["status"] == "active":
                    if faculty_email is None or s.get("facultyEmail") == faculty_email:
                        self.end_session(sid, ended_at)

    def purge_stale_faces(self, cutoff_s):
        """Delete temporary embeddings of sessions that ended (or timed out) before cutoff_s."""
        with self._lock:
            for sid, s in self.sessions.items():
                if s.get("facesPurged"):
                    continue
                end = s.get("endedAtS") if s["status"] == "ended" else s.get("expiresAtS", 0)
                if end is not None and end < cutoff_s:
                    self.faces.pop(sid, None)
                    s["facesPurged"] = True
                    s["status"] = "ended"

    # --- templates ------------------------------------------------------
    def get_template(self, student_id):
        return self.templates.get(student_id)

    def put_template(self, student_id, doc):
        self.templates[student_id] = doc

    def delete_template(self, student_id):
        self.templates.pop(student_id, None)

    # --- attendance -----------------------------------------------------
    def add_attendance(self, record, doc_id=None):
        """Test helper that mimics the faculty page creating 'absent' rows."""
        with self._lock:
            doc_id = doc_id or f"auto_{len(self.attendance) + 1}"
            self.attendance[doc_id] = dict(record)
            return doc_id

    def is_present(self, usn, session_id):
        return any(v.get("usn") == usn and v.get("sessionId") == session_id
                   and (v.get("status") or "").lower() == "present" for v in self.attendance.values())

    def mark_present(self, session, student, verification):
        with self._lock:
            matches = [(k, v) for k, v in self.attendance.items()
                       if v.get("usn") == student["usn"] and v.get("sessionId") == session["sessionId"]]
            if any((v.get("status") or "").lower() == "present" for _, v in matches):
                raise AlreadyMarked()
            if matches:
                self.attendance[matches[0][0]].update(present_update_fields(student, verification))
                return "updated"
            doc_id = f"att_{_safe(session['caId'])}_{session['sessionId']}_{_safe(student['usn'])}"
            self.attendance[doc_id] = present_full_record(session, student, verification)
            return "created"

    # --- per-session helpers -------------------------------------------
    def session_faces(self, sid):
        return dict(self.faces.get(sid, {}))

    def put_session_face(self, sid, student_id, embedding, device_id):
        with self._lock:
            self.faces.setdefault(sid, {})[student_id] = {"embedding": list(map(float, embedding)), "deviceId": device_id}

    def consume_nonce(self, nonce):
        with self._lock:
            if nonce in self.nonces:
                return False
            self.nonces.add(nonce)
            return True

    def get_failures(self, scope, student_id):
        return self.failures.get((scope, student_id), 0)

    def bump_failures(self, scope, student_id):
        with self._lock:
            key = (scope, student_id)
            self.failures[key] = self.failures.get(key, 0) + 1
            return self.failures[key]

    def log_attempt(self, entry):
        self.attempts.append({**entry, "at": time.time()})


class FirestoreStore:
    """NOTE: written against the firebase-admin / google-cloud-firestore API but not
    executed in the development sandbox (no credentials/network). Test it with your project."""

    def __init__(self):
        from firebase_admin import firestore
        from google.cloud import firestore as gcf
        self.db = firestore.client()
        self._gcf = gcf

    def _col(self, name):
        return self.db.collection(name)

    # --- identity -------------------------------------------------------
    def is_approved_faculty(self, email):
        for d in self._col("teachers").where("email", "==", email).stream():
            data = d.to_dict() or {}
            role = (data.get("role") or "").strip().lower()
            status = (data.get("status") or data.get("approvalStatus") or "").strip().lower()
            is_fac = role in ("faculty", "ca", "class advisor", "teacher") or bool(data.get("isCA"))
            is_ok = status == "approved" or (not status and bool(data.get("isCA")))
            if is_fac and is_ok and status not in ("pending", "rejected", "revoked", "dismissed"):
                return True
        q = self._col("ca_appointments").where("facultyEmail", "==", email).where("status", "==", "active").limit(1)
        if any(True for _ in q.stream()):
            return True
        return False

    def ca_exists(self, ca_id, appointment_id=None):
        if self._col("teachers").document(ca_id).get().exists:
            return True
        for aid in [a for a in (appointment_id, ca_id) if a]:
            if self._col("ca_appointments").document(aid).get().exists:
                return True
        q = self._col("ca_appointments").where("facultyDocId", "==", ca_id).where("status", "==", "active").limit(1)
        return any(True for _ in q.stream())

    def ca_owner_emails(self, ca_id, appointment_id=None):
        emails = set()

        def add(v):
            if v:
                emails.add(str(v).strip().lower())

        t = self._col("teachers").document(ca_id).get()
        if t.exists:
            add((t.to_dict() or {}).get("email"))
        for aid in [a for a in (appointment_id, ca_id) if a]:
            a = self._col("ca_appointments").document(aid).get()
            if a.exists and (a.to_dict() or {}).get("status") == "active":
                add(a.to_dict().get("facultyEmail"))
        q = self._col("ca_appointments").where("facultyDocId", "==", ca_id).where("status", "==", "active")
        for d in q.stream():
            add(d.to_dict().get("facultyEmail"))
        return emails

    def get_student_by_email(self, email):
        for d in self._col("students").where("email", "==", email).limit(1).stream():
            return {"id": d.id, **d.to_dict()}
        return None

    def get_student_by_id(self, student_id):
        d = self._col("students").document(student_id).get()
        return {"id": d.id, **d.to_dict()} if d.exists else None

    def get_login_request(self, request_id):
        d = self._col("student_login_requests").document(request_id).get()
        return d.to_dict() if d.exists else None

    # --- sessions -------------------------------------------------------
    def put_session(self, session):
        self._col("attendance_sessions").document(str(session["sessionId"])).set(
            {**session, "facesPurged": False, "startedAt": _now()})

    def get_session(self, sid):
        d = self._col("attendance_sessions").document(str(sid)).get()
        return d.to_dict() if d.exists else None

    def _clear_faces(self, sid):
        for d in self._col("attendance_sessions").document(str(sid)).collection("faces").stream():
            d.reference.delete()

    def end_session(self, sid, ended_at):
        self._col("attendance_sessions").document(str(sid)).set(
            {"status": "ended", "endedAtS": ended_at, "endedAt": _now()}, merge=True)

    def end_active_sessions_for_ca(self, ca_id, ended_at, faculty_email=None):
        q = self._col("attendance_sessions").where("caId", "==", ca_id).where("status", "==", "active")
        for d in q.stream():
            if faculty_email is None or (d.to_dict() or {}).get("facultyEmail") == faculty_email:
                self.end_session(int(d.id), ended_at)

    def purge_stale_faces(self, cutoff_s):
        q = self._col("attendance_sessions").where("facesPurged", "==", False)
        for d in q.stream():
            s = d.to_dict() or {}
            end = s.get("endedAtS") if s.get("status") == "ended" else s.get("expiresAtS", 0)
            if end is not None and end < cutoff_s:
                self._clear_faces(int(d.id))
                d.reference.set({"facesPurged": True, "status": "ended"}, merge=True)

    # --- templates ------------------------------------------------------
    def get_template(self, student_id):
        d = self._col("face_templates").document(student_id).get()
        return d.to_dict() if d.exists else None

    def put_template(self, student_id, doc):
        self._col("face_templates").document(student_id).set({**doc, "updatedAt": _now()})

    def delete_template(self, student_id):
        self._col("face_templates").document(student_id).delete()

    # --- attendance -----------------------------------------------------
    def is_present(self, usn, session_id):
        q = self._col("attendance").where("usn", "==", usn).where("sessionId", "==", session_id)
        return any(((d.to_dict() or {}).get("status") or "").lower() == "present" for d in q.stream())

    def mark_present(self, session, student, verification):
        gcf = self._gcf
        coll = self._col("attendance")

        @gcf.transactional
        def run(txn):
            q = coll.where("usn", "==", student["usn"]).where("sessionId", "==", session["sessionId"])
            docs = list(q.stream(transaction=txn))
            if any(((d.to_dict() or {}).get("status") or "").lower() == "present" for d in docs):
                raise AlreadyMarked()
            if docs:
                txn.update(docs[0].reference, present_update_fields(student, verification))
                return "updated"
            ref = coll.document(f"att_{_safe(session['caId'])}_{session['sessionId']}_{_safe(student['usn'])}")
            txn.create(ref, present_full_record(session, student, verification))   # fails if it already exists
            return "created"

        return run(self.db.transaction())

    # --- per-session helpers -------------------------------------------
    def session_faces(self, sid):
        col = self._col("attendance_sessions").document(str(sid)).collection("faces")
        return {d.id: d.to_dict() for d in col.stream()}

    def put_session_face(self, sid, student_id, embedding, device_id):
        self._col("attendance_sessions").document(str(sid)).collection("faces").document(student_id).set(
            {"embedding": list(map(float, embedding)), "deviceId": device_id, "at": _now()})

    def consume_nonce(self, nonce):
        from google.api_core.exceptions import AlreadyExists
        try:
            self._col("attendance_nonces").document(_safe(nonce)).create({"at": _now()})
            return True
        except AlreadyExists:
            return False

    def _failure_ref(self, scope, student_id):
        return (self._col("attendance_sessions").document(str(scope))
                .collection("attempts").document(student_id))

    def get_failures(self, scope, student_id):
        d = self._failure_ref(scope, student_id).get()
        return int((d.to_dict() or {}).get("failures", 0)) if d.exists else 0

    def bump_failures(self, scope, student_id):
        ref = self._failure_ref(scope, student_id)
        ref.set({"failures": self._gcf.Increment(1)}, merge=True)
        return int(ref.get().to_dict().get("failures", 1))

    def log_attempt(self, entry):
        self._col("attendance_attempts").add({**entry, "at": _now()})
