import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import { 
  collection, 
  getDocs, 
  getDoc,
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc 
} from "firebase/firestore";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { 
  AlertCircle,
  ArrowLeft, 
  Users, 
  QrCode, 
  CheckCircle, 
  Clock, 
  Loader2, 
  Play, 
  Square, 
  UserCheck, 
  Search, 
  X, 
  Sparkles,
  GraduationCap,
  Download,
  RotateCcw
} from "lucide-react";
import { getAuth, signOut } from "firebase/auth";
import AppLayout from "@/layouts/AppLayout";
import { verifyFacultyAuthorization } from "@/lib/facultyAuth";
import { parseClassSemesterAndSection, formatShortClass } from "@/lib/caAuth";
import { toast } from "@/hooks/use-toast";
import {
  generateAttendanceReportFilename,
  buildAttendanceReportExcel,
  downloadAttendanceReportExcel,
  buildAttendanceReportCsv,
  downloadAttendanceReportCsv,
  calculateAttendanceSummary,
  formatReportDate,
  formatReportTime,
  formatScanTime,
  formatReportSemester,
  formatReportSection,
  toValidDate,
  SessionInformation,
  StudentAttendanceRow,
} from "@/lib/attendanceReport";
import { faceApi, isFaceServiceConfigured } from "@/lib/faceService";

interface ResolvedCAProfile {
  id: string;
  appointmentId?: string;
  name: string;
  email: string;
  class: string;
  shortClass: string;
  semester: string;
  section: string;
  semesterNumber: string;
  sectionLetter: string;
  allCaDocIds: string[];
}

interface FacultyInfo {
  name?: string;
  email?: string;
  subject?: string;
  role?: string;
  isCA?: boolean;
}

interface RosterStudent {
  id: string;
  name?: string;
  usn?: string;
  email?: string;
  gmail?: string;
  studentEmail?: string;
  class?: string;
  semester?: string;
  section?: string;
  shortClass?: string;
  status?: string;
  createdBy?: string;
  caId?: string;
  caName?: string;
  caAppointmentId?: string;
}

interface SessionAttendanceRecord {
  id: string;
  name?: string;
  usn?: string;
  email?: string;
  studentEmail?: string;
  status?: string;
  sessionId?: number | string;
  time?: unknown;
}

const SESSION_STORAGE_PREFIX = "canattend_faculty_session_";

export default function FacultySession() {
  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);
  const { caId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const searchParamSubject = searchParams.get("subject");
  const selectedSubject = searchParamSubject || sessionStorage.getItem("selectedSubject") || "";
  const searchParamClass = searchParams.get("class") || "";
  const searchParamShortClass = searchParams.get("shortClass") || "";
  const searchParamSemester = searchParams.get("semester") || "";
  const searchParamSection = searchParams.get("section") || "";
  const searchParamApptId = searchParams.get("apptId") || "";

  const initialParsed = parseClassSemesterAndSection(
    searchParamClass || searchParamShortClass,
    searchParamSemester,
    searchParamSection
  );

  const [qrToken, setQrToken] = useState("");
  const [qrError, setQrError] = useState<string | null>(null);
  const [caProfile, setCaProfile] = useState<ResolvedCAProfile | null>(() => {
    if (searchParamClass || searchParamSemester || searchParamSection || searchParamApptId) {
      return {
        id: caId || "",
        appointmentId: searchParamApptId,
        name: "Class Advisor",
        email: "",
        class: searchParamClass,
        shortClass: searchParamShortClass || (searchParamSemester && searchParamSection ? formatShortClass(searchParamSemester, searchParamSection) : searchParamClass),
        semester: searchParamSemester,
        section: searchParamSection,
        semesterNumber: initialParsed.semesterNumber,
        sectionLetter: initialParsed.sectionLetter,
        allCaDocIds: caId ? [caId] : [],
      };
    }
    return null;
  });
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [showStudentModal, setShowStudentModal] = useState<boolean>(false);
  const [studentSearchQuery, setStudentSearchQuery] = useState<string>("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"idle" | "active" | "completed">("idle");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionEndTime, setSessionEndTime] = useState<number | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [attendanceList, setAttendanceList] = useState<SessionAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [markingStudent, setMarkingStudent] = useState<string | null>(null);
  const [qrRefreshMs, setQrRefreshMs] = useState(1000);
  const [timeLeft, setTimeLeft] = useState(1);
  const qrInFlightRef = useRef(false);
  const lastQrErrorToastRef = useRef(0);
  const firstQrLoggedRef = useRef(false);

  const activeSubjectName = selectedSubject || faculty?.subject || "Classroom Session";

  // 1. Resolve Active CA Profile & Target Class Section
  useEffect(() => {
    if (!caId) return;

    let isMounted = true;

    const resolveCA = async () => {
      try {
        interface ApptDocData {
          id: string;
          status?: string;
          facultyDocId?: string;
          facultyEmail?: string;
          facultyName?: string;
          class?: string;
          shortClass?: string;
          semester?: string;
          section?: string;
        }
        interface TeacherDocData {
          id: string;
          email?: string;
          name?: string;
          caClass?: string;
          class?: string;
          caSemester?: string;
          semester?: string;
          caSection?: string;
          section?: string;
          caShortClass?: string;
          caAppointmentId?: string;
        }
        let targetAppt: ApptDocData | null = null;
        let targetTeacher: TeacherDocData | null = null;

        // A. Check searchParamApptId directly if passed
        if (searchParamApptId) {
          try {
            const apptDocRef = doc(db, "ca_appointments", searchParamApptId);
            const apptDocSnap = await getDoc(apptDocRef);
            if (apptDocSnap.exists() && apptDocSnap.data().status === "active") {
              targetAppt = { id: apptDocSnap.id, ...(apptDocSnap.data() as Omit<ApptDocData, "id">) };
            }
          } catch { /* ignore lookup miss */ }
        }

        // B. Check if caId matches an appointment document in 'ca_appointments'
        if (!targetAppt) {
          try {
            const apptDocRef = doc(db, "ca_appointments", caId);
            const apptDocSnap = await getDoc(apptDocRef);
            if (apptDocSnap.exists() && apptDocSnap.data().status === "active") {
              targetAppt = { id: apptDocSnap.id, ...(apptDocSnap.data() as Omit<ApptDocData, "id">) };
            }
          } catch { /* ignore lookup miss */ }
        }

        // C. Check if caId matches a facultyDocId in 'ca_appointments' (active)
        if (!targetAppt) {
          const qAppt = query(
            collection(db, "ca_appointments"),
            where("facultyDocId", "==", caId),
            where("status", "==", "active")
          );
          const snapAppt = await getDocs(qAppt);
          if (!snapAppt.empty) {
            targetAppt = { id: snapAppt.docs[0].id, ...(snapAppt.docs[0].data() as Omit<ApptDocData, "id">) };
          }
        }

        // D. Check if caId matches a doc in 'teachers' collection
        try {
          const teacherDocRef = doc(db, "teachers", caId);
          const teacherDocSnap = await getDoc(teacherDocRef);
          if (teacherDocSnap.exists()) {
            targetTeacher = { id: teacherDocSnap.id, ...(teacherDocSnap.data() as Omit<TeacherDocData, "id">) };
          }
        } catch { /* ignore lookup miss */ }

        // E. Cross-reference: If targetTeacher found but targetAppt not yet found, check active appointment by email
        if (!targetAppt && targetTeacher?.email) {
          const qApptByEmail = query(
            collection(db, "ca_appointments"),
            where("facultyEmail", "==", targetTeacher.email.toLowerCase().trim()),
            where("status", "==", "active")
          );
          const snapApptByEmail = await getDocs(qApptByEmail);
          if (!snapApptByEmail.empty) {
            targetAppt = { id: snapApptByEmail.docs[0].id, ...(snapApptByEmail.docs[0].data() as Omit<ApptDocData, "id">) };
          }
        }

        // F. Cross-reference: If targetAppt found but targetTeacher not yet found, check teacher by facultyDocId or email
        if (targetAppt && !targetTeacher) {
          if (targetAppt.facultyDocId) {
            try {
              const tSnap = await getDoc(doc(db, "teachers", targetAppt.facultyDocId));
              if (tSnap.exists()) {
                targetTeacher = { id: tSnap.id, ...(tSnap.data() as Omit<TeacherDocData, "id">) };
              }
            } catch { /* ignore lookup miss */ }
          }
          if (!targetTeacher && targetAppt.facultyEmail) {
            const qT = query(
              collection(db, "teachers"),
              where("email", "==", targetAppt.facultyEmail.toLowerCase().trim())
            );
            const snapT = await getDocs(qT);
            if (!snapT.empty) {
              targetTeacher = { id: snapT.docs[0].id, ...(snapT.docs[0].data() as Omit<TeacherDocData, "id">) };
            }
          }
        }

        // Collect all related Firestore teacher document IDs for this CA
        const caEmail = (targetAppt?.facultyEmail || targetTeacher?.email || "").toLowerCase().trim();
        const allCaDocIds: string[] = [];
        if (targetAppt?.facultyDocId) allCaDocIds.push(targetAppt.facultyDocId);
        if (targetTeacher?.id) allCaDocIds.push(targetTeacher.id);
        if (caId) allCaDocIds.push(caId);

        if (caEmail) {
          const qAllTeachers = query(
            collection(db, "teachers"),
            where("email", "==", caEmail)
          );
          const snapAll = await getDocs(qAllTeachers);
          snapAll.docs.forEach((d) => {
            if (!allCaDocIds.includes(d.id)) allCaDocIds.push(d.id);
          });
        }

        // Resolve class, semester and section
        const resolvedClass =
          targetAppt?.class ||
          targetTeacher?.caClass ||
          targetTeacher?.class ||
          searchParamClass ||
          "";

        const resolvedSemester =
          targetAppt?.semester ||
          targetTeacher?.caSemester ||
          targetTeacher?.semester ||
          searchParamSemester ||
          "";

        const resolvedSection =
          targetAppt?.section ||
          targetTeacher?.caSection ||
          targetTeacher?.section ||
          searchParamSection ||
          "";

        const resolvedShortClass =
          targetAppt?.shortClass ||
          targetTeacher?.caShortClass ||
          searchParamShortClass ||
          (resolvedSemester && resolvedSection ? formatShortClass(resolvedSemester, resolvedSection) : "");

        const parsed = parseClassSemesterAndSection(resolvedClass, resolvedSemester, resolvedSection);

        const profile: ResolvedCAProfile = {
          id: targetAppt?.facultyDocId || targetTeacher?.id || caId,
          appointmentId: targetAppt?.id || targetTeacher?.caAppointmentId || searchParamApptId || "",
          name: targetAppt?.facultyName || targetTeacher?.name || "Class Advisor",
          email: caEmail,
          class: resolvedClass,
          shortClass: resolvedShortClass,
          semester: resolvedSemester,
          section: resolvedSection,
          semesterNumber: parsed.semesterNumber,
          sectionLetter: parsed.sectionLetter,
          allCaDocIds: Array.from(new Set(allCaDocIds)),
        };

        if (isMounted) {
          setCaProfile(profile);
        }
      } catch (err) {
        console.error("Error resolving CA profile in FacultySession:", err);
      }
    };

    resolveCA();

    return () => {
      isMounted = false;
    };
  }, [caId, searchParamApptId, searchParamClass, searchParamSection, searchParamSemester, searchParamShortClass]);

  // 2. Real-time Student Roster Synchronization (retrieves students enrolled under this CA's class)
  useEffect(() => {
    if (!caId) return;

    const unsubStudents = onSnapshot(
      collection(db, "students"),
      (snapshot) => {
        const allStudents: RosterStudent[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RosterStudent, "id">),
        }));

        const targetClass = (caProfile?.class || "").trim().toLowerCase();
        const targetShort = (caProfile?.shortClass || "").trim().toLowerCase();
        const targetSemNum = caProfile?.semesterNumber || "";
        const targetSecLetter = caProfile?.sectionLetter || "";
        const allDocIds = caProfile?.allCaDocIds || [caId];
        const apptId = caProfile?.appointmentId || "";

        const enrolled = allStudents.filter((s) => {
          // Exclude deactivated or pending students
          const sStatus = (s.status || "approved").toLowerCase().trim();
          if (sStatus === "rejected" || sStatus === "deactivated") return false;

          // 1. Direct Document-ID relationship match
          if (s.createdBy && (s.createdBy === caId || allDocIds.includes(s.createdBy))) return true;
          if (s.caId && (s.caId === caId || allDocIds.includes(s.caId))) return true;
          if (apptId && s.caAppointmentId === apptId) return true;

          // 2. Class string match
          const sClass = (s.class || "").trim().toLowerCase();
          const sShort = (s.shortClass || "").trim().toLowerCase();

          if (targetClass && (sClass === targetClass || sShort === targetClass)) return true;
          if (targetShort && (sClass === targetShort || sShort === targetShort)) return true;

          // 3. Robust parsed semester and section match
          if (targetSemNum && targetSecLetter) {
            const sParsed = parseClassSemesterAndSection(s.class, s.semester, s.section);
            if (
              sParsed.semesterNumber === targetSemNum &&
              sParsed.sectionLetter === targetSecLetter
            ) {
              return true;
            }
          }

          return false;
        });

        // Deduplicate students by normalized USN
        const uniqueMap = new Map<string, RosterStudent>();
        for (const s of enrolled) {
          const usnKey = (s.usn || "").toUpperCase().trim() || s.id;
          if (!uniqueMap.has(usnKey)) {
            uniqueMap.set(usnKey, s);
          }
        }

        const sorted = Array.from(uniqueMap.values()).sort((a, b) =>
          (a.name || a.usn || "").localeCompare(b.name || b.usn || "")
        );

        setStudents(sorted);

        // Auto-select all enrolled students on initial load, or preserve valid selected IDs
        setSelectedStudentIds((prev) => {
          if (prev.length === 0) {
            return sorted.map((s) => s.id);
          }
          const validPrev = prev.filter((id) => sorted.some((s) => s.id === id));
          return validPrev.length > 0 ? validPrev : sorted.map((s) => s.id);
        });
      },
      (err) => {
        console.error("Error listening to enrolled students:", err);
      }
    );

    return () => unsubStudents();
  }, [caId, caProfile]);

  // Restore saved session state from localStorage (ensures persistence across refresh)
  useEffect(() => {
    if (!caId) return;
    let cancelled = false;
    try {
      const raw = localStorage.getItem(`${SESSION_STORAGE_PREFIX}${caId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.sessionId) {
          const sid = Number(saved.sessionId);
          setSessionStartTime(sid);
          if (saved.sessionEndTime) {
            setSessionEndTime(Number(saved.sessionEndTime));
          }
          if (Array.isArray(saved.selectedStudentIds) && saved.selectedStudentIds.length > 0) {
            setSelectedStudentIds(saved.selectedStudentIds);
          }

          if (saved.sessionStatus === "completed") {
            setSessionStatus("completed");
            setSessionActive(false);
          } else if (saved.sessionStatus === "active") {
            const elapsed = (Date.now() - sid) / 1000;
            if (elapsed >= 120 * 60) {
              const finalizedEndTime = Date.now();
              setSessionStatus("completed");
              setSessionActive(false);
              setSessionEndTime(finalizedEndTime);
              saved.sessionStatus = "completed";
              saved.sessionEndTime = finalizedEndTime;
              localStorage.setItem(`${SESSION_STORAGE_PREFIX}${caId}`, JSON.stringify(saved));
            } else {
              setSessionStatus("active");
              setSessionActive(true);
              setTimeLeft(1);
              if (isFaceServiceConfigured()) {
                faceApi<{ active: boolean }>(`/sessions/${sid}`, undefined, "GET")
                  .then((statusRes) => {
                    if (cancelled || statusRes.active) return;
                    const finalizedEndTime = Date.now();
                    setSessionStatus("completed");
                    setSessionActive(false);
                    setSessionEndTime(finalizedEndTime);
                    saved.sessionStatus = "completed";
                    saved.sessionEndTime = finalizedEndTime;
                    localStorage.setItem(`${SESSION_STORAGE_PREFIX}${caId}`, JSON.stringify(saved));
                  })
                  .catch((err) => {
                    if (cancelled) return;
                    if (err?.status === 404) {
                      const finalizedEndTime = Date.now();
                      setSessionStatus("completed");
                      setSessionActive(false);
                      setSessionEndTime(finalizedEndTime);
                      saved.sessionStatus = "completed";
                      saved.sessionEndTime = finalizedEndTime;
                      localStorage.setItem(`${SESSION_STORAGE_PREFIX}${caId}`, JSON.stringify(saved));
                    }
                  });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Error restoring session from localStorage:", err);
    }
    return () => {
      cancelled = true;
    };
  }, [caId]);

  // Auth & Faculty Data Fetch with CA Approval Verification
  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user || !user.email) {
        navigate("/faculty-login", { replace: true });
        return;
      }

      // Verify faculty authorization
      const authResult = await verifyFacultyAuthorization(user.email);
      if (!authResult.isApproved) {
        await signOut(auth);
        if (authResult.isPending) {
          navigate("/faculty/pending-approval", {
            replace: true,
            state: { message: authResult.message, email: user.email },
          });
        } else {
          navigate("/faculty-login", {
            replace: true,
            state: { error: authResult.message },
          });
        }
        return;
      }

      const q = query(
        collection(db, "teachers"),
        where("email", "==", user.email.toLowerCase().trim())
      );

      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const facultyDoc =
          snapshot.docs.find((d) => {
            const r = (d.data().role || "").toLowerCase().trim();
            return r === "faculty" || r === "ca" || d.data().isCA === true;
          }) || snapshot.docs[0];
        if (facultyDoc) {
          setFaculty(facultyDoc.data());
        }
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // Real-time listener for current session's attendance records from Firestore (Source of Truth)
  // Keeps syncing even after refresh or when session is completed
  useEffect(() => {
    if (!caId || !sessionStartTime) return;

    const q = query(collection(db, "attendance"), where("sessionId", "==", Number(sessionStartTime)));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: SessionAttendanceRecord[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SessionAttendanceRecord, "id">),
      }));
      const currentSessionRecords = records.filter(r => Number(r.sessionId) === Number(sessionStartTime));
      setAttendanceList(currentSessionRecords);
    });

    return () => unsubscribe();
  }, [caId, sessionStartTime]);

  // Keep countdown badge aligned with live 1s QR refresh interval
  useEffect(() => {
    if (!sessionActive || !sessionStartTime) return;
    setTimeLeft(Math.max(1, Math.round(qrRefreshMs / 1000)));
  }, [sessionActive, sessionStartTime, qrRefreshMs]);

  // Fetch short-lived, server-signed QR tokens every 1s. The session itself remains active while tokens rotate.
  const fetchLiveQrToken = useCallback(async (sid: number, isCancelled?: () => boolean) => {
    if (qrInFlightRef.current) return null;
    qrInFlightRef.current = true;
    try {
      const result = await faceApi<{
        token: string;
        expiresAt?: number;
        serverTimeMs?: number;
        refreshIntervalMs?: number;
      }>(`/sessions/${sid}/qr`, undefined, "GET");
      if (isCancelled?.()) return null;
      const cleanToken = (result.token || "").trim();
      if (!firstQrLoggedRef.current) {
        firstQrLoggedRef.current = true;
        console.info("[FacultySession] QR token refreshed", {
          sessionId: sid,
          hasCa2Prefix: cleanToken.startsWith("CA2."),
          length: cleanToken.length,
          expiresAt: result.expiresAt,
          refreshIntervalMs: result.refreshIntervalMs ?? 1000,
        });
      }
      if (!cleanToken.startsWith("CA2.")) {
        throw new Error("Server returned an invalid QR token format.");
      }
      const nextInterval =
        typeof result.refreshIntervalMs === "number" && result.refreshIntervalMs >= 500
          ? result.refreshIntervalMs
          : 1000;
      setQrRefreshMs(nextInterval);
      setQrToken(cleanToken);
      setQrError(null);
      setTimeLeft(Math.max(1, Math.round(nextInterval / 1000)));
      return result;
    } catch (error) {
      if (isCancelled?.()) return null;
      const message = error instanceof Error ? error.message : "Check the face service connection.";
      console.warn("[FacultySession] QR refresh failed", { sessionId: sid, message });
      setQrError(message);
      const nowMs = Date.now();
      if (nowMs - lastQrErrorToastRef.current >= 10000) {
        lastQrErrorToastRef.current = nowMs;
        toast({ variant: "destructive", title: "QR refresh failed", description: message });
      }
      return null;
    } finally {
      qrInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!sessionActive || !sessionStartTime) {
      firstQrLoggedRef.current = false;
      setQrToken("");
      setQrError(null);
      return;
    }
    let cancelled = false;
    let timerId: number | null = null;

    const clearScheduled = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const runAndSchedule = async () => {
      if (cancelled || document.hidden) return;
      const res = await fetchLiveQrToken(sessionStartTime, () => cancelled);
      if (cancelled || document.hidden) return;
      const baseMs =
        typeof res?.refreshIntervalMs === "number" && res.refreshIntervalMs >= 500
          ? res.refreshIntervalMs
          : 1000;
      // Align next 1s request right after server second boundary to guarantee fresh exp/signature every second without overlap
      const delayMs =
        typeof res?.serverTimeMs === "number" && baseMs === 1000
          ? Math.max(250, 1080 - (res.serverTimeMs % 1000))
          : baseMs;
      timerId = window.setTimeout(() => {
        void runAndSchedule();
      }, delayMs);
    };

    const onVisibilityChange = () => {
      clearScheduled();
      if (!document.hidden && !cancelled) {
        void runAndSchedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void runAndSchedule();

    return () => {
      cancelled = true;
      clearScheduled();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionActive, sessionStartTime, fetchLiveQrToken]);

  // Reconstitute selected students if restored after refresh with empty in-memory selection
  useEffect(() => {
    if (selectedStudentIds.length === 0 && attendanceList.length > 0 && students.length > 0) {
      const sessionUsns = new Set(attendanceList.map(a => (a.usn || "").toUpperCase()));
      const matched = students.filter(s => sessionUsns.has((s.usn || "").toUpperCase())).map(s => s.id);
      if (matched.length > 0) {
        setSelectedStudentIds(matched);
      }
    }
  }, [attendanceList, students, selectedStudentIds.length]);

  // Deduplicate session attendance records by normalized USN
  // PRESENT status takes precedence over ABSENT, latest timestamp preserved
  const attendanceByUsn = new Map<string, SessionAttendanceRecord>();
  attendanceList.forEach((rec) => {
    const u = (rec.usn || "").trim().toUpperCase();
    if (!u) return;
    const existing = attendanceByUsn.get(u);
    if (!existing) {
      attendanceByUsn.set(u, rec);
    } else {
      if (existing.status?.toLowerCase() !== "present" && rec.status?.toLowerCase() === "present") {
        attendanceByUsn.set(u, rec);
      }
    }
  });

  // Participating students strictly for this session
  const participatingStudents = students.filter(s => selectedStudentIds.includes(s.id));

  // Resolved Present vs Absent students strictly among participating students
  const presentStudents = participatingStudents.filter(s => {
    const rec = attendanceByUsn.get((s.usn || "").trim().toUpperCase());
    return rec && rec.status?.toLowerCase() === "present";
  });

  const absentStudents = participatingStudents.filter(s => {
    const rec = attendanceByUsn.get((s.usn || "").trim().toUpperCase());
    return !rec || rec.status?.toLowerCase() !== "present";
  });

  // Initialize absent records in Firestore for all selected students
  const markAllAbsent = async (sid: number, targets: RosterStudent[]) => {
    setLoading(true);
    try {
      await Promise.all(
        targets.map((s) => {
          const studentEmail = (s.email || s.gmail || s.studentEmail || "").trim().toLowerCase();
          return addDoc(collection(db, "attendance"), {
            name: s.name,
            usn: (s.usn || "").trim().toUpperCase(),
            email: studentEmail,
            studentEmail: studentEmail,
            studentId: s.id,
            status: "absent",
            time: new Date(),
            caId: caProfile?.id || caId || "",
            sessionId: sid,
            subject: activeSubjectName,
            class: caProfile?.class || s.class || "",
            facultyName: faculty?.name || "Faculty Member",
            facultyEmail: faculty?.email || "",
          });
        })
      );
    } catch (error) {
      console.error("Error marking initial attendance:", error);
      toast({
        variant: "destructive",
        title: "Session Error",
        description: "Failed to initialize attendance roster records.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Manual Override: Mark student present during active session
  const markStudentPresent = async (student: RosterStudent) => {
    if (!sessionStartTime || sessionStatus === "completed" || !sessionActive) return;
    setMarkingStudent(student.id);
    const cleanUsn = (student.usn || "").trim().toUpperCase();
    const studentEmail = (student.email || student.gmail || student.studentEmail || "").trim().toLowerCase();

    try {
      const q = query(
        collection(db, "attendance"),
        where("usn", "==", cleanUsn),
        where("sessionId", "==", sessionStartTime)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const docRef = doc(db, "attendance", snapshot.docs[0].id);
        await updateDoc(docRef, {
          status: "present",
          time: new Date(),
          email: studentEmail,
          studentEmail: studentEmail,
        });
      } else {
        await addDoc(collection(db, "attendance"), {
          name: student.name,
          usn: cleanUsn,
          email: studentEmail,
          studentEmail: studentEmail,
          studentId: student.id,
          status: "present",
          time: new Date(),
          caId: caProfile?.id || caId || "",
          sessionId: sessionStartTime,
          subject: activeSubjectName,
          class: caProfile?.class || student.class || "",
          facultyName: faculty?.name || "Faculty Member",
          facultyEmail: faculty?.email || "",
        });
      }
    } catch (error) {
      console.error("Error marking student present:", error);
      toast({
        variant: "destructive",
        title: "Action Failed",
        description: "Could not mark student present.",
      });
    } finally {
      setMarkingStudent(null);
    }
  };

  // Open a new verified attendance session without GPS/location requirements.
  const handleStartSession = async () => {
    if (participatingStudents.length === 0 || loading || startingSession) return;

    setStartingSession(true);
    try {
      if (!isFaceServiceConfigured()) throw new Error("Face verification service is not configured. Set VITE_FACE_SERVICE_URL before starting a verified session.");
      const currentUser = getAuth().currentUser;
      if (!currentUser) throw new Error("Faculty login expired. Please sign in again.");
      const serverSession = await faceApi<{
        sessionId: number;
        qrToken?: string;
        qrRefreshMs?: number;
      }>("/sessions/start", {
        caId: caProfile?.id || caId || "",
        appointmentId: caProfile?.appointmentId || "",
        facultyName: faculty?.name || currentUser.displayName || "Faculty Member",
        subject: activeSubjectName,
      });
      const sid = serverSession.sessionId;
      const initialQr = (serverSession.qrToken || "").trim();
      const refreshMs =
        typeof serverSession.qrRefreshMs === "number" && serverSession.qrRefreshMs >= 500
          ? serverSession.qrRefreshMs
          : 1000;
      if (initialQr.startsWith("CA2.")) {
        firstQrLoggedRef.current = true;
        console.info("[FacultySession] Initial signed QR received from /sessions/start", {
          sessionId: sid,
          length: initialQr.length,
          refreshIntervalMs: refreshMs,
        });
      }

      setAttendanceList([]);
      setSessionStartTime(sid);
      setSessionEndTime(null);
      setQrRefreshMs(refreshMs);
      setQrToken(initialQr.startsWith("CA2.") ? initialQr : "");
      setQrError(null);
      setTimeLeft(Math.max(1, Math.round(refreshMs / 1000)));
      setSessionStatus("active");
      setSessionActive(true);

      if (caId) {
        localStorage.setItem(
          `${SESSION_STORAGE_PREFIX}${caId}`,
          JSON.stringify({
            sessionId: sid,
            sessionStartTime: sid,
            sessionEndTime: null,
            sessionStatus: "active",
            selectedStudentIds,
            subject: activeSubjectName,
            caId,
          })
        );
      }

      await markAllAbsent(sid, participatingStudents);
    } catch (error: unknown) {
      console.error("Unable to start attendance session:", error);
      toast({
        variant: "destructive",
        title: "Could Not Start Session",
        description: (error as { message?: string })?.message || "Unable to start attendance session. Please check your connection and try again.",
      });
    } finally {
      setStartingSession(false);
    }
  };

  // End session & finalize attendance
  const handleEndSession = async () => {
    const endTime = Date.now();
    if (sessionStartTime) {
      try { await faceApi(`/sessions/${sessionStartTime}/end`, {}, "POST"); }
      catch (error) { toast({ variant: "destructive", title: "Server session could not be closed", description: error instanceof Error ? error.message : "Contact the administrator." }); }
    }
    setSessionActive(false);
    setSessionStatus("completed");
    setSessionEndTime(endTime);

    if (caId && sessionStartTime) {
      localStorage.setItem(
        `${SESSION_STORAGE_PREFIX}${caId}`,
        JSON.stringify({
          sessionId: sessionStartTime,
          sessionStartTime,
          sessionEndTime: endTime,
          sessionStatus: "completed",
          selectedStudentIds,
          subject: activeSubjectName,
          caId,
        })
      );
    }

    toast({
      title: "Session Completed",
      description: "Attendance records finalized. You can now download the attendance report.",
    });
  };

  // Start fresh session (clears completed state)
  const handleStartNewSession = () => {
    if (caId) {
      localStorage.removeItem(`${SESSION_STORAGE_PREFIX}${caId}`);
    }
    setSessionStatus("idle");
    setSessionActive(false);
    setSessionStartTime(null);
    setSessionEndTime(null);
    setAttendanceList([]);
    setQrRefreshMs(1000);
    setTimeLeft(1);
    toast({
      title: "Ready for New Session",
      description: "Select participating students and click 'Start Session'.",
    });
  };

  // Download Attendance Report Excel (.xlsx) / CSV
  const handleDownloadReport = async (format: "xlsx" | "csv" = "xlsx") => {
    if (participatingStudents.length === 0) {
      toast({
        variant: "destructive",
        title: "No Attendance Data",
        description: "No students were selected for this session.",
      });
      return;
    }

    setDownloading(true);
    try {
      const resolvedClassStr = caProfile?.class || students[0]?.class || "";
      const resolvedSem = caProfile?.semester || students[0]?.semester || "";
      const resolvedSec = caProfile?.section || students[0]?.section || "";

      // Retrieve actual session start and end timestamps from Firestore records (never fabricating current time)
      let actualStartTime = toValidDate(sessionStartTime);
      if (!actualStartTime && attendanceList.length > 0) {
        const validTimes = attendanceList
          .map((a) => toValidDate(a.time))
          .filter((t): t is Date => t !== null)
          .sort((a, b) => a.getTime() - b.getTime());
        if (validTimes.length > 0) {
          actualStartTime = validTimes[0];
        }
      }

      let actualEndTime = toValidDate(sessionEndTime);
      if (!actualEndTime && sessionStatus === "completed" && attendanceList.length > 0) {
        const validTimes = attendanceList
          .map((a) => toValidDate(a.time))
          .filter((t): t is Date => t !== null)
          .sort((a, b) => b.getTime() - a.getTime());
        if (validTimes.length > 0) {
          actualEndTime = validTimes[0];
        }
      }

      const sessionDateStr = formatReportDate(actualStartTime, "Not Available");
      const startTimeStr = formatReportTime(actualStartTime, "Not Recorded");
      const endTimeStr = formatReportTime(actualEndTime, "Not Recorded");

      const sessionInfo: SessionInformation = {
        institution: "Canara Engineering College",
        subjectName: activeSubjectName,
        facultyName: faculty?.name || getAuth().currentUser?.displayName || "Faculty Member",
        caName: caProfile?.name || students[0]?.caName || "Class Advisor",
        semester: formatReportSemester(resolvedSem, resolvedClassStr),
        section: formatReportSection(resolvedSec, resolvedClassStr),
        sessionDate: sessionDateStr,
        sessionStartTime: startTimeStr,
        sessionEndTime: endTimeStr,
      };

      const summary = calculateAttendanceSummary(
        students.length,
        participatingStudents.length,
        presentStudents.length
      );

      const studentRows: StudentAttendanceRow[] = participatingStudents.map((s, idx) => {
        const rec = attendanceByUsn.get((s.usn || "").trim().toUpperCase());
        const isPresent = rec && rec.status?.toLowerCase() === "present";

        return {
          slNo: idx + 1,
          name: s.name || rec?.name || "Student",
          usn: (s.usn || rec?.usn || "").toUpperCase(),
          email: s.email || s.gmail || s.studentEmail || rec?.email || rec?.studentEmail || "N/A",
          status: isPresent ? "PRESENT" : "ABSENT",
          scanTime: formatScanTime(rec?.time, isPresent ? "PRESENT" : "ABSENT"),
        };
      });

      const filename = generateAttendanceReportFilename({
        subject: activeSubjectName,
        semester: resolvedSem,
        section: resolvedSec,
        classStr: resolvedClassStr,
        sessionDate: sessionDateStr,
        extension: format,
      });

      if (format === "csv") {
        const csvContent = buildAttendanceReportCsv(sessionInfo, summary, studentRows);
        downloadAttendanceReportCsv(filename, csvContent);
      } else {
        const blob = await buildAttendanceReportExcel(sessionInfo, summary, studentRows);
        downloadAttendanceReportExcel(filename, blob);
      }

      toast({
        title: "Report Downloaded",
        description: `Saved ${filename} to your local files.`,
      });
    } catch (err) {
      console.error("Error generating attendance report:", err);
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: "An error occurred while compiling the report.",
      });
    } finally {
      setDownloading(false);
    }
  };

  // Student selection modal handlers
  const filteredModalStudents = students.filter((s) => {
    const qLower = studentSearchQuery.trim().toLowerCase();
    if (!qLower) return true;
    return (
      s.name?.toLowerCase().includes(qLower) ||
      s.usn?.toLowerCase().includes(qLower)
    );
  });

  const isAllSelected = students.length > 0 && selectedStudentIds.length === students.length;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(students.map((s) => s.id));
    }
  };

  const handleToggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const isRosterLocked = sessionActive || sessionStatus === "completed";

  return (
    <AppLayout fullViewport={true}>
      <div className="w-full h-full flex flex-col overflow-hidden text-left space-y-3">
        
        {/* TOP CONTROL BAR: Back Button + Session Status Pill */}
        <div className="flex items-center justify-between shrink-0">
          <button 
            onClick={() => navigate(`/faculty/dashboard${selectedSubject ? `?subject=${encodeURIComponent(selectedSubject)}` : ""}`)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-extrabold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all shadow-2xs"
          >
            <ArrowLeft size={15} />
            <span>← Back</span>
          </button>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black tracking-wider uppercase border ${
              sessionStatus === "completed"
                ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                : sessionActive 
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" 
                  : "bg-slate-200/80 text-slate-600 border-slate-300/80"
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                sessionActive 
                  ? "bg-emerald-500 animate-pulse" 
                  : sessionStatus === "completed"
                    ? "bg-emerald-500"
                    : "bg-slate-400"
              }`} />
              {sessionStatus === "completed" 
                ? "SESSION COMPLETED" 
                : sessionActive 
                  ? "LIVE SESSION ACTIVE" 
                  : "SESSION INACTIVE"}
            </span>
          </div>
        </div>

        {/* HERO SUBJECT BANNER CARD */}
        <div className="bg-slate-900 rounded-2xl p-4 sm:p-5 text-white shadow-xl relative overflow-hidden shrink-0 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Ambient Background Glows */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute left-1/3 -top-10 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Subject Title & Meta */}
          <div className="space-y-1 relative z-10">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={12} />
                LIVE ATTENDANCE SESSION
              </span>
              {caProfile?.class && (
                <span className="px-2.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <GraduationCap size={12} className="text-indigo-300" />
                  <span>Class: {caProfile.class}</span>
                </span>
              )}
              <span className="text-xs text-slate-300 font-medium hidden sm:inline">
                Faculty: {faculty?.name || "Faculty Member"}
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase leading-none">
              {activeSubjectName}
            </h1>
            <p className="text-xs text-slate-300 font-medium">
              Canara Engineering College • <span className="text-emerald-400 font-bold">Can</span><span className="text-white font-bold">Attend</span> Control Center
              {caProfile?.name && <span> • CA: <strong className="text-white">{caProfile.name}</strong></span>}
            </p>
          </div>

          {/* Interactive Controls & Live Stats */}
          <div className="flex flex-wrap items-center gap-3 relative z-10 shrink-0">
            {/* STUDENTS SELECTION BUTTON */}
            <button
              onClick={() => setShowStudentModal(true)}
              disabled={isRosterLocked}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all shadow-md ${
                isRosterLocked
                  ? "bg-slate-800/80 text-slate-400 border-slate-700 cursor-not-allowed"
                  : selectedStudentIds.length > 0
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/30"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
              }`}
              title={
                sessionActive 
                  ? "Roster locked during active session" 
                  : sessionStatus === "completed"
                    ? "Session completed. Start a new session to modify roster."
                    : "Select participating students for this session"
              }
            >
              <Users className={`w-5 h-5 shrink-0 ${selectedStudentIds.length > 0 ? "text-emerald-300" : "text-slate-400"}`} />
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-wider opacity-90 leading-none">
                  Students ({students.length})
                </span>
                <span className="text-xs sm:text-sm font-black leading-tight mt-0.5">
                  {selectedStudentIds.length === 0 ? "Select Students" : `${selectedStudentIds.length} of ${students.length} Selected`}
                </span>
              </div>
            </button>

            {/* LIVE SUMMARY STAT BADGES */}
            <div className="flex items-center gap-2 bg-slate-800/90 p-1.5 rounded-xl border border-slate-700/80">
              <div className="px-3 py-1 bg-slate-900/80 rounded-lg text-center border border-slate-700/50 min-w-[55px]">
                <span className="block text-[9px] font-bold text-slate-400 uppercase leading-none">Selected</span>
                <span className="text-sm font-black text-white leading-tight mt-0.5 block">{participatingStudents.length}</span>
              </div>
              <div className="px-3 py-1 bg-rose-950/50 rounded-lg text-center border border-rose-800/50 min-w-[55px]">
                <span className="block text-[9px] font-bold text-rose-300 uppercase leading-none">Absent</span>
                <span className="text-sm font-black text-rose-400 leading-tight mt-0.5 block">{absentStudents.length}</span>
              </div>
              <div className="px-3 py-1 bg-emerald-950/50 rounded-lg text-center border border-emerald-800/50 min-w-[55px]">
                <span className="block text-[9px] font-bold text-emerald-300 uppercase leading-none">Present</span>
                <span className="text-sm font-black text-emerald-400 leading-tight mt-0.5 block">{presentStudents.length}</span>
              </div>
            </div>

            {/* HEADER DOWNLOAD REPORT SHORTCUT (when completed) */}
            {sessionStatus === "completed" && (
              <button
                onClick={() => handleDownloadReport("xlsx")}
                disabled={downloading || participatingStudents.length === 0}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-all shadow-md active:scale-95 disabled:opacity-50"
                title="Download Attendance Report Excel (.xlsx)"
              >
                <Download size={15} className="stroke-[2.5]" />
                <span className="hidden sm:inline">Download Report</span>
              </button>
            )}
          </div>
        </div>

        {/* WORKSPACE 3-COLUMN LAYOUT (DESKTOP: QR SESSION LEFT | ABSENT MIDDLE | PRESENT RIGHT) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch flex-1 min-h-0 overflow-hidden">
          
          {/* COLUMN 1: QR SESSION CONTROLLER (LEFT ~35% WIDTH) */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 flex flex-col justify-between h-full min-h-0 overflow-y-auto text-center">
            <div className="shrink-0 space-y-0.5 pb-2 border-b border-slate-100">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center justify-center gap-1.5">
                <span>📱 QR SESSION</span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {sessionStatus === "completed"
                  ? "Attendance finalized"
                  : sessionActive
                    ? "Live dynamic QR countdown"
                    : "Ready to start session"}
              </p>
            </div>

            {/* STATE 1: COMPLETED SESSION WITH DOWNLOAD BUTTON */}
            {sessionStatus === "completed" ? (
              <div className="space-y-4 py-2 my-auto shrink-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-3xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-600 shadow-xs">
                  <CheckCircle className="w-10 h-10 sm:w-11 sm:h-11 text-emerald-600" />
                </div>

                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider">
                    <Sparkles size={11} />
                    <span>Attendance Finalized</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    Session Completed
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Attendance records are finalized and locked.
                  </p>
                </div>

                {/* Finalized Attendance Summary Card */}
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/90 text-left space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-slate-600 font-medium">
                    <span>Total Enrolled:</span>
                    <span className="font-bold text-slate-900 font-mono">{students.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 font-medium">
                    <span>Selected Students:</span>
                    <span className="font-bold text-slate-900 font-mono">{participatingStudents.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 font-medium">
                    <span>Present Students:</span>
                    <span className="font-bold text-emerald-700 font-mono">{presentStudents.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 font-medium">
                    <span>Absent Students:</span>
                    <span className="font-bold text-rose-700 font-mono">{absentStudents.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700 font-semibold pt-1.5 border-t border-slate-200">
                    <span>Attendance Rate:</span>
                    <span className="font-black text-slate-900 font-mono text-sm">
                      {participatingStudents.length > 0
                        ? `${((presentStudents.length / participatingStudents.length) * 100).toFixed(1)}%`
                        : "0.0%"}
                    </span>
                  </div>
                </div>

                {/* PROMINENT DOWNLOAD ATTENDANCE REPORT BUTTON */}
                <div className="space-y-1.5 w-full">
                  <button
                    onClick={() => handleDownloadReport("xlsx")}
                    disabled={downloading || participatingStudents.length === 0}
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl font-black text-xs sm:text-sm transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 group disabled:opacity-50"
                    title="Download attendance report as formatted Excel (.xlsx) workbook"
                  >
                    {downloading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Generating Excel...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                        <span>Download Attendance Report</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownloadReport("csv")}
                    disabled={downloading || participatingStudents.length === 0}
                    className="w-full text-center text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition-colors underline decoration-slate-300"
                    title="Download as plain CSV file"
                  >
                    Download as CSV
                  </button>
                </div>

                {/* START NEW SESSION BUTTON */}
                <button
                  onClick={handleStartNewSession}
                  className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-extrabold text-xs transition-colors flex items-center justify-center gap-1.5"
                  title="Clear completed session and start a new attendance session"
                >
                  <RotateCcw size={13} />
                  <span>Start New Session</span>
                </button>
              </div>
            ) : !sessionActive ? (
              /* STATE 2: INACTIVE SESSION - READY TO START */
              <div className="space-y-4 py-2 my-auto shrink-0">
                <div className="w-28 h-28 sm:w-36 sm:h-36 mx-auto rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 shadow-inner">
                  <QrCode className="w-14 h-14 sm:w-16 sm:h-16 text-slate-400" />
                </div>
                
                <button
                  onClick={handleStartSession}
                  disabled={participatingStudents.length === 0 || loading || startingSession}
                  className="w-full py-3 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-extrabold text-xs sm:text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading || startingSession ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>{startingSession ? "Starting session..." : "Initializing..."}</span>
                    </>
                  ) : (
                    <>
                      <Play size={15} fill="currentColor" />
                      <span>Start Session</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* STATE 3: LIVE ACTIVE SESSION WITH TIMER & END SESSION BUTTON */
              <div className="space-y-3.5 my-auto shrink-0">
                {qrToken.startsWith("CA2.") ? (
                  <div className="bg-white p-3.5 rounded-2xl border-2 border-emerald-500/30 inline-block shadow-inner">
                    <QRCodeCanvas
                      value={qrToken}
                      size={185}
                      className="mx-auto"
                    />
                  </div>
                ) : (
                  <div className="mx-auto w-[215px] h-[215px] bg-slate-50 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center p-4 text-center gap-2 shadow-inner">
                    {qrError ? (
                      <>
                        <AlertCircle className="w-6 h-6 text-rose-500" />
                        <p className="text-xs font-semibold text-rose-700 leading-snug">{qrError}</p>
                        <button
                          type="button"
                          onClick={() => sessionStartTime && void fetchLiveQrToken(sessionStartTime)}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-bold hover:bg-emerald-600 transition-colors"
                        >
                          Retry QR
                        </button>
                      </>
                    ) : (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                        <p className="text-xs font-semibold text-slate-600">Generating secure QR…</p>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-2.5">
                  <div className="flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold text-emerald-800 bg-emerald-50 py-1.5 px-3 rounded-full border border-emerald-200 w-fit mx-auto">
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Dynamic QR active · Auto-rotates every {Math.max(1, Math.round(qrRefreshMs / 1000))}s</span>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 py-1.5 px-4 rounded-full border border-slate-200 w-fit mx-auto">
                    <Clock className="w-4 h-4 text-emerald-600" />
                    <span>QR refresh: {timeLeft}s</span>
                  </div>

                  <button
                    onClick={handleEndSession}
                    className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs sm:text-sm transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                    title="End session and finalize attendance results"
                  >
                    <Square size={13} fill="currentColor" />
                    <span>End Session</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* COLUMN 2: ABSENT / UNMARKED PANEL (MIDDLE ~32.5% WIDTH) */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-2xs flex flex-col h-full min-h-0 overflow-hidden">
            {/* Panel Header */}
            <div className="px-4 py-3 bg-rose-50/70 border-b border-rose-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-rose-900">
                  🔴 ABSENT ({absentStudents.length})
                </h3>
              </div>
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">
                Unmarked Roster
              </span>
            </div>

            {/* Scrollable Student List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
              {absentStudents.length === 0 ? (
                <div className="p-6 text-center space-y-1.5 my-auto">
                  <Users className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-sm font-bold text-slate-800">
                    {participatingStudents.length === 0 ? "No Students Selected" : "All Selected Students Present!"}
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    {participatingStudents.length === 0 
                      ? "Click the 'Students' button above to choose roster participants for this session." 
                      : "No remaining absent students."}
                  </p>
                </div>
              ) : (
                absentStudents.map((student) => (
                  <div
                    key={student.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 hover:border-rose-300 transition-all flex items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-bold text-sm text-slate-900 truncate">{student.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-rose-700 font-mono font-semibold uppercase tracking-wider">
                          {student.usn}
                        </span>
                        {student.email && (
                          <span className="text-[11px] text-slate-400 truncate max-w-[130px] hidden sm:inline font-mono">
                            {student.email}
                          </span>
                        )}
                      </div>
                    </div>

                    {sessionActive && (
                      <button
                        onClick={() => markStudentPresent(student)}
                        disabled={markingStudent === student.id}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-2xs"
                        title="Manual Override Present"
                      >
                        {markingStudent === student.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle size={13} />
                        )}
                        <span>Present</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* COLUMN 3: PRESENT PANEL (RIGHT ~32.5% WIDTH) */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-2xs flex flex-col h-full min-h-0 overflow-hidden">
            {/* Panel Header */}
            <div className="px-4 py-3 bg-emerald-50/70 border-b border-emerald-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-900">
                  🟢 PRESENT ({presentStudents.length})
                </h3>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                Verified Attendance
              </span>
            </div>

            {/* Scrollable Student List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
              {presentStudents.length === 0 ? (
                <div className="p-6 text-center space-y-1.5 my-auto">
                  <UserCheck className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-sm font-bold text-slate-700">No Students Present Yet</p>
                  <p className="text-xs text-slate-400">Scanned students will appear here in real-time.</p>
                </div>
              ) : (
                presentStudents.map((s) => {
                  const rec = attendanceByUsn.get((s.usn || "").trim().toUpperCase());
                  const formattedScan = formatScanTime(rec?.time);

                  return (
                    <div
                      key={s.id}
                      className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/90 flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <p className="font-bold text-sm text-slate-900 truncate">{s.name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-700 font-mono font-semibold uppercase tracking-wider">
                            {s.usn}
                          </span>
                          {formattedScan !== "Not scanned" && (
                            <span className="text-[10px] text-emerald-600 bg-emerald-100/70 px-1.5 py-0.2 rounded font-mono font-bold">
                              {formattedScan}
                            </span>
                          )}
                        </div>
                      </div>
                      <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>

      {/* STUDENT SELECTION MODAL */}
      {showStudentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-slate-900 text-base sm:text-lg">Student Selection</h3>
              </div>
              <button
                onClick={() => setShowStudentModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search students by name or USN..."
                value={studentSearchQuery}
                onChange={(e) => setStudentSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-slate-50 font-medium"
              />
            </div>

            {/* Select All Row */}
            <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 shrink-0">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  disabled={isRosterLocked}
                  className="w-4 h-4 accent-emerald-600 rounded cursor-pointer disabled:cursor-not-allowed"
                />
                <span>Select All ({students.length})</span>
              </label>
              <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Selected: {selectedStudentIds.length} / {students.length}
              </span>
            </div>

            {/* Scrollable Student List */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {filteredModalStudents.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No matching students found in roster.</p>
              ) : (
                filteredModalStudents.map((s) => {
                  const checked = selectedStudentIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                        checked
                          ? "bg-emerald-50/50 border-emerald-300 text-slate-900"
                          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                      } ${isRosterLocked ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <div className="space-y-0.5">
                        <p className="font-bold text-xs sm:text-sm text-slate-900">{s.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono font-semibold uppercase tracking-wider">{s.usn}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => !isRosterLocked && handleToggleStudent(s.id)}
                        disabled={isRosterLocked}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setShowStudentModal(false)}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
              >
                <span>OK</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
