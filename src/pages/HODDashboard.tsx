import { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  onSnapshot 
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { 
  Loader2, 
  Users, 
  ArrowLeft, 
  LogOut,
  Crown,
  ShieldCheck,
  ChevronRight,
  GraduationCap,
  Sparkles,
  UserCheck
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyHODAuthorization } from "@/lib/hodAuth";

export default function HODDashboard() {
  const navigate = useNavigate();

  // Authentication & Verification state
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentHOD, setCurrentHOD] = useState<Record<string, string | undefined> | null>(null);

  // Live counters for the dashboard cards
  const [pendingFacultyCount, setPendingFacultyCount] = useState<number>(0);
  const [activeAppointmentsCount, setActiveAppointmentsCount] = useState<number>(0);
  const [totalApprovedStaff, setTotalApprovedStaff] = useState<number>(0);
  const [totalCAs, setTotalCAs] = useState<number>(0);
  const [totalFaculty, setTotalFaculty] = useState<number>(0);
  const [loadingStats, setLoadingStats] = useState(true);

  // =========================================================================
  // PROTECTED ROUTE CHECK: FIREBASE AUTH & FIRESTORE AUTHORIZATION
  // =========================================================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        navigate("/hod-login", { replace: true });
        return;
      }

      try {
        const authResult = await verifyHODAuthorization(user.email);

        if (authResult.isApproved) {
          setCurrentHOD({
            ...authResult.data,
            email: user.email,
            displayName: user.displayName || authResult.data?.name || "HOD",
            photoURL: user.photoURL,
          });
          setCheckingAuth(false);
        } else {
          await signOut(auth);
          navigate("/hod-login", {
            replace: true,
            state: { error: authResult.message || "Unauthorized access." },
          });
        }
      } catch (err) {
        console.error("HOD Authorization check failed:", err);
        await signOut(auth);
        navigate("/hod-login", {
          replace: true,
          state: { error: "Failed to verify departmental authorization." },
        });
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // =========================================================================
  // REAL-TIME FIRESTORE STATS LISTENERS (SCOPED TO HOD'S DEPARTMENT)
  // =========================================================================
  useEffect(() => {
    if (checkingAuth || !currentHOD) return;

    const currentDeptId = currentHOD?.departmentId;
    const currentDeptName = (currentHOD?.departmentName || currentHOD?.department || "").toLowerCase().trim();

    // Department match helper
    const matchesDept = (docData: { departmentId?: string; department?: string; departmentName?: string }) => {
      if (currentDeptId && docData.departmentId === currentDeptId) return true;
      const docDept = (docData.department || docData.departmentName || "").toLowerCase().trim();
      if (currentDeptName && docDept === currentDeptName) return true;
      return false;
    };

    // 1. Pending Faculty registration requests count for this department
    const facultyUnsub = onSnapshot(
      collection(db, "faculty_requests"),
      (snapshot) => {
        const pending = snapshot.docs.filter((d) => {
          const data = d.data();
          if (!matchesDept(data)) return false;
          const s = (data.status || "").toLowerCase();
          return s === "pending" || (!s && s !== "approved" && s !== "rejected");
        });
        setPendingFacultyCount(pending.length);
      },
      (error) => {
        console.error("Error fetching Faculty requests count:", error);
      }
    );

    // 2. Active CA appointments count for this department
    const apptsUnsub = onSnapshot(
      collection(db, "ca_appointments"),
      (snapshot) => {
        const active = snapshot.docs.filter((d) => {
          const data = d.data();
          if (!matchesDept(data)) return false;
          return data.status === "active";
        });
        setActiveAppointmentsCount(active.length);
      },
      (error) => {
        console.error("Error fetching active CA appointments count:", error);
      }
    );

    // 3. Approved Staff count for this department
    const teachersUnsub = onSnapshot(
      collection(db, "teachers"),
      (snapshot) => {
        // Approved Staff count for this department (excluding dismissed, rejected, revoked, pending)
        const approvedStaff = snapshot.docs.filter((d) => {
          const data = d.data();
          if (!matchesDept(data)) return false;
          const role = (data.role || "").toLowerCase().trim();
          const status = (data.status || "").toLowerCase().trim();
          const isStaff = role === "ca" || role === "faculty" || role === "class advisor" || data.isCA === true;
          const isExcluded = status === "rejected" || status === "revoked" || status === "dismissed" || status === "pending";
          return isStaff && !isExcluded;
        });

        // Deduplicate faculty by email so each person is counted once
        const staffByEmail = new Map<string, { role?: string; isCA?: boolean; email?: string }>();
        for (const d of approvedStaff) {
          const data = d.data() as { role?: string; isCA?: boolean; email?: string };
          const email = (data.email || "").toLowerCase().trim() || d.id;
          if (!staffByEmail.has(email)) {
            staffByEmail.set(email, data);
          } else {
            const existing = staffByEmail.get(email);
            if (!existing?.isCA && data.isCA) staffByEmail.set(email, data);
          }
        }

        const uniqueStaffList = Array.from(staffByEmail.values());
        const cas = uniqueStaffList.filter((d) => {
          const role = (d.role || "").toLowerCase().trim();
          return role === "ca" || role === "class advisor" || d.isCA === true;
        }).length;

        const faculty = uniqueStaffList.filter((d) => {
          const role = (d.role || "").toLowerCase().trim();
          return role === "faculty" && !d.isCA;
        }).length;

        setTotalApprovedStaff(uniqueStaffList.length);
        setTotalCAs(cas);
        setTotalFaculty(faculty);
        setLoadingStats(false);
      },
      (error) => {
        console.error("Error fetching teachers directory:", error);
        setLoadingStats(false);
      }
    );

    return () => {
      facultyUnsub();
      apptsUnsub();
      teachersUnsub();
    };
  }, [checkingAuth, currentHOD]);

  // Sign out handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/admin-select");
    } catch (error) {
      navigate("/admin-select");
    }
  };

  // Loading Screen
  if (checkingAuth) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-24 text-center space-y-4">
          <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 mx-auto mb-3 shadow-md border-slate-200" />
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-800">Verifying HOD Authorization...</h2>
            <p className="text-xs text-slate-500">Checking Firebase authentication and executive clearance.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-8 text-left pb-16">
        
        {/* Navigation Bar */}
        <div className="flex justify-between items-center">
          <button 
            onClick={() => navigate("/")} 
            className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Home Portal</span>
          </button>

          <button 
            onClick={handleLogout} 
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-rose-600 hover:text-rose-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm hover:border-rose-300 transition-all"
          >
            <LogOut size={16} />
            <span>Sign Out (HOD)</span>
          </button>
        </div>

        {/* Executive Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold">
                <Crown size={14} className="text-amber-400" />
                HOD Executive Terminal
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                <ShieldCheck size={14} className="text-emerald-600" />
                Google Authenticated
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Institutional Oversight
            </h1>
            
            <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
              Executive command center for institutional staff appointments, Class Advisor allocations, staff directory management, and departmental registration approvals.
            </p>

            {/* Logged in HOD identity banner */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-1">
              <span>
                Executive: <strong className="text-slate-900">{currentHOD?.name || currentHOD?.displayName || "Authorized HOD"}</strong>
              </span>
              <span>•</span>
              <span>
                Department: <strong className="text-emerald-700">{currentHOD?.department || "Academic Department"}</strong>
              </span>
              <span>•</span>
              <span className="text-slate-400">{currentHOD?.email}</span>
            </div>
          </div>

          <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 shadow-sm border-slate-200 shrink-0" />
        </div>

        {/* ========================================================================= */}
        {/* MAIN INTERFACE: PROFESSIONAL, CLICKABLE CARDS */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch pt-2">
          
          {/* CARD 1: INSTITUTIONAL APPROVAL MANAGEMENT */}
          <div
            onClick={() => navigate("/hod/approval-management")}
            className="group relative p-7 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/50 hover:scale-[1.01] transition-all cursor-pointer flex flex-col justify-between space-y-5 overflow-hidden"
          >
            <div className="space-y-5">
              {/* Card Header with Icon and Pending Badge */}
              <div className="flex items-start justify-between gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors shadow-xs">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                
                {loadingStats ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                    Loading...
                  </span>
                ) : pendingFacultyCount > 0 ? (
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
                    {pendingFacultyCount} Pending
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    All Up to Date
                  </span>
                )}
              </div>

              {/* Title & Description */}
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Institutional Approval Management
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Authorize and manage faculty registration requests across departments.
                </p>
              </div>

              {/* Status Pill */}
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700">
                  <Users size={13} className="text-indigo-600" />
                  {pendingFacultyCount} Faculty {pendingFacultyCount === 1 ? "Request" : "Requests"}
                </span>
              </div>
            </div>

            {/* Clickable Action Footer */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 group-hover:text-emerald-800 flex items-center gap-1.5">
                <span>Manage Approvals</span>
                <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="text-[10px] text-slate-400 font-medium">HOD Clearance</span>
            </div>
          </div>

          {/* CARD 2: CLASS ADVISOR APPOINTMENT MANAGEMENT */}
          <div
            onClick={() => navigate("/hod/ca-appointments")}
            className="group relative p-7 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/50 hover:scale-[1.01] transition-all cursor-pointer flex flex-col justify-between space-y-5 overflow-hidden"
          >
            <div className="space-y-5">
              {/* Card Header with Icon and Count Badge */}
              <div className="flex items-start justify-between gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors shadow-xs">
                  <GraduationCap className="w-7 h-7" />
                </div>

                {loadingStats ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                    Loading...
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {activeAppointmentsCount} Active CAs
                  </span>
                )}
              </div>

              {/* Title & Description */}
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Class Advisor Appointments
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Appoint approved faculty to semester sections with atomic replacement.
                </p>
              </div>

              {/* Status Pill */}
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                  <UserCheck size={13} className="text-emerald-600" />
                  {activeAppointmentsCount} Assigned Sections
                </span>
              </div>
            </div>

            {/* Clickable Action Footer */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 group-hover:text-emerald-800 flex items-center gap-1.5">
                <span>Appoint & Manage CAs</span>
                <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="text-[10px] text-slate-400 font-medium">HOD Controlled</span>
            </div>
          </div>

          {/* CARD 3: INSTITUTIONAL STAFF DIRECTORY */}
          <div
            onClick={() => navigate("/hod/staff-directory")}
            className="group relative p-7 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-500/50 hover:scale-[1.01] transition-all cursor-pointer flex flex-col justify-between space-y-5 overflow-hidden"
          >
            <div className="space-y-5">
              {/* Card Header with Icon and Count Badge */}
              <div className="flex items-start justify-between gap-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center transition-colors shadow-xs">
                  <Users className="w-7 h-7" />
                </div>

                {loadingStats ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                    Loading...
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    {totalApprovedStaff} Staff Members
                  </span>
                )}
              </div>

              {/* Title & Description */}
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-slate-900 group-hover:text-indigo-700 transition-colors">
                  Institutional Staff Directory
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  View and manage all approved faculty and live CA section assignments.
                </p>
              </div>

              {/* Status Pill */}
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700">
                  <GraduationCap size={13} className="text-emerald-600" />
                  {totalCAs} CA Appointments Active
                </span>
              </div>
            </div>

            {/* Clickable Action Footer */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-700 group-hover:text-indigo-800 flex items-center gap-1.5">
                <span>Open Staff Directory</span>
                <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="text-[10px] text-slate-400 font-medium">Search & Audit</span>
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
