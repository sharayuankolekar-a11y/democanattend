import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Shield, 
  AlertCircle, 
  ShieldCheck, 
  Loader2, 
  GraduationCap, 
  CheckCircle,
  Info
} from "lucide-react";
import { auth, provider } from "../firebase";
import { signInWithPopup, signOut } from "firebase/auth";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyCAAuthorization } from "@/lib/caAuth";

// Authentic Google 'G' multicolored icon SVG
const GoogleIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export default function CALogin() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Check if routed with error in location state
  useEffect(() => {
    const navError = (location.state as { error?: string } | null)?.error;
    if (navError) {
      setErrorMessage(navError);
    }
  }, [location.state]);

  // =========================================================================
  // EXISTING CA LOGIN WITH GOOGLE
  // =========================================================================
  const handleExistingCALogin = async () => {
    setErrorMessage("");
    setIsLoggingIn(true);

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!user || !user.email) {
        setErrorMessage("Google Sign-In was cancelled or failed to retrieve email.");
        setIsLoggingIn(false);
        return;
      }

      // Verify active CA appointment in Firestore
      const authResult = await verifyCAAuthorization(user.email);

      if (authResult.isApproved) {
        // Successful verified CA login -> Navigate to CA Dashboard
        navigate("/ca");
      } else {
        // Not approved or not appointed as CA
        await signOut(auth); // Revoke lingering unauthorized session
        setErrorMessage(authResult.message);
      }
    } catch (error: unknown) {
      console.error("CA Login Error:", error);
      const authErr = error as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setErrorMessage(authErr.message || "Failed to authenticate with Google. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6 text-left pb-16">
        
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/admin-select")}
            className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>

          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-white px-3 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <span>Home Portal</span>
          </button>
        </div>

        {/* Page Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                <Shield size={14} className="text-emerald-600" />
                Class Advisor Gateway
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                Institutional Access
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Class Advisor Authentication
            </h1>

            <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
              Access the Class Advisor Dashboard to manage student rosters, class timetables, and student login approvals.
            </p>
          </div>

          <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 shadow-sm border-slate-200 shrink-0" />
        </div>

        {/* IN-APP ERROR / AUTHORIZATION ALERT */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1 flex items-start gap-3.5 shadow-xs"
            >
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs">
                <p className="font-extrabold text-sm text-rose-900 tracking-tight">
                  Authorization Alert
                </p>
                <p className="leading-relaxed text-rose-700">{errorMessage}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* INSTITUTIONAL APPOINTMENT NOTICE CALLOUT */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
          <Info className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-relaxed">
            <p className="font-bold text-slate-900">HOD Appointment Policy</p>
            <p className="text-slate-500 text-[11px]">
              Class Advisors are appointed directly by the <strong>Head of Department</strong> from approved faculty members. Independent CA registration is not permitted. If you require CA access, please contact your Head of Department.
            </p>
          </div>
        </div>

        {/* DEDICATED LOGIN CARD */}
        <div className="p-8 sm:p-10 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck size={30} />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Official Institutional Portal
              </span>
              <h2 className="text-xl font-bold text-slate-900">
                Class Advisor – Login with Google
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Log in using your approved institutional Gmail account. Access is granted only to faculty members with an active Class Advisor appointment.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            <button
              disabled={isLoggingIn}
              onClick={handleExistingCALogin}
              className="w-full py-4 px-6 bg-slate-900 hover:bg-emerald-600 text-white rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-3 transition-all shadow-md hover:shadow-emerald-600/20 disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 size={18} className="animate-spin text-emerald-400" />
                  <span>Verifying CA Appointment...</span>
                </>
              ) : (
                <>
                  <GoogleIcon className="w-4 h-4 shrink-0" />
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            <p className="text-[11px] text-center text-slate-400">
              Active HOD Appointment Required • Instant Clearance Verification
            </p>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
