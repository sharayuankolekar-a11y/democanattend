import { useEffect, useState, useMemo } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  where,
  orderBy
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/use-toast";
import { 
  Loader2, 
  Users, 
  Mail, 
  GraduationCap, 
  ArrowLeft, 
  CheckCircle2, 
  Check, 
  X, 
  LogOut,
  Crown,
  ShieldCheck,
  Building2,
  BookOpen,
  Search,
  AlertTriangle,
  Clock,
  History,
  RotateCcw,
  Sparkles,
  ArrowRight,
  UserCheck
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyHODAuthorization } from "@/lib/hodAuth";
import { 
  appointClassAdvisor, 
  revokeClassAdvisorAppointment, 
  formatShortClass,
  CAAppointmentRecord 
} from "@/lib/caAuth";

const SEMESTERS = [
  "1st Semester",
  "2nd Semester",
  "3rd Semester",
  "4th Semester",
  "5th Semester",
  "6th Semester",
  "7th Semester",
  "8th Semester",
];

const SECTIONS = ["A", "B", "C", "D"];

interface FacultyMember {
  id: string;
  name: string;
  email: string;
  departmentId?: string;
  department?: string;
  designation?: string;
  isCA?: boolean;
  caClass?: string;
  caShortClass?: string;
  caAppointmentId?: string;
  role?: string;
  status?: string;
  subject?: string;
  subjects?: string[];
}

export default function HODCAAppointments() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedFacultyId = searchParams.get("facultyId");

  // Authentication & Verification state
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentHOD, setCurrentHOD] = useState<Record<string, string | undefined> | null>(null);

  // Data states
  const [facultyList, setFacultyList] = useState<FacultyMember[]>([]);
  const [appointments, setAppointments] = useState<CAAppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [searchFacultyQuery, setSearchFacultyQuery] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState<FacultyMember | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<string>(SEMESTERS[4]); // default 5th
  const [selectedSection, setSelectedSection] = useState<string>(SECTIONS[2]);   // default C
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Revoke appointment dialog state
  const [revokeTarget, setRevokeTarget] = useState<CAAppointmentRecord | null>(null);
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // Active view tab: "assign" | "active" | "history"
  const [viewTab, setViewTab] = useState<"assign" | "active" | "history">("assign");

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
  // REAL-TIME FIRESTORE LISTENERS FOR FACULTY AND CA APPOINTMENTS (SCOPED TO HOD'S DEPARTMENT)
  // =========================================================================
  useEffect(() => {
    if (checkingAuth || !currentHOD) return;

    const currentDeptId = currentHOD?.departmentId;
    const currentDeptName = (currentHOD?.departmentName || currentHOD?.department || "").toLowerCase().trim();

    const matchesDept = (docData: { departmentId?: string; department?: string; departmentName?: string }) => {
      if (currentDeptId && docData.departmentId === currentDeptId) return true;
      const docDept = (docData.department || docData.departmentName || "").toLowerCase().trim();
      if (currentDeptName && docDept === currentDeptName) return true;
      return false;
    };

    // 1. Listen to approved faculty in 'teachers' belonging to this department
    const teachersUnsub = onSnapshot(
      collection(db, "teachers"),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as FacultyMember[];

        // Filter to approved institutional faculty/teachers in this department (excluding pure HOD accounts and pending/rejected records)
        const approvedFaculty = list.filter((m) => {
          if (!matchesDept(m)) return false;
          const role = (m.role || "").toLowerCase().trim();
          const status = (m.status || "").toLowerCase().trim();
          const isApproved = status === "approved" || (!status && (role === "ca" || role === "faculty"));
          return role !== "hod" && status !== "rejected" && status !== "pending" && isApproved;
        });

        // Consolidate faculty by verified email so each faculty member appears only once with all their subjects
        const facultyGroups = new Map<string, FacultyMember[]>();
        for (const f of approvedFaculty) {
          const emailKey = (f.email || "").toLowerCase().trim();
          const key = emailKey || f.id;
          if (!facultyGroups.has(key)) {
            facultyGroups.set(key, [f]);
          } else {
            facultyGroups.get(key)!.push(f);
          }
        }

        const uniqueFaculty: FacultyMember[] = [];
        for (const [, docs] of facultyGroups.entries()) {
          let primary = docs[0];
          for (const d of docs) {
            if (!primary.isCA && d.isCA) primary = d;
            else if (!primary.designation && d.designation) primary = d;
          }

          // Extract all subjects across all documents of this faculty
          const subjectsSet = new Set<string>();
          docs.forEach((docItem) => {
            const extra = docItem as FacultyMember & { subjectSpecialization?: string };
            if (extra.subject && typeof extra.subject === "string") {
              const trimmed = extra.subject.trim();
              if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
                trimmed.split(/[,;/\n]+/).forEach((part: string) => {
                  const clean = part.trim();
                  if (clean && clean.toLowerCase() !== "teaching faculty") subjectsSet.add(clean);
                });
              }
            }
            if (Array.isArray(extra.subjects)) {
              extra.subjects.forEach((s: unknown) => {
                if (typeof s === "string") {
                  const trimmed = s.trim();
                  if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
                    trimmed.split(/[,;/\n]+/).forEach((part: string) => {
                      const clean = part.trim();
                      if (clean && clean.toLowerCase() !== "teaching faculty") subjectsSet.add(clean);
                    });
                  }
                }
              });
            }
            if (extra.subjectSpecialization && typeof extra.subjectSpecialization === "string") {
              const trimmed = extra.subjectSpecialization.trim();
              if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
                trimmed.split(/[,;/\n]+/).forEach((part: string) => {
                  const clean = part.trim();
                  if (clean && clean.toLowerCase() !== "teaching faculty") subjectsSet.add(clean);
                });
              }
            }
          });

          const allSubjects: string[] = [];
          const seenSub = new Set<string>();
          for (const sub of Array.from(subjectsSet)) {
            if (!seenSub.has(sub.toLowerCase())) {
              seenSub.add(sub.toLowerCase());
              allSubjects.push(sub);
            }
          }

          uniqueFaculty.push({
            ...primary,
            subjects: allSubjects,
          });
        }
        setFacultyList(uniqueFaculty);

        // Pre-select if facultyId was passed via query parameter
        if (preselectedFacultyId) {
          const match = uniqueFaculty.find((f) => f.id === preselectedFacultyId);
          if (match) {
            setSelectedFaculty(match);
          } else {
            // Match by email if preselectedFacultyId belonged to a secondary document
            const matchedDoc = list.find((d) => d.id === preselectedFacultyId);
            if (matchedDoc?.email) {
              const matchedUnique = uniqueFaculty.find(
                (f) => (f.email || "").toLowerCase().trim() === matchedDoc.email.toLowerCase().trim()
              );
              if (matchedUnique) {
                setSelectedFaculty(matchedUnique);
              }
            }
          }
        }

        setLoading(false);
      },
      (error) => {
        console.error("Error fetching faculty members:", error);
        setLoading(false);
      }
    );

    // 2. Listen to 'ca_appointments' for this department
    const apptsUnsub = onSnapshot(
      collection(db, "ca_appointments"),
      (snapshot) => {
        const allAppts = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CAAppointmentRecord[];

        // Filter by HOD's department
        const deptAppts = allAppts.filter((a) => matchesDept(a));

        // Sort descending by appointedAt
        deptAppts.sort((a, b) => {
          const timeA = new Date(a.appointedAt || 0).getTime();
          const timeB = new Date(b.appointedAt || 0).getTime();
          return timeB - timeA;
        });

        setAppointments(deptAppts);
      },
      (error) => {
        console.error("Error fetching CA appointments:", error);
      }
    );

    return () => {
      teachersUnsub();
      apptsUnsub();
    };
  }, [checkingAuth, currentHOD, preselectedFacultyId]);

  // Filtered faculty for searchable selection
  const filteredFaculty = useMemo(() => {
    if (!searchFacultyQuery.trim()) return facultyList;
    const queryStr = searchFacultyQuery.toLowerCase().trim();
    return facultyList.filter((f) => {
      const name = (f.name || "").toLowerCase();
      const email = (f.email || "").toLowerCase();
      const dept = (f.department || "").toLowerCase();
      const designation = (f.designation || "").toLowerCase();
      return (
        name.includes(queryStr) ||
        email.includes(queryStr) ||
        dept.includes(queryStr) ||
        designation.includes(queryStr)
      );
    });
  }, [facultyList, searchFacultyQuery]);

  // Active appointments list
  const activeAppointments = useMemo(() => {
    return appointments.filter((a) => a.status === "active");
  }, [appointments]);

  // Appointment history list (replaced / revoked)
  const appointmentHistory = useMemo(() => {
    return appointments.filter((a) => a.status === "replaced" || a.status === "revoked");
  }, [appointments]);

  // Selected class string
  const currentClassString = `${selectedSemester} – Section ${selectedSection}`;
  const currentShortClass = formatShortClass(selectedSemester, selectedSection);

  // Check if an existing CA is currently assigned to the selected class
  const existingActiveCAForClass = useMemo(() => {
    return activeAppointments.find(
      (a) => a.class === currentClassString || (a.semester === selectedSemester && a.section === selectedSection)
    );
  }, [activeAppointments, currentClassString, selectedSemester, selectedSection]);

  // Check if the selected faculty already has a different active CA appointment
  const selectedFacultyCurrentAppt = useMemo(() => {
    if (!selectedFaculty) return null;
    return activeAppointments.find(
      (a) => a.facultyDocId === selectedFaculty.id || a.facultyEmail === selectedFaculty.email?.toLowerCase().trim()
    );
  }, [activeAppointments, selectedFaculty]);

  // =========================================================================
  // ACTIONS: CONFIRM CA APPOINTMENT WITH AUTOMATIC ATOMIC REPLACEMENT
  // =========================================================================
  const handleConfirmAppointment = async () => {
    if (!selectedFaculty) {
      toast({
        title: "Faculty Selection Required",
        description: "Please select an approved faculty member from the list.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);

      const result = await appointClassAdvisor({
        facultyDocId: selectedFaculty.id,
        facultyName: selectedFaculty.name,
        facultyEmail: selectedFaculty.email,
        departmentId: currentHOD?.departmentId || selectedFaculty.departmentId || "",
        departmentCode: currentHOD?.departmentCode || "",
        department: currentHOD?.department || selectedFaculty.department || "Academic Department",
        designation: selectedFaculty.designation || "Teaching Faculty",
        semester: selectedSemester,
        section: selectedSection,
        hodEmail: currentHOD?.email || "hod@college.edu",
      });

      if (result.success) {
        toast({
          title: "Class Advisor Appointed!",
          description: result.message,
        });

        // Reset form selection
        setSelectedFaculty(null);
        setSearchFacultyQuery("");
        setViewTab("active");
      } else {
        toast({
          title: "Appointment Failed",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      console.error("Appointment submission error:", error);
      toast({
        title: "Appointment Error",
        description: (error as { message?: string })?.message || "Failed to appoint Class Advisor.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // =========================================================================
  // ACTIONS: REVOKE CA APPOINTMENT
  // =========================================================================
  const handleConfirmRevocation = async () => {
    if (!revokeTarget || !revokeTarget.id) return;

    try {
      setIsRevoking(true);
      const result = await revokeClassAdvisorAppointment({
        appointmentId: revokeTarget.id,
        facultyDocId: revokeTarget.facultyDocId,
        hodEmail: currentHOD?.email || "hod@college.edu",
      });

      if (result.success) {
        toast({
          title: "Appointment Revoked",
          description: `${revokeTarget.facultyName} is no longer the Class Advisor for ${revokeTarget.class}. Their faculty account remains active.`,
        });
        setIsRevokeDialogOpen(false);
        setRevokeTarget(null);
      } else {
        toast({
          title: "Revocation Failed",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      console.error("Revocation error:", error);
      toast({
        title: "Revocation Error",
        description: (error as { message?: string })?.message || "Failed to revoke appointment.",
        variant: "destructive",
      });
    } finally {
      setIsRevoking(false);
    }
  };

  // Sign out handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/admin-select");
    } catch (error) {
      navigate("/admin-select");
    }
  };

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => navigate("/hod-dashboard")} 
              className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
            >
              <ArrowLeft size={16} />
              <span>Back to HOD Dashboard</span>
            </button>
            <button 
              onClick={() => navigate("/")} 
              className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-white px-3 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
            >
              <span>Home Portal</span>
            </button>
          </div>

          <button 
            onClick={handleLogout} 
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-rose-600 hover:text-rose-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm hover:border-rose-300 transition-all"
          >
            <LogOut size={16} />
            <span>Sign Out (HOD)</span>
          </button>
        </div>

        {/* Page Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold">
                <Crown size={14} className="text-amber-400" />
                HOD Executive Terminal
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                <ShieldCheck size={14} className="text-emerald-600" />
                Appointment Control
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <GraduationCap className="w-7 h-7 text-emerald-600" />
              Class Advisor Appointment Management
            </h1>
            
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Exclusively appoint approved faculty members as Class Advisors for specific academic semesters and sections. 
              Assigning a new advisor to an active section automatically and atomically retires the previous advisor while preserving their faculty account.
            </p>

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

        {/* View Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs">
            <button
              onClick={() => setViewTab("assign")}
              className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
                viewTab === "assign" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <UserCheck size={15} className="text-emerald-600" />
              <span>Appoint Class Advisor</span>
            </button>
            <button
              onClick={() => setViewTab("active")}
              className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
                viewTab === "active" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <GraduationCap size={15} />
              <span>Active Appointments ({activeAppointments.length})</span>
            </button>
            <button
              onClick={() => setViewTab("history")}
              className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
                viewTab === "history" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <History size={15} />
              <span>Audit History ({appointmentHistory.length})</span>
            </button>
          </div>

          <span className="text-xs text-slate-500 font-medium">
            Active Sections: <strong className="text-emerald-700 font-bold">{activeAppointments.length} assigned</strong>
          </span>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: APPOINT CLASS ADVISOR FORM */}
        {/* ========================================================================= */}
        {viewTab === "assign" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* COLUMN 1: SELECT FACULTY MEMBER (7 COLS) */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-5">
              <header className="space-y-1 pb-3 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-600" />
                    A. Select Faculty Member
                  </h3>
                  <span className="text-xs font-semibold text-slate-500">
                    {facultyList.length} Approved Faculty
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Select an approved teaching faculty member from the institutional staff registry. Only approved faculty can be appointed.
                </p>
              </header>

              {/* Search Faculty List */}
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search faculty by name, email, department, designation..."
                  value={searchFacultyQuery}
                  onChange={(e) => setSearchFacultyQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Faculty Cards List */}
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {loading ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-600 mx-auto mb-2" />
                    <span>Loading faculty roster...</span>
                  </div>
                ) : filteredFaculty.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-500">
                    No approved faculty members found matching your search.
                  </div>
                ) : (
                  filteredFaculty.map((faculty) => {
                    const isSelected = selectedFaculty?.id === faculty.id;
                    const hasActiveCA = activeAppointments.find(
                      (a) => a.facultyDocId === faculty.id || a.facultyEmail === faculty.email?.toLowerCase().trim()
                    );

                    return (
                      <div
                        key={faculty.id}
                        onClick={() => setSelectedFaculty(faculty)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                            : "bg-slate-50/70 border-slate-200 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                            isSelected ? "bg-emerald-600 shadow-sm" : "bg-slate-800"
                          }`}>
                            {faculty.name?.charAt(0) || "F"}
                          </div>

                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-slate-900 truncate">
                                {faculty.name}
                              </h4>
                              {hasActiveCA && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                                  CA of {hasActiveCA.shortClass || hasActiveCA.class}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                              <Mail size={12} className="text-slate-400 shrink-0" />
                              <span className="truncate">{faculty.email}</span>
                            </p>

                            <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-slate-500">
                              {faculty.department && (
                                <span>{faculty.department}</span>
                              )}
                              {faculty.designation && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-600 font-medium">{faculty.designation}</span>
                                </>
                              )}
                            </div>

                            {/* Assigned Subjects Chips */}
                            {faculty.subjects && faculty.subjects.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pt-1.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-0.5">
                                  Subjects:
                                </span>
                                {faculty.subjects.map((sub, sIdx) => (
                                  <span
                                    key={sIdx}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs"
                                  >
                                    {sub}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0">
                          {isSelected ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                              <Check size={14} />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full border border-slate-300 bg-white" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* COLUMN 2: ASSIGN CLASS & CONFIRM APPOINTMENT (5 COLS) */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* ASSIGN CLASS DROPDOWNS */}
              <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-sm space-y-5">
                <header className="space-y-1 pb-3 border-b border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-emerald-600" />
                    B. Assign Class Section
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select the academic semester and section for this Class Advisor.
                  </p>
                </header>

                <div className="space-y-4">
                  {/* Semester Dropdown */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                      Academic Semester
                    </label>
                    <select
                      value={selectedSemester}
                      onChange={(e) => setSelectedSemester(e.target.value)}
                      className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    >
                      {SEMESTERS.map((sem) => (
                        <option key={sem} value={sem}>{sem}</option>
                      ))}
                    </select>
                  </div>

                  {/* Section Dropdown */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                      Class Section
                    </label>
                    <select
                      value={selectedSection}
                      onChange={(e) => setSelectedSection(e.target.value)}
                      className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    >
                      {SECTIONS.map((sec) => (
                        <option key={sec} value={sec}>Section {sec}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* AUTOMATIC REPLACEMENT WARNING */}
                {existingActiveCAForClass && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-bold text-amber-950">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                      <span>Automatic CA Replacement Notice</span>
                    </div>
                    <p className="leading-relaxed">
                      <strong>{existingActiveCAForClass.facultyName}</strong> is currently active CA for <strong>{currentClassString}</strong>.
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Confirming will immediately retire {existingActiveCAForClass.facultyName}'s CA appointment for this class. Their faculty profile will remain active.
                    </p>
                  </div>
                )}

                {/* FACULTY REASSIGNMENT WARNING */}
                {selectedFacultyCurrentAppt && (
                  <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-1 text-xs">
                    <div className="flex items-center gap-2 font-bold text-indigo-950">
                      <RotateCcw size={14} className="text-indigo-600 shrink-0" />
                      <span>Advisor Reassignment</span>
                    </div>
                    <p className="text-[11px] text-indigo-800 leading-relaxed">
                      {selectedFaculty?.name} is currently CA for <strong>{selectedFacultyCurrentAppt.class}</strong>. Appointing to {currentClassString} will transfer their assignment.
                    </p>
                  </div>
                )}
              </div>

              {/* CONFIRM APPOINTMENT CARD */}
              <div className="bg-white rounded-3xl p-6 sm:p-7 border border-emerald-500/40 shadow-md space-y-5">
                <header className="space-y-0.5 pb-3 border-b border-slate-100">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    C. Appointment Summary
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Review and confirm institutional assignment.
                  </p>
                </header>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-500 font-medium">Faculty Member:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {selectedFaculty ? selectedFaculty.name : <em className="text-slate-400">None selected</em>}
                    </span>
                  </div>

                  <div className="flex justify-between items-start">
                    <span className="text-slate-500 font-medium">Department:</span>
                    <span className="font-semibold text-slate-800 text-right truncate max-w-[200px]">
                      {selectedFaculty?.department || currentHOD?.department || "Academic Department"}
                    </span>
                  </div>

                  <div className="flex justify-between items-start">
                    <span className="text-slate-500 font-medium">Assigned Role:</span>
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Class Advisor
                    </span>
                  </div>

                  <div className="flex justify-between items-start pt-1 border-t border-slate-200/60">
                    <span className="text-slate-500 font-medium">Assigned Class:</span>
                    <span className="font-extrabold text-slate-900 text-right text-xs">
                      {currentClassString} ({currentShortClass})
                    </span>
                  </div>
                </div>

                <button
                  disabled={!selectedFaculty || isSubmitting}
                  onClick={handleConfirmAppointment}
                  className="w-full py-3.5 px-6 bg-slate-900 hover:bg-emerald-600 text-white rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-emerald-400" />
                      <span>Executing Atomic Appointment...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>Confirm CA Appointment</span>
                    </>
                  )}
                </button>
              </div>

            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: ACTIVE CLASS ADVISOR APPOINTMENTS */}
        {/* ========================================================================= */}
        {viewTab === "active" && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div className="space-y-0.5">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-emerald-600" />
                  Active Class Advisor Appointments
                </h3>
                <p className="text-xs text-slate-500">
                  Current institutional class assignments ({activeAppointments.length} active advisors). One active advisor per semester-section.
                </p>
              </div>
              <button
                onClick={() => setViewTab("assign")}
                className="px-4 py-2 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-colors w-fit flex items-center gap-1.5"
              >
                <span>New Appointment</span>
                <ArrowRight size={14} />
              </button>
            </header>

            {activeAppointments.length === 0 ? (
              <div className="p-12 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <GraduationCap className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-bold text-slate-700">No Active CA Appointments</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  No faculty members are currently appointed as Class Advisors. Select an approved faculty member from the appointment tab to begin.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeAppointments.map((appt) => (
                  <div
                    key={appt.id}
                    className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              {appt.shortClass || appt.class}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              {appt.semester} • Sec {appt.section}
                            </span>
                          </div>
                          <h4 className="font-bold text-base text-slate-900 mt-1">
                            {appt.facultyName}
                          </h4>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <Mail size={12} className="text-slate-400" />
                            <span>{appt.facultyEmail}</span>
                          </p>
                        </div>

                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          Active CA
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs pt-1">
                        {appt.department && (
                          <span className="font-semibold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                            <Building2 size={12} className="text-slate-400" />
                            <span>{appt.department}</span>
                          </span>
                        )}
                        {appt.appointedAt && (
                          <span className="text-slate-500 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                            <Clock size={12} className="text-slate-400" />
                            <span>Appointed: {new Date(appt.appointedAt).toLocaleDateString()}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-200/60">
                      <button
                        onClick={() => {
                          const match = facultyList.find((f) => f.id === appt.facultyDocId);
                          if (match) setSelectedFaculty(match);
                          setSelectedSemester(appt.semester || SEMESTERS[0]);
                          setSelectedSection(appt.section || SECTIONS[0]);
                          setViewTab("assign");
                        }}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                      >
                        <span>Reassign Class</span>
                        <ArrowRight size={13} />
                      </button>

                      <button
                        onClick={() => {
                          setRevokeTarget(appt);
                          setIsRevokeDialogOpen(true);
                        }}
                        className="px-3 py-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Remove CA
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: APPOINTMENT AUDIT HISTORY */}
        {/* ========================================================================= */}
        {viewTab === "history" && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            <header className="space-y-0.5 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-slate-700" />
                Class Advisor Appointment Audit History
              </h3>
              <p className="text-xs text-slate-500">
                Institutional record of previous, replaced, and revoked Class Advisor appointments. Historical records are preserved for auditing.
              </p>
            </header>

            {appointmentHistory.length === 0 ? (
              <div className="p-12 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-1 text-xs font-semibold text-slate-500">
                No historical or retired CA appointments recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {appointmentHistory.map((hist) => (
                  <div
                    key={hist.id}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{hist.facultyName}</span>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                          {hist.shortClass || hist.class}
                        </span>
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                          hist.status === "replaced"
                            ? "bg-amber-100 text-amber-800 border border-amber-200"
                            : "bg-rose-100 text-rose-800 border border-rose-200"
                        }`}>
                          {hist.status === "replaced" ? "Replaced" : "Revoked"}
                        </span>
                      </div>
                      <p className="text-slate-500">{hist.facultyEmail} • {hist.department}</p>
                      {hist.replacedByFacultyName && (
                        <p className="text-[11px] text-amber-800 font-medium">
                          Replaced by: <strong>{hist.replacedByFacultyName}</strong> on {hist.replacedAt ? new Date(hist.replacedAt).toLocaleDateString() : ""}
                        </p>
                      )}
                    </div>

                    <div className="text-right text-[11px] text-slate-400 shrink-0">
                      <span>Appointed: {new Date(hist.appointedAt).toLocaleDateString()}</span>
                      {hist.replacedAt && (
                        <p>Retired: {new Date(hist.replacedAt).toLocaleDateString()}</p>
                      )}
                      {hist.revokedAt && (
                        <p>Revoked: {new Date(hist.revokedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* IN-APP CONFIRMATION DIALOG FOR REVOKING CA APPOINTMENT */}
      {/* ========================================================================= */}
      <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
        <DialogContent className="max-w-md bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-xl space-y-4">
          <DialogHeader className="space-y-2 text-left">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Remove Class Advisor Appointment
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to remove this Class Advisor appointment?
            </DialogDescription>
          </DialogHeader>

          {revokeTarget && (
            <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-2 text-xs">
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Faculty Member:</span>
                <span className="font-bold text-slate-900">{revokeTarget.facultyName}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Class Section:</span>
                <span className="font-bold text-emerald-800">{revokeTarget.class}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Department:</span>
                <span className="font-semibold text-slate-800">{revokeTarget.department}</span>
              </div>
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Appointment Revocation Notice:</p>
            <p>
              Removing this appointment will deny further CA Dashboard access for this class. 
              The faculty member's institutional faculty account will remain active, and historical attendance logs will be preserved.
            </p>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              disabled={isRevoking}
              onClick={() => {
                setIsRevokeDialogOpen(false);
                setRevokeTarget(null);
              }}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isRevoking}
              onClick={handleConfirmRevocation}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isRevoking ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Revoking...</span>
                </>
              ) : (
                <span>Confirm Revocation</span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
