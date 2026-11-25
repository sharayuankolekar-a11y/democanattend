"""Runtime settings for the CanAttend verification service.

Every field can be overridden with an environment variable named after the
field in UPPER_CASE (for example LIGHT_CHECK_MODE). See .env.example.
Thresholds marked "uncalibrated" are sensible starting points that have NOT
been tuned on real phones/webcams - tune them during your own testing.
"""
import os
from dataclasses import dataclass, field, fields
from typing import List


@dataclass
class Settings:
    qr_signing_secret: str                      # required, >= 16 chars
    face_template_key: str = ""                 # Fernet key (see .env.example)
    allow_plaintext_templates: bool = False     # dev only
    admin_key: str = ""                         # enables DELETE /admin/face/<id>
    allowed_origins: List[str] = field(default_factory=lambda: ["http://localhost:5173"])
    model_dir: str = "models"
    debug_scores: bool = False                  # include raw scores in responses

    # --- tokens / sessions ----------------------------------------------
    qr_refresh_ms: int = 1000                   # faculty QR rotation cadence (ms)
    qr_ttl_s: int = 3                           # short token lifetime aligned with 1s rotation
    qr_grace_s: int = 2                         # covers clock truncation + network transit right after scan
    ticket_ttl_s: int = 90
    attendance_window_s: int = 7200             # max length of one session; faculty normally ends it sooner
    max_attempts: int = 5                       # failed face/liveness tries per student per session

    # --- face recognition -----------------------------------------------
    match_threshold: float = 0.363              # cosine; OpenCV's SFace default (uncalibrated)
    light_identity_slack: float = 0.05          # colour flashing lowers match scores a little
    dup_face_threshold: float = 0.5             # same face on two accounts in one session
    enroll_min_frames: int = 5
    enroll_max_frames: int = 10
    enroll_consistency: float = 0.5
    min_face_px: int = 80
    min_brightness: float = 45
    max_brightness: float = 215
    min_sharpness: float = 25
    max_frames: int = 60

    # --- liveness ---------------------------------------------------------
    light_steps: int = 8
    light_step_ms: int = 400
    light_latency_ms: int = 120                 # screen->camera delay (uncalibrated)
    light_min_frames_per_step: int = 2
    light_min_valid_steps: int = 6
    light_min_score: float = 0.65               # correlation with the colour sequence (uncalibrated)
    light_min_slope: float = 0.02               # response must be positive and at least this strong (uncalibrated)
    light_min_strength: float = 0.02            # below this the face shows no measurable response -> "inconclusive"
    # auto     : pass = ok; measurable-but-wrong response = reject; unmeasurable = allow + flag as reduced
    # enforce  : anything except a clear pass is rejected (use once your phones give clean scores)
    # advisory : never blocks on the light check, only records it
    # off      : skip the light check
    light_check_mode: str = "auto"
    turn_min_shift: float = 0.2
    turn_front_max_yaw: float = 0.2
    turn_sign_flip: bool = False                # only used when turn_direction_mode=exact
    # either: any clear head turn counts (robust: front cameras differ in mirroring across phones/laptops)
    # exact : must turn the requested way (tighter, but check it on every device type first)
    turn_direction_mode: str = "either"

    @classmethod
    def from_env(cls) -> "Settings":
        secret = os.environ.get("QR_SIGNING_SECRET", "")
        if len(secret) < 16:
            raise RuntimeError("QR_SIGNING_SECRET must be set to a random string of at least 16 characters.")
        kwargs = {"qr_signing_secret": secret}
        origins = os.environ.get("ALLOWED_ORIGINS")
        if origins:
            kwargs["allowed_origins"] = [o.strip() for o in origins.split(",") if o.strip()]
        for f in fields(cls):
            if f.name in ("qr_signing_secret", "allowed_origins"):
                continue
            raw = os.environ.get(f.name.upper())
            if raw is None or raw == "":
                continue
            default = f.default
            if isinstance(default, bool):
                kwargs[f.name] = raw.strip().lower() in ("1", "true", "yes", "on")
            elif isinstance(default, int):
                kwargs[f.name] = int(raw)
            elif isinstance(default, float):
                kwargs[f.name] = float(raw)
            else:
                kwargs[f.name] = raw
        return cls(**kwargs)
