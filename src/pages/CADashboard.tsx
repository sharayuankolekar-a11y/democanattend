import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { signOut } from "firebase/auth";
import { 
  verifyCAAuthorization, 
  parseClassSemesterAndSection, 
  formatShortClass 
} from "@/lib/caAuth";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  Users,
  CheckCircle,
  GraduationCap,
  ArrowLeft,
  LayoutDashboard,
  User,
  Mail,
  BookOpen,
  ShieldCheck,
  Plus,
  Trash2,
  Check,
  X,
  Calendar,
  LogOut,
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { motion } from "framer-motion";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";

interface CAStudentRow {
  id: string;
  name?: string;
  usn?: string;
  email?: string;
  createdBy?: string;
  caId?: string;
  caAppointmentId?: string;
  class?: string;
  shortClass?: string;
  semester?: string;
  section?: string;
}

interface CAAttendanceRow {
  id: string;
  name?: string;
  subject?: string;
  caId?: string;
  status?: string;
  time?: { toMillis?: () => number } | string | Date;
}

export default function CADashboard() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [students, setStudents] = useState<CAStudentRow[]>([]);
  const [attendance, setAttendance] = useState<CAAttendanceRow[]>([]);

  const [name, setName] = useState("");
  const [usn, setUsn] = useState("");
  const [email, setEmail] = useState("");
  const [caId, setCaId] = useState("");
  const [caProfile, setCaProfile] = useState<Record<string, string | undefined> | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingLoginApprovalsCount, setPendingLoginApprovalsCount] = useState<number>(0);

  const navigate = useNavigate();

  // Fetch Students (Real-time for this assigned class)
  useEffect(() => {
    if (!caId) return;

    const caClass = (caProfile?.class || "").trim().toLowerCase();
    const caShort = (caProfile?.shortClass || "").trim().toLowerCase();
    const { semesterNumber: caSemNum, sectionLetter: caSecLetter } =
      parseClassSemesterAndSection(caProfile?.class, caProfile?.semester, caProfile?.section);

    const unsubscribe = onSnapshot(collection(db, "students"), (snapshot) => {
      const studentsList: CAStudentRow[] = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<CAStudentRow, "id">),
        }))
        .filter((s) => {
          if (s.createdBy === caId || s.caId === caId) return true;
          if (caProfile?.caAppointmentId && s.caAppointmentId === caProfile.caAppointmentId) return true;
          const sClass = (s.class || "").trim().toLowerCase();
          const sShort = (s.shortClass || "").trim().toLowerCase();
          if (caClass && (sClass === caClass || sShort === caClass)) return true;
          if (caShort && (sClass === caShort || sShort === caShort)) return true;

          if (caSemNum && caSecLetter) {
            const sParsed = parseClassSemesterAndSection(s.class, s.semester, s.section);
            if (sParsed.semesterNumber === caSemNum && sParsed.sectionLetter === caSecLetter) {
              return true;
            }
          }
          return false;
        });
      setStudents(studentsList);
    });

    return () => unsubscribe();
  }, [caId, caProfile]);

  // Fetch Pending Student Login Requests (Real-time for this active CA appointment)
  useEffect(() => {
    if (!caId || !caProfile) return;

    const caClass = (caProfile.class || "").trim().toLowerCase();
    const caShort = (caProfile.shortClass || "").trim().toLowerCase();
    const apptId = caProfile.caAppointmentId;

    const requestsRef = collection(db, "student_login_requests");
    const unsubscribe = onSnapshot(
      requestsRef,
      (snapshot) => {
        const count = snapshot.docs.filter((d) => {
          const data = d.data();
          if (data.status !== "pending") return false;
          if (apptId && data.caAppointmentId === apptId) return true;
          if (data.assignedFacultyDocId === caId || data.caId === caId) return true;
          const reqClass = (data.class || "").trim().toLowerCase();
          const reqShort = (data.shortClass || "").trim().toLowerCase();
          return (
            (caClass && (reqClass === caClass || reqClass === caShort)) ||
            (caShort && (reqShort === caShort || reqShort === caClass))
          );
        }).length;
        setPendingLoginApprovalsCount(count);
      },
      (err) => {
        console.error("Error listening to pending login approvals count:", err);
      }
    );

    return () => unsubscribe();
  }, [caId, caProfile]);

  // Fetch Attendance (only this class)
  const fetchAttendance = async () => {
    if (!caId) return;

    // 1. Fetch students belonging to this class
    const studentsSnap = await getDocs(collection(db, "students"));
    const caClass = (caProfile?.class || "").trim().toLowerCase();
    const caShort = (caProfile?.shortClass || "").trim().toLowerCase();

    const studentNames = studentsSnap.docs
      .filter((d) => {
        const data = d.data();
        if (data.createdBy === caId || data.caId === caId) return true;
        const sClass = (data.class || "").trim().toLowerCase();
        return (caClass && sClass === caClass) || (caShort && sClass === caShort);
      })
      .map((d) => d.data().name);

    // 2. Fetch all attendance
    const attendanceSnap = await getDocs(collection(db, "attendance"));
    const allAttendance: CAAttendanceRow[] = attendanceSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<CAAttendanceRow, "id">),
    }));

    // 3. Filter attendance for students managed by this CA
    const filteredAttendance = allAttendance.filter((a) =>
      studentNames.includes(a.name)
    );

    // 4. Sort by time descending (newest first)
    filteredAttendance.sort((a, b) => {
      const aTime = a.time as { toMillis?: () => number } | string | Date | undefined;
      const bTime = b.time as { toMillis?: () => number } | string | Date | undefined;
      const timeA = aTime && typeof aTime === "object" && "toMillis" in aTime && typeof aTime.toMillis === "function"
        ? aTime.toMillis()
        : aTime
        ? new Date(aTime as string | Date).getTime()
        : 0;
      const timeB = bTime && typeof bTime === "object" && "toMillis" in bTime && typeof bTime.toMillis === "function"
        ? bTime.toMillis()
        : bTime
        ? new Date(bTime as string | Date).getTime()
        : 0;
      return timeB - timeA;
    });

    setAttendance(filteredAttendance);
  };

  // Add Student (Name + USN + Gmail)
  const handleAddStudent = async () => {
    if (!name.trim() || !usn.trim() || !email.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Fields",
        description: "Please fill all fields (Name, USN, Gmail).",
      });
      return;
    }

    if (!caId) {
      toast({
        variant: "destructive",
        title: "Profile Not Ready",
        description: "CA profile is still loading. Please wait a moment and try again.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsn = usn.trim().toUpperCase();
    const caClass = caProfile?.class || "";
    const caSemester = caProfile?.semester || "";
    const caSection = caProfile?.section || "";
    const caShortClass = caProfile?.shortClass || (caSemester && caSection ? formatShortClass(caSemester, caSection) : "");

    // Check for existing records by USN or Email to prevent duplicates
    const studentsRef = collection(db, "students");
    const existingSnap = await getDocs(
      query(studentsRef, where("usn", "==", normalizedUsn))
    );

    let primaryDocId: string | null = null;
    const duplicateDocIds: string[] = [];

    existingSnap.docs.forEach((d) => {
      if (!primaryDocId) {
        primaryDocId = d.id;
      } else {
        duplicateDocIds.push(d.id);
      }
    });

    // Also check if any record matches by normalized email
    if (!primaryDocId) {
      const emailSnap = await getDocs(
        query(studentsRef, where("email", "==", normalizedEmail))
      );
      emailSnap.docs.forEach((d) => {
        if (!primaryDocId) {
          primaryDocId = d.id;
        } else {
          duplicateDocIds.push(d.id);
        }
      });
    }

    const studentPayload = {
      name: name.trim(),
      usn: normalizedUsn,
      email: normalizedEmail,
      createdBy: caId,
      class: caClass,
      semester: caSemester,
      section: caSection,
      shortClass: caShortClass,
      caId: caId,
      caName: caProfile?.name || "",
      caAppointmentId: caProfile?.caAppointmentId || "",
      caSelected: true,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };

    if (primaryDocId) {
      // Update existing record
      await updateDoc(doc(db, "students", primaryDocId), studentPayload);
      // Clean up any redundant duplicates
      for (const dupId of duplicateDocIds) {
        await deleteDoc(doc(db, "students", dupId)).catch(() => {});
      }
      toast({
        title: "Student Updated",
        description: `${name.trim()} (${normalizedUsn}) updated in class roster.`,
      });
    } else {
      // Create new record
      await addDoc(studentsRef, {
        ...studentPayload,
        createdAt: new Date().toISOString(),
      });
      toast({
        title: "Student Added",
        description: `${name.trim()} (${normalizedUsn}) added to class roster.`,
      });
    }

    setName("");
    setUsn("");
    setEmail("");
  };

  // Delete Student
  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, "students", id));
  };

  // Verify CA Authorization & Resolve CA ID
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user || !user.email) {
        setCaId("");
        setCaProfile(null);
        navigate("/ca-login", { replace: true });
        return;
      }

      try {
        const authResult = await verifyCAAuthorization(user.email);
        if (!authResult.isApproved) {
          await signOut(auth);
          navigate("/ca-login", {
            replace: true,
            state: { error: authResult.message }
          });
          return;
        }

        setCaId(authResult.docId || "");
        setCaProfile({
          ...(authResult.data as Record<string, string | undefined> | undefined),
          class: authResult.assignedClass || String(authResult.data?.class || ""),
          semester: authResult.semester || String(authResult.data?.caSemester || ""),
          section: authResult.section || String(authResult.data?.caSection || ""),
          shortClass: authResult.shortClass || String(authResult.data?.caShortClass || ""),
        });
      } catch (err) {
        console.error("CA Authorization check error:", err);
        await signOut(auth);
        navigate("/ca-login", {
          replace: true,
          state: { error: "Failed to verify Class Advisor authorization." }
        });
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/admin-select");
    } catch (error) {
      console.error("Logout error:", error);
      navigate("/admin-select");
    }
  };

  useEffect(() => {
    if (caId) {
      fetchAttendance();
    }
  }, [caId]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 text-left">
        
        {/* Top Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (activeSection) {
                  setActiveSection(null);
                } else {
                  navigate("/");
                }
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 bg-slate-100 px-3.5 py-2 rounded-full border border-slate-200 transition-all shrink-0"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>

            <div className="space-y-0.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                <LayoutDashboard className="w-6 h-6 text-emerald-600" />
                CA Dashboard
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                {caProfile?.class ? `Class Advisor • ${caProfile.class}` : "Class Advisor Management Suite"}
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-emerald-600 text-white px-4 py-2 rounded-full text-xs font-semibold transition-colors shadow-sm"
              title="View CA Profile"
            >
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span>Profile Information</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 px-3.5 py-2 rounded-full text-xs font-semibold transition-all shadow-sm"
              title="Sign Out as Class Advisor"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Dashboard Section Selection Cards */}
        {!activeSection && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Student Login Approvals Card */}
            <div
              onClick={() => navigate("/ca/student-approvals")}
              className="group p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all cursor-pointer space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-900 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                {pendingLoginApprovalsCount > 0 && (
                  <span className="px-2.5 py-1 text-xs font-extrabold bg-amber-100 text-amber-800 border border-amber-200 rounded-full animate-pulse">
                    {pendingLoginApprovalsCount} Pending
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  Student Login Approvals
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Review and approve student login requests before granting dashboard access.
                </p>
              </div>
            </div>

            {/* Attendance Roster Card */}
            <div
              onClick={() => setActiveSection("attendance")}
              className="group p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all cursor-pointer space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-900 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">Class Attendance</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Review live and historical student attendance logs</p>
              </div>
            </div>

            {/* Student Roster Card */}
            <div
              onClick={() => setActiveSection("students")}
              className="group p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all cursor-pointer space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-900 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">Student Roster</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Add & manage enrolled student USN profiles</p>
              </div>
            </div>

            {/* Class Timetable Card */}
            <div
              onClick={() => navigate("/ca/timetable")}
              className="group p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all cursor-pointer space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-900 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
                <Calendar className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">Class Timetable</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Organize, edit & schedule weekly class periods</p>
              </div>
            </div>
          </div>
        )}

        {/* SECTION: Attendance */}
        {activeSection === "attendance" && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                Class Attendance Records
              </h2>
              <button
                onClick={() => setActiveSection(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Close View
              </button>
            </div>

            {attendance.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
                <p className="text-sm font-semibold text-slate-500">No attendance logs found for your class.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                {attendance.map((a) => (
                  <div
                    key={a.id}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-bold text-sm text-slate-900">{a.name}</p>
                      <p className="text-xs text-slate-500">{a.subject || a.caId}</p>
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-semibold capitalize">
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION: Students Management */}
        {activeSection === "students" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            
            {/* Add Student Form */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="pb-2 border-b border-slate-100">
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-600" />
                  Add Student Profile
                </h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">Student Name</label>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">USN</label>
                  <input
                    type="text"
                    placeholder="e.g. 4CB21CS001"
                    value={usn}
                    onChange={(e) => setUsn(e.target.value.toUpperCase())}
                    className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">Gmail Address</label>
                  <input
                    type="email"
                    placeholder="student@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                <button
                  onClick={handleAddStudent}
                  className="w-full py-3 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm mt-2"
                >
                  Save Student to Roster
                </button>
              </div>
            </div>

            {/* Students Roster List */}
            <div className="md:col-span-2 bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-emerald-600" />
                  Enrolled Students ({students.length})
                </h3>
                <button
                  onClick={() => setActiveSection(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                {students.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No students in roster yet. Use the form to add students.</p>
                ) : (
                  students.map((s) => (
                    <div
                      key={s.id}
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5 text-left min-w-0 flex-1">
                        <p className="font-bold text-sm text-slate-900 truncate">{s.name}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                          <span className="text-emerald-700 font-bold uppercase">{s.usn}</span>
                          {s.email && <span className="truncate">• {s.email}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors shrink-0"
                        title="Delete Student"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* CA PROFILE DIALOG */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="bg-white border-slate-200 rounded-3xl p-6 max-w-md shadow-2xl">
          <DialogHeader className="text-center space-y-2 pb-2 border-b border-slate-100">
            <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 mx-auto mb-1 shadow-md border-slate-200" />
            <DialogTitle className="text-xl font-bold text-slate-900">
              Class Advisor Profile
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Institutional CA Credentials & Role Metadata
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-left">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
              <User className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="overflow-hidden">
                <p className="text-[10px] font-bold uppercase text-slate-400">Name</p>
                <p className="font-bold text-slate-900 text-sm truncate">
                  {caProfile?.name || auth.currentUser?.displayName || "Class Advisor"}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
              <Mail className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="overflow-hidden">
                <p className="text-[10px] font-bold uppercase text-slate-400">Gmail Address</p>
                <p className="font-medium text-slate-800 text-xs truncate">
                  {caProfile?.email || auth.currentUser?.email || "No Email"}
                </p>
              </div>
            </div>

            {caProfile?.class && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
                <BookOpen className="h-4 w-4 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Assigned Class Section</p>
                  <p className="font-semibold text-slate-900 text-xs">{caProfile.class}</p>
                </div>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <div>
                <p className="text-[10px] font-bold uppercase text-emerald-700">Authority Role</p>
                <p className="font-bold text-slate-900 text-xs">Class Advisor (CA)</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}