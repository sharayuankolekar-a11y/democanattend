"""Firebase ID-token verification (students and faculty both sign in with Firebase Auth)."""
import json
import os


class AuthError(Exception):
    pass


class FirebaseVerifier:
    """Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file path,
    or FIREBASE_SERVICE_ACCOUNT_JSON to the JSON text (handy on hosting dashboards).
    Never commit either."""

    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials
        if not firebase_admin._apps:
            raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
            if raw:
                firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)))
            else:
                firebase_admin.initialize_app()   # uses GOOGLE_APPLICATION_CREDENTIALS

    def verify(self, id_token):
        from firebase_admin import auth
        try:
            decoded = auth.verify_id_token(id_token, clock_skew_seconds=10)
        except Exception as exc:   # expired, malformed, wrong project, ...
            raise AuthError(str(exc))
        return {"uid": decoded.get("uid"), "email": decoded.get("email"),
                "email_verified": decoded.get("email_verified", False)}
