import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import FacultySession from "../pages/FacultySession";

const mockFaceApi = vi.fn();
vi.mock("@/lib/faceService", () => ({
  isFaceServiceConfigured: () => true,
  faceApi: (...args: unknown[]) => mockFaceApi(...args),
}));

// Mock Firebase & Auth
vi.mock("../firebase", () => ({
  db: {},
  auth: {
    currentUser: {
      email: "faculty@canara.edu",
      displayName: "Dr. Faculty",
    },
    onAuthStateChanged: (cb: (user: { email: string; displayName: string }) => void) => {
      cb({ email: "faculty@canara.edu", displayName: "Dr. Faculty" });
      return () => {};
    },
  },
}));

vi.mock("firebase/auth", () => ({
  getAuth: () => ({
    currentUser: {
      email: "faculty@canara.edu",
      displayName: "Dr. Faculty",
    },
    onAuthStateChanged: (cb: (user: { email: string; displayName: string }) => void) => {
      cb({ email: "faculty@canara.edu", displayName: "Dr. Faculty" });
      return () => {};
    },
  }),
  signOut: vi.fn(),
}));

vi.mock("@/lib/facultyAuth", () => ({
  verifyFacultyAuthorization: vi.fn().mockResolvedValue({
    isApproved: true,
  }),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({
      name: "Prof. Suresh Rao",
      class: "5th C",
      semester: "5th Semester",
      section: "Section C",
    }),
  }),
  getDocs: vi.fn().mockResolvedValue({
    empty: false,
    docs: [
      {
        id: "s1",
        data: () => ({
          name: "Suhas S Pai",
          usn: "4CB24CS155",
          email: "suhaspai13@gmail.com",
          class: "5th C",
          createdBy: "mock-ca-id",
        }),
      },
      {
        id: "s2",
        data: () => ({
          name: "Rahul Verma",
          usn: "4CB24CS101",
          email: "rahul.v@gmail.com",
          class: "5th C",
          createdBy: "mock-ca-id",
        }),
      },
    ],
  }),
  onSnapshot: vi.fn((_q: unknown, cb: (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void) => {
    cb({
      docs: [
        {
          id: "s1",
          data: () => ({
            name: "Suhas S Pai",
            usn: "4CB24CS155",
            email: "suhaspai13@gmail.com",
            class: "5th C",
            createdBy: "mock-ca-id",
            status: "present",
            sessionId: 1700000000000,
            time: new Date("2026-11-18T11:50:15"),
          }),
        },
        {
          id: "s2",
          data: () => ({
            name: "Rahul Verma",
            usn: "4CB24CS101",
            email: "rahul.v@gmail.com",
            class: "5th C",
            createdBy: "mock-ca-id",
            status: "absent",
            sessionId: 1700000000000,
            time: new Date("2026-11-18T11:50:00"),
          }),
        },
      ],
    });
    return () => {};
  }),
  addDoc: vi.fn().mockResolvedValue({ id: "new-doc" }),
  updateDoc: vi.fn().mockResolvedValue({}),
}));

describe("FacultySession UI Component Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={["/faculty/session/mock-ca-id"]}>
        <Routes>
          <Route path="/faculty/session/:caId" element={<FacultySession />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it("renders the session page with inactive status initially", async () => {
    renderComponent();

    expect(screen.getByText(/SESSION INACTIVE/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Session/i })).toBeInTheDocument();
  });

  it("restores completed session from localStorage and displays Download Attendance Report button", async () => {
    // Pre-populate completed session in localStorage for this CA ID
    const savedSession = {
      sessionId: 1700000000000,
      sessionStartTime: 1700000000000,
      sessionEndTime: 1700000030000,
      sessionStatus: "completed",
      selectedStudentIds: ["s1", "s2"],
      subject: "DSA",
      caId: "mock-ca-id",
    };
    localStorage.setItem("canattend_faculty_session_mock-ca-id", JSON.stringify(savedSession));

    renderComponent();

    await waitFor(() => {
      const completedElements = screen.getAllByText(/SESSION COMPLETED/i);
      expect(completedElements.length).toBeGreaterThan(0);
    });

    // Verify Download button is present and clearly visible
    const downloadBtns = screen.getAllByRole("button", { name: /Download Attendance Report/i });
    expect(downloadBtns.length).toBeGreaterThan(0);
    expect(downloadBtns[0]).toBeInTheDocument();

    // Verify Session Completed status details
    expect(screen.getAllByText(/Attendance Finalized/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Start New Session/i })).toBeInTheDocument();
  });

  it("starts a session without GPS/location and fetches dynamic QR token", async () => {
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/sessions/start") return { ok: true, sessionId: 1700000000999 };
      if (path === "/sessions/1700000000999/qr") return { ok: true, token: "CA2.1700000000999.9999999999.sig" };
      return { ok: true };
    });

    renderComponent();

    const startBtn = await screen.findByRole("button", { name: /Start Session/i });
    await waitFor(() => expect(startBtn).not.toBeDisabled());
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(mockFaceApi).toHaveBeenCalledWith(
        "/sessions/start",
        expect.not.objectContaining({ location: expect.anything() })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/LIVE SESSION ACTIVE/i)).toBeInTheDocument();
      expect(screen.getByText(/Dynamic QR active/i)).toBeInTheDocument();
      expect(screen.getByText(/every 1s/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/location captured/i)).not.toBeInTheDocument();
  });

  it("continuously refreshes signed QR tokens every 1000ms without page reload", async () => {
    let seq = 0;
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/sessions/start") {
        return {
          ok: true,
          sessionId: 1700000002222,
          qrToken: "CA2.1700000002222.1700000003.tok0",
          qrRefreshMs: 1000,
        };
      }
      if (path === "/sessions/1700000002222/qr") {
        seq += 1;
        return {
          ok: true,
          token: `CA2.1700000002222.${1700000003 + seq}.tok${seq}`,
          refreshIntervalMs: 1000,
        };
      }
      return { ok: true };
    });

    const { container } = renderComponent();
    const startBtn = await screen.findByRole("button", { name: /Start Session/i });
    await waitFor(() => expect(startBtn).not.toBeDisabled());
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(container.querySelector("canvas")).not.toBeNull();
      expect(seq).toBeGreaterThanOrEqual(1);
    });

    const firstSeq = seq;
    await waitFor(
      () => {
        expect(seq).toBeGreaterThan(firstSeq);
      },
      { timeout: 2500 }
    );
    expect(screen.getByText(/LIVE SESSION ACTIVE/i)).toBeInTheDocument();
  });

  it("never renders a QR canvas when QR generation fails and lets faculty retry", async () => {
    let qrCalls = 0;
    mockFaceApi.mockImplementation(async (path: string) => {
      if (path === "/sessions/start") return { ok: true, sessionId: 1700000001001 };
      if (path === "/sessions/1700000001001/qr") {
        qrCalls += 1;
        if (qrCalls === 1) throw new Error("Face service connection interrupted.");
        return { ok: true, token: "CA2.1700000001001.9999999999.sig" };
      }
      return { ok: true };
    });

    const { container } = renderComponent();
    const startBtn = await screen.findByRole("button", { name: /Start Session/i });
    await waitFor(() => expect(startBtn).not.toBeDisabled());
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry QR/i })).toBeInTheDocument();
    });
    expect(container.querySelector("canvas")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Retry QR/i }));

    await waitFor(() => {
      expect(container.querySelector("canvas")).not.toBeNull();
    });
  });
});
