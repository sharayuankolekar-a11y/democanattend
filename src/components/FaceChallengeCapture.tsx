import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { NEVER_CAPTURED, lightTick, rgbCss, type LightPlan } from "@/lib/lightTimeline";

export type FaceCapturePhase = "front" | "light" | "turn";
export type FaceCaptureFrame = { phase: FaceCapturePhase; t: number; image: string };
export type FaceChallenge = { turn: "left" | "right"; light: { colors: number[][]; stepMs: number; latencyMs?: number } };
export type FaceCaptureStage = "idle" | "front" | "light" | "turn" | "sending";
export type FaceCameraState = "starting" | "ready" | "error";

interface Props {
  challenge: FaceChallenge;
  onComplete: (frames: FaceCaptureFrame[]) => Promise<void>;
  onCancel: () => void;
  mode: "enroll" | "attendance";
  embedded?: boolean;
  autoStart?: boolean;
  onStageChange?: (stage: FaceCaptureStage, camera: FaceCameraState) => void;
}

const DARK = "#0b1220";
const FRAME_WIDTH = 480;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const describeCameraError = (err: unknown): string => {
  const name = (err as { name?: string })?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Camera permission is blocked. Allow camera access for this site in your browser settings, then tap Retry camera.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The camera is being used by another app or browser tab. Close it and tap Retry camera.";
  return "The camera could not be started. Tap Retry camera, or try another browser.";
};

export default function FaceChallengeCapture({
  challenge,
  onComplete,
  onCancel,
  mode,
  embedded = false,
  autoStart = false,
  onStageChange,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const autoStartedRef = useRef(false);
  const runningRef = useRef(false);

  const [camera, setCamera] = useState<FaceCameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stage, setStage] = useState<FaceCaptureStage>("idle");
  const [instruction, setInstruction] = useState("Look straight at the camera");
  const [status, setStatus] = useState("Starting front camera…");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    onStageChange?.(stage, camera);
  }, [stage, camera, onStageChange]);

  useEffect(() => {
    autoStartedRef.current = false;
  }, [challenge]);

  const startCamera = useCallback(async () => {
    setCamera("starting");
    setCameraError(null);
    setStatus("Starting front camera…");
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("error");
      setCameraError("This browser cannot open the camera here. Use a current Chrome or Safari and open the site over HTTPS.");
      return;
    }
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false },
    ];
    let lastError: unknown = null;
    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) await sleep(350);
      for (const constraints of attempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelledRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          streamRef.current = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            await video.play().catch(() => undefined);
          }
          return; // "ready" is set once the video reports real dimensions (see onLoadedData / onPlaying)
        } catch (err) {
          lastError = err;
          const name = (err as { name?: string })?.name || "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
            setCamera("error");
            setCameraError(describeCameraError(lastError));
            return;
          }
        }
      }
      const errName = (lastError as { name?: string })?.name || "";
      if (errName !== "NotReadableError" && errName !== "TrackStartError") break;
    }
    setCamera("error");
    setCameraError(describeCameraError(lastError));
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    cancelledRef.current = false;
    void startCamera();
    return () => {
      cancelledRef.current = true;
      stopStream();
      if (overlay) overlay.style.backgroundColor = "";
    };
  }, [startCamera]);

  const markReady = () => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setCamera("ready");
      setStatus(
        autoStart
          ? "Camera ready — starting face verification…"
          : "Camera ready. Keep only your face in the frame."
      );
    }
  };

  // Frames are drawn from the raw video, so they are NOT mirrored (only the on-screen preview is).
  const capture = useCallback((phase: FaceCapturePhase, t: number): FaceCaptureFrame | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null;
    const height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH);
    canvas.width = FRAME_WIDTH;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, FRAME_WIDTH, height);
    return { phase, t, image: canvas.toDataURL("image/jpeg", 0.8) };
  }, []);

  // The whole screen becomes the colour so that real light reaches the face.
  const runLightPhase = useCallback(
    (frames: FaceCaptureFrame[]) =>
      new Promise<void>((resolve) => {
        const overlay = overlayRef.current;
        const plan: LightPlan = {
          colors: challenge.light.colors,
          stepMs: challenge.light.stepMs,
          latencyMs: challenge.light.latencyMs ?? 120,
          captureEveryMs: 100,
        };
        let t0 = 0;
        let lastCapture = NEVER_CAPTURED;
        let shown = -2;
        const finish = () => {
          if (overlay) overlay.style.backgroundColor = "";
          resolve();
        };
        const tick = (now: number) => {
          if (cancelledRef.current) return finish();
          if (!t0) t0 = now;
          const elapsed = now - t0;
          const step = lightTick(elapsed, lastCapture, plan);
          if (step.colorIndex !== shown) {
            shown = step.colorIndex;
            if (overlay) overlay.style.backgroundColor = shown >= 0 ? rgbCss(plan.colors[shown]) : DARK;
          }
          if (step.capture) {
            const frame = capture("light", elapsed);
            if (frame) frames.push(frame);
            lastCapture = elapsed;
          }
          if (step.done) return finish();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [capture, challenge.light.colors, challenge.light.latencyMs, challenge.light.stepMs]
  );

  const run = useCallback(async () => {
    if (runningRef.current || stage !== "idle" || camera !== "ready") return;
    runningRef.current = true;
    const frames: FaceCaptureFrame[] = [];
    try {
      // 1) Straight-on frames: used for recognition and as the "neutral" pose.
      setStage("front");
      setInstruction("Look straight at the camera");
      setStatus("Checking identity — hold still…");
      await sleep(700);
      const frontCount = mode === "enroll" ? 8 : 5;
      for (let i = 0; i < frontCount; i++) {
        if (cancelledRef.current) return;
        const frame = capture("front", i * 200);
        if (frame) frames.push(frame);
        await sleep(200);
      }
      if (frames.length < 3) throw new Error("The camera is not delivering video. Close other apps that use the camera and try again.");

      // 2) Screen-light check.
      setStage("light");
      setInstruction("Keep looking at the camera");
      setStatus("Performing liveness check — screen flashing colours…");
      await runLightPhase(frames);
      if (cancelledRef.current) return;

      // 3) Random head turn.
      setStage("turn");
      setInstruction(`Turn your head to your ${challenge.turn}, then hold`);
      setStatus(`Performing liveness check — turn your head ${challenge.turn} and hold`);
      await sleep(700);
      const turnStart = performance.now();
      for (let i = 0; i < 12; i++) {
        if (cancelledRef.current) return;
        const frame = capture("turn", performance.now() - turnStart);
        if (frame) frames.push(frame);
        await sleep(150);
      }

      setStage("sending");
      setInstruction(mode === "enroll" ? "Saving face profile…" : "Verifying attendance…");
      setStatus(mode === "enroll" ? "Encrypting and saving your face template…" : "Verifying face identity and liveness…");
      await onComplete(frames);
    } catch (error) {
      if (overlayRef.current) overlayRef.current.style.backgroundColor = "";
      setStage("idle");
      setInstruction("Look straight at the camera");
      setStatus(error instanceof Error ? error.message : "The check failed. Please try again.");
    } finally {
      runningRef.current = false;
    }
  }, [camera, capture, challenge.turn, mode, onComplete, runLightPhase, stage]);

  useEffect(() => {
    if (!autoStart || camera !== "ready" || stage !== "idle" || autoStartedRef.current) return;
    const timer = window.setTimeout(() => {
      if (cancelledRef.current || autoStartedRef.current) return;
      autoStartedRef.current = true;
      void run();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [autoStart, camera, run, stage]);

  const busy = stage !== "idle";
  const flashing = stage === "light";

  const containerClass =
    !embedded || flashing
      ? "fixed inset-0 z-[100] bg-[#0b1220] text-white flex flex-col items-center justify-center gap-4 p-4 overflow-y-auto"
      : "flex flex-col items-center justify-center gap-4 w-full";

  return (
    <div ref={overlayRef} className={containerClass}>
      {!flashing && !embedded && (
        <div className="flex items-center gap-2 text-emerald-300">
          <ShieldCheck />
          <span className="font-bold">{mode === "enroll" ? "Face enrollment" : "Attendance verification"}</span>
        </div>
      )}

      <div
        className={`relative overflow-hidden rounded-2xl border bg-black ${
          !embedded || flashing
            ? "w-[min(88vw,420px)] aspect-[4/3] border-white/30"
            : "w-full max-w-sm sm:max-w-md aspect-[4/3] border-slate-200 shadow-inner"
        }`}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          onLoadedData={markReady}
          onPlaying={markReady}
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <div className="absolute inset-0 pointer-events-none border-[3px] border-dashed border-white/60 rounded-[45%] m-[12%]" />
        {camera === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white text-xs font-semibold">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <span>Activating front camera…</span>
          </div>
        )}
      </div>

      <div
        className={`rounded-full px-4 py-2 text-sm font-semibold text-center max-w-[92vw] ${
          !embedded || flashing ? "bg-black/75 text-white" : "bg-slate-900 text-white"
        }`}
      >
        {instruction}
      </div>

      {camera === "error" && (
        <div
          className={`max-w-md rounded-2xl border p-4 text-xs sm:text-sm space-y-2.5 text-center ${
            !embedded || flashing
              ? "bg-rose-950/90 border-rose-400/40 text-rose-100"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <p>{cameraError}</p>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 py-2 font-semibold text-white text-xs"
          >
            <RefreshCw size={14} /> Retry camera
          </button>
        </div>
      )}

      {stage === "idle" && camera !== "error" && !autoStart && (
        <ul
          className={`max-w-md text-xs space-y-1 text-left list-disc pl-5 ${
            !embedded || flashing ? "text-slate-300" : "text-slate-600"
          }`}
        >
          <li>Turn your screen brightness up to maximum.</li>
          <li>Face a light. Avoid a bright window or sunlight behind you.</li>
          <li>Hold the device about 30 cm away so your face fills the oval.</li>
          <li>The screen will flash colours for about 4 seconds. If flashing lights bother you, ask your faculty to mark you manually.</li>
        </ul>
      )}

      <p
        aria-live="polite"
        className={`rounded-full px-3.5 py-1 text-xs sm:text-sm text-center max-w-[92vw] font-medium ${
          !embedded || flashing ? "bg-black/60 text-slate-100" : "bg-slate-100 text-slate-700 border border-slate-200"
        }`}
      >
        {status}
      </p>

      {!flashing && (
        <div className="flex w-full max-w-md gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-xs sm:text-sm font-semibold disabled:opacity-50 transition-colors ${
              !embedded
                ? "border border-white/30 text-white hover:bg-white/10"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Cancel
          </button>
          {(!autoStart || stage !== "idle") && (
            <button
              type="button"
              onClick={() => {
                autoStartedRef.current = true;
                void run();
              }}
              disabled={busy || camera !== "ready"}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 text-xs sm:text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
              {busy ? "Verifying…" : "Start check"}
            </button>
          )}
        </div>
      )}

      {!flashing && (
        <p className={`text-[11px] text-center ${!embedded ? "text-slate-400" : "text-slate-500"}`}>
          Live frames are sent securely to the CanAttend verification server for this check only.
        </p>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
