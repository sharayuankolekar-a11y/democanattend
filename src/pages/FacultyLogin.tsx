import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { auth, provider, db } from "../firebase";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { 
  GraduationCap, 
  UserPlus, 
  ArrowLeft, 
  CheckCircle, 
  BookOpen, 
  Shield, 
  AlertCircle, 
  Loader2, 
  Building2, 
  Award, 
  Phone, 
  Mail, 
  User, 
  Clock, 
  ArrowRight,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { verifyFacultyAuthorization, registerNewFacultyRequest, normalizeEmail } from "@/lib/facultyAuth";
import { getDepartmentsWithActiveHOD, DepartmentRecord } from "@/lib/departmentService";
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

export default function FacultyLogin() {
  const navigate = useNavigate();
  const location = useLocation();

  // View state: 'options' | 'register' | 'submitted'
  const [view, setView] = useState<"options" | "register" | "submitted">("options");

  // Loading states
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(true);

  // Departments list loaded from Firestore
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);

  // Messages
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  // Registration Form Fields
  const [name, setName] = useState("");
  const [officialEmail, setOfficialEmail] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [designation, setDesignation] = useState("Assistant Professor");
  const [contactNumber, setContactNumber] = useState("");
  const [subject, setSubject] = useState("");

  // Cache for submitted success view
  const [submittedData, setSubmittedData] = useState<Record<string, string> | null>(null);

  // Load error message if passed via route navigation
  useEffect(() => {
    const navError = (location.state as { error?: string } | null)?.error;
    if (navError) {
      setErrorMessage(navError);
    }
  }, [location.state]);

  // Real-time listener for academic departments with an active, approved HOD
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

        // Only departments that have an active, approved Head of Department
        const activeHODDepts = list
          .filter((d) => Boolean(d.currentHodId && d.currentHodEmail) && d.status !== "inactive")
          .sort((a, b) => a.name.localeCompare(b.name));

        setDepartments(activeHODDepts);
        setSelectedDeptId((prev) => {
          if (prev && activeHODDepts.some((d) => d.id === prev)) {
            return prev;
          }
          return activeHODDepts.length > 0 ? activeHODDepts[0].id : "";
        });

        setLoadingDepts(false);
        setIsCheckingSession(false);
      },
      (error) => {
        console.error("Real-time departments listener error in FacultyLogin:", error);
        setLoadingDepts(false);
        setIsCheckingSession(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // =========================================================================
  // OPTION A: EXISTING FACULTY LOGIN WITH GOOGLE
  // =========================================================================
  const handleExistingFacultyLogin = async () => {
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

      // Check authorization in Firestore
      const authResult = await verifyFacultyAuthorization(user.email);

      if (authResult.isApproved) {
        toast({
          title: "Authorization Verified",
          description: `Welcome, ${authResult.data?.name || "Faculty Member"}. Accessing attendance workspace.`,
        });
        navigate("/faculty/subjects");
      } else {
        // Pending, Rejected, or Unregistered -> Block access & sign out immediately
        await signOut(auth);

        if (authResult.isPending) {
          navigate("/faculty/pending-approval", {
            state: {
              email: user.email,
              name: authResult.data?.name || user.displayName,
              department: authResult.data?.department,
              designation: authResult.data?.designation,
              subject: authResult.data?.subject,
              message: "Your faculty registration is awaiting HOD approval.",
            },
          });
        } else if (authResult.isRejected) {
          setErrorMessage("Your faculty registration has been rejected. Contact your HOD.");
        } else if (authResult.isRevoked) {
          setErrorMessage("Your faculty registration has been revoked. Contact your HOD.");
        } else {
          setErrorMessage(authResult.message || "Account not found. Please register as a new faculty member.");
        }
      }
    } catch (error: unknown) {
      console.error("FACULTY LOGIN ERROR:", error);
      const authErr = error as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setErrorMessage(authErr.message || "Failed to authenticate with Google. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // =========================================================================
  // OPTION B: NEW FACULTY REQUEST SUBMISSION (DEPARTMENT-SPECIFIC)
  // =========================================================================
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!name.trim()) {
      setErrorMessage("Please enter your Full Legal Name.");
      return;
    }

    if (!officialEmail.trim() || !officialEmail.includes("@")) {
      setErrorMessage("Please enter a valid official college Gmail address.");
      return;
    }

    if (!selectedDeptId) {
      setErrorMessage("Please select your Academic Department.");
      return;
    }

    if (!designation.trim()) {
      setErrorMessage("Please enter your Designation.");
      return;
    }

    if (!contactNumber.trim() || contactNumber.trim().length < 8) {
      setErrorMessage("Please enter a valid Contact Number.");
      return;
    }

    if (!subject.trim()) {
      setErrorMessage("Please enter your teaching subject or specialization.");
      return;
    }

    const selectedDept = departments.find((d) => d.id === selectedDeptId);
    if (!selectedDept) {
      setErrorMessage("Selected department was not recognized. Please choose from the list.");
      return;
    }

    setIsRegistering(true);

    try {
      // Authenticate with Google
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

      // Check if this account already exists
      const existingCheck = await verifyFacultyAuthorization(user.email);
      if (existingCheck.isApproved) {
        toast({
          title: "Account Already Approved",
          description: "Your account is already an approved faculty member! Redirecting to dashboard...",
        });
        setTimeout(() => {
          navigate("/faculty/subjects");
        }, 1200);
        return;
      }

      if (existingCheck.isPending) {
        await signOut(auth);
        navigate("/faculty/pending-approval", {
          state: {
            email: user.email,
            name: existingCheck.data?.name || name.trim(),
            department: existingCheck.data?.department || selectedDept.name,
            designation: existingCheck.data?.designation || designation.trim(),
            subject: existingCheck.data?.subject || subject.trim(),
            message: "Your faculty registration is awaiting HOD approval.",
          },
        });
        setIsRegistering(false);
        return;
      }

      // Save registration request to Firestore under 'faculty_requests' with status = 'pending'
      // Automatically associates with the selected department and its HOD
      await registerNewFacultyRequest({
        name: name.trim(),
        email: user.email,
        departmentId: selectedDept.id,
        department: selectedDept.name,
        departmentCode: selectedDept.code,
        hodId: selectedDept.currentHodId || "",
        hodEmail: selectedDept.currentHodEmail || "",
        designation: designation.trim(),
        contactNumber: contactNumber.trim(),
        subject: subject.trim(),
        uid: user.uid,
      });

      // Sign out user so they cannot access dashboard until approved
      await signOut(auth);

      // Redirect to Pending Approval screen
      navigate("/faculty/pending-approval", {
        state: {
          name: name.trim(),
          email: user.email,
          departmentId: selectedDept.id,
          department: selectedDept.name,
          departmentCode: selectedDept.code,
          designation: designation.trim(),
          contactNumber: contactNumber.trim(),
          subject: subject.trim(),
          message: "Your faculty registration is awaiting HOD approval.",
        },
      });
    } catch (error: unknown) {
      console.error("FACULTY REQUEST ERROR:", error);
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
          {/* Ambient Glow */}
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
                    <GraduationCap size={14} className="text-emerald-400" />
                    <span>Faculty Terminal Gateway</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Faculty Authentication
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                    Sign in with your verified institutional Google account to launch classroom QR attendance sessions.
                  </p>
                </header>

                <div className="space-y-4">
                  {/* OPTION 1: EXISTING FACULTY LOGIN */}
                  <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all space-y-4 shadow-xs">
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-md shrink-0">
                        <GraduationCap className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <h2 className="font-bold text-base text-slate-900">
                          Existing Faculty — Login with Gmail
                        </h2>
                        <p className="text-xs text-slate-500">
                          Approved faculty members authorized for attendance sessions
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleExistingFacultyLogin}
                      disabled={isLoggingIn || isCheckingSession}
                      className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-bold text-sm border border-slate-300 shadow-sm hover:border-slate-400 transition-all flex items-center justify-center gap-3 disabled:opacity-60 cursor-pointer"
                    >
                      {isLoggingIn ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                          <span>Verifying Faculty Credentials...</span>
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
                      Or Submit Registration Request
                    </span>
                    <div className="border-t border-slate-200 w-full" />
                  </div>

                  {/* OPTION 2: CREATE NEW FACULTY ACCOUNT */}
                  <button
                    type="button"
                    onClick={() => {
                      setView("register");
                      setErrorMessage("");
                    }}
                    className="w-full group p-5 rounded-2xl border border-slate-200 hover:border-emerald-500/60 bg-emerald-50/40 hover:bg-emerald-50/80 transition-all flex items-center justify-between text-left shadow-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0 group-hover:scale-105 transition-transform">
                        <UserPlus className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="font-bold text-base text-slate-900 group-hover:text-emerald-800 transition-colors">
                          New Faculty — Register Account
                        </h2>
                        <p className="text-xs text-slate-500">
                          Submit teaching specialization and department details for HOD approval
                        </p>
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white text-slate-400 group-hover:text-emerald-700 flex items-center justify-center border border-slate-200 group-hover:border-emerald-300 shadow-xs shrink-0 transition-colors">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </button>
                </div>

                {/* Security footer */}
                <div className="pt-2 text-center">
                  <p className="text-[11px] text-slate-400 font-medium flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Protected by CanAttend Institutional Authorization Protocol</span>
                  </p>
                </div>
              </motion.div>
            )}

            {/* ================================================================= */}
            {/* VIEW 2: NEW FACULTY REGISTRATION FORM (DEPARTMENT-SPECIFIC)       */}
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
                    Faculty Application
                  </div>
                  <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                    New Faculty Registration
                  </h2>
                  <p className="text-xs text-slate-500">
                    Provide your institutional details. Your request will be routed directly to the Head of Department for review and approval.
                  </p>
                </header>

                <form onSubmit={handleRequestSubmit} className="space-y-4">
                  
                  {/* Full Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Full Legal Name *
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Prof. Suresh Shenoy"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {/* Official Gmail */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Official Gmail Address *
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        required
                        placeholder="e.g. suresh.shenoy@gmail.com"
                        value={officialEmail}
                        onChange={(e) => setOfficialEmail(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 ml-1">
                      Must match the Google account you select during authentication.
                    </p>
                  </div>

                  {/* Academic Department Dropdown (Loaded dynamically from departments collection) */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Academic Department *
                    </label>
                    {departments.length === 0 && !loadingDepts ? (
                      <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                        <span>No academic departments currently have an onboarded Head of Department. A department HOD must onboard first before faculty can register.</span>
                      </div>
                    ) : (
                      <div className="relative">
                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <select
                          value={selectedDeptId}
                          onChange={(e) => setSelectedDeptId(e.target.value)}
                          disabled={loadingDepts || departments.length === 0}
                          className="w-full py-3 pl-10 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all appearance-none cursor-pointer font-medium disabled:opacity-50"
                        >
                          {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                              {dept.name} ({dept.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1 ml-1">
                      Your application will be routed exclusively to this department&apos;s HOD dashboard.
                    </p>
                  </div>

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
                        placeholder="e.g. Assistant Professor / Associate Professor"
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

                  {/* Teaching Subject or Specialization */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                      Subject or Teaching Specialization *
                    </label>
                    <div className="relative">
                      <BookOpen className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Data Structures & Algorithms, Computer Networks"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {/* Security Policy Notice */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Google Sign-In is required to verify your institutional identity. Once submitted, your application status will be <strong>Pending HOD Approval</strong>.
                    </p>
                  </div>

                  {/* Submit Buttons */}
                  <div className="space-y-2 pt-2">
                    <button
                      type="submit"
                      disabled={isRegistering}
                      className="w-full py-3.5 px-4 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
                    >
                      {isRegistering ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                          <span>Submitting Faculty Request...</span>
                        </>
                      ) : (
                        <>
                          <GoogleIcon className="w-5 h-5" />
                          <span>Authenticate with Google & Submit Application</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setView("options");
                        setErrorMessage("");
                      }}
                      className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                    >
                      Cancel and Return to Options
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ================================================================= */}
            {/* VIEW 3: APPLICATION SUBMITTED SUCCESS VIEW                        */}
            {/* ================================================================= */}
            {view === "submitted" && submittedData && (
              <motion.div
                key="submitted"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-6 py-4 relative z-10"
              >
                {/* Success Icon */}
                <div className="mx-auto w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center border border-emerald-200 shadow-sm">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>

                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold">
                    <Clock size={13} className="text-amber-600" />
                    <span>Status: Pending HOD Approval</span>
                  </span>
                  <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                    Faculty Application Submitted!
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
                    Your application has been registered and routed directly to the Head of Department for review.
                  </p>
                </div>

                {/* Summary Card */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2.5 text-xs max-w-md mx-auto">
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Applicant</span>
                    <span className="font-bold text-slate-800">{submittedData.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Gmail</span>
                    <span className="font-bold text-slate-800">{submittedData.email}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Department</span>
                    <span className="font-bold text-emerald-700">{submittedData.department}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Subject</span>
                    <span className="font-bold text-indigo-700">{submittedData.subject}</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Designation</span>
                    <span className="font-bold text-slate-800">{submittedData.designation}</span>
                  </div>
                </div>

                {/* Instructions */}
                <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 text-left space-y-1">
                  <p className="font-bold">Next Steps:</p>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    Your application will appear in the Institutional Approval Management panel of the Head of Department for {submittedData.department}. Once approved, you can log in directly using "Continue with Google".
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setView("options");
                    setSubmittedData(null);
                    setName("");
                    setOfficialEmail("");
                    setContactNumber("");
                    setSubject("");
                  }}
                  className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer"
                >
                  Return to Faculty Portal
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      </div>
    </AppLayout>
  );
}
