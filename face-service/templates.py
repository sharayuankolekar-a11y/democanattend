"""Face templates (embeddings only - raw images are never stored).
Encrypted at rest with a Fernet key from FACE_TEMPLATE_KEY."""
import json


class TemplateConfigError(RuntimeError):
    pass


def encode(cfg, template: dict) -> dict:
    if cfg.face_template_key:
        from cryptography.fernet import Fernet
        token = Fernet(cfg.face_template_key.encode()).encrypt(json.dumps(template).encode())
        return {"v": 1, "enc": True, "data": token.decode()}
    if cfg.allow_plaintext_templates:
        return {"v": 1, "enc": False, "payload": template}
    raise TemplateConfigError("FACE_TEMPLATE_KEY is not set (or set ALLOW_PLAINTEXT_TEMPLATES=true for development only).")


def decode(cfg, doc: dict) -> dict:
    if doc.get("enc"):
        if not cfg.face_template_key:
            raise TemplateConfigError("FACE_TEMPLATE_KEY is required to read stored face templates.")
        from cryptography.fernet import Fernet
        return json.loads(Fernet(cfg.face_template_key.encode()).decrypt(doc["data"].encode()))
    return doc["payload"]
