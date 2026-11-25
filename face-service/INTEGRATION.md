# CanAttend face verification integration

The React application now uses the signed-token flow exposed by this service:

1. Faculty starts a session through `POST /sessions/start` using their Firebase ID token and a precise GPS reading.
2. Faculty QR rotates every 20 seconds using `GET /sessions/<id>/qr`. The QR value is a signed `CA2...` token; it does not expose classroom coordinates.
3. Student scans the token. The app sends Firebase ID token, approved student login request ID/session token, device ID and GPS to `POST /attendance/begin`.
4. Student completes the server-issued front-face, randomized screen-colour and head-turn challenge. Frames are sent to `POST /attendance/complete`.
5. The service verifies the face and liveness and writes the present attendance record to the existing `attendance` collection through Firebase Admin.
6. Faculty ends the session through `POST /sessions/<id>/end`.

## Frontend configuration

Create a frontend `.env` file from the repository root `.env.example` and set:

```dotenv
VITE_FACE_SERVICE_URL=https://YOUR-FACE-SERVICE-HOST
```

Restart Vite after changing environment variables.

## Face service configuration

Install `face-service/requirements.txt`, download the model files with `python download_models.py`, and configure the variables in `face-service/.env.example` in your hosting dashboard. Required secrets are `QR_SIGNING_SECRET`, `FACE_TEMPLATE_KEY`, and Firebase Admin credentials (`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`). Set `ALLOWED_ORIGINS` to the exact deployed frontend origin(s). Never commit service-account JSON or production secrets.

The Firebase Admin service account must belong to the same Firebase project used by `src/firebase.js`. The service uses the Admin SDK, so Firestore client security rules do not protect its writes; keep the service credentials private and restrict the admin key.

## Important verification notes

- The liveness thresholds in `face-service/config.py` are explicitly uncalibrated. Test on actual Android/iOS devices and tune them before relying on this for real attendance.
- Face matching and liveness checks are anti-proxy signals, not proof against modified clients, deepfakes or GPS spoofing.
- Face enrollment is consent-based. Do not make enrollment compulsory until the institution has approved the biometric-data policy, retention period, access controls and an alternative attendance method.
- Use HTTPS in production. Browser camera and geolocation access require a secure context (localhost is allowed for development).
- The scanner accepts ONLY signed `CA2.` QR codes. The old JSON / `subject|expiry` QR formats and the old browser-side attendance write were removed; they can no longer mark attendance.

## Liveness: how failures are handled (updated)

Head-turn is always required. The screen-light check has three outcomes: **pass**, **fail** (the face reacted, but not to our random colours) and **inconclusive** (no measurable reaction, e.g. bright room). `LIGHT_CHECK_MODE` decides what happens:
`auto` (default) rejects *fail* and allows *inconclusive* but stores `livenessLevel: "reduced"` on the attendance record; `enforce` rejects both; `advisory` never blocks; `off` skips it.
Set `DEBUG_SCORES=true` while tuning: rejected checks then show the light/turn scores in the on-screen message. Turn it off for the live demo.
