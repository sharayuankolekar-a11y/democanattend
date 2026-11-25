import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Crown, 
  UserPlus, 
  CheckCircle, 
  AlertCircle, 
  ShieldCheck, 
  Loader2, 
  Building2, 
  Award, 
  Phone, 
  Mail, 
  User, 
  Clock,
  ArrowRight
} from "lucide-react";
import { auth, provider } from "../firebase";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyHODAuthorization, registerFirstTimeHOD, normalizeEmail } from "@/lib/hodAuth";
import { getActiveDepartments, getUnclaimedDepartments, DepartmentRecord } from "@/lib/departmentService";
import { toast } from "@/components/ui/use-toast";

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

import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

interface HODLoginProps {
  initialMode?: "options" | "register";
}

export default function HODLogin({ initialMode }: HODLoginProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();

  const isRegisterRoute = initialMode === "register" || 
    location.pathname === "/hod-register" || 
    new URLSearchParams(location.search).get("mode") === "register";

  // View state: 'options' | 'register'
  const [view, setView] = useState<"options" | "register">(isRegisterRoute ? "register" : "options");

  // Loading states
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const [loadingDepts, setLoadingDepts] = useState(true);

  // Departments list from Firestore (showing only unclaimed departments for registration)
  const [unclaimedDepartments, setUnclaimedDepartments] = useState<DepartmentRecord[]>([]);

  // Error and Notification states
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string>("");

  // Form states for New HOD Registration
  const [fullName, setFullName] = useState("");
  const [officialEmail, setOfficialEmail] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [designation, setDesignation] = useState("Professor & Head of Department");
  const [contactNumber, setContactNumber] = useState("");

  // Custom new department creation states
  const [isCustomDept, setIsCustomDept] = useState(false);
  const [customDeptName, setCustomDeptName] = useState("");
  const [customDeptCode, setCustomDeptCode] = useState("");

  // Check if routed with error or mode in location state/search
  useEffect(() => {
    const navError = (location.state as { error?: string } | null)?.error;
    if (navError) {
      setErrorMessage(navError);
    }
    const params = new URLSearchParams(location.search);
    if (params.get("mode") === "register" || location.pathname === "/hod-register") {
      setView("register");
    }
  }, [location]);

  // Real-time listener for unclaimed academic departments in Firestore
  useEffect(() => {
    setLoadingDepts(true);
    const qDepts = collection(db, "departments");
    const unsubscribe = onSnapshot(
      qDepts,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as DepartmentRecord[];

        // Filter to unclaimed, active departments
        const unclaimed = list
          .filter((d) => (!d.currentHodId || !d.currentHodEmail) && d.status !== "inactive")
          .sort((a, b) => a.name.localeCompare(b.name));

        setUnclaimedDepartments(unclaimed);

        setSelectedDeptId((prev) => {
          if (prev && (unclaimed.some((d) => d.id === prev) || prev === "custom_new")) {
            return prev;
          }
          if (unclaimed.length > 0) {
            setIsCustomDept(false);
            return unclaimed[0].id;
          } else {
            setIsCustomDept(true);
            return "custom_new";
          }
        });

        setLoadingDepts(false);
      },
      (error) => {
        console.error("Real-time departments listener error:", error);
        setLoadingDepts(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // =========================================================================
  // OPTION 1: EXISTING HOD LOGIN WITH GMAIL
  // =========================================================================
  const handleExistingHODLogin = async () => {
    setErrorMessage("");
    setInfoMessage("");
    setIsLoggingIn(true);

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!user || !user.email) {
        setErrorMessage("Google Sign-In was cancelled or failed to retrieve email.");
        setIsLoggingIn(false);
        return;
      }

      // Verify HOD role and approval status in Firestore
      const authResult = await verifyHODAuthorization(user.email);

      if (authResult.isApproved) {
        toast({
          title: "Authorization Verified",
          description: `Welcome back, ${authResult.data?.name || "HOD"}. Accessing ${authResult.departmentName || "departmental"} terminal.`,
        });
        navigate("/hod-dashboard");
      } else {
        await signOut(auth); // Prevent lingering unauthorized session
        setErrorMessage(authResult.message);
      }
    } catch (error: unknown) {
      console.error("HOD Login Error:", error);
      const authErr = error as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setErrorMessage(authErr.message || "Failed to authenticate with Google. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // =========================================================================
  // OPTION 2: DYNAMIC FIRST-HOD ONBOARDING (ATOMIC CLAIM)
  // =========================================================================
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // Form validation
    if (!fullName.trim()) {
      setErrorMessage("Please enter your Full Name.");
      return;
    }

    if (!officialEmail.trim() || !officialEmail.includes("@")) {
      setErrorMessage("Please provide a valid official college Gmail address.");
      return;
    }

    if (isCustomDept) {
      if (!customDeptName.trim()) {
        setErrorMessage("Please enter the Academic Department Name.");
        return;
      }
      if (!customDeptCode.trim()) {
        setErrorMessage("Please enter the Department Code (e.g. AIML, AIDS).");
        return;
      }
    } else {
      if (!selectedDeptId) {
        setErrorMessage("Please select your Academic Department.");
        return;
      }
      const selectedDept = unclaimedDepartments.find((d) => d.id === selectedDeptId);
      if (!selectedDept) {
        setErrorMessage("Selected department was not recognized or is already claimed.");
        return;
      }
    }

    if (!designation.trim()) {
      setErrorMessage("Please enter your Designation.");
      return;
    }

    if (!contactNumber.trim() || contactNumber.trim().length < 8) {
      setErrorMessage("Please enter a valid institutional Contact Number.");
      return;
    }

    setIsRegistering(true);

    try {
      // 1. Authenticate with Google
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!user || !user.email) {
        setErrorMessage("Google Authentication is required to verify your institutional identity.");
        setIsRegistering(false);
        return;
      }

      const googleEmail = normalizeEmail(user.email);
      const inputEmail = normalizeEmail(officialEmail);

      if (googleEmail !== inputEmail) {
        await signOut(auth);
        setErrorMessage(`Authenticated Google account (${googleEmail}) does not match entered Gmail (${inputEmail}). Please use the matching account.`);
        setIsRegistering(false);
        return;
      }

      // 2. Execute Atomic First-HOD Claim Rule
      const regResult = await registerFirstTimeHOD({
        departmentId: isCustomDept ? "new" : selectedDeptId,
        fullName: fullName.trim(),
        email: user.email,
        contactNumber: contactNumber.trim(),
        designation: designation.trim(),
        uid: user.uid,
        isNewDepartment: isCustomDept,
        newDepartmentName: customDeptName.trim(),
        newDepartmentCode: customDeptCode.trim(),
      });

      if (regResult.success) {
        toast({
          title: "HOD Registration Successful",
          description: regResult.message,
        });

        // Direct redirection to the department's HOD Dashboard
        navigate("/hod-dashboard");
      } else {
        await signOut(auth);
        setErrorMessage(regResult.message);
      }
    } catch (error: unknown) {
      console.error("HOD Registration Error:", error);
      const authErr = error as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setErrorMessage(authErr.message || "Failed to complete Google Authentication.");
      }
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6 text-left">
        
        {/* Navigation Back Button */}
        <div className="flex justify-start">
          <button
            onClick={() => {
              if (view === "register") {
                setView("options");
                setErrorMessage("");
              } else {
                navigate("/admin-select");
              }
            }}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>{view === "register" ? "Back to Login Options" : "Administrative Gateway"}</span>
          </button>
        </div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-900/5 relative overflow-hidden"
        >
          {/* Ambient Corner Blur */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-emerald-50 rounded-full blur-3xl pointer-events-none" />

          {/* Error Banner */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-3 shadow-xs"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-900">Authentication Alert</p>
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            </motion.div>
          )}

          {/* Info Banner */}
          {infoMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-3 shadow-xs"
            >
              <CheckCircle className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
              <p className="leading-relaxed">{infoMessage}</p>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            
            {/* ================================================================= */}
            {/* VIEW 1: DUAL OPTIONS INTERFACE                                    */}
            {/* ================================================================= */}
            {view === "options" && (
              <motion.div
                key="options"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 relative z-10"
              >
                {/* Header */}
                <header className="text-center space-y-2 mb-6">
                  <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 mx-auto mb-3 shadow-md border-slate-200" />
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold mb-1 shadow-xs">
                    <Crown size={14} className="text-amber-400" />
                    <span>HOD Executive Authority</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Head of Department Portal
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                    Multi-department attendance oversight. Log in with your departmental Google account or onboard as the first HOD for your department.
                  </p>
                </header>

                <div className="space-y-4">
                  {/* OPTION 1: EXISTING HOD LOGIN */}
                  <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all space-y-4 shadow-xs">
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-md shrink-0">
                        <Crown className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h2 className="font-bold text-base text-slate-900">
                          Existing HOD — Login with Gmail
                        </h2>
                        <p className="text-xs text-slate-500">
                          Authorized departmental heads with active department appointments
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleExistingHODLogin}
                      disabled={isLoggingIn || isCheckingSession}
                      className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-bold text-sm border border-slate-300 shadow-sm hover:border-slate-400 transition-all flex items-center justify-center gap-3 disabled:opacity-60"
                    >
                      {isLoggingIn ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                          <span>Verifying Departmental Authorization...</span>
                        </>
                      ) : (
                        <>
                          <GoogleIcon className="w-5 h-5" />
                          <span>Continue with Google</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* DIVIDER */}
                  <div className="relative flex items-center justify-center">
                    <div className="border-t border-slate-200 w-full" />
                    <span className="bg-white px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                      Or Onboard New Department
                    </span>
                    <div className="border-t border-slate-200 w-full" />
                  </div>

                  {/* OPTION 2: CREATE NEW HOD ACCOUNT */}
                  <button
                    type="button"
                    onClick={() => {
                      setView("register");
                      setErrorMessage("");
                    }}
                    className="w-full group p-5 rounded-2xl border border-slate-200 hover:border-emerald-500/60 bg-emerald-50/40 hover:bg-emerald-50/80 transition-all flex items-center justify-between text-left shadow-xs"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0 group-hover:scale-105 transition-transform">
                        <UserPlus className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="font-bold text-base text-slate-900 group-hover:text-emerald-800 transition-colors">
                          New HOD — Create Account
                        </h2>
                        <p className="text-xs text-slate-500">
                          Register as the first Head of Department for your academic discipline
                        </p>
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white text-slate-400 group-hover:text-emerald-700 flex items-center justify-center border border-slate-200 group-hover:border-emerald-300 shadow-xs shrink-0 transition-colors">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </button>
                </div>

                {/* Footer security note */}
                <div className="pt-2 text-center">
                  <p className="text-[11px] text-slate-400 font-medium flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>CanAttend Multi-Department Institutional Authorization</span>
                  </p>
                </div>
              </motion.div>
            )}

            {/* ================================================================= */}
            {/* VIEW 2: NEW HOD REGISTRATION FORM                                 */}
            {/* ================================================================= */}
            {view === "register" && (
              <motion.div
                key="register"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 relative z-10"
              >
                <header className="space-y-1 pb-4 border-b border-slate-100">
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold uppercase tracking-wider mb-1">
                    Department Onboarding
                  </div>
                  <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                    First-HOD Department Setup
                  </h2>
                  <p className="text-xs text-slate-500">
                    The first HOD of a department registers independently and activates immediately. If a department is already claimed, only the existing HOD may access it.
                  </p>
                </header>

                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  
                  {/* Full Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Full Name *
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Dr. Ramesh Rao"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {/* Official College Gmail */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Official College Gmail *
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        required
                        placeholder="e.g. ramesh.rao@gmail.com"
                        value={officialEmail}
                        onChange={(e) => setOfficialEmail(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 ml-1">
                      Must match the Google account you select during authentication.
                    </p>
                  </div>

                  {/* Academic Department (Requirement: New HOD registration must show ONLY unclaimed departments) */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Academic Department *
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <select
                        value={selectedDeptId}
                        onChange={(e) => {
                          setSelectedDeptId(e.target.value);
                          setIsCustomDept(e.target.value === "custom_new");
                        }}
                        disabled={loadingDepts}
                        className="w-full py-3 pl-10 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all appearance-none cursor-pointer font-medium disabled:opacity-50"
                      >
                        {unclaimedDepartments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.name} ({dept.code}) • [Available for Onboarding]
                          </option>
                        ))}
                        <option value="custom_new">+ Register New Academic Department...</option>
                      </select>
                    </div>

                    {unclaimedDepartments.length === 0 && !isCustomDept && (
                      <p className="text-[11px] text-amber-700 font-medium mt-1.5 ml-1 flex items-center gap-1.5 bg-amber-50 p-2 rounded-lg border border-amber-200">
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span>All standard departments currently have active HODs. Select &quot;+ Register New Academic Department...&quot; or log in with your Gmail.</span>
                      </p>
                    )}
                  </div>

                  {/* Custom New Department Name & Code Fields */}
                  {isCustomDept && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-900 mb-1">
                          New Department Name *
                        </label>
                        <input
                          type="text"
                          required={isCustomDept}
                          placeholder="e.g. Artificial Intelligence & Data Science"
                          value={customDeptName}
                          onChange={(e) => setCustomDeptName(e.target.value)}
                          className="w-full py-2.5 px-3 bg-white border border-emerald-300 rounded-lg text-slate-900 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-900 mb-1">
                          Dept Code *
                        </label>
                        <input
                          type="text"
                          required={isCustomDept}
                          placeholder="e.g. AIDS"
                          value={customDeptCode}
                          onChange={(e) => setCustomDeptCode(e.target.value.toUpperCase())}
                          className="w-full py-2.5 px-3 bg-white border border-emerald-300 rounded-lg text-slate-900 text-xs font-bold uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Designation */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Designation *
                    </label>
                    <div className="relative">
                      <Award className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Professor & Head of Department"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {/* Contact Number */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Contact Number *
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="tel"
                        required
                        placeholder="e.g. +91 98765 43210"
                        value={contactNumber}
                        onChange={(e) => setContactNumber(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {/* Security Policy Notice Box */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      First-HOD registration is verified server-side via atomic transaction. You will be activated immediately and granted direct access to your department terminal.
                    </p>
                  </div>

                  {/* Buttons */}
                  <div className="space-y-2 pt-2">
                    <button
                      type="submit"
                      disabled={isRegistering}
                      className="w-full py-3.5 px-4 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2.5 disabled:opacity-60"
                    >
                      {isRegistering ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                          <span>Claiming Department & Authenticating...</span>
                        </>
                      ) : (
                        <>
                          <GoogleIcon className="w-5 h-5" />
                          <span>Authenticate with Google & Activate Department</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setView("options");
                        setErrorMessage("");
                      }}
                      className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      Cancel and Return to Options
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      </div>
    </AppLayout>
  );
}
