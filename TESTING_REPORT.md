# Testing report – face / light-check fix

## Root causes found in the integrated build
1. **The screen never really flashed.** The colour was drawn only as a blend overlay inside the small preview box (not part of the captured frames) on a dark page, so almost no coloured light reached the face. The server then (correctly) saw no response → "The light check failed".
2. **Timeline drift.** One timer per colour step made each step slightly longer than the 400 ms the server assumes; by the last colours the server compared the face with the wrong colours.
3. The light check was **all-or-nothing and uncalibrated**: "could not measure" was treated as "failed".
4. Face detection under strong colour casts could fail and sink the whole attempt; head-turn direction depends on whether a camera is mirrored (differs across phones/laptops).
Your face **was** being detected: the server only reaches the light check after the face/quality checks pass.

## What was run here (automated)
| Check | Result |
|---|---|
| Backend unit + API tests (`python -m unittest discover -s tests`) | **61 / 61 pass** |
| Covered: signed QR (forged / expired / legacy formats rejected), faculty ownership, GPS (outside / inaccurate / missing accuracy), login-approval gate, enrollment (consent, encrypted template, re-enroll block), wrong person, still face, replayed video with other colours, ticket reuse / other account / expiry, attempt lockout, same face or same device on two accounts, duplicate attendance, completion grace after session end, face-data purge, CORS, light-check modes | pass |
| Light-check simulation (synthetic): genuine run, camera delay 60–240 ms, exposure drift | **100 %** pass |
| Same simulation: video reacting to a *different* colour sequence | rejected **99.6 %** |
| Same simulation: photo (no reaction) | never passes the light step (inconclusive); head-turn still required |
| New client timeline (real `lightTimeline.ts` driven with jittery frames, slow frames, 60–240 ms delay) vs server | **200 / 200** pass |
| Frontend syntax check (esbuild) of every touched file | pass |

## NOT tested (cannot be tested in this sandbox)
- **Real faces / real recognition accuracy:** the YuNet/SFace model files and any camera are unavailable here. Face matching was tested only with a stand-in engine. `MATCH_THRESHOLD` is OpenCV's default, not tuned on your students.
- **Real phone/laptop light response.** All light-check numbers above are synthetic. Calibrate on your devices (see SETUP_WINDOWS.md §5).
- **Head-turn direction sign on real cameras** (default mode accepts either direction for this reason).
- GPS hardware, browser permission prompts, iOS Safari/Android Chrome behaviour.
- **Live Firebase:** Admin-SDK token check, Firestore transactions (`FirestoreStore`), Firestore rules. Only the in-memory twin was tested.
- `npm install` / `npm run build` / full TypeScript type-check (no `node_modules`, no network).
- `firestore.rules.hardened` (optional, never deployed or run).

## Known limits (be upfront in the demo)
- In `auto` mode a **photo or video replay can pass the light step when the room is too bright to measure** (it is recorded as `livenessLevel: "reduced"`); the head-turn and face match still apply. Use `enforce` once your devices give clean scores.
- A student who **modifies the web app** to forge frames, a real-time deepfake, or GPS spoofing apps are not stopped.
- Until `firestore.rules.hardened` (or equivalent) is deployed, a technical student can still write to `attendance` straight from the browser console. The verification server is only authoritative once client writes are blocked.
- The Firebase admin key file found inside `face-service/` of the uploaded ZIP was **removed from the returned ZIP**. Treat it as exposed and rotate it.

## Files
**Rewritten / modified:** `src/components/FaceChallengeCapture.tsx`, `src/pages/Scanner.tsx` (direct-write code and page reloads removed; errors persist), `src/lib/faceService.ts` (debug scores), `face-service/{app,config,liveness,store,wsgi}.py`, `face-service/{requirements.txt,.env.example,INTEGRATION.md}`, `face-service/tests/*`.
**New:** `src/lib/lightTimeline.ts`, `firestore.rules.hardened`, `SETUP_WINDOWS.md`, `TESTING_REPORT.md`.
**Untouched:** everything else (e.g. `FacultySession.tsx`, `FaceEnrollment.tsx`, `App.tsx`, `Dashboard.tsx`, original `firestore.rules`).
