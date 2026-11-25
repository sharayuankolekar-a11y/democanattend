import { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Plus, Trash2, ChevronRight, LogOut, Loader2, ShieldCheck } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { motion } from "framer-motion";
import { verifyFacultyAuthorization } from "@/lib/facultyAuth";
import { toast } from "@/components/ui/use-toast";

interface SubjectItem {
  id: string;
  subject: string;
  name?: string;
}

export default function FacultySubjects() {
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [facultyName, setFacultyName] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        navigate("/faculty-login", { replace: true });
        return;
      }

      // Verify faculty authorization
      const authResult = await verifyFacultyAuthorization(user.email);
      if (!authResult.isApproved) {
        await signOut(auth);
        if (authResult.isPending) {
          navigate("/faculty/pending-approval", {
            replace: true,
            state: { message: authResult.message, email: user.email },
          });
        } else {
          navigate("/faculty-login", { 
            replace: true, 
            state: { error: authResult.message } 
          });
        }
        return;
      }

      setFacultyName(authResult.data?.name || user.displayName || "Faculty Member");
      setCheckingAuth(false);

      // Fetch all subjects for this faculty member (including CAs who teach subjects)
      const email = user.email.toLowerCase().trim();
      const q = query(
        collection(db, "teachers"),
        where("email", "==", email)
      );

      const snapshot = await getDocs(q);
      const allSubjectNames = new Set<string>();
      const list: SubjectItem[] = [];

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const sub = (data.subject || "").trim();
        if (sub && sub.toLowerCase() !== "teaching faculty") {
          sub.split(/[,;/\n]+/).forEach((s: string) => {
            const clean = s.trim();
            if (clean && !allSubjectNames.has(clean.toLowerCase())) {
              allSubjectNames.add(clean.toLowerCase());
              list.push({ id: docSnap.id, ...data, subject: clean });
            }
          });
        }
        if (Array.isArray(data.subjects)) {
          data.subjects.forEach((s: unknown) => {
            if (typeof s === "string") {
              const clean = s.trim();
              if (clean && !allSubjectNames.has(clean.toLowerCase())) {
                allSubjectNames.add(clean.toLowerCase());
                list.push({ id: `${docSnap.id}_${clean}`, ...data, subject: clean });
              }
            }
          });
        }
      });

      setSubjects(list);
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/faculty-login");
    } catch (err) {
      console.error("Logout error:", err);
      navigate("/faculty-login");
    }
  };

  const handleClick = (subjectItem: SubjectItem | string) => {
    const subjectName = typeof subjectItem === "string" 
      ? subjectItem 
      : (subjectItem?.subject || subjectItem?.name || "");

    if (subjectName) {
      sessionStorage.setItem("selectedSubject", subjectName);
    }

    navigate(`/faculty/dashboard?subject=${encodeURIComponent(subjectName)}`);
  };

  // DELETE FUNCTION
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, "teachers", id));
      setSubjects((prev) => prev.filter((s) => s.id !== id));
      toast({
        title: "Subject Removed",
        description: "The course has been deleted from your assigned teaching list.",
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Deletion Failed",
        description: "Error deleting subject. Please try again.",
      });
    }
  };

  if (checkingAuth) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Verifying Faculty Clearance...</h2>
          <p className="text-xs text-slate-500">Checking CA approval and institutional credentials.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/admin-select")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Administrative Gateway</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/faculty/add-subject")}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={16} />
              <span>Add Subject</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold border border-slate-200 shadow-sm transition-colors"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm text-left space-y-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                <ShieldCheck size={13} className="text-emerald-600" />
                CA Approved Faculty
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {facultyName}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Select Teaching Subject
            </h1>
            <p className="text-sm text-slate-500">
              Choose the course subject for your current attendance session.
            </p>
          </div>

          {/* SUBJECT LIST */}
          <div className="space-y-3">
            {subjects.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <BookOpen className="w-10 h-10 mx-auto text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No subjects added yet.</p>
                <button
                  onClick={() => navigate("/faculty/add-subject")}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-emerald-600 transition-colors"
                >
                  + Add Your First Subject
                </button>
              </div>
            ) : (
              subjects.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => handleClick(s)}
                  className="group flex items-center justify-between p-4 sm:p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-emerald-50/40 hover:border-emerald-300 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm group-hover:bg-emerald-600 transition-colors">
                      <BookOpen className="w-5 h-5 text-emerald-400 group-hover:text-white" />
                    </div>
                    <span className="font-bold text-base text-slate-900 group-hover:text-emerald-800 transition-colors">
                      {s.subject}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleDelete(s.id, e)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete Subject"
                    >
                      <Trash2 size={18} />
                    </button>
                    <ChevronRight size={18} className="text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}