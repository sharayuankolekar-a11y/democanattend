import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { db, auth, provider } from "../firebase";
import { signInWithPopup, signOut } from "firebase/auth";
import { collection, query, where, getDocs, updateDoc, doc, getDoc, onSnapshot } from "firebase/firestore";
import { 
  GraduationCap, 
  Mail, 
  CreditCard, 
  ArrowLeft, 
  CheckCircle2, 
  AlertCircle, 
  UserCheck, 
  ChevronRight,
  ShieldCheck,
  Building2,
  BookOpen,
  Clock,
  ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";
import {
  verifyStudentAuthorization,
  verifyStudentDocById,
  normalizeEmail,
  normalizeUSN,
  createStudentLoginRequest,
  verifyStudentLoginApproval,
  validateStudentSession,
  StudentAuthData,
  StudentSession,
  STORAGE_KEY,
  getStoredStudentSession,
  setStoredStudentSession,
  clearStoredStudentSession,
} from "@/lib/studentAuth";
import { getActiveCAAppointmentForClass, parseClassSemesterAndSection, resolveStudentActiveCAAppointment } from "@/lib/caAuth";

// Re-export for backward-compatibility across all modules
export type { StudentSession };
export { STORAGE_KEY, getStoredStudentSession, setStoredStudentSession, clearStoredStudentSession };

export default function StudentLogin() {
  const navigate = useNavigate();
  const location = useLocation();

  // Login Form States
  const [email, setEmail] = useState("");
  const [usn, setUsn] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Setup / CA Selection & Approval States
  const [step, setStep] = useState<"login" | "select_ca" | "pending_approval">("login");
  const [matchedStudentDoc, setMatchedStudentDoc] = useState<(StudentAuthData & { uid?: string }) | null>(null);
  const [availableCAs, setAvailableCAs] = useState<Array<{ id: string; name?: string; email?: string; class?: string }>>([]);
  const [selectedCaId, setSelectedCaId] = useState<string>("");
  const [caLoading, setCaLoading] = useState(false);
  const [savingCa, setSavingCa] = useState(false);

  // Pending Approval States
  const [pendingRequestId, setPendingRequestId] = useState<string>("");
  const [pendingSessionToken, setPendingSessionToken] = useState<string>("");
  const [pendingStudent, setPendingStudent] = useState<StudentAuthData | null>(null);
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);

  // Read redirected state errors or CA selection requests
  useEffect(() => {
    const state = location.state as { error?: string; step?: string; student?: StudentAuthData & { uid?: string } } | null;
    if (state) {
      if (state.error) {
        setError(state.error);
      }
      if (state.step === "select_ca" && state.student) {
        setMatchedStudentDoc(state.student);
        fetchClassAdvisors(state.student.createdBy || state.student.caId);
        setStep("select_ca");
      }
    }
  }, [location.state]);

  // Check if session exists and is already approved by CA
  useEffect(() => {
    let isMounted = true;
    const verifyExistingSession = async () => {
      const navState = location.state as { error?: string; step?: string } | null;
      if (navState && (navState.error || navState.step === "select_ca")) {
        return;
      }

      const session = getStoredStudentSession();
      if (!session || !session.id || !session.usn || !session.loginRequestId || !session.sessionToken) {
        return;
      }

      const check = await verifyStudentLoginApproval(session);
      if (!isMounted) return;

      if (!check.isAuthorized) {
        clearStoredStudentSession();
        return;
      }

      navigate("/dashboard");
    };

    verifyExistingSession();
    return () => {
      isMounted = false;
    };
  }, [navigate, location.state]);

  // Real-time listener for Pending Login Approval Request
  useEffect(() => {
    if (step !== "pending_approval" || !pendingRequestId) return;

    const requestRef = doc(db, "student_login_requests", pendingRequestId);
    const unsubscribe = onSnapshot(
      requestRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setRejectionMessage("Your login request was removed or cancelled by your Class Advisor.");
          return;
        }

        const data = snapshot.data();
        if (data.status === "approved") {
          if (!pendingStudent) return;
          const classString = data.class || pendingStudent.class || "";
          const { semesterNumber, sectionLetter } = parseClassSemesterAndSection(classString);
          const semesterStr = data.semester || (semesterNumber ? `${semesterNumber}th Semester` : "");
          const sectionStr = data.section || sectionLetter || "";

          const verifiedSession: StudentSession = {
            id: pendingStudent.id,
            name: pendingStudent.name,
            usn: pendingStudent.usn,
            email: pendingStudent.email,
            uid: auth.currentUser?.uid || (pendingStudent as StudentAuthData & { uid?: string }).uid || "",
            class: classString,
            semester: semesterStr,
            section: sectionStr,
            shortClass: data.shortClass || (semesterNumber && sectionLetter ? `${semesterNumber}th ${sectionLetter}` : ""),
            caId: data.caId || data.assignedFacultyDocId || pendingStudent.caId || "",
            caName: data.caName || pendingStudent.caName || "Class Advisor",
            caAppointmentId: data.caAppointmentId || pendingStudent.caAppointmentId || "",
            caSelected: true,
            loginRequestId: pendingRequestId || snapshot.id,
            sessionToken: data.sessionToken || pendingSessionToken,
          };
          setStoredStudentSession(verifiedSession);
          toast({
            title: "Login Approved",
            description: "Your Class Advisor has approved your access. Redirecting to dashboard...",
          });
          navigate("/dashboard");
        } else if (data.status === "rejected") {
          setRejectionMessage(
            "Your login request was rejected by your Class Advisor. Please contact your CA for assistance."
          );
        }
      },
      (err) => {
        console.error("Error listening to login approval status:", err);
      }
    );

    return () => unsubscribe();
  }, [step, pendingRequestId, pendingStudent, pendingSessionToken, navigate]);

  // Handle Login Form Submission (Google Auth + Roster Verification + Login Approval Request Creation)
  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanEmail = normalizeEmail(email);
    const cleanUsn = normalizeUSN(usn);

    if (!cleanEmail || !cleanUsn) {
      setError("Please enter both your Gmail address and USN.");
      return;
    }

    setLoading(true);

    try {
      // 1. Verify Google-authenticated identity
      let currentGoogleUser = auth.currentUser;
      if (!currentGoogleUser || normalizeEmail(currentGoogleUser.email) !== cleanEmail) {
        try {
          const authResult = await signInWithPopup(auth, provider);
          currentGoogleUser = authResult.user;
        } catch (popupErr: unknown) {
          console.error("Google sign-in popup error:", popupErr);
          setLoading(false);
          setError("Google Sign-In was cancelled or failed. Please authenticate with your Google account to proceed.");
          return;
        }
      }

      const googleEmail = normalizeEmail(currentGoogleUser?.email);
      if (googleEmail !== cleanEmail) {
        await signOut(auth);
        setLoading(false);
        setError(`The authenticated Google account (${googleEmail}) does not match the entered Gmail address (${cleanEmail}). Please use the correct Google account.`);
        return;
      }

      // 2. Strict Firestore roster verification (Scenario A, B, C, D)
      const result = await verifyStudentAuthorization(cleanEmail, cleanUsn);

      if (!result.isApproved || !result.student) {
        clearStoredStudentSession();
        setError(result.message);
        setLoading(false);
        return;
      }

      const student = result.student;

      // 3. Resolve CURRENT ACTIVE CA APPOINTMENT from HOD records (Single Source of Truth)
      const caApptResult = await resolveStudentActiveCAAppointment(student);

      if (!caApptResult.found || !caApptResult.appointment || !caApptResult.facultyDocId) {
        clearStoredStudentSession();
        setError(
          caApptResult.message ||
          `No active Class Advisor is currently appointed for ${student.class || student.shortClass || "your class"}. Please contact your Head of Department.`
        );
        setLoading(false);
        return;
      }

      const activeCA = {
        appointmentId: caApptResult.appointment.id || caApptResult.appointmentId || "",
        facultyDocId: caApptResult.facultyDocId,
        facultyName: caApptResult.facultyName || "Class Advisor",
        facultyEmail: caApptResult.facultyEmail || "",
        class: caApptResult.class || student.class || "",
        shortClass: caApptResult.shortClass || student.shortClass || "",
      };

      // 4. Create fresh unique pending login approval request assigned to current active CA
      const { requestId, sessionToken } = await createStudentLoginRequest(student, activeCA);

      setPendingRequestId(requestId);
      setPendingSessionToken(sessionToken);
      setPendingStudent({
        ...student,
        caId: activeCA.facultyDocId,
        caName: activeCA.facultyName,
        class: activeCA.class,
      });
      setRejectionMessage(null);
      setStep("pending_approval");

    } catch (err: unknown) {
      console.error("Login verification error:", err);
      clearStoredStudentSession();
      setError("An error occurred during verification. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch Available CAs from `teachers` collection
  const fetchClassAdvisors = async (createdById?: string) => {
    setCaLoading(true);
    try {
      const qCAs = query(collection(db, "teachers"), where("role", "==", "ca"));
      const snap = await getDocs(qCAs);
      const caList = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setAvailableCAs(caList);

      // Auto-select creator CA if available
      if (createdById) {
        const foundCreator = caList.find((ca) => ca.id === createdById);
        if (foundCreator) {
          setSelectedCaId(foundCreator.id);
        } else if (caList.length > 0) {
          setSelectedCaId(caList[0].id);
        }
      } else if (caList.length > 0) {
        setSelectedCaId(caList[0].id);
      }
    } catch (err) {
      console.error("Error fetching class advisors:", err);
    } finally {
      setCaLoading(false);
    }
  };

  // Handle CA Selection & Permanent Save
  const handleSaveCaAssociation = async () => {
    if (!selectedCaId || !matchedStudentDoc) {
      toast({
        variant: "destructive",
        title: "Selection Required",
        description: "Please select your Class Advisor to proceed.",
      });
      return;
    }

    const chosenCa = availableCAs.find((ca) => ca.id === selectedCaId);
    if (!chosenCa) {
      toast({
        variant: "destructive",
        title: "Advisor Not Found",
        description: "Selected Class Advisor details could not be found. Please try again.",
      });
      return;
    }

    setSavingCa(true);

    try {
      const studentRef = doc(db, "students", matchedStudentDoc.id);

      const updates = {
        caId: chosenCa.id,
        caName: chosenCa.name || "Class Advisor",
        class: chosenCa.class || matchedStudentDoc.class || "Class",
        caSelected: true,
      };

      // Save permanently in Firestore database
      await updateDoc(studentRef, updates);

      toast({
        title: "Setup Complete",
        description: `Linked to Class Advisor: ${updates.caName}. Submitting login request...`,
      });

      const updatedStudent: StudentAuthData = {
        id: matchedStudentDoc.id,
        name: matchedStudentDoc.name || "Student",
        usn: matchedStudentDoc.usn || usn.trim().toUpperCase(),
        email: matchedStudentDoc.email || email.trim().toLowerCase(),
        class: updates.class,
        caId: updates.caId,
        caName: updates.caName,
        caSelected: true,
      };

      // Create unique pending login approval request in Firestore
      const { requestId, sessionToken } = await createStudentLoginRequest(updatedStudent);

      setPendingRequestId(requestId);
      setPendingSessionToken(sessionToken);
      setPendingStudent(updatedStudent);
      setRejectionMessage(null);
      setStep("pending_approval");
    } catch (err) {
      console.error("Error saving CA association:", err);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: "Failed to save CA selection. Please try again.",
      });
    } finally {
      setSavingCa(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6 text-left">
        
        {/* Navigation back */}
        <div className="flex justify-start">
          <button
            onClick={() => {
              if (step === "pending_approval") {
                setStep("login");
              } else if (step === "select_ca") {
                setStep("login");
              } else {
                navigate("/");
              }
            }}
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>
              {step === "pending_approval"
                ? "Back to Login"
                : step === "select_ca"
                ? "Back to Login"
                : "Institutional Portal"}
            </span>
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-900/5 space-y-6"
        >
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <CollegeLogo size="sm" showContainer containerClassName="w-10 h-10 border-slate-200 shadow-sm" />
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-600">
                  CANARA ENGINEERING COLLEGE
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Student <span className="text-emerald-600">Portal Login</span>
                </h1>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 font-medium pt-1">
              {step === "login"
                ? "Enter your CA-registered Gmail address and USN to verify your account."
                : step === "select_ca"
                ? "One-time Setup: Confirm your assigned Class Advisor to link your class schedule."
                : "Awaiting approval from your designated Class Advisor to access the portal."}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {step === "login" ? (
              /* STEP 1: GMAIL + USN LOGIN FORM */
              <motion.form
                key="step-login"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                onSubmit={handleVerifyLogin}
                className="space-y-5"
              >
                {/* Error Banner */}
                {error && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-medium flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-900">Authentication Failed</p>
                      <p>{error}</p>
                    </div>
                  </div>
                )}

                {/* Gmail Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Gmail Address</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@gmail.com"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                </div>

                {/* USN Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                    <span>University Seat Number (USN)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={usn}
                    onChange={(e) => setUsn(e.target.value.toUpperCase())}
                    placeholder="e.g. 4CB24CS155"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 uppercase tracking-wider transition-all"
                  />
                </div>

                {/* Login Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm sm:text-base transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Verifying Credentials...</span>
                    </>
                  ) : (
                    <>
                      <span>Login to Dashboard</span>
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-2 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Verified against Class Advisor registered roster</span>
                </div>
              </motion.form>
            ) : step === "select_ca" ? (
              /* STEP 2: FIRST-TIME CA SELECTION FORM */
              <motion.div
                key="step-select-ca"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-5"
              >
                <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-900 text-xs sm:text-sm font-medium flex items-center gap-3">
                  <UserCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-900">
                      Roster Verification Successful!
                    </p>
                    <p className="text-slate-600">
                      Student: <span className="font-semibold text-slate-900">{matchedStudentDoc?.name}</span> ({matchedStudentDoc?.usn})
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-emerald-600" />
                    <span>Select Your Class Advisor (CA)</span>
                  </label>

                  {caLoading ? (
                    <div className="py-8 text-center text-xs text-slate-500 font-medium space-y-2">
                      <div className="w-5 h-5 mx-auto rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                      <p>Loading Class Advisors...</p>
                    </div>
                  ) : availableCAs.length === 0 ? (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                      No Class Advisor profiles found in system. Please contact admin.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {availableCAs.map((ca) => {
                        const isSelected = selectedCaId === ca.id;
                        return (
                          <div
                            key={ca.id}
                            onClick={() => setSelectedCaId(ca.id)}
                            className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isSelected
                                ? "bg-emerald-50/70 border-emerald-500 shadow-sm"
                                : "bg-slate-50 border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            <div className="space-y-0.5 text-left">
                              <h3 className="font-bold text-sm text-slate-900">
                                {ca.name || "Class Advisor"}
                              </h3>
                              <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                                <span className="flex items-center gap-1 text-emerald-700 font-bold bg-emerald-100/60 px-2 py-0.5 rounded-md">
                                  <BookOpen className="w-3 h-3 text-emerald-600" />
                                  Class: {ca.class || "General"}
                                </span>
                                {ca.email && <span>• {ca.email}</span>}
                              </div>
                            </div>

                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
                                isSelected
                                  ? "bg-emerald-600 border-emerald-600 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isSelected && <CheckCircle2 className="w-4 h-4" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleSaveCaAssociation}
                    disabled={savingCa || !selectedCaId}
                    className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm sm:text-base transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {savingCa ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        <span>Saving CA Association...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm & Request Login Approval</span>
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-slate-400 text-center pt-2 italic">
                    Note: CA selection is saved permanently and will not be asked again.
                  </p>
                </div>
              </motion.div>
            ) : (
              /* STEP 3: PENDING APPROVAL SCREEN */
              <motion.div
                key="step-pending"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="space-y-6 text-center"
              >
                {rejectionMessage ? (
                  <div className="space-y-6 py-4">
                    <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-sm">
                      <ShieldAlert className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        Login Request Rejected
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                        {rejectionMessage}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setRejectionMessage(null);
                        setPendingRequestId("");
                        setPendingSessionToken("");
                        setStep("login");
                      }}
                      className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm transition-colors shadow-md flex items-center justify-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Return to Login</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6 py-2">
                    {/* Pulsing Clock Icon */}
                    <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                      <div className="absolute inset-0 rounded-3xl bg-amber-400/20 animate-ping" />
                      <div className="relative w-20 h-20 rounded-3xl bg-amber-500/10 border-2 border-amber-500/30 text-amber-600 flex items-center justify-center shadow-md">
                        <Clock className="w-10 h-10 animate-pulse text-amber-600" />
                      </div>
                    </div>

                    {/* Headings & Mandatory Message */}
                    <div className="space-y-2 text-left bg-amber-50/80 border border-amber-200/90 rounded-2xl p-4 sm:p-5">
                      <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm sm:text-base">
                        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
                        <span>Login Approval Pending</span>
                      </div>
                      <p className="text-xs sm:text-sm text-amber-950 font-medium leading-relaxed">
                        Your login request has been submitted successfully. Please wait for your Class Advisor to approve your access.
                      </p>
                    </div>

                    {/* Student Request Details Card */}
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 text-left">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Request Details
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block font-medium">Student</span>
                          <span className="font-bold text-slate-900">{pendingStudent?.name}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block font-medium">USN</span>
                          <span className="font-bold text-slate-900 uppercase">{pendingStudent?.usn}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block font-medium">Class Section</span>
                          <span className="font-bold text-emerald-700">{pendingStudent?.class || "Assigned Section"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block font-medium">Class Advisor</span>
                          <span className="font-bold text-slate-900">{pendingStudent?.caName || "Class Advisor"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Real-time Indicator */}
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-full text-xs font-semibold shadow-sm">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span>Awaiting Class Advisor in real-time...</span>
                    </div>

                    {/* Cancel / Back Option */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (pendingRequestId) {
                            try {
                              await updateDoc(doc(db, "student_login_requests", pendingRequestId), {
                                status: "cancelled",
                              });
                            } catch (e) {
                              console.warn("Cancel request error:", e);
                            }
                          }
                          setPendingRequestId("");
                          setPendingSessionToken("");
                          setStep("login");
                        }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-900 underline"
                      >
                        Cancel Request & Return
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </AppLayout>
  );
}
