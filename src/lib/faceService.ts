import { auth } from "@/firebase";
import { getStoredStudentSession } from "@/lib/studentAuth";

const BASE_URL = (import.meta.env.VITE_FACE_SERVICE_URL || "").replace(/\/$/, "");

export class FaceServiceError extends Error {
  code?: string;
  status?: number;
  attemptsLeft?: number;
  constructor(message: string, code?: string, status?: number, attemptsLeft?: number) {
    super(message);
    this.name = "FaceServiceError";
    this.code = code;
    this.status = status;
    this.attemptsLeft = attemptsLeft;
  }
}

// Only present when the server runs with DEBUG_SCORES=true (for tuning on real phones; switch it off for the live demo).
function formatDebug(debug: unknown): string {
  if (!debug || typeof debug !== "object") return "";
  const dbg = debug as {
    light?: { status?: string; score?: number; strength?: number };
    turn?: { peak?: number };
    faceScore?: number;
  };
  const bits: string[] = [];
  if (dbg.light) bits.push(`light: ${dbg.light.status ?? "?"}, score ${dbg.light.score ?? "-"}, strength ${dbg.light.strength ?? "-"}`);
  if (dbg.turn) bits.push(`turn peak ${dbg.turn.peak ?? "-"}`);
  if (dbg.faceScore != null) bits.push(`face ${dbg.faceScore}`);
  return bits.length ? ` [debug: ${bits.join(" | ")}]` : "";
}

export function isFaceServiceConfigured() {
  return Boolean(BASE_URL);
}

async function waitForAuthenticatedUser() {
  if (auth.currentUser) return auth.currentUser;
  if (typeof auth.onAuthStateChanged !== "function") return null;
  return new Promise<typeof auth.currentUser>((resolve) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      resolve(auth.currentUser);
    }, 1500);
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        window.clearTimeout(timer);
        unsubscribe();
        resolve(user);
      }
    });
  });
}

export async function faceApi<T>(path: string, body?: Record<string, unknown>, method = "POST"): Promise<T> {
  if (!BASE_URL) {
    throw new FaceServiceError(
      "Face verification service is not configured. Set VITE_FACE_SERVICE_URL in the frontend environment.",
      "service_unconfigured"
    );
  }
  const user = await waitForAuthenticatedUser();
  if (!user) {
    throw new FaceServiceError("Your Google login has expired. Please sign in again.", "unauthenticated", 401);
  }
  const idToken = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new FaceServiceError(
      "Could not reach the face-verification service. Ensure the backend server is running and check your network connection.",
      "network_error"
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new FaceServiceError(
      (data.message || `Face service request failed (${response.status}).`) + formatDebug(data.debug),
      data.code,
      response.status,
      typeof data.attemptsLeft === "number" ? data.attemptsLeft : undefined
    );
  }
  return data as T;
}

export function getDeviceId() {
  const key = "canattend_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function getStudentApprovalPayload() {
  const session = getStoredStudentSession();
  if (!session?.loginRequestId || !session.sessionToken) {
    throw new FaceServiceError(
      "Your approved student login could not be verified. Sign out and log in again.",
      "login_not_approved",
      403
    );
  }
  return { loginRequestId: session.loginRequestId, sessionToken: session.sessionToken };
}
