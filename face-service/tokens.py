"""HMAC-signed tokens. The server clock is the only clock that matters."""
import base64
import hashlib
import hmac
import json
import time

QR_PREFIX = "CA2"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(secret: str, message: str) -> bytes:
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()


def issue_qr_token(secret, session_id, ttl_s, now_s=None):
    """Compact token shown in the QR code: CA2.<sessionId>.<expiry>.<sig>."""
    now = time.time() if now_s is None else now_s
    exp = int(now + ttl_s)
    body = f"{QR_PREFIX}.{int(session_id)}.{exp}"
    return f"{body}.{_b64(_mac(secret, body)[:16])}", exp


def verify_qr_token(secret, token, grace_s=0, now_s=None):
    """Returns (ok, session_id, reason). reason: malformed | bad_signature | expired."""
    now = time.time() if now_s is None else now_s
    if not isinstance(token, str):
        return False, None, "malformed"
    parts = token.strip().split(".")
    if len(parts) != 4 or parts[0] != QR_PREFIX:
        return False, None, "malformed"
    try:
        sid = int(parts[1])
        exp = int(parts[2])
    except ValueError:
        return False, None, "malformed"
    expected = _b64(_mac(secret, f"{QR_PREFIX}.{sid}.{exp}")[:16])
    if not hmac.compare_digest(expected, parts[3]):
        return False, None, "bad_signature"
    if now > exp + grace_s:
        return False, sid, "expired"
    return True, sid, None


def sign_payload(secret, payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{body}.{_b64(_mac(secret, 'T|' + body))}"


def verify_payload(secret, token, now_s=None):
    """Returns (payload|None, reason). Payload must carry an 'exp' (epoch seconds)."""
    now = time.time() if now_s is None else now_s
    if not isinstance(token, str) or token.count(".") != 1:
        return None, "malformed"
    body, sig = token.split(".")
    if not hmac.compare_digest(_b64(_mac(secret, "T|" + body)), sig):
        return None, "bad_signature"
    try:
        payload = json.loads(_unb64(body))
    except Exception:
        return None, "malformed"
    if not isinstance(payload, dict) or now > float(payload.get("exp", 0)):
        return None, "expired"
    return payload, None
