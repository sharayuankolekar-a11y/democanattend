import { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Users, ChevronRight, BookOpen, Loader2 } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { verifyFacultyAuthorization } from "@/lib/facultyAuth";

interface CAOption {
  id: string;
  appointmentId?: string;
  name: string;
  email: string;
  class: string;
  shortClass: string;
  semester: string;
  section: string;
  department: string;
}

export default function FacultyDashboard() {
  const location = useLocation();
  const searchParamSubject = new URLSearchParams(location.search).get("subject");

  if (searchParamSubject) {
    sessionStorage.setItem("selectedSubject", searchParamSubject);
  }
  const subject = searchParamSubject || sessionStorage.getItem("selectedSubject") || "";

  const navigate = useNavigate();
  const [cas, setCas] = useState<CAOption[]>([]);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Protected route check & Fetch all CAs
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
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

      setCheckingAuth(false);

      // Fetch active CAs from ca_appointments (Single Source of Truth) and teachers collection
      try {
        const apptsSnap = await getDocs(
          query(collection(db, "ca_appointments"), where("status", "==", "active"))
        );
        interface RawApptDoc {
          id: string;
          class?: string;
          shortClass?: string;
          facultyDocId?: string;
          facultyName?: string;
          facultyEmail?: string;
          semester?: string;
          section?: string;
          department?: string;
        }
        interface RawTeacherDoc {
          id: string;
          name?: string;
          email?: string;
          class?: string;
          caClass?: string;
          shortClass?: string;
          caShortClass?: string;
          semester?: string;
          caSemester?: string;
          section?: string;
          caSection?: string;
          department?: string;
        }
        const activeAppts: RawApptDoc[] = apptsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RawApptDoc, "id">),
        }));

        const teachersSnap = await getDocs(
          query(collection(db, "teachers"), where("role", "==", "ca"))
        );
        const caTeachers: RawTeacherDoc[] = teachersSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RawTeacherDoc, "id">),
        }));

        const caMap = new Map<string, CAOption>();

        // 1. Process active appointments first (highest priority)
        for (const appt of activeAppts) {
          const classStr = appt.class || appt.shortClass || "";
          const key = (classStr || appt.facultyDocId || appt.id).toLowerCase().trim();
          caMap.set(key, {
            id: appt.facultyDocId || appt.id,
            appointmentId: appt.id,
            name: appt.facultyName || "Class Advisor",
            email: appt.facultyEmail || "",
            class: appt.class || appt.shortClass || "Class Section",
            shortClass: appt.shortClass || appt.class || "",
            semester: appt.semester || "",
            section: appt.section || "",
            department: appt.department || "",
          });
        }

        // 2. Add any CAs from teachers not already covered by appointment
        for (const t of caTeachers) {
          const classStr = t.caClass || t.class || "";
          const key = (classStr || t.email || t.id).toLowerCase().trim();
          if (!caMap.has(key)) {
            caMap.set(key, {
              id: t.id,
              name: t.name || "Class Advisor",
              email: t.email || "",
              class: classStr || "General",
              shortClass: t.caShortClass || t.shortClass || classStr,
              semester: t.caSemester || t.semester || "",
              section: t.caSection || t.section || "",
              department: t.department || "",
            });
          }
        }

        const casList = Array.from(caMap.values()).sort((a, b) =>
          (a.class || "").localeCompare(b.class || "")
        );

        setCas(casList);
      } catch (err) {
        console.error("Error fetching active CAs in FacultyDashboard:", err);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // When CA is clicked
  const handleCaClick = (ca: CAOption) => {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (ca.class) params.set("class", ca.class);
    if (ca.shortClass) params.set("shortClass", ca.shortClass);
    if (ca.semester) params.set("semester", ca.semester);
    if (ca.section) params.set("section", ca.section);
    if (ca.appointmentId) params.set("apptId", ca.appointmentId);
    navigate(`/faculty/session/${ca.id}?${params.toString()}`);
  };

  if (checkingAuth) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Verifying Faculty Clearance...</h2>
          <p className="text-xs text-slate-500">Checking CA approval and active credentials.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-start">
          <button
            onClick={() => navigate("/faculty/subjects")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Subjects</span>
          </button>
        </div>

        {/* Dashboard Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm text-left flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            {subject && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                <span>Selected Subject: {subject}</span>
              </div>
            )}
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Select Class Advisor (CA)
            </h1>
            <p className="text-sm text-slate-500">
              Choose the target class section to launch your attendance terminal.
            </p>
          </div>
        </div>

        {/* CA List Grid */}
        <div className="space-y-3">
          {cas.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm">
              <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-600">No Class Advisors registered yet.</p>
              <p className="text-xs text-slate-400 mt-1">Please ask your HOD or CA to register their account.</p>
            </div>
          ) : (
            cas.map((ca, i) => (
              <motion.button
                key={ca.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleCaClick(ca)}
                className="w-full group p-5 rounded-2xl bg-white border border-slate-200/80 hover:border-emerald-500/50 hover:bg-emerald-50/30 shadow-sm hover:shadow-md transition-all flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg group-hover:bg-emerald-600 transition-colors shadow-sm shrink-0">
                    {ca.name?.charAt(0) || "C"}
                  </div>
                  
                  <div className="space-y-0.5">
                    <h3 className="font-bold text-lg text-slate-900 group-hover:text-emerald-800 transition-colors">
                      {ca.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold uppercase tracking-wider">
                        Class: {ca.class || "General"}
                      </span>
                      {ca.email && (
                        <span className="text-xs text-slate-400 font-medium hidden sm:inline">
                          • {ca.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-white px-3 py-1.5 rounded-full border border-slate-200 group-hover:border-emerald-300">
                  <span>Enter Session</span>
                  <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
              </motion.button>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}