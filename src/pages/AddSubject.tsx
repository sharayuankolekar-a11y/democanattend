import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Loader2, Save } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { motion } from "framer-motion";
import { verifyFacultyAuthorization } from "@/lib/facultyAuth";
import { toast } from "@/components/ui/use-toast";

export default function AddSubject() {
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        navigate("/faculty-login", { replace: true });
        return;
      }

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
            state: { error: authResult.message },
          });
        }
        return;
      }

      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleAdd = async () => {
    if (!subject.trim()) {
      toast({
        variant: "destructive",
        title: "Subject Name Required",
        description: "Please enter a subject name to register.",
      });
      return;
    }

    try {
      setLoading(true);
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        toast({
          variant: "destructive",
          title: "Session Not Ready",
          description: "User authentication not ready. Please wait a moment and try again.",
        });
        return;
      }

      const email = user.email?.toLowerCase().trim();
      const newSub = subject.trim();

      // Find existing teacher records for this faculty to inherit department and metadata
      const qExisting = query(collection(db, "teachers"), where("email", "==", email));
      const existingSnap = await getDocs(qExisting);
      let facultyName = user.displayName || "Faculty Member";
      let deptId = "";
      let deptName = "";
      let deptCode = "";
      let designation = "Teaching Faculty";
      let isCA = false;

      if (!existingSnap.empty) {
        const first = existingSnap.docs[0].data();
        facultyName = first.name || facultyName;
        deptId = first.departmentId || "";
        deptName = first.department || "";
        deptCode = first.departmentCode || "";
        designation = first.designation || designation;
        isCA = existingSnap.docs.some((d) => d.data().isCA === true || d.data().role === "ca");
      }

      // 1. Add specific subject document
      await addDoc(collection(db, "teachers"), {
        email: email,
        name: facultyName,
        subject: newSub,
        subjects: [newSub],
        departmentId: deptId,
        department: deptName,
        departmentCode: deptCode,
        designation: designation,
        role: isCA ? "ca" : "faculty",
        status: "approved",
        createdAt: new Date().toISOString(),
      });

      // 2. Also append this subject to the subjects array on all existing documents for this email
      for (const d of existingSnap.docs) {
        const currentData = d.data();
        const existingSubjects: string[] = Array.isArray(currentData.subjects) ? currentData.subjects : [];
        if (!existingSubjects.some((s) => s.toLowerCase() === newSub.toLowerCase())) {
          await updateDoc(doc(db, "teachers", d.id), {
            subjects: [...existingSubjects, newSub],
          });
        }
      }

      toast({
        title: "Subject Added",
        description: `Successfully added ${newSub} to your teaching profile.`,
      });
      navigate("/faculty/subjects");

    } catch (error: unknown) {
      console.error("ERROR:", error);
      toast({
        variant: "destructive",
        title: "Addition Failed",
        description: (error as { message?: string })?.message || "Error adding subject. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Verifying Faculty Clearance...</h2>
          <p className="text-xs text-slate-500">Checking CA approval and active credentials.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex justify-start">
          <button
            onClick={() => navigate("/faculty/subjects")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Subjects</span>
          </button>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-900/5 text-left space-y-6"
        >
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Add New Subject
              </h1>
              <p className="text-xs text-slate-500">
                Register a new course subject to your teaching roster.
              </p>
            </div>

            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shrink-0">
              <BookOpen size={24} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 ml-1">
                Subject Title
              </label>
              <input
                type="text"
                placeholder="e.g. Java Programming, Data Structures, DDCO"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="w-full py-3.5 px-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-400"
              />
            </div>

            <button
              onClick={handleAdd}
              disabled={loading || !subject.trim()}
              className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-md mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Save Subject</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
}