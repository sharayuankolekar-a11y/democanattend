import { useEffect, useState, useMemo } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  getDocs, 
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
  Trash2, 
  LogOut,
  Crown,
  ShieldCheck,
  Building2,
  BookOpen,
  Phone,
  Search,
  AlertTriangle,
  LayoutDashboard,
  RotateCcw,
  UserCheck,
  ArrowRight
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
import { revokeClassAdvisorAppointment, CAAppointmentRecord } from "@/lib/caAuth";

interface StaffMember {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  designation?: string;
  class?: string;
  subject?: string;
  subjects?: string[];
  subjectSpecialization?: string;
  phone?: string;
  contactNumber?: string;
  status?: string;
  uid?: string;
  isCA?: boolean;
  caClass?: string;
  caShortClass?: string;
  caAppointmentId?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface GroupedStaffMember {
  id: string; // Primary Firestore doc ID in 'teachers'
  allDocIds: string[]; // All Firestore document IDs belonging to this faculty
  name: string;
  email: string;
  role?: string;
  department?: string;
  designation?: string;
  phone?: string;
  contactNumber?: string;
  status?: string;
  uid?: string;
  subjects: string[]; // List of all assigned subjects
  isCA?: boolean;
  caClass?: string;
  class?: string;
  caClassDisplay?: string;
  activeAppointment?: CAAppointmentRecord;
  hasCAAppointment: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export default function HODStaffDirectory() {
  const navigate = useNavigate();

  // Authentication & Verification state
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentHOD, setCurrentHOD] = useState<Record<string, string | undefined> | null>(null);

  // Data states
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>([]);
  const [activeAppointments, setActiveAppointments] = useState<CAAppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "ca" | "faculty">("all");

  // In-app Dismissal confirmation dialog state
  const [dismissTarget, setDismissTarget] = useState<GroupedStaffMember | null>(null);
  const [isDismissDialogOpen, setIsDismissDialogOpen] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  // In-app Remove CA Appointment dialog state
  const [removeCATarget, setRemoveCATarget] = useState<{ staff: GroupedStaffMember; appointment?: CAAppointmentRecord } | null>(null);
  const [isRemoveCADialogOpen, setIsRemoveCADialogOpen] = useState(false);
  const [isRemovingCA, setIsRemovingCA] = useState(false);

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
  // REAL-TIME FIRESTORE LISTENER FOR APPROVED STAFF & CA APPOINTMENTS (SCOPED TO HOD'S DEPARTMENT)
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

    // 1. Staff directory listener for this department
    const teachersUnsub = onSnapshot(
      collection(db, "teachers"),
      (snapshot) => {
        const users = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as StaffMember[];

        // Filter to approved institutional staff of this department (excluding pure HODs and dismissed/revoked staff)
        const staff = users.filter((u) => {
          if (!matchesDept(u)) return false;
          const role = (u.role || "").toLowerCase().trim();
          const status = (u.status || "").toLowerCase().trim();
          const isStaffRole = role === "ca" || role === "faculty" || role === "class advisor" || u.isCA === true;
          const isExcluded = status === "rejected" || status === "revoked" || status === "dismissed" || status === "pending";
          return isStaffRole && !isExcluded;
        });

        setStaffDirectory(staff);
        setLoading(false);
      },
      (error) => {
        console.error("Error listening to staff directory:", error);
        setLoading(false);
      }
    );

    // 2. Active CA appointments listener for this department
    const apptsUnsub = onSnapshot(
      collection(db, "ca_appointments"),
      (snapshot) => {
        const all = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CAAppointmentRecord[];
        const active = all.filter((a) => matchesDept(a) && a.status === "active");
        setActiveAppointments(active);
      },
      (error) => {
        console.error("Error listening to appointments:", error);
      }
    );

    return () => {
      teachersUnsub();
      apptsUnsub();
    };
  }, [checkingAuth, currentHOD]);

  // =========================================================================
  // DISMISS STAFF MEMBER LOGIC
  // =========================================================================
  const openDismissDialog = (staff: GroupedStaffMember) => {
    setDismissTarget(staff);
    setIsDismissDialogOpen(true);
  };

  const handleConfirmDismissal = async () => {
    if (!dismissTarget) return;

    try {
      setIsDismissing(true);
      const staffEmail = (dismissTarget.email || "").toLowerCase().trim();

      // 1. Remove all documents in teachers collection belonging to this faculty member
      const docIdsToDelete = Array.from(new Set([...dismissTarget.allDocIds, dismissTarget.id]));
      for (const docId of docIdsToDelete) {
        try {
          await deleteDoc(doc(db, "teachers", docId));
        } catch (e) {
          console.error(`Error deleting teacher doc ${docId}:`, e);
        }
      }

      // 2. Revoke associated faculty requests in faculty_requests
      if (staffEmail) {
        const qFacultyReq = query(
          collection(db, "faculty_requests"),
          where("email", "==", staffEmail)
        );
        const snapFacultyReq = await getDocs(qFacultyReq);
        for (const d of snapFacultyReq.docs) {
          await updateDoc(doc(db, "faculty_requests", d.id), {
            status: "rejected",
            dismissedBy: currentHOD?.email || "HOD",
            dismissedAt: new Date().toISOString(),
          });
        }
      }

      // 3. Revoke any active CA appointments
      const apptsToRevoke = activeAppointments.filter(
        (a) =>
          docIdsToDelete.includes(a.facultyDocId) ||
          (a.facultyEmail && a.facultyEmail.toLowerCase() === staffEmail)
      );

      for (const appt of apptsToRevoke) {
        if (appt.id) {
          await updateDoc(doc(db, "ca_appointments", appt.id), {
            status: "revoked",
            revokedAt: new Date().toISOString(),
            revokedByHOD: currentHOD?.email || "HOD",
          });
        }
      }

      // Query fallback for any other active appointments by email
      if (staffEmail) {
        const qApptEmail = query(
          collection(db, "ca_appointments"),
          where("facultyEmail", "==", staffEmail),
          where("status", "==", "active")
        );
        const snapApptEmail = await getDocs(qApptEmail);
        for (const d of snapApptEmail.docs) {
          await updateDoc(doc(db, "ca_appointments", d.id), {
            status: "revoked",
            revokedAt: new Date().toISOString(),
            revokedByHOD: currentHOD?.email || "HOD",
          });
        }
      }

      toast({
        title: "Staff Member Dismissed",
        description: `${dismissTarget.name} has been removed and institutional access revoked. Historical attendance records remain preserved.`,
      });

      setIsDismissDialogOpen(false);
      setDismissTarget(null);
    } catch (error) {
      console.error("Staff dismissal error:", error);
      toast({
        title: "Dismissal Failed",
        description: "Failed to dismiss staff member. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDismissing(false);
    }
  };

  // =========================================================================
  // REMOVE / REVOKE CA APPOINTMENT LOGIC
  // =========================================================================
  const openRemoveCADialog = (staff: GroupedStaffMember, appointment?: CAAppointmentRecord) => {
    setRemoveCATarget({ staff, appointment });
    setIsRemoveCADialogOpen(true);
  };

  const handleConfirmRemoveCA = async () => {
    if (!removeCATarget) return;

    try {
      setIsRemovingCA(true);
      const { staff, appointment } = removeCATarget;

      if (appointment?.id) {
        await revokeClassAdvisorAppointment({
          appointmentId: appointment.id,
          facultyDocId: staff.id,
          hodEmail: currentHOD?.email || "hod@college.edu",
        });
      }

      // Clear CA flags across all teachers documents for this faculty member
      const docIdsToUpdate = Array.from(new Set([...staff.allDocIds, staff.id]));
      for (const docId of docIdsToUpdate) {
        try {
          await updateDoc(doc(db, "teachers", docId), {
            isCA: false,
            caClass: null,
            caSemester: null,
            caSection: null,
            caShortClass: null,
            caAppointmentId: null,
            role: "faculty",
          });
        } catch (e) {
          console.error(`Error resetting CA fields on teacher doc ${docId}:`, e);
        }
      }

      toast({
        title: "CA Appointment Revoked",
        description: `${staff.name} is no longer Class Advisor for this section. Their faculty account remains active.`,
      });

      setIsRemoveCADialogOpen(false);
      setRemoveCATarget(null);
    } catch (error) {
      console.error("Error revoking CA appointment:", error);
      toast({
        title: "Revocation Failed",
        description: "Failed to revoke Class Advisor appointment.",
        variant: "destructive",
      });
    } finally {
      setIsRemovingCA(false);
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

  // =========================================================================
  // GROUPING LOGIC: Consolidate faculty by verified email & collect subjects
  // =========================================================================
  const groupedStaff: GroupedStaffMember[] = useMemo(() => {
    const groupsMap = new Map<string, { docs: StaffMember[]; primaryDoc: StaffMember }>();

    for (const member of staffDirectory) {
      const emailKey = (member.email || "").toLowerCase().trim();
      const groupKey = emailKey || member.id;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { docs: [member], primaryDoc: member });
      } else {
        const group = groupsMap.get(groupKey)!;
        group.docs.push(member);
        // Prefer primaryDoc with CA appointment or richer metadata
        if (!group.primaryDoc.isCA && member.isCA) {
          group.primaryDoc = member;
        } else if (!group.primaryDoc.designation && member.designation) {
          group.primaryDoc = member;
        } else if (!group.primaryDoc.department && member.department) {
          group.primaryDoc = member;
        }
      }
    }

    const result: GroupedStaffMember[] = [];

    for (const [, { docs, primaryDoc }] of groupsMap.entries()) {
      const allDocIds = docs.map((d) => d.id);
      const email = (primaryDoc.email || "").toLowerCase().trim();

      // Collect all assigned subjects across all documents of this faculty (handling arrays, single subjects, and delimited strings)
      const subjectsSet = new Set<string>();
      docs.forEach((docItem) => {
        if (docItem.subject && typeof docItem.subject === "string") {
          const trimmed = docItem.subject.trim();
          if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
            trimmed.split(/[,;/\n]+/).forEach((part) => {
              const clean = part.trim();
              if (clean && clean.toLowerCase() !== "teaching faculty") {
                subjectsSet.add(clean);
              }
            });
          }
        }
        if (Array.isArray(docItem.subjects)) {
          docItem.subjects.forEach((s) => {
            if (s && typeof s === "string") {
              const trimmed = s.trim();
              if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
                trimmed.split(/[,;/\n]+/).forEach((part) => {
                  const clean = part.trim();
                  if (clean && clean.toLowerCase() !== "teaching faculty") {
                    subjectsSet.add(clean);
                  }
                });
              }
            }
          });
        }
        if (docItem.subjectSpecialization && typeof docItem.subjectSpecialization === "string") {
          const trimmed = docItem.subjectSpecialization.trim();
          if (trimmed && trimmed.toLowerCase() !== "teaching faculty") {
            trimmed.split(/[,;/\n]+/).forEach((part) => {
              const clean = part.trim();
              if (clean && clean.toLowerCase() !== "teaching faculty") {
                subjectsSet.add(clean);
              }
            });
          }
        }
      });

      // Deduplicate case-insensitively while preserving natural casing
      const allSubjects: string[] = [];
      const seenSubjectLower = new Set<string>();
      for (const sub of Array.from(subjectsSet)) {
        const lower = sub.toLowerCase();
        if (!seenSubjectLower.has(lower)) {
          seenSubjectLower.add(lower);
          allSubjects.push(sub);
        }
      }

      // Match active CA appointment
      const appt = activeAppointments.find(
        (a) =>
          allDocIds.includes(a.facultyDocId) ||
          (a.facultyEmail && a.facultyEmail.toLowerCase() === email)
      );

      const hasCAAppointment =
        !!appt ||
        docs.some((d) => d.isCA === true || (d.role || "").toLowerCase() === "ca");

      const docWithClass = docs.find((d) => d.caShortClass || d.caClass || d.class);
      const caClassDisplay =
        appt?.shortClass ||
        appt?.class ||
        docWithClass?.caShortClass ||
        docWithClass?.caClass ||
        docWithClass?.class;

      // Extract phone / contact number
      const phone =
        docs.find((d) => d.phone && d.phone.trim() !== "")?.phone ||
        docs.find((d) => d.contactNumber && d.contactNumber.trim() !== "")?.contactNumber ||
        primaryDoc.phone ||
        primaryDoc.contactNumber;

      // Extract best designation
      const designation =
        docs.find((d) => d.designation && d.designation.trim() !== "")?.designation ||
        primaryDoc.designation ||
        "Faculty Member";

      // Extract best department
      const department =
        docs.find((d) => d.department && d.department.trim() !== "")?.department ||
        primaryDoc.department;

      // Extract best name
      const name =
        docs.find((d) => d.name && d.name.trim() !== "")?.name ||
        primaryDoc.name ||
        "Faculty Member";

      result.push({
        id: primaryDoc.id,
        allDocIds,
        name,
        email: primaryDoc.email || "",
        role: hasCAAppointment ? "ca" : "faculty",
        department,
        designation,
        phone,
        contactNumber: phone,
        status: primaryDoc.status || "approved",
        uid: docs.find((d) => d.uid)?.uid || primaryDoc.uid,
        subjects: allSubjects,
        isCA: hasCAAppointment,
        caClassDisplay,
        activeAppointment: appt,
        hasCAAppointment,
        approvedBy: primaryDoc.approvedBy,
        approvedAt: primaryDoc.approvedAt,
      });
    }

    // Sort alphabetically by name
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [staffDirectory, activeAppointments]);

  // Filtered staff based on search and role
  const filteredStaff = useMemo(() => {
    return groupedStaff.filter((member) => {
      // Role filter
      if (roleFilter === "ca" && !member.hasCAAppointment) return false;
      if (roleFilter === "faculty" && member.hasCAAppointment) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const name = (member.name || "").toLowerCase();
        const email = (member.email || "").toLowerCase();
        const department = (member.department || "").toLowerCase();
        const designation = (member.designation || "").toLowerCase();
        const assignedClass = (member.caClassDisplay || "").toLowerCase();
        const matchesSubject = member.subjects.some((sub) => sub.toLowerCase().includes(query));

        return (
          name.includes(query) ||
          email.includes(query) ||
          department.includes(query) ||
          designation.includes(query) ||
          assignedClass.includes(query) ||
          matchesSubject
        );
      }

      return true;
    });
  }, [groupedStaff, roleFilter, searchQuery]);

  const totalCAs = groupedStaff.filter((s) => s.hasCAAppointment).length;
  const totalFacultyOnly = groupedStaff.filter((s) => !s.hasCAAppointment).length;

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
              onClick={() => navigate("/hod/ca-appointments")} 
              className="hidden sm:flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-3.5 py-2 rounded-full border border-emerald-200 shadow-sm transition-all"
            >
              <GraduationCap size={14} />
              <span>CA Appointment Control</span>
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
              <Users className="w-7 h-7 text-indigo-600" />
              Institutional Staff Directory
            </h1>
            
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Official institutional roster of validated Faculty Members and Class Advisor appointments. Manage designations, departmental assignments, and active CA class allocations.
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

        {/* Search & Filter Toolbar */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff by name, email, department, class (e.g. 5th C)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>

            {/* Role Filter Pills */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs">
              <button
                onClick={() => setRoleFilter("all")}
                className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                  roleFilter === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All Staff ({groupedStaff.length})
              </button>
              <button
                onClick={() => setRoleFilter("ca")}
                className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                  roleFilter === "ca" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Active CAs ({totalCAs})
              </button>
              <button
                onClick={() => setRoleFilter("faculty")}
                className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
                  roleFilter === "faculty" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Faculty Only ({totalFacultyOnly})
              </button>
            </div>

          </div>

          <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>
              Showing <strong className="text-slate-900">{filteredStaff.length}</strong> of <strong className="text-slate-900">{groupedStaff.length}</strong> staff members
            </span>
            <button
              onClick={() => navigate("/hod/ca-appointments")}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
            >
              <span>Manage CA Appointments</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Staff Directory Cards Grid */}
        {loading ? (
          <div className="flex justify-center p-12 bg-white rounded-3xl border border-slate-200">
            <div className="flex items-center gap-3 text-slate-500 font-medium text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span>Loading Staff Directory...</span>
            </div>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Users className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">No Staff Members Found</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              {searchQuery 
                ? "No institutional staff matched your search query. Try searching with different keywords." 
                : "No staff members are registered under this category."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredStaff.map((staff) => {
              const isCA = staff.hasCAAppointment;

              return (
                <div
                  key={staff.id}
                  className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between gap-5 hover:border-slate-300 hover:shadow-md transition-all"
                >
                  <div className="space-y-3.5">
                    {/* Header: Avatar, Name, Email, Role and CA Indicator */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-base text-white shrink-0 ${
                          isCA ? "bg-emerald-600 shadow-emerald-200" : "bg-indigo-600 shadow-indigo-200"
                        }`}>
                          {staff.name?.charAt(0) || "S"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-base text-slate-900 truncate">{staff.name}</h4>
                          <p className="text-xs text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
                            <Mail size={13} className="text-slate-400 shrink-0" />
                            <span className="truncate">{staff.email}</span>
                          </p>
                        </div>
                      </div>

                      {/* CLEAR CA APPOINTMENT INDICATOR AS REQUESTED */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          Faculty
                        </span>
                        {isCA ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 shadow-xs">
                            <GraduationCap size={12} className="text-emerald-700" />
                            <span>CA of {staff.caClassDisplay}</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-400 border border-slate-200">
                            Not Assigned
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {staff.department && (
                        <span className="font-semibold text-slate-700 bg-slate-50 px-3 py-1 rounded-xl border border-slate-200 flex items-center gap-1.5">
                          <Building2 size={13} className="text-slate-400" />
                          <span>{staff.department}</span>
                        </span>
                      )}

                      <span className="font-semibold text-indigo-800 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-200 flex items-center gap-1.5">
                        <BookOpen size={13} className="text-indigo-500" />
                        <span>{staff.designation || "Teaching Faculty"}</span>
                      </span>

                      {(staff.phone || staff.contactNumber) && (
                        <span className="text-slate-600 bg-slate-50 px-3 py-1 rounded-xl border border-slate-200 flex items-center gap-1.5">
                          <Phone size={12} className="text-slate-400" />
                          <span>{staff.phone || staff.contactNumber}</span>
                        </span>
                      )}
                    </div>

                    {/* Assigned Subjects Badges/Chips */}
                    <div className="pt-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold mb-1.5">
                        <BookOpen size={12} className="text-indigo-500" />
                        <span>Assigned Subjects:</span>
                      </div>
                      {staff.subjects && staff.subjects.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {staff.subjects.map((sub, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200/90 shadow-2xs"
                            >
                              {sub}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No specific subjects assigned</span>
                      )}
                    </div>
                  </div>

                  {/* Actions: Change / Remove CA Appointment and Dismiss Staff */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3.5 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      {isCA ? (
                        <>
                          <button
                            onClick={() => navigate(`/hod/ca-appointments?facultyId=${staff.id}`)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-colors flex items-center gap-1"
                            title="Change assigned class section"
                          >
                            <RotateCcw size={12} />
                            <span>Change CA</span>
                          </button>
                          <button
                            onClick={() => openRemoveCADialog(staff, staff.activeAppointment)}
                            className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-xs font-semibold transition-colors"
                            title="Remove Class Advisor appointment"
                          >
                            <span>Remove CA</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => navigate(`/hod/ca-appointments?facultyId=${staff.id}`)}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold transition-colors flex items-center gap-1 shadow-xs"
                          title="Appoint as Class Advisor"
                        >
                          <UserCheck size={12} />
                          <span>Appoint as CA</span>
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => openDismissDialog(staff)}
                      className="px-3 py-1.5 text-rose-600 hover:text-white bg-white hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs"
                    >
                      <Trash2 size={13} />
                      <span>Dismiss Staff</span>
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* IN-APP CONFIRMATION DIALOG FOR STAFF DISMISSAL */}
      {/* ========================================================================= */}
      <Dialog open={isDismissDialogOpen} onOpenChange={setIsDismissDialogOpen}>
        <DialogContent className="max-w-md bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-xl space-y-4">
          <DialogHeader className="space-y-2 text-left">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Confirm Staff Member Dismissal
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to dismiss this staff member from the institutional roster?
            </DialogDescription>
          </DialogHeader>

          {dismissTarget && (
            <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-2 text-xs">
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Staff Name:</span>
                <span className="font-bold text-slate-900">{dismissTarget.name}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Gmail Address:</span>
                <span className="font-semibold text-slate-800">{dismissTarget.email}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Department:</span>
                <span className="font-semibold text-slate-800">
                  {dismissTarget.department || "Academic Department"}
                </span>
              </div>
              {dismissTarget.subjects && dismissTarget.subjects.length > 0 && (
                <div className="flex justify-between items-start pt-1 border-t border-rose-100">
                  <span className="text-slate-500 font-medium">Assigned Subjects:</span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[220px]">
                    {dismissTarget.subjects.map((sub, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800"
                      >
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Access Revocation Notice:</p>
            <p>
              Dismissal will revoke this staff member's institutional login and dashboard authorization immediately. 
              Historical student attendance logs and class timetables will remain fully preserved in Firestore.
            </p>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              disabled={isDismissing}
              onClick={() => {
                setIsDismissDialogOpen(false);
                setDismissTarget(null);
              }}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isDismissing}
              onClick={handleConfirmDismissal}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isDismissing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Revoking Access...</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Confirm Dismissal</span>
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* IN-APP CONFIRMATION DIALOG FOR REMOVING CA APPOINTMENT */}
      {/* ========================================================================= */}
      <Dialog open={isRemoveCADialogOpen} onOpenChange={setIsRemoveCADialogOpen}>
        <DialogContent className="max-w-md bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-xl space-y-4">
          <DialogHeader className="space-y-2 text-left">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Remove Class Advisor Appointment
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to remove the Class Advisor appointment for this faculty member?
            </DialogDescription>
          </DialogHeader>

          {removeCATarget && (
            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100 space-y-2 text-xs">
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Faculty Member:</span>
                <span className="font-bold text-slate-900">{removeCATarget.staff.name}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Gmail Address:</span>
                <span className="font-semibold text-slate-800">{removeCATarget.staff.email}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 font-medium">Current CA Class:</span>
                <span className="font-bold text-emerald-800">
                  {removeCATarget.staff.caClass || removeCATarget.appointment?.class || removeCATarget.staff.class || "Assigned Class"}
                </span>
              </div>
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Faculty Role Retention Notice:</p>
            <p>
              Removing this appointment revokes their CA Dashboard access for this class. 
              <strong> Their institutional faculty account will remain completely active</strong> and they can continue conducting teaching sessions and launching QR codes.
            </p>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              disabled={isRemovingCA}
              onClick={() => {
                setIsRemoveCADialogOpen(false);
                setRemoveCATarget(null);
              }}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isRemovingCA}
              onClick={handleConfirmRemoveCA}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isRemovingCA ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Removing Appointment...</span>
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
