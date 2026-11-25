# CanAttend – setup on Windows (VS Code, React, Python)

You run **two things** side by side: the React app (port 5173) and the Python verification server (port 8000).

## 0. Install once
- VS Code, **Node.js 20 LTS**, **Python 3.11** (3.10–3.12 work). Tick "Add Python to PATH".

## 1. Frontend (VS Code terminal 1)
```powershell
cd CanAttend-CEC-main
npm install
copy .env.example .env
npm run dev
```
`.env` must contain `VITE_FACE_SERVICE_URL=http://localhost:8000`. Restart `npm run dev` after editing it.

## 2. Verification server (VS Code terminal 2)
```powershell
cd CanAttend-CEC-main\face-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
python download_models.py             # one-time, ~40 MB (face detector + recognizer)
```
Create `face-service\.env` (copy `.env.example`) and fill in:
```
QR_SIGNING_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(32))">
FACE_TEMPLATE_KEY=<python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
GOOGLE_APPLICATION_CREDENTIALS=C:\keys\firebase-admin.json
ALLOWED_ORIGINS=http://localhost:5173
DEBUG_SCORES=true
```
Keep the Firebase admin key file **outside the project folder** (e.g. `C:\keys\`). Then:
```powershell
python wsgi.py
```
Open http://localhost:8000/health – you should see `"faceEngine": true`. If it says false, run `python download_models.py` again.

## 3. Try it on the laptop
1. Student: log in (CA approves) → Dashboard → **Face Enrollment** → tick consent → Start. Raise screen brightness, face the light, follow the prompts.
2. Faculty: open a session → **Start Session** (allow location). The QR changes every 20 s.
3. Student: Scan Attendance QR → allow location → camera check → attendance is marked **by the server**.

## 4. Test on phones (camera + GPS need HTTPS)
Easiest: free tunnels, one per server.
```powershell
cloudflared tunnel --url http://localhost:5173     # frontend  -> https://AAAA.trycloudflare.com
cloudflared tunnel --url http://localhost:8000     # server    -> https://BBBB.trycloudflare.com
```
Then: `.env` → `VITE_FACE_SERVICE_URL=https://BBBB…`; `face-service\.env` → `ALLOWED_ORIGINS=https://AAAA…`; restart both.
Also: Firebase Console → Authentication → Settings → **Authorized domains** → add the frontend domain (otherwise Google sign-in fails).
If Vite says "Blocked request. This host is not allowed", add `server: { allowedHosts: true }` to `vite.config.ts` for the demo.
(Alternative: deploy the frontend to Vercel – it is already HTTPS – and tunnel only the server.)

## 5. Tuning the light check on your phones
With `DEBUG_SCORES=true`, a rejected check shows scores in the message, e.g. `light: pass, score 0.93, strength 0.08`.
- `LIGHT_CHECK_MODE=auto` (default): clear match = ok; reacted-but-wrong = rejected; no measurable reaction = allowed and flagged `reduced` on the record.
- Once your phones show clean `pass` scores, set `LIGHT_CHECK_MODE=enforce`. Turn `DEBUG_SCORES` **off** for the real demo.
- Thresholds (`LIGHT_MIN_SCORE`, `LIGHT_MIN_SLOPE`, `LIGHT_MIN_STRENGTH`, `LIGHT_LATENCY_MS`) are starting points, not calibrated values.

## 6. Troubleshooting
| Message / symptom | Fix |
|---|---|
| "Could not reach the face-verification service" | server not running, wrong `VITE_FACE_SERVICE_URL`, or `ALLOWED_ORIGINS` doesn't match the page's exact origin |
| "No face was detected" / "too dark" | face a light, centre your face in the oval, hold ~30 cm away |
| "Screen-light check did not match" | no moving lights / second screens; brightness max; retry |
| "Head turn not detected" | turn clearly to one side and hold ~1 s |
| "location too imprecise" | use a phone (GPS) or sit near a window; laptops use Wi-Fi location |
| "Enroll your face first" | Dashboard → Face Enrollment |
| Reset a student's face profile | `Invoke-RestMethod -Method Delete -Headers @{"X-Admin-Key"="<ADMIN_KEY>"} http://localhost:8000/admin/face/<studentDocId>` (set `ADMIN_KEY` first) |

## 7. Security reminders
- Never commit or share the Firebase admin key. If it was ever zipped, emailed or pushed, **revoke it** (Firebase Console → Project settings → Service accounts) and create a new one.
- Face enrollment is consent-based: have a manual attendance alternative for students who decline.
