import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import {
  ShieldCheck,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Mail,
  CreditCard,
  BookOpen,
  Filter,
  Check,
  X,
  Search,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { motion, AnimatePresence } from "framer-motion";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";
import { StudentLoginRequest } from "@/lib/studentAuth";
import { verifyCAAuthorization, syncPendingRequestsForClass, CAAppointmentRecord } from "@/lib/caAuth";

export default function CAStudentApprovals() {
  const navigate = useNavigate();

  const [caId, setCaId] = useState<string>("");
  const [caProfile, setCaProfile] = useState<{ name?: string; email?: string; class?: string } | null>(null);
  const [activeAppointment, setActiveAppointment] = useState<CAAppointmentRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [requests, setRequests] = useState<StudentLoginRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 1. Resolve CA Profile & Active Appointment from HOD records (Single Source of Truth)
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user || !user.email) {
        setCaId("");
        setCaProfile(null);
        setActiveAppointment(null);
        setLoading(false);
        navigate("/ca-login");
        return;
      }

      try {
        const verifyRes = await verifyCAAuthorization(user.email);

        if (verifyRes.isApproved && verifyRes.appointment && verifyRes.docId) {
          setCaId(verifyRes.docId);
          setCaProfile((verifyRes.data as { name?: string; email?: string; class?: string }) || null);
          setActiveAppointment(verifyRes.appointment);
        } else {
          toast({
            variant: "destructive",
            title: "Access Denied",
            description:
              verifyRes.message ||
              "You do not have an active Class Advisor appointment. Only the Head of Department can appoint Class Advisors.",
          });
          navigate("/ca-login");
        }
      } catch (err) {
        console.error("CA appointment verification error:", err);
        navigate("/ca-login");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // 2. Real-time Listener for Student Login Requests Scoped to this Active Appointment
  useEffect(() => {
    if (!caId || !activeAppointment) return;

    // First: Automatically heal/reassign any pending requests for this class from previous CAs
    syncPendingRequestsForClass(activeAppointment.class, {
      appointmentId: activeAppointment.id!,
      facultyDocId: caId,
      facultyName: caProfile?.name || activeAppointment.facultyName || "Class Advisor",
      facultyEmail: caProfile?.email || activeAppointment.facultyEmail || "",
      class: activeAppointment.class,
      shortClass: activeAppointment.shortClass,
      semester: activeAppointment.semester,
      section: activeAppointment.section,
    }).catch((e) => console.warn("Pending request sync warning:", e));

    const targetClass = (activeAppointment.class || "").trim().toLowerCase();
    const targetShort = (activeAppointment.shortClass || "").trim().toLowerCase();
    const apptId = activeAppointment.id;

    // Listen to student_login_requests and filter for this CA's active class & appointment
    const requestsRef = collection(db, "student_login_requests");

    const unsubscribe = onSnapshot(
      requestsRef,
      (snapshot) => {
        const list: StudentLoginRequest[] = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<StudentLoginRequest, "id">),
          }))
          .filter((req: StudentLoginRequest) => {
            if (req.caAppointmentId && req.caAppointmentId === apptId) return true;
            if (req.assignedFacultyDocId && req.assignedFacultyDocId === caId) return true;
            if (req.caId && req.caId === caId) return true;
            const reqClass = (req.class || "").trim().toLowerCase();
            const reqShort = (req.shortClass || "").trim().toLowerCase();
            return (
              reqClass === targetClass ||
              reqShort === targetShort ||
              reqClass === targetShort ||
              reqShort === targetClass
            );
          });

        // Sort descending: newest requests first
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        setRequests(list);
      },
      (error) => {
        console.error("Error listening to student login requests:", error);
      }
    );

    return () => unsubscribe();
  }, [caId, activeAppointment, caProfile]);

  // 3. Handle CA Approval
  const handleApprove = async (req: StudentLoginRequest) => {
    if (!req.id || !caId || !caProfile) return;

    // Security check: CA can only approve for their assigned class
    const caClass = (caProfile.class || "").trim().toLowerCase();
    const reqClass = (req.class || "").trim().toLowerCase();
    if (caClass && reqClass && caClass !== reqClass && req.caId !== caId) {
      toast({
        variant: "destructive",
        title: "Unauthorized Action",
        description: `You are assigned to ${caProfile.class} and cannot approve requests for ${req.class}.`,
      });
      return;
    }

    setProcessingId(req.id);
    try {
      await updateDoc(doc(db, "student_login_requests", req.id), {
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedBy: caId,
        reviewedByName: caProfile.name || "Class Advisor",
        caAppointmentId: activeAppointment?.id || req.caAppointmentId || "",
        assignedFacultyDocId: caId,
      });

      toast({
        title: "Login Request Approved",
        description: `Granted portal access to ${req.studentName} (${req.usn}).`,
      });
    } catch (err) {
      console.error("Approve error:", err);
      toast({
        variant: "destructive",
        title: "Approval Failed",
        description: "Failed to update request status. Please try again.",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // 4. Handle CA Rejection
  const handleReject = async (req: StudentLoginRequest) => {
    if (!req.id || !caId || !caProfile) return;

    // Security check: CA can only reject for their assigned class
    const caClass = (caProfile.class || "").trim().toLowerCase();
    const reqClass = (req.class || "").trim().toLowerCase();
    if (caClass && reqClass && caClass !== reqClass && req.caId !== caId) {
      toast({
        variant: "destructive",
        title: "Unauthorized Action",
        description: `You are assigned to ${caProfile.class} and cannot reject requests for ${req.class}.`,
      });
      return;
    }

    setProcessingId(req.id);
    try {
      await updateDoc(doc(db, "student_login_requests", req.id), {
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: caId,
        reviewedByName: caProfile.name || "Class Advisor",
        caAppointmentId: activeAppointment?.id || req.caAppointmentId || "",
        assignedFacultyDocId: caId,
      });

      toast({
        title: "Login Request Rejected",
        description: `Rejected portal access for ${req.studentName} (${req.usn}).`,
      });
    } catch (err) {
      console.error("Reject error:", err);
      toast({
        variant: "destructive",
        title: "Rejection Failed",
        description: "Failed to update request status. Please try again.",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Format timestamp nicely
  const formatTime = (isoString?: string, timestamp?: number) => {
    if (!isoString && !timestamp) return "Recently";
    try {
      const d = isoString ? new Date(isoString) : new Date(timestamp!);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch (e) {
      return "Recently";
    }
  };

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    const matchesFilter = filter === "all" ? true : r.status === filter;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return matchesFilter;

    const nameMatch = (r.studentName || "").toLowerCase().includes(term);
    const usnMatch = (r.usn || "").toLowerCase().includes(term);
    const emailMatch = (r.email || "").toLowerCase().includes(term);

    return matchesFilter && (nameMatch || usnMatch || emailMatch);
  });

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const rejectedCount = requests.filter((r) => r.status === "rejected").length;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 text-left">
        
        {/* Top Header Card */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/ca")}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 bg-slate-100 px-3.5 py-2 rounded-full border border-slate-200 transition-all shrink-0"
            >
              <ArrowLeft size={14} />
              <span>Back to Dashboard</span>
            </button>

            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-600">
                  CLASS ADVISOR TERMINAL
                </span>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200 rounded-full animate-pulse">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
                <ShieldCheck className="w-7 h-7 text-emerald-600" />
                Student Login Approvals
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                {caProfile?.class
                  ? `Review and authorize real-time login sessions for Class: ${caProfile.class}`
                  : "Review and authorize real-time student login access requests"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-full text-xs font-semibold flex items-center gap-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Live Monitor Active</span>
            </div>
          </div>
        </div>

        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            onClick={() => setFilter("pending")}
            className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
              filter === "pending"
                ? "bg-amber-50/80 border-amber-400 shadow-sm"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pending Requests
              </span>
              <p className="text-2xl sm:text-3xl font-extrabold text-amber-600">
                {pendingCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div
            onClick={() => setFilter("approved")}
            className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
              filter === "approved"
                ? "bg-emerald-50/80 border-emerald-400 shadow-sm"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Approved Sessions
              </span>
              <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600">
                {approvedCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle className="w-6 h-6" />
            </div>
          </div>

          <div
            onClick={() => setFilter("rejected")}
            className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
              filter === "rejected"
                ? "bg-rose-50/80 border-rose-400 shadow-sm"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Rejected Requests
              </span>
              <p className="text-2xl sm:text-3xl font-extrabold text-rose-600">
                {rejectedCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <XCircle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Search & Tabs Controls */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            
            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl overflow-x-auto">
              <button
                onClick={() => setFilter("pending")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  filter === "pending"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>Pending ({pendingCount})</span>
              </button>

              <button
                onClick={() => setFilter("approved")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  filter === "approved"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                <span>Approved ({approvedCount})</span>
              </button>

              <button
                onClick={() => setFilter("rejected")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  filter === "rejected"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <XCircle className="w-3.5 h-3.5 text-rose-500" />
                <span>Rejected ({rejectedCount})</span>
              </button>

              <button
                onClick={() => setFilter("all")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  filter === "all"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>All ({requests.length})</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Name, USN, Gmail..."
                className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
              />
            </div>
          </div>

          {/* Requests List */}
          {loading ? (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto" />
              <p className="text-xs font-medium">Loading student login requests...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-16 text-center bg-slate-50/60 rounded-2xl border border-slate-200/80 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-white text-slate-400 flex items-center justify-center mx-auto shadow-sm border border-slate-200">
                <ShieldCheck className="w-6 h-6 text-slate-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  {filter === "pending"
                    ? "No pending login approval requests"
                    : filter === "approved"
                    ? "No approved login records found"
                    : filter === "rejected"
                    ? "No rejected login records found"
                    : "No login requests match your filter"}
                </p>
                <p className="text-xs text-slate-500">
                  {filter === "pending"
                    ? "When students in your class sign in with their Gmail and USN, their authorization requests will appear here in real-time."
                    : "Change the filter tab or clear your search query to view other requests."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <AnimatePresence>
                {filteredRequests.map((req) => {
                  const isProcessing = processingId === req.id;
                  const isPending = req.status === "pending";
                  const isApproved = req.status === "approved";
                  const isRejected = req.status === "rejected";

                  return (
                    <motion.div
                      key={req.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      className={`p-5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                        isPending
                          ? "bg-amber-50/30 border-amber-200/80 hover:border-amber-400"
                          : isApproved
                          ? "bg-white border-slate-200"
                          : "bg-rose-50/20 border-slate-200"
                      }`}
                    >
                      {/* Left: Student Information */}
                      <div className="space-y-2 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-extrabold text-base text-slate-900">
                            {req.studentName}
                          </h3>
                          <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono text-xs font-bold tracking-wider uppercase">
                            {req.usn}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100/80 text-emerald-800 text-xs font-bold">
                            Class: {req.class || caProfile?.class || "Assigned"}
                          </span>

                          {/* Status Badge */}
                          {isPending && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>Pending Review</span>
                            </span>
                          )}
                          {isApproved && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                              <span>Approved Access</span>
                            </span>
                          )}
                          {isRejected && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-bold">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              <span>Rejected</span>
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Mail className="w-3.5 h-3.5 text-emerald-600" />
                            {req.email}
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-500">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            Requested: {formatTime(req.requestedAt, req.timestamp)}
                          </span>
                          {req.reviewedAt && (
                            <span className="text-[11px] text-slate-400 italic">
                              Reviewed: {formatTime(req.reviewedAt)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                        {isPending ? (
                          <>
                            {/* Approve Button */}
                            <button
                              disabled={isProcessing}
                              onClick={() => handleApprove(req)}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <Check className="w-4 h-4" />
                              <span>Approve</span>
                            </button>

                            {/* Reject Button */}
                            <button
                              disabled={isProcessing}
                              onClick={() => handleReject(req)}
                              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <X className="w-4 h-4" />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : isApproved ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 flex items-center gap-1.5">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Authorized Session</span>
                            </span>
                            {/* Option to revoke approval */}
                            <button
                              disabled={isProcessing}
                              onClick={() => handleReject(req)}
                              className="px-3 py-1.5 text-xs text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium transition-colors border border-transparent hover:border-rose-200"
                              title="Revoke session access"
                            >
                              Revoke
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-rose-700 font-bold bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200 flex items-center gap-1.5">
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                              <span>Access Denied</span>
                            </span>
                            {/* Option to reconsider and approve */}
                            <button
                              disabled={isProcessing}
                              onClick={() => handleApprove(req)}
                              className="px-3 py-1.5 text-xs text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg font-medium transition-colors border border-transparent hover:border-emerald-200"
                              title="Re-approve access"
                            >
                              Allow
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
