import { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where,
  onSnapshot 
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
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
  Phone,
  LayoutDashboard
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyHODAuthorization } from "@/lib/hodAuth";
import { approveFacultyRegistrationRequest, rejectFacultyRegistrationRequest } from "@/lib/facultyAuth";

interface CARequest {
  id: string;
  name: string;
  email: string;
  departmentId?: string;
  departmentCode?: string;
  department?: string;
  class?: string;
  uid?: string;
  createdAt?: string;
  status?: string;
}

interface FacultyRequest {
  id: string;
  name: string;
  email: string;
  departmentId?: string;
  departmentCode?: string;
  department?: string;
  designation?: string;
  contactNumber?: string;
  phone?: string;
  subject?: string;
  class?: string;
  assignedCA?: string;
  caName?: string;
  uid?: string;
  createdAt?: string;
  status?: string;
}

export default function HODApprovalManagement() {
  const navigate = useNavigate();

  // Authentication & Verification state
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentHOD, setCurrentHOD] = useState<Record<string, string | undefined> | null>(null);

  // Data states
  const [caRequests, setCaRequests] = useState<CARequest[]>([]);
  const [facultyRequests, setFacultyRequests] = useState<FacultyRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Active view filter: "all" | "ca" | "faculty"
  const [filterView, setFilterView] = useState<"all" | "ca" | "faculty">("all");

  // Processing state
  const [processingId, setProcessingId] = useState<string | null>(null);

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
  // REAL-TIME FIRESTORE LISTENERS FOR REQUESTS (SCOPED TO HOD'S DEPARTMENT)
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

    // Real-time CA Requests listener for this department
    const caUnsub = onSnapshot(
      collection(db, "ca_requests"),
      (snapshot) => {
        const reqs = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CARequest[];
        const pending = reqs.filter((r) => matchesDept(r) && (r.status === "pending" || !r.status));
        setCaRequests(pending);
        setLoading(false);
      },
      (error) => {
        console.error("Error listening to CA requests:", error);
        setLoading(false);
      }
    );

    // Real-time Faculty Requests listener for this department
    const facultyUnsub = onSnapshot(
      collection(db, "faculty_requests"),
      (snapshot) => {
        const reqs = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as FacultyRequest[];
        const pending = reqs.filter((r) => {
          if (!matchesDept(r)) return false;
          const s = (r.status || "").toLowerCase();
          return s === "pending" || (!s && s !== "approved" && s !== "rejected");
        });
        setFacultyRequests(pending);
      },
      (error) => {
        console.error("Error listening to faculty requests:", error);
      }
    );

    return () => {
      caUnsub();
      facultyUnsub();
    };
  }, [checkingAuth, currentHOD]);

  // =========================================================================
  // APPROVAL HANDLERS
  // =========================================================================

  // Approve CA Request
  const handleApproveCA = async (req: CARequest) => {
    try {
      setProcessingId(req.id);
      const deptId = currentHOD?.departmentId || req.departmentId || "";
      const deptName = currentHOD?.department || req.department || "Academic Department";
      const deptCode = currentHOD?.departmentCode || req.departmentCode || "";

      await addDoc(collection(db, "teachers"), {
        name: req.name,
        email: req.email.toLowerCase().trim(),
        uid: req.uid || "",
        role: "ca",
        departmentId: deptId,
        department: deptName,
        departmentCode: deptCode,
        class: req.class || "",
        status: "approved",
        approvedBy: currentHOD?.email || "HOD",
        approvedAt: new Date().toISOString(),
      });

      await deleteDoc(doc(db, "ca_requests", req.id));

      toast({
        title: "Class Advisor Approved",
        description: `${req.name} has been authorized as Class Advisor for ${req.class || "assigned class"}.`,
      });
    } catch (error) {
      console.error("Approve CA error:", error);
      toast({
        title: "Approval Failed",
        description: "Failed to authorize Class Advisor. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Reject CA Request
  const handleRejectCA = async (req: CARequest) => {
    try {
      setProcessingId(req.id);
      await deleteDoc(doc(db, "ca_requests", req.id));

      toast({
        title: "CA Request Dismissed",
        description: `Registration request from ${req.name} was dismissed.`,
      });
    } catch (error) {
      console.error("Reject CA error:", error);
      toast({
        title: "Rejection Failed",
        description: "Failed to dismiss request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Approve Faculty Request
  const handleApproveFaculty = async (req: FacultyRequest) => {
    try {
      setProcessingId(req.id);
      const approver = currentHOD?.email || "HOD";
      const deptId = currentHOD?.departmentId || "";

      const res = await approveFacultyRegistrationRequest({
        requestId: req.id,
        hodEmail: approver,
        hodDepartmentId: deptId,
      });

      if (!res.success) {
        toast({
          title: "Approval Failed",
          description: res.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Faculty Approved",
        description: `${req.name} (${req.designation || "Faculty"}) has been authorized for attendance sessions.`,
      });
    } catch (error) {
      console.error("Approve Faculty error:", error);
      toast({
        title: "Approval Failed",
        description: "Failed to authorize faculty. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Reject Faculty Request
  const handleRejectFaculty = async (req: FacultyRequest) => {
    try {
      setProcessingId(req.id);
      const reviewer = currentHOD?.email || "HOD";
      const deptId = currentHOD?.departmentId || "";

      const res = await rejectFacultyRegistrationRequest({
        requestId: req.id,
        hodEmail: reviewer,
        hodDepartmentId: deptId,
      });

      if (!res.success) {
        toast({
          title: "Rejection Failed",
          description: res.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Faculty Request Rejected",
        description: `Registration request from ${req.name} was rejected.`,
      });
    } catch (error) {
      console.error("Reject Faculty error:", error);
      toast({
        title: "Rejection Failed",
        description: "Failed to reject faculty request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Sign out handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/admin-select");
    } catch (error) {
      console.error("Logout error:", error);
      navigate("/admin-select");
    }
  };

  const totalPending = caRequests.length + facultyRequests.length;

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
              <LayoutDashboard size={14} />
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
                Google Authenticated
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-emerald-600" />
              Institutional Approval Management
            </h1>
            
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Authorize or dismiss registration requests for Class Advisors (CAs) and Teaching Faculty. Only the Head of Department holds clearance to approve institutional applicants.
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

        {/* Filter Tabs & Summary Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs">
            <button
              onClick={() => setFilterView("all")}
              className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                filterView === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Requests ({totalPending})
            </button>
            <button
              onClick={() => setFilterView("ca")}
              className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                filterView === "ca" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              CA Requests ({caRequests.length})
            </button>
            <button
              onClick={() => setFilterView("faculty")}
              className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                filterView === "faculty" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Faculty Requests ({facultyRequests.length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              {caRequests.length} CA Pending
            </span>
            <span className="px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
              {facultyRequests.length} Faculty Pending
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-12 bg-white rounded-3xl border border-slate-200">
            <div className="flex items-center gap-3 text-slate-500 font-medium text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span>Loading Registration Requests...</span>
            </div>
          </div>
        ) : totalPending === 0 ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">All Registration Requests Handled</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              There are currently no pending Class Advisor or Faculty registration applications awaiting approval.
            </p>
            <div className="pt-2">
              <button
                onClick={() => navigate("/hod-dashboard")}
                className="px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors shadow-xs"
              >
                Return to HOD Dashboard
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            
            {/* SECTION: CLASS ADVISOR REQUESTS */}
            {(filterView === "all" || filterView === "ca") && (
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div className="space-y-0.5">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <GraduationCap className="w-5 h-5 text-emerald-600" />
                      Class Advisor (CA) Applications
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Authorize faculty applicants to assume Class Advisor responsibilities and manage student rosters.
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200 w-fit">
                    {caRequests.length} Pending
                  </span>
                </header>

                {caRequests.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-500">
                    No pending Class Advisor requests.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {caRequests.map((req) => (
                      <div 
                        key={req.id} 
                        className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-sm text-slate-900">{req.name}</h4>
                              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                <Mail size={12} className="text-slate-400 shrink-0" />
                                <span className="truncate">{req.email}</span>
                              </p>
                            </div>
                            <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                              CA Applicant
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1 text-xs">
                            {req.department && (
                              <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                                <Building2 size={12} />
                                {req.department}
                              </span>
                            )}
                            <span className="font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                              <GraduationCap size={12} />
                              Class: {req.class || "Not assigned"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-3 border-t border-slate-200/60">
                          <button
                            disabled={processingId === req.id}
                            onClick={() => handleApproveCA(req)}
                            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
                          >
                            {processingId === req.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            <span>Approve CA</span>
                          </button>
                          <button
                            disabled={processingId === req.id}
                            onClick={() => handleRejectCA(req)}
                            className="px-4 py-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <X size={14} />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECTION: FACULTY REQUESTS */}
            {(filterView === "all" || filterView === "faculty") && (
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div className="space-y-0.5">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Users className="w-5 h-5 text-indigo-600" />
                      Teaching Faculty Applications
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Authorize teaching faculty members to conduct attendance sessions and access the Faculty Portal.
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200 w-fit">
                    {facultyRequests.length} Pending
                  </span>
                </header>

                {facultyRequests.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-500">
                    No pending Faculty registration requests.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {facultyRequests.map((req) => (
                      <div 
                        key={req.id} 
                        className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-sm text-slate-900">{req.name}</h4>
                              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                <Mail size={12} className="text-slate-400 shrink-0" />
                                <span className="truncate">{req.email}</span>
                              </p>
                            </div>
                            <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 shrink-0">
                              Faculty Applicant
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1 text-xs">
                            {req.department && (
                              <span className="font-semibold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                                <Building2 size={12} />
                                {req.department}
                              </span>
                            )}
                            <span className="font-bold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-200 flex items-center gap-1">
                              <BookOpen size={12} />
                              {req.designation || "Teaching Faculty"}
                            </span>
                            {(req.contactNumber || req.phone) && (
                              <span className="text-slate-600 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                                <Phone size={12} />
                                {req.contactNumber || req.phone}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-3 border-t border-slate-200/60">
                          <button
                            disabled={processingId === req.id}
                            onClick={() => handleApproveFaculty(req)}
                            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
                          >
                            {processingId === req.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            <span>Approve Faculty</span>
                          </button>
                          <button
                            disabled={processingId === req.id}
                            onClick={() => handleRejectFaculty(req)}
                            className="px-4 py-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <X size={14} />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

      </div>
    </AppLayout>
  );
}
