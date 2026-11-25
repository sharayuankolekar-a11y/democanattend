"""Entry point:  python wsgi.py   (dev)   |   gunicorn wsgi:app   (hosted)."""
import logging
import os

try:                      # optional: lets you keep settings in face-service/.env on your own PC
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app import create_app
from auth import FirebaseVerifier
from config import Settings
from face_engine import EngineUnavailable, load_engine
from store import FirestoreStore

logging.basicConfig(level=logging.INFO)
settings = Settings.from_env()
engine, engine_error = None, None
try:
    engine = load_engine(settings)
except EngineUnavailable as exc:
    engine_error = str(exc)
    logging.warning("Face engine unavailable: %s", exc)

firebase_verifier = FirebaseVerifier()
firestore_store = FirestoreStore()

app = create_app(settings, firestore_store, firebase_verifier, engine, engine_error)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
