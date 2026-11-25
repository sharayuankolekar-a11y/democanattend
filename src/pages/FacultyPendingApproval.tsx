import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { 
  Clock, 
  GraduationCap, 
  ArrowLeft, 
  ShieldCheck, 
  Mail, 
  Building2, 
  BookOpen, 
  Award, 
  CheckCircle, 
  RefreshCw,
  AlertCircle,
  Loader2,
  LogOut
} from "lucide-react";
import { auth, provider } from "../firebase";
import { signInWithPopup, signOut } from "firebase/auth";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyFacultyAuthorization } from "@/lib/facultyAuth";
import { toast } from "@/components/ui/use-toast";

export default function FacultyPendingApproval() {
  const navigate = useNavigate();
  const location = useLocation();

  const stateData = (location.state as {
    name?: string;
    email?: string;
    department?: string;
    subject?: string;
    designation?: string;
    message?: string;
  } | null) || {};

  const [applicantName, setApplicantName] = useState(stateData.name || "");
  const [applicantEmail, setApplicantEmail] = useState(stateData.email || "");
  const [departmentName, setDepartmentName] = useState(stateData.department || "");
  const [subject, setSubject] = useState(stateData.subject || "");
  const [designation, setDesignation] = useState(stateData.designation || "");
  const [statusMessage, setStatusMessage] = useState(
    stateData.message || "Your faculty registration is awaiting HOD approval."
  );

  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  // Clean up any active session on mount so unapproved faculty cannot enter dashboard
  useEffect(() => {
    signOut(auth).catch(() => {});
  }, []);

  const handleCheckStatus = async () => {
    setCheckError("");
    setIsChecking(true);

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!user || !user.email) {
        setCheckError("Google Sign-In was cancelled.");
        setIsChecking(false);
        return;
      }

      setApplicantEmail(user.email);
      if (user.displayName) setApplicantName(user.displayName);

      const authResult = await verifyFacultyAuthorization(user.email);

      if (authResult.isApproved) {
        toast({
          title: "Registration Approved!",
          description: `Welcome, ${authResult.data?.name || "Faculty Member"}. Your faculty account is active.`,
        });
        navigate("/faculty/subjects");
      } else if (authResult.isPending) {
        await signOut(auth);
        setStatusMessage("Your faculty registration is awaiting HOD approval.");
        if (authResult.data) {
          if (authResult.data.department) setDepartmentName(authResult.data.department);
          if (authResult.data.subject) setSubject(authResult.data.subject);
          if (authResult.data.designation) setDesignation(authResult.data.designation);
          if (authResult.data.name) setApplicantName(authResult.data.name);
        }
        toast({
          title: "Status: Pending",
          description: "Your registration is awaiting approval by your Head of Department.",
        });
      } else if (authResult.isRejected) {
        await signOut(auth);
        setCheckError("Your faculty registration has been rejected. Contact your HOD.");
      } else {
        await signOut(auth);
        setCheckError(authResult.message || "Registration record not found.");
      }
    } catch (error: unknown) {
      console.error("Status check error:", error);
      const authErr = error as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setCheckError(authErr.message || "Failed to verify approval status.");
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6 text-left">
        
        {/* Navigation Back Button */}
        <div className="flex justify-start">
          <button
            onClick={() => navigate("/faculty-login")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Return to Faculty Portal</span>
          </button>
        </div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-900/5 relative overflow-hidden text-center space-y-6"
        >
          {/* Ambient Glow */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-amber-50 rounded-full blur-3xl pointer-events-none" />

          {/* Pending Status Icon */}
          <div className="mx-auto w-16 h-16 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center border border-amber-200 shadow-sm">
            <Clock className="w-8 h-8 text-amber-600 animate-pulse" />
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/70 text-amber-900 border border-amber-300 text-xs font-bold">
              <Clock size={13} className="text-amber-700" />
              <span>Status: Pending HOD Approval</span>
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Awaiting HOD Authorization
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 font-medium max-w-sm mx-auto leading-relaxed">
              {statusMessage}
            </p>
          </div>

          {/* Error Banner if any */}
          {checkError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2.5 text-left"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <p className="leading-relaxed">{checkError}</p>
            </motion.div>
          )}

          {/* Applicant Summary Card */}
          {(applicantName || applicantEmail || departmentName) && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2.5 text-xs max-w-md mx-auto">
              {applicantName && (
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Applicant</span>
                  <span className="font-bold text-slate-800">{applicantName}</span>
                </div>
              )}
              {applicantEmail && (
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Gmail</span>
                  <span className="font-bold text-slate-800">{applicantEmail}</span>
                </div>
              )}
              {departmentName && (
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Department</span>
                  <span className="font-bold text-emerald-700">{departmentName}</span>
                </div>
              )}
              {subject && (
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Subject</span>
                  <span className="font-bold text-indigo-700">{subject}</span>
                </div>
              )}
              {designation && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Designation</span>
                  <span className="font-bold text-slate-800">{designation}</span>
                </div>
              )}
            </div>
          )}

          {/* Next Steps Card */}
          <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-amber-950 text-left space-y-1.5 leading-relaxed">
            <p className="font-bold text-amber-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span>Next Steps & Security Protocol</span>
            </p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Your registration has been forwarded exclusively to the Head of Department for review.
              Once your HOD approves your registration in the Institutional Management Portal, your faculty account will be activated immediately.
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={handleCheckStatus}
              disabled={isChecking}
              className="w-full py-3.5 px-4 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Checking Approval Status...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Check Approval Status</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate("/faculty-login")}
              className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              Return to Faculty Login
            </button>
          </div>

        </motion.div>
      </div>
    </AppLayout>
  );
}
