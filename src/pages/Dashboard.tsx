import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import {
  StudentSession,
  getStoredStudentSession,
  clearStoredStudentSession,
  setStoredStudentSession,
  validateStudentSession,
  verifyStudentLoginApproval,
  endStudentLoginSession,
} from "@/lib/studentAuth";

// UI Components & Icons
import {
  QrCode,
  History,
  LogOut,
  Mail,
  CreditCard,
  ShieldCheck,
  BookOpen,
  User,
} from "lucide-react";
import { ActionCard } from "@/components/ActionCard";
import AppLayout from "@/layouts/AppLayout";
import { motion } from "framer-motion";

const Dashboard = () => {
  const navigate = useNavigate();

  // Student Profile State
  const [session, setSession] = useState<StudentSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Load Student Session & Real-time Profile Listener
  useEffect(() => {
    let isMounted = true;
    let unsubStudent: (() => void) | null = null;
    let unsubRequest: (() => void) | null = null;
    let safetyTimeout: NodeJS.Timeout | null = null;

    const currentSession = getStoredStudentSession();
    const validation = validateStudentSession(currentSession, "Dashboard");

    // 1. Verify student session using canonical session validation
    if (!validation.isValid || !currentSession) {
      clearStoredStudentSession();
      setLoading(false);
      navigate("/student-login", {
        replace: true,
        state: { error: validation.reason || "Dashboard access requires an approved login session from your Class Advisor. Please log in." },
      });
      return;
    }

    setSession(currentSession);

    // 5 & 9. Prevent infinite loading on slow networks or deployment:
    // Fallback safety timeout guarantees loading state always ends
    safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn("Safety timeout reached for student profile loading.");
        setLoading(false);
      }
    }, 6000);

    const initStudentProfile = async () => {
      const studentDocId = currentSession.id;
      const studentRef = doc(db, "students", studentDocId);

      try {
        // Strict Login Approval Verification against Firestore
        const approvalCheck = await verifyStudentLoginApproval(currentSession);
        if (!isMounted) return;

        if (!approvalCheck.isAuthorized) {
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              error: approvalCheck.reason || "Dashboard access requires an approved login session from your Class Advisor. Please log in.",
            },
          });
          return;
        }

        // 2. Fetch the student profile from the 'students' collection directly
        const docSnap = await getDoc(studentRef);

        if (!isMounted) return;

        // 3 & 6. Handle missing documents: clear invalid session and redirect with error
        if (!docSnap.exists()) {
          console.warn("Student record does not exist in Firestore:", studentDocId);
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              error: "Your student record has not been registered by your Class Advisor yet. Please contact your CA.",
            },
          });
          return;
        }

        const data = docSnap.data();
        const status = (data.status || "").toLowerCase().trim();

        // Check if student status is pending, rejected, or unapproved
        if (status === "pending") {
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              error: "Your student registration is awaiting approval by your Class Advisor.",
            },
          });
          return;
        }

        if (status === "rejected" || status === "deactivated") {
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              error: "Your student registration has been deactivated. Please contact your Class Advisor.",
            },
          });
          return;
        }

        // 7. If the student has not selected a CA, redirect to the existing CA selection flow
        const hasCa = Boolean((data.caSelected && data.caId) || (data.caId && data.caName));
        if (!hasCa && !data.createdBy) {
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              step: "select_ca",
              student: { id: docSnap.id, ...data },
            },
          });
          return;
        }

        // Check for stale credentials in localStorage (protect against mismatched session)
        const cleanDocEmail = (data.email || "").toLowerCase().trim();
        const cleanDocUsn = (data.usn || "").toUpperCase().trim();
        if (
          cleanDocEmail !== (currentSession.email || "").toLowerCase().trim() ||
          cleanDocUsn !== (currentSession.usn || "").toUpperCase().trim()
        ) {
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          setLoading(false);
          navigate("/student-login", {
            replace: true,
            state: {
              error: "Session credential mismatch. Please log in again with your Gmail and USN.",
            },
          });
          return;
        }

        // 8. If profile exists and CA association complete, display Student Dashboard
        const verifiedSession: StudentSession = {
          ...currentSession,
          id: docSnap.id,
          name: data.name || currentSession.name,
          usn: cleanDocUsn,
          email: cleanDocEmail,
          uid: currentSession.uid || auth.currentUser?.uid || "",
          class: data.class || currentSession.class || "5th C",
          semester: data.semester || currentSession.semester || "",
          section: data.section || currentSession.section || "",
          shortClass: data.shortClass || currentSession.shortClass || "",
          caId: data.caId || data.assignedFacultyDocId || currentSession.caId || "",
          caName: data.caName || currentSession.caName || "Class Advisor",
          caAppointmentId: data.caAppointmentId || currentSession.caAppointmentId || "",
          caSelected: true,
          loginRequestId: currentSession.loginRequestId,
          sessionToken: currentSession.sessionToken,
        };

        setSession(verifiedSession);
        setStoredStudentSession(verifiedSession);
        setLoading(false); // End loading state cleanly!

        // Real-time listener for login approval request status changes (e.g. CA revoking access)
        if (currentSession.loginRequestId) {
          unsubRequest = onSnapshot(
            doc(db, "student_login_requests", currentSession.loginRequestId),
            (reqSnap) => {
              if (!isMounted) return;
              if (!reqSnap.exists()) {
                clearStoredStudentSession();
                signOut(auth).catch(() => {});
                setLoading(false);
                navigate("/student-login", {
                  replace: true,
                  state: {
                    error: "Your login session was ended or revoked by your Class Advisor.",
                  },
                });
                return;
              }
              const rData = reqSnap.data();
              if (rData.status !== "approved") {
                clearStoredStudentSession();
                signOut(auth).catch(() => {});
                setLoading(false);
                navigate("/student-login", {
                  replace: true,
                  state: {
                    error: "Your login session was ended or revoked by your Class Advisor.",
                  },
                });
              }
            },
            (err) => console.warn("Login request onSnapshot error:", err)
          );
        }

        // 4. Attach onSnapshot listener for real-time updates and CA deletion detection
        unsubStudent = onSnapshot(
          studentRef,
          (liveSnap) => {
            if (!isMounted) return;

            // Missing document in real-time
            if (!liveSnap.exists()) {
              console.warn("Student record deleted in Firestore in real-time.");
              clearStoredStudentSession();
              signOut(auth).catch(() => {});
              setLoading(false);
              navigate("/student-login", {
                replace: true,
                state: {
                  error: "Your student record was deleted by your Class Advisor. Please contact your CA.",
                },
              });
              return;
            }

            const liveData = liveSnap.data();
            const liveStatus = (liveData.status || "").toLowerCase().trim();

            if (liveStatus === "pending" || liveStatus === "rejected" || liveStatus === "deactivated") {
              clearStoredStudentSession();
              signOut(auth).catch(() => {});
              setLoading(false);
              navigate("/student-login", {
                replace: true,
                state: {
                  error: "Your student registration is no longer active. Please contact your Class Advisor.",
                },
              });
              return;
            }

            // Real-time CA unassignment check
            if (!liveData.caSelected && !liveData.caId && !liveData.createdBy) {
              setLoading(false);
              navigate("/student-login", {
                replace: true,
                state: {
                  step: "select_ca",
                  student: { id: liveSnap.id, ...liveData },
                },
              });
              return;
            }

            const updatedLiveSession: StudentSession = {
              ...verifiedSession,
              id: liveSnap.id,
              name: liveData.name || verifiedSession.name,
              usn: (liveData.usn || verifiedSession.usn).toUpperCase().trim(),
              email: (liveData.email || verifiedSession.email).toLowerCase().trim(),
              uid: verifiedSession.uid || auth.currentUser?.uid || "",
              class: liveData.class || verifiedSession.class || "5th C",
              semester: liveData.semester || verifiedSession.semester || "",
              section: liveData.section || verifiedSession.section || "",
              shortClass: liveData.shortClass || verifiedSession.shortClass || "",
              caId: liveData.caId || liveData.assignedFacultyDocId || verifiedSession.caId || "",
              caName: liveData.caName || verifiedSession.caName || "Class Advisor",
              caAppointmentId: liveData.caAppointmentId || verifiedSession.caAppointmentId || "",
              caSelected: true,
              loginRequestId: verifiedSession.loginRequestId,
              sessionToken: verifiedSession.sessionToken,
            };

            setSession(updatedLiveSession);
            setStoredStudentSession(updatedLiveSession);
            setLoading(false);
          },
          (snapshotError: { code?: string }) => {
            console.error("Student onSnapshot listener error:", snapshotError);
            if (!isMounted) return;
            setLoading(false);

            // Handle permission-denied
            if (snapshotError?.code === "permission-denied") {
              clearStoredStudentSession();
              signOut(auth).catch(() => {});
              navigate("/student-login", {
                replace: true,
                state: {
                  error: "Access permission denied. Please log in again or contact your Class Advisor.",
                },
              });
            }
          }
        );

      } catch (err: unknown) {
        const firebaseErr = err as { code?: string; name?: string };
        console.error("Error fetching student profile from Firestore:", err);
        if (!isMounted) return;

        setLoading(false); // 5. Ensure loading state always ends

        // 3. Handle Firestore permission errors and missing documents properly
        if (firebaseErr?.code === "permission-denied") {
          clearStoredStudentSession();
          signOut(auth).catch(() => {});
          navigate("/student-login", {
            replace: true,
            state: {
              error: "Permission denied while accessing student record. Please verify your account.",
            },
          });
        } else if (firebaseErr?.code === "unavailable" || firebaseErr?.name === "FirebaseError") {
          // If network error occurred but we have a valid currentSession, keep user on dashboard
          if (currentSession && currentSession.usn && currentSession.caSelected) {
            setLoading(false);
          } else {
            clearStoredStudentSession();
            navigate("/student-login", {
              replace: true,
              state: {
                error: "Network error connecting to institutional database. Please check your connection and try again.",
              },
            });
          }
        } else {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: {
              error: "An error occurred while loading your profile. Please log in again.",
            },
          });
        }
      }
    };

    initStudentProfile();

    return () => {
      isMounted = false;
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (unsubStudent) unsubStudent();
      if (unsubRequest) unsubRequest();
    };
  }, [navigate]);

  // Sign out handler
  const handleSignOut = async () => {
    if (session) {
      await endStudentLoginSession(session);
    }
    clearStoredStudentSession();
    try {
      await signOut(auth);
    } catch (e) {
      // Ignore auth signout error if non-firebase user
    }
    navigate("/student-login", { replace: true });
  };

  const getInitials = (name: string) => {
    return (name || "Student")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans text-slate-600">
        <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="font-semibold text-sm">Loading Student Profile...</span>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8 text-left">
        
        {/* STUDENT PROFILE CARD */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm relative overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10 text-center sm:text-left">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-2xl sm:text-3xl shadow-md shrink-0 border-2 border-emerald-500/30">
              {getInitials(session?.name || "Student")}
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>CA-Verified Student</span>
                </span>
                {session?.class && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-200 text-xs font-bold">
                    <BookOpen className="w-3 h-3 text-slate-500" />
                    <span>Class {session.class}</span>
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                {session?.name}
              </h1>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs sm:text-sm font-medium text-slate-500 pt-1">
                <span className="flex items-center gap-1.5 text-slate-800 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 font-bold">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                  {session?.usn}
                </span>
                <span className="flex items-center gap-1 text-slate-600">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  {session?.email}
                </span>
                <span className="flex items-center gap-1 text-slate-600">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  CA: <strong className="text-slate-800">{session?.caName || "Class Advisor"}</strong>
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* MAIN ACTIONS GRID */}
        <div className="grid sm:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <ActionCard
              icon={QrCode}
              title="Scan Attendance QR"
              description="Scan the dynamic QR code displayed by your faculty during class."
              variant="primary"
              onClick={() => {
                if (session) {
                  setStoredStudentSession(session);
                }
                navigate("/scanner");
              }}
            />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <ActionCard
              icon={History}
              title="MyTrack"
              description="View your complete attendance summary, class timetable, live status and attendance history."
              onClick={() => {
                if (session) {
                  setStoredStudentSession(session);
                }
                navigate("/history");
              }}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <ActionCard
              icon={ShieldCheck}
              title="Face Enrollment"
              description="Register your face securely before using face-verified attendance scanning."
              onClick={() => navigate("/face-enrollment")}
            />
          </motion.div>
        </div>

        {/* SIGN OUT BUTTON */}
        <div className="flex justify-center pt-4">
          <button
            className="flex items-center gap-2 px-6 py-2.5 rounded-full border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 text-slate-600 text-sm font-semibold transition-all shadow-sm"
            onClick={handleSignOut}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>

      </div>
    </AppLayout>
  );
};

export default Dashboard;