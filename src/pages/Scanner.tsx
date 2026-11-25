import { onAuthStateChanged } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Html5Qrcode } from "html5-qrcode";
import FaceChallengeCapture, {
  type FaceCameraState,
  type FaceCaptureFrame,
  type FaceCaptureStage,
  type FaceChallenge,
} from "@/components/FaceChallengeCapture";
import { faceApi, FaceServiceError, getDeviceId, getStudentApprovalPayload, isFaceServiceConfigured } from "@/lib/faceService";
import { db, auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  QrCode,
  ShieldCheck,
  UserCheck,
  Sparkles,
  BookOpen,
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import {
  StudentSession,
  getStoredStudentSession,
  clearStoredStudentSession,
  validateStudentSession,
} from "@/lib/studentAuth";
import { toast } from "@/components/ui/use-toast";

type WorkflowStage =
  | "waiting_qr"
  | "qr_verifying"
  | "qr_verified"
  | "starting_face"
  | "checking_identity"
  | "liveness_check"
  | "verifying_attendance"
  | "success"
  | "error";

interface VerifiedSessionInfo {
  sessionId: number;
  subject: string;
  facultyName: string;
  caId: string;
}

interface BeginAttendanceResponse {
  ok: boolean;
  ticket: string;
  challenge: FaceChallenge;
  expiresInSec: number;
  session?: VerifiedSessionInfo;
}

interface CompleteAttendanceResponse {
  ok: boolean;
  status: string;
  record: string;
  livenessLevel?: string;
}

const STAGE_LABELS: Record<WorkflowStage, string> = {
  waiting_qr: "Waiting for QR scan",
  qr_verifying: "Validating QR code",
  qr_verified: "QR verified",
  starting_face: "Starting face verification",
  checking_identity: "Checking identity",
  liveness_check: "Performing liveness check",
  verifying_attendance: "Verifying attendance",
  success: "Attendance successful",
  error: "Verification failed",
};

const Scanner = () => {
  const navigate = useNavigate();
  const scanLock = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const startTimerRef = useRef<number | null>(null);

  const [studentSession, setStudentSession] = useState<StudentSession | null>(null);
  const [stage, setStage] = useState<WorkflowStage>("waiting_qr");
  const [faceChallenge, setFaceChallenge] = useState<FaceChallenge | null>(null);
  const [faceTicket, setFaceTicket] = useState<string | null>(null);
  const [verifiedSession, setVerifiedSession] = useState<VerifiedSessionInfo | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null);
  const [livenessResult, setLivenessResult] = useState<string | null>(null);
  const [lastQrToken, setLastQrToken] = useState<string | null>(null);

  const stopQrScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (e) {
        console.warn("Scanner stop error:", e);
      }
    }
  }, []);

  // Validate student session, Firebase Auth state, and enrollment status
  useEffect(() => {
    let isMounted = true;
    const session = getStoredStudentSession();
    const validation = validateStudentSession(session, "Scanner");

    if (!validation.isValid || !session) {
      clearStoredStudentSession();
      navigate("/student-login", {
        replace: true,
        state: {
          error:
            validation.reason ||
            "Scanning requires an approved login session from your Class Advisor. Please log in.",
        },
      });
      return;
    }

    setStudentSession(session);

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!isMounted) return;
      if (!user || !user.email) {
        clearStoredStudentSession();
        navigate("/student-login", {
          replace: true,
          state: { error: "Your Google sign-in has expired. Please log in again." },
        });
        return;
      }
      if (user.email.trim().toLowerCase() !== session.email.trim().toLowerCase()) {
        clearStoredStudentSession();
        navigate("/student-login", {
          replace: true,
          state: { error: "Signed-in Google account does not match your student session. Please log in again." },
        });
        return;
      }
      if (isFaceServiceConfigured()) {
        faceApi<{ enrolled: boolean }>("/face/status", getStudentApprovalPayload())
          .then((res) => {
            if (isMounted) setFaceEnrolled(Boolean(res.enrolled));
          })
          .catch(() => {
            // Non-blocking: /attendance/begin also enforces enrollment and surfaces backend connectivity
          });
      }
    });

    const studentRef = doc(db, "students", session.id);
    const unsubStudent = onSnapshot(
      studentRef,
      (docSnap) => {
        if (!isMounted) return;
        if (!docSnap.exists()) {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your student record was deleted by your Class Advisor. Please contact your CA." },
          });
          return;
        }
        const data = docSnap.data();
        const status = (data.status || "").toLowerCase().trim();
        if (status === "pending" || status === "rejected" || status === "deactivated") {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your student registration is no longer active. Please contact your Class Advisor." },
          });
        }
      },
      (error) => console.error("Scanner student onSnapshot error:", error)
    );

    const unsubRequest = onSnapshot(
      doc(db, "student_login_requests", session.loginRequestId!),
      (reqSnap) => {
        if (!isMounted) return;
        if (!reqSnap.exists() || reqSnap.data().status !== "approved") {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your login approval has ended or was revoked by your Class Advisor." },
          });
        }
      },
      (err) => console.warn("Scanner login request listener error:", err)
    );

    return () => {
      isMounted = false;
      unsubAuth();
      unsubStudent();
      unsubRequest();
    };
  }, [navigate]);

  const isPermissionError = (err: unknown): boolean => {
    if (!err) return false;
    const e = err as { name?: string; message?: string };
    const name = e?.name || "";
    const msg = (e?.message || String(err) || "").toLowerCase();
    return (
      name === "NotAllowedError" ||
      name === "PermissionDeniedError" ||
      name === "SecurityError" ||
      msg.includes("permission") ||
      msg.includes("not allowed") ||
      msg.includes("denied")
    );
  };

  const isNotFoundError = (err: unknown): boolean => {
    if (!err) return false;
    const e = err as { name?: string; message?: string };
    const name = e?.name || "";
    const msg = (e?.message || String(err) || "").toLowerCase();
    return (
      name === "NotFoundError" ||
      name === "DevicesNotFoundError" ||
      msg.includes("not found") ||
      msg.includes("requested device not found") ||
      msg.includes("notfound")
    );
  };

  const NON_RETRYABLE_FACE_CODES = new Set([
    "qr_invalid",
    "qr_expired",
    "session_inactive",
    "too_many_attempts",
    "already_marked",
    "face_not_enrolled",
    "face_reused",
    "device_reused",
    "student_not_found",
    "account_not_approved",
  ]);

  const beginAttendanceWithQr = useCallback(async (cleanQr: string) => {
    setStage("qr_verifying");
    setVerifyError(null);
    setErrorCode(null);
    setAttemptsLeft(null);
    setLastQrToken(cleanQr);

    try {
      const begin = await faceApi<BeginAttendanceResponse>("/attendance/begin", {
        ...getStudentApprovalPayload(),
        qrToken: cleanQr,
        deviceId: getDeviceId(),
      });
      if (!isMountedRef.current) return;

      console.info("[Scanner] Backend QR & student validation succeeded", {
        sessionId: begin.session?.sessionId,
        subject: begin.session?.subject,
      });

      setVerifiedSession(
        begin.session || {
          sessionId: 0,
          subject: "Classroom Session",
          facultyName: "Faculty",
          caId: "",
        }
      );
      setFaceTicket(begin.ticket);
      setStage("qr_verified");

      // Short pause lets the OS camera driver finish releasing the QR stream before opening the front camera
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      if (!isMountedRef.current) return;

      setStage("starting_face");
      setFaceChallenge(begin.challenge);
    } catch (error) {
      if (!isMountedRef.current) return;
      const message =
        error instanceof Error ? error.message : "Could not validate QR code. Please scan the current QR code again.";
      const code = error instanceof FaceServiceError ? error.code || null : null;
      console.warn("[Scanner] Backend QR validation failed", { code });
      if (code === "qr_expired" || code === "qr_invalid" || code === "session_inactive") {
        setLastQrToken(null);
      }
      setVerifyError(message);
      setErrorCode(code);
      if (code === "face_not_enrolled") setFaceEnrolled(false);
      setStage("error");
      toast({
        variant: "destructive",
        title: code === "already_marked" ? "Attendance already marked" : "QR verification failed",
        description: message,
      });
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (!isMountedRef.current) return;
    const readerElement = document.getElementById("reader");
    if (!readerElement) return;

    setCameraError(null);
    await stopQrScanner();

    const scanner = new Html5Qrcode("reader");
    scannerRef.current = scanner;

    const scanConfig = {
      fps: 15,
      qrbox: { width: 240, height: 240 },
    };

    const onScanSuccess = async (decodedText: string) => {
      if (scanLock.current) return;
      scanLock.current = true;
      const cleanQr = (decodedText || "").trim();

      console.info("[Scanner] QR decoded", {
        prefix: cleanQr.slice(0, 4),
        length: cleanQr.length,
        validCa2Prefix: cleanQr.startsWith("CA2."),
      });

      setStage("qr_verifying");
      setVerifyError(null);
      setErrorCode(null);
      setAttemptsLeft(null);

      // Stop QR camera feed immediately so hardware camera is free for automatic face verification
      await stopQrScanner();

      if (!cleanQr.startsWith("CA2.")) {
        let unsupported =
          "This is not a valid CanAttend attendance QR code. Scan the live QR code displayed by your faculty.";
        if (cleanQr.startsWith("Preparing secure QR")) {
          unsupported =
            "This is not a valid CanAttend attendance QR code — the faculty QR was still loading. Wait for the live QR code to finish generating and scan again.";
        } else if (cleanQr.startsWith("subject:") && cleanQr.includes("|expiry:")) {
          unsupported =
            "This is not a valid CanAttend attendance QR code — it appears to be an older terminal QR. Ask your faculty to start a live session from the Faculty Session page.";
        }
        setLastQrToken(null);
        setVerifyError(unsupported);
        setErrorCode("qr_invalid");
        setStage("error");
        toast({ variant: "destructive", title: "Invalid QR code", description: unsupported });
        return;
      }

      await beginAttendanceWithQr(cleanQr);
    };

    const onScanFailure = () => {
      // Continuous frame search; ignore normal decode misses
    };

    const attempts: Array<MediaTrackConstraints | string> = [
      { facingMode: { exact: "environment" } },
      { facingMode: "environment" },
      { facingMode: "user" },
    ];

    for (let i = 0; i < attempts.length; i++) {
      try {
        await scanner.start(attempts[i], scanConfig, onScanSuccess, onScanFailure);
        if (!isMountedRef.current) await stopQrScanner();
        return;
      } catch (err: unknown) {
        if (isPermissionError(err)) {
          setCameraError(
            "Camera permission was denied. Please allow camera access in your browser settings to scan attendance."
          );
          return;
        }
      }
    }

    try {
      const cameras = await Html5Qrcode.getCameras();
      if (cameras && cameras.length > 0) {
        await scanner.start(cameras[0].id, scanConfig, onScanSuccess, onScanFailure);
        if (!isMountedRef.current) await stopQrScanner();
        return;
      }
      setCameraError("No camera detected on this device. Please connect a camera to mark attendance.");
    } catch (err: unknown) {
      if (isPermissionError(err)) {
        setCameraError(
          "Camera permission was denied. Please allow camera access in your browser settings to scan attendance."
        );
      } else if (isNotFoundError(err)) {
        setCameraError("No camera detected on this device. Please connect a camera to mark attendance.");
      } else {
        setCameraError(
          "Camera could not be accessed. Ensure camera permissions are enabled and no other app is using your camera."
        );
      }
    }
  }, [beginAttendanceWithQr, stopQrScanner]);

  const reset = useCallback(async () => {
    scanLock.current = false;
    setFaceChallenge(null);
    setFaceTicket(null);
    setLastQrToken(null);
    setVerifiedSession(null);
    setVerifyError(null);
    setErrorCode(null);
    setAttemptsLeft(null);
    setCameraError(null);
    setLivenessResult(null);
    setStage("waiting_qr");
    await stopQrScanner();
    if (startTimerRef.current) window.clearTimeout(startTimerRef.current);
    startTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) void startScanner();
    }, 350);
  }, [startScanner, stopQrScanner]);

  const retryFaceVerification = useCallback(async () => {
    if (!lastQrToken) {
      await reset();
      return;
    }
    setFaceChallenge(null);
    setFaceTicket(null);
    await beginAttendanceWithQr(lastQrToken);
  }, [beginAttendanceWithQr, lastQrToken, reset]);

  useEffect(() => {
    isMountedRef.current = true;
    startTimerRef.current = window.setTimeout(() => {
      void startScanner();
    }, 100);

    return () => {
      isMountedRef.current = false;
      if (startTimerRef.current) window.clearTimeout(startTimerRef.current);
      void stopQrScanner();
    };
  }, [startScanner, stopQrScanner]);

  const handleFaceStageChange = useCallback((captureStage: FaceCaptureStage, cameraState: FaceCameraState) => {
    if (!isMountedRef.current) return;
    if (captureStage === "idle") {
      if (cameraState === "starting" || cameraState === "ready") {
        setStage((prev) => (prev === "qr_verified" || prev === "starting_face" ? "starting_face" : prev));
      }
    } else if (captureStage === "front") {
      setStage("checking_identity");
    } else if (captureStage === "light" || captureStage === "turn") {
      setStage("liveness_check");
    } else if (captureStage === "sending") {
      setStage("verifying_attendance");
    }
  }, []);

  const completeFaceAttendance = async (frames: FaceCaptureFrame[]) => {
    if (!faceTicket) throw new Error("Verification expired. Scan the QR code again.");
    setStage("verifying_attendance");
    try {
      const res = await faceApi<CompleteAttendanceResponse>("/attendance/complete", {
        ticket: faceTicket,
        deviceId: getDeviceId(),
        frames,
      });
      setFaceChallenge(null);
      setFaceTicket(null);
      setLastQrToken(null);
      setLivenessResult(res.livenessLevel || "full");
      setStage("success");
      toast({
        title: "Attendance marked",
        description: "Your QR, face identity, and liveness checks passed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan the QR code and try again.";
      const code = error instanceof FaceServiceError ? error.code || null : null;
      const left = error instanceof FaceServiceError ? error.attemptsLeft ?? null : null;
      setFaceChallenge(null);
      setFaceTicket(null);
      setVerifyError(message);
      setErrorCode(code);
      setAttemptsLeft(left);
      setStage("error");
      toast({ variant: "destructive", title: "Verification failed", description: message });
      throw error;
    }
  };

  // Determine step progress for the stepper UI
  const stepIndex =
    stage === "waiting_qr"
      ? 1
      : stage === "qr_verifying" || stage === "qr_verified"
        ? 2
        : stage === "starting_face" ||
            stage === "checking_identity" ||
            stage === "liveness_check" ||
            stage === "verifying_attendance"
          ? 3
          : stage === "success"
            ? 4
            : verifiedSession
              ? 3
              : 1;

  const isFacePhase = Boolean(faceChallenge);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </button>

          {studentSession && (
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-xs">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{studentSession.name}</span>
              <span className="text-slate-400">•</span>
              <span className="font-mono font-bold text-emerald-700">{studentSession.usn}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Title, Live Progress Stepper & Verified Session Context */}
          <div className="lg:col-span-5 space-y-4 text-left">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md">
              {isFacePhase ? (
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              ) : (
                <QrCode className="w-6 h-6 text-emerald-400" />
              )}
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Attendance Verification
              </h1>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Scan your faculty&apos;s live QR code. Face identity and liveness verification will launch automatically right here.
              </p>
            </div>

            {/* Proactive Face Enrollment Warning if not enrolled */}
            {faceEnrolled === false && stage === "waiting_qr" && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2.5">
                <div className="font-bold flex items-center gap-1.5 text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Face Enrollment Required</span>
                </div>
                <p className="leading-relaxed">
                  You haven&apos;t enrolled your face profile yet. Enroll once before scanning classroom QR codes.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/face-enrollment")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-xs transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Go to Face Enrollment</span>
                </button>
              </div>
            )}

            {/* Verified QR Session Card (retained throughout face verification & success) */}
            {verifiedSession && (
              <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-emerald-950 text-xs space-y-1.5 shadow-2xs">
                <div className="font-bold flex items-center gap-1.5 text-emerald-800 uppercase tracking-wider text-[11px]">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                  <span>QR Session Verified</span>
                </div>
                <p className="font-extrabold text-sm text-slate-900">
                  {verifiedSession.subject || "Classroom Session"}
                </p>
                <p className="text-slate-600 font-medium">
                  Faculty: <strong className="text-slate-800">{verifiedSession.facultyName || "Faculty"}</strong>
                  {verifiedSession.sessionId ? ` • ID #${verifiedSession.sessionId}` : ""}
                </p>
              </div>
            )}

            {/* Continuous Progress Stepper */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  Verification Progress
                </span>
                <span
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                    stage === "success"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : stage === "error"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                  }`}
                >
                  {STAGE_LABELS[stage]}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                {[
                  { n: 1, title: "Scan dynamic QR code", desc: "Point camera at faculty screen" },
                  { n: 2, title: "Verify QR & session", desc: "Cryptographic token & expiry check" },
                  { n: 3, title: "Face & liveness check", desc: "Automatic identity match, light & head-turn" },
                  { n: 4, title: "Mark attendance", desc: "Saved securely by verification server" },
                ].map((item) => {
                  const done = stage === "success" || stepIndex > item.n;
                  const active = stage !== "success" && stepIndex === item.n;
                  return (
                    <div key={item.n} className="flex items-start gap-2.5">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 border ${
                          done
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : active
                              ? "bg-slate-900 border-slate-900 text-white"
                              : "bg-slate-50 border-slate-200 text-slate-400"
                        }`}
                      >
                        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : item.n}
                      </div>
                      <div className="leading-tight">
                        <p className={`font-bold ${done || active ? "text-slate-900" : "text-slate-400"}`}>
                          {item.title}
                        </p>
                        <p className="text-[11px] text-slate-500">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Unified Verification Viewport */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-5 sm:p-8 border border-slate-200 shadow-xl shadow-slate-900/5 text-center">
            <AnimatePresence mode="wait">
              {stage === "success" ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6 py-6"
                >
                  <div className="mx-auto w-20 h-20 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Attendance Successful</span>
                    </div>
                    <h2 className="text-2xl font-extrabold text-slate-900">Attendance Marked!</h2>
                    <p className="text-sm text-slate-600 max-w-md mx-auto">
                      Your presence for <strong>{verifiedSession?.subject || "this session"}</strong> has been verified and saved.
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 max-w-md mx-auto text-left text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-500">QR Token Verification</span>
                      <span className="font-bold text-emerald-700">Passed</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Face Identity Match</span>
                      <span className="font-bold text-emerald-700">Passed</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Liveness Verification</span>
                      <span className="font-bold text-emerald-700 capitalize">
                        Passed{livenessResult ? ` (${livenessResult})` : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                    <button
                      type="button"
                      onClick={() => navigate("/dashboard")}
                      className="flex-1 py-3 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-md"
                    >
                      Back to Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => void reset()}
                      className="flex-1 py-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-semibold text-sm transition-colors"
                    >
                      Scan Another Session
                    </button>
                  </div>
                </motion.div>
              ) : stage === "error" ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-5 py-4"
                >
                  <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm font-medium flex items-start gap-3 text-left">
                    <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                    <div className="space-y-2 flex-1">
                      <p className="font-bold text-rose-950">
                        {errorCode === "already_marked"
                          ? "Attendance Already Marked"
                          : errorCode === "face_not_enrolled"
                            ? "Face Not Enrolled"
                            : "Verification Failed — Attendance Not Marked"}
                      </p>
                      <p className="leading-relaxed text-slate-700">{verifyError}</p>
                      {attemptsLeft !== null && attemptsLeft > 0 && (
                        <p className="text-xs font-semibold text-rose-700">
                          Attempts remaining in this session: {attemptsLeft}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {errorCode === "face_not_enrolled" ? (
                      <button
                        type="button"
                        onClick={() => navigate("/face-enrollment")}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Enroll Face Now</span>
                      </button>
                    ) : lastQrToken &&
                      !NON_RETRYABLE_FACE_CODES.has(errorCode || "") &&
                      (attemptsLeft === null || attemptsLeft > 0) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void retryFaceVerification()}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span>Retry Face Verification</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void reset()}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-semibold text-sm transition-colors"
                        >
                          <QrCode className="w-4 h-4" />
                          <span>Scan New QR</span>
                        </button>
                      </>
                    ) : errorCode !== "too_many_attempts" && errorCode !== "already_marked" ? (
                      <button
                        type="button"
                        onClick={() => void reset()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Scan QR &amp; Retry</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => navigate("/dashboard")}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-semibold text-sm transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back to Dashboard</span>
                    </button>
                  </div>
                </motion.div>
              ) : isFacePhase && faceChallenge ? (
                <motion.div
                  key="face-verification"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full text-xs font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{STAGE_LABELS[stage]}</span>
                  </div>
                  <FaceChallengeCapture
                    mode="attendance"
                    embedded
                    autoStart
                    challenge={faceChallenge}
                    onStageChange={handleFaceStageChange}
                    onCancel={() => {
                      setFaceChallenge(null);
                      setFaceTicket(null);
                      void reset();
                    }}
                    onComplete={completeFaceAttendance}
                  />
                </motion.div>
              ) : (
                <motion.div key="qr-scanner" exit={{ opacity: 0 }} className="space-y-4">
                  {cameraError ? (
                    <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-medium flex items-start gap-3 text-left w-full">
                      <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                      <div className="space-y-2 flex-1">
                        <p className="font-bold text-rose-900">Camera Access Alert</p>
                        <p className="leading-relaxed text-slate-700">{cameraError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setCameraError(null);
                            void startScanner();
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold text-xs transition-colors shadow-sm"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry Camera</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-slate-900 text-white rounded-full text-xs font-semibold">
                      {stage === "qr_verifying" || stage === "qr_verified" ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          <span>{STAGE_LABELS[stage]}…</span>
                        </>
                      ) : (
                        <>
                          <Camera className="w-3.5 h-3.5 text-emerald-400" />
                          <span>QR Scanner Active — Waiting for QR scan</span>
                        </>
                      )}
                    </div>
                  )}

                  <div
                    id="reader"
                    className={`rounded-2xl overflow-hidden border-2 border-slate-200 mx-auto w-full max-w-sm sm:max-w-md bg-slate-900 min-h-[280px] flex items-center justify-center relative shadow-inner [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_video]:rounded-2xl ${
                      cameraError || stage === "qr_verifying" || stage === "qr_verified" ? "hidden" : "block"
                    }`}
                  />

                  {(stage === "qr_verifying" || stage === "qr_verified") && (
                    <div className="min-h-[260px] flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50 border border-slate-200 p-6">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                      <p className="text-sm font-bold text-slate-800">
                        {stage === "qr_verified"
                          ? "QR verified! Opening face verification camera…"
                          : "Validating QR code with server…"}
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Scanner;
