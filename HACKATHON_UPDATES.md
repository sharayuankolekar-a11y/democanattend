# CanAttend Hackathon Updates

## Implemented in this update

### 1. HOD department options
- Updated `src/lib/departmentService.ts` to include the requested seven departments: ISE, CSE, ECE, Mechanical, CSD, CSBS, and AIML.
- Existing Firestore department records are preserved.
- When the app loads the department registry, it creates any missing standard department documents without overwriting existing HOD assignments.
- The existing HOD registration dropdown reads from this registry, so it receives the added options automatically (subject to each department being unclaimed).

### 2. Faculty-captured location for dynamic QR attendance
- Faculty must allow location access when starting an attendance session.
- The faculty device's current GPS coordinates (including its reported accuracy) are captured before the session becomes active.
- The captured point and the 100-metre prototype radius are saved with the local session state and embedded in each refreshed dynamic QR code.
- The student scanner requires a location-bearing dynamic QR, requests the student's GPS location, calculates the distance to the faculty-captured session point, and rejects scans outside the configured radius.
- Successful attendance records store the student's coordinates, measured distance, and `locationVerified: true`.
- The existing 30-second QR refresh/expiry behavior remains unchanged.
- Old active sessions that do not have a captured session location are not restored as active; faculty should start a new session.

### Location limitations to understand before the demo
- This checks proximity to the faculty device's captured GPS point. It does not reliably identify an individual classroom or room number.
- GPS accuracy can be weak indoors and can vary between phones. Test the radius in the actual rooms and adjust `DEFAULT_GEOFENCE_RADIUS_METERS` in `src/lib/locationVerification.ts` if needed.
- A 100-metre radius is a prototype tolerance, not a surveyed classroom boundary. For reliable room-level checks, consider a college Wi-Fi/BLE beacon or a fixed QR/NFC point in each room.
- Browser GPS can be spoofed and the current verification is client-side. A production deployment should validate signed session data, location evidence, and attendance writes in a trusted backend (for example, Firebase Cloud Functions) and tighten Firestore rules.
- Browser geolocation requires HTTPS (or localhost) and the user's permission.

## Face recognition: not yet implemented
The existing student flow does not currently enroll or store a student's face template. A real identity check must not be simulated by merely detecting that a face is visible. Before enabling face-based attendance, implement:
1. An explicit student consent and face-enrollment step.
2. A tested face-embedding model and secure storage/retention policy for templates.
3. A live camera verification step that compares the current face to the enrolled template and the authenticated student profile.
4. Basic liveness/anti-spoofing checks and a documented manual fallback for camera/model failures.
5. Server-side validation so the browser cannot mark face verification as successful by changing client state.

Python is optional: face matching can run in the browser with a suitable model, or through a Python API. The browser approach avoids adding a separate server, but requires shipping and testing the model assets. Do not treat face detection alone as face recognition.

## Files changed in this update
- `src/lib/departmentService.ts` (from the previous update)
- `src/lib/locationVerification.ts`
- `src/pages/FacultySession.tsx`
- `src/pages/Scanner.tsx`
