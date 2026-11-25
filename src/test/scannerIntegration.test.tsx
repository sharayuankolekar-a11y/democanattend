import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Scanner from "../pages/Scanner";
import { STORAGE_KEY } from "@/lib/studentAuth";
import { FaceServiceError } from "@/lib/faceService";
import type { FaceCaptureFrame, FaceChallenge } from "@/components/FaceChallengeCapture";

let latestOnScanSuccess: ((text: string) => Promise<void>) | null = null;
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
const mockStart = vi.fn(async (_cam: unknown, _cfg: unknown, onSuccess: (text: string) => Promise<void>) => {
  latestOnScanSuccess = onSuccess;
});

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    isScanning = true;
    start = mockStart;
    stop = mockStop;
    clear = mockClear;
    static getCameras = vi.fn().mockResolvedValue([]);
  },
}));

const mockFaceApi = vi.fn();
vi.mock("@/lib/faceService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/faceService")>();
  return {
    ...actual,
    isFaceServiceConfigured: () => true,
    faceApi: (...args: unknown[]) => mockFaceApi(...args),
    getDeviceId: () => "device-test-123456",
    getStudentApprovalPayload: () => ({ loginRequestId: "lr1", sessionToken: "tok1" }),
  };
});

interface MockCaptureProps {
  challenge: FaceChallenge;
  onComplete: (frames: FaceCaptureFrame[]) => Promise<void>;
  onCancel: () => void;
  mode: "enroll" | "attendance";
  embedded?: boolean;
  autoStart?: boolean;
}

let mockCaptureProps: MockCaptureProps | null = null;
vi.mock("@/components/FaceChallengeCapture", () => ({
  default: (props: MockCaptureProps) => {
    mockCaptureProps = props;
    return (
      <div
        data-testid="embedded-face-capture"
        data-autostart={String(Boolean(props.autoStart))}
        data-embedded={String(Boolean(props.embedded))}
      >
        <span>Face Capture Ready</span>
        <button
          type="button"
          onClick={() =>
            props
              .onComplete([
                { phase: "front", t: 0, image: "data:image/jpeg;base64,AA==" },
                { phase: "light", t: 100, image: "data:image/jpeg;base64,AA==" },
                { phase: "turn", t: 200, image: "data:image/jpeg;base64,AA==" },
              ])
              .catch(() => {})
          }
        >
          Complete Face Check
        </button>
      </div>
    );
  },
}));

vi.mock("../firebase", () => ({
  db: {},
  auth: {
    currentUser: { email: "asha@cec.edu", uid: "u1" },
    onAuthStateChanged: (cb: (user: { email: string; uid: string } | null) => void) => {
      cb({ email: "asha@cec.edu", uid: "u1" });
      return () => {};
    },
  },
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { email: string; uid: string } | null) => void) => {
    cb({ email: "asha@cec.edu", uid: "u1" });
    return () => {};
  },
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: { exists: () => boolean; data: () => { status: string } }) => void) => {
    cb({
      exists: () => true,
      data: () => ({ status: "approved" }),
    });
    return () => {};
  }),
}));

describe("Unified Scanner & Face Verification Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestOnScanSuccess = null;
    mockCaptureProps = null;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: "s1",
        name: "Asha",
        usn: "4CB24CS001",
        email: "asha@cec.edu",
        loginRequestId: "lr1",
        sessionToken: "tok1",
      })
    );
  });

  const renderScanner = () =>
    render(
      <MemoryRouter initialEntries={["/scanner"]}>
        <Routes>
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/face-enrollment" element={<div>Face Enrollment Page</div>} />
          <Route path="/dashboard" element={<div>Student Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );

  it("transitions seamlessly from QR scan to embedded auto-start face verification without GPS and marks attendance", async () => {
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/face/status") return { ok: true, enrolled: true };
      if (path === "/attendance/begin") {
        return {
          ok: true,
          ticket: "ticket.sig",
          challenge: { turn: "left", light: { colors: [[255, 0, 0]], stepMs: 400 } },
          expiresInSec: 90,
          session: { sessionId: 12345, subject: "DSA", facultyName: "Prof. Rao", caId: "t1" },
        };
      }
      if (path === "/attendance/complete") {
        return { ok: true, status: "present", record: "updated", livenessLevel: "full" };
      }
      return { ok: true };
    });

    renderScanner();

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fps: 15 }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(screen.getAllByText(/Waiting for QR scan/i).length).toBeGreaterThan(0);

    await act(async () => {
      await latestOnScanSuccess!("  CA2.12345.9999999999.valid\n");
    });

    await waitFor(() => {
      expect(screen.getByTestId("embedded-face-capture")).toBeInTheDocument();
    });

    expect(mockFaceApi).toHaveBeenCalledWith(
      "/attendance/begin",
      expect.objectContaining({ qrToken: "CA2.12345.9999999999.valid" })
    );
    expect(mockFaceApi).toHaveBeenCalledWith(
      "/attendance/begin",
      expect.not.objectContaining({ location: expect.anything() })
    );
    expect(mockCaptureProps?.embedded).toBe(true);
    expect(mockCaptureProps?.autoStart).toBe(true);
    expect(screen.getByText("DSA")).toBeInTheDocument();
    expect(screen.getByText(/Prof\. Rao/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Complete Face Check/i }));

    await waitFor(() => {
      expect(screen.getByText(/Attendance Marked!/i)).toBeInTheDocument();
    });
  });

  it("rejects arbitrary non-CA2 QR text and allows safe retry", async () => {
    mockFaceApi.mockResolvedValue({ ok: true, enrolled: true });
    renderScanner();

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    await act(async () => {
      await latestOnScanSuccess!("arbitrary-qr-text");
    });

    await waitFor(() => {
      expect(screen.getByText(/Verification Failed — Attendance Not Marked/i)).toBeInTheDocument();
      expect(screen.getByText(/not a valid CanAttend attendance QR code/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Scan QR & Retry/i })).toBeInTheDocument();
  });

  it("handles expired QR rejection gracefully", async () => {
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/face/status") return { ok: true, enrolled: true };
      if (path === "/attendance/begin") {
        throw new FaceServiceError("This QR code has expired. Scan the refreshed code on the faculty screen.", "qr_expired", 400);
      }
      return { ok: true };
    });

    renderScanner();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    await act(async () => {
      await latestOnScanSuccess!("CA2.12345.1000.expired");
    });

    await waitFor(() => {
      expect(screen.getByText(/QR code has expired/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("embedded-face-capture")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scan QR & Retry/i })).toBeInTheDocument();
  });

  it("surfaces face mismatch with remaining attempts, blocks attendance, and allows safe face retry without rescanning valid QR", async () => {
    let completeCalls = 0;
    let beginCalls = 0;
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/face/status") return { ok: true, enrolled: true };
      if (path === "/attendance/begin") {
        beginCalls += 1;
        return {
          ok: true,
          ticket: `ticket-${beginCalls}.sig`,
          challenge: { turn: "right", light: { colors: [[0, 255, 0]], stepMs: 400 } },
          expiresInSec: 90,
          session: { sessionId: 12345, subject: "OS", facultyName: "Prof. Nair", caId: "t1" },
        };
      }
      if (path === "/attendance/complete") {
        completeCalls += 1;
        if (completeCalls === 1) {
          throw new FaceServiceError("Your face does not match the profile registered for this account.", "face_mismatch", 422, 4);
        }
        return { ok: true, status: "present", record: "updated", livenessLevel: "full" };
      }
      return { ok: true };
    });

    renderScanner();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    await act(async () => {
      await latestOnScanSuccess!("CA2.12345.9999999999.valid");
    });

    await waitFor(() => expect(screen.getByTestId("embedded-face-capture")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Complete Face Check/i }));

    await waitFor(() => {
      expect(screen.getByText(/does not match the profile/i)).toBeInTheDocument();
      expect(screen.getByText(/Attempts remaining in this session: 4/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry Face Verification/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Attendance Marked!/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry Face Verification/i }));

    await waitFor(() => expect(screen.getByTestId("embedded-face-capture")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Complete Face Check/i }));

    await waitFor(() => {
      expect(screen.getByText(/Attendance Marked!/i)).toBeInTheDocument();
    });
    expect(beginCalls).toBe(2);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
