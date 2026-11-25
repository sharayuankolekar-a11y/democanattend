import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { QRCodeCanvas } from "qrcode.react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Download, QrCode, ArrowLeft, Users, UserCheck, UserX, Square } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";

interface AdminAttendanceRow {
  id: string;
  name: string;
  email: string;
  time: string;
  status: "present" | "absent";
  coords: string;
}

const AdminDashboard = () => {
  const [students, setStudents] = useState<AdminAttendanceRow[]>([]);
  const [subject, setSubject] = useState("");
  const navigate = useNavigate();
  const [sessionActive, setSessionActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);

  const startSession = () => {
    if (!subject.trim()) {
      toast({
        variant: "destructive",
        title: "Subject Required",
        description: "Please enter a subject name before starting the attendance session.",
      });
      return;
    }
    setStudents([]);
    setSessionActive(true);
    setTimeLeft(30);
  };

  const handleExport = () => {
    if (students.length === 0) {
      toast({
        variant: "destructive",
        title: "No Records",
        description: "No student attendance logs available to export.",
      });
      return;
    }

    const csvRows = [["Name", "Email", "Subject", "Time", "Status"]];
    students.forEach((s) => {
      csvRows.push([s.name, s.email, subject, s.time, s.status]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map((row) => row.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${subject}_attendance.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const presentCount = students.filter((s) => s.status === "present").length;
  const absentCount = students.filter((s) => s.status === "absent").length;

  useEffect(() => {
    if (!subject) return;

    const q = query(
      collection(db, "attendance"),
      where("subject", "==", subject)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: AdminAttendanceRow[] = snapshot.docs.map((doc) => {
        const d = doc.data() as { name?: string; email?: string; time?: { toDate: () => Date }; status?: string };
        return {
          id: doc.id,
          name: d.name || "",
          email: d.email || "",
          time: d.time ? d.time.toDate().toLocaleTimeString() : "—",
          status: d.status === "Present" || d.status === "present" ? "present" : "absent",
          coords: "—"
        };
      });
      setStudents(data);
    });

    return () => unsubscribe();
  }, [subject]);

  useEffect(() => {
    if (!sessionActive || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setSessionActive(false);
          return 30;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionActive, timeLeft]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 text-left">
        <div className="flex justify-start">
          <button
            onClick={() => navigate("/admin-select")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Gateway</span>
          </button>
        </div>

        {/* Dashboard Header Banner */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <CollegeLogo size="md" showContainer containerClassName="w-12 h-12 shadow-sm border-slate-200 shrink-0" />
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Admin Terminal
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                {subject ? `Live Session • ${subject}` : "Select a subject to launch QR attendance tracking"}
              </p>
            </div>
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-900 hover:text-white text-slate-700 text-xs font-semibold transition-colors shadow-sm"
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Entries</span>
              <p className="text-3xl font-extrabold text-slate-900">{students.length}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Users size={22} />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Present</span>
              <p className="text-3xl font-extrabold text-emerald-600">{presentCount}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center">
              <UserCheck size={22} />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600">Absent</span>
              <p className="text-3xl font-extrabold text-rose-600">{absentCount}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
              <UserX size={22} />
            </div>
          </div>
        </div>

        {/* Main Grid: QR Panel & Student Roster */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* QR Generator Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-slate-900/5 space-y-6 text-center">
              <header className="space-y-1">
                <h2 className="text-xl font-bold text-slate-900">Initiate Session</h2>
                <p className="text-xs text-slate-500">Generate time-sensitive QR code</p>
              </header>

              {!sessionActive ? (
                <div className="space-y-4 pt-2">
                  <div className="w-24 h-24 mx-auto rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200">
                    <QrCode size={48} />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5 text-left">Subject Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Data Structures"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>

                  <button
                    onClick={startSession}
                    disabled={!subject}
                    className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Play size={16} fill="currentColor" />
                    <span>Start QR Terminal</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-slate-50 p-6 rounded-2xl border-2 border-emerald-500/30 inline-block shadow-inner">
                    <QRCodeCanvas
                      value={`subject:${subject}|expiry:${Date.now() + 30000}`}
                      size={200}
                      className="mx-auto"
                    />
                  </div>

                  <div className="space-y-3">
                    <p className="text-3xl font-extrabold text-slate-900">{timeLeft}s</p>
                    <p className="text-xs text-slate-500 font-medium">Verified Entries: <span className="font-bold text-emerald-600">{presentCount}</span></p>

                    <button
                      onClick={() => setSessionActive(false)}
                      className="w-full py-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <Square size={14} fill="currentColor" />
                      <span>Terminate Terminal</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Student Records Table */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Student Attendance Logs</h2>

            {students.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm">
                <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-slate-600 text-sm">System idling. No entry logs detected.</p>
              </div>
            ) : (
              <div className="bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-600">
                        <th className="p-4">Registrant</th>
                        <th className="p-4">Timestamp</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                      {students.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="p-4 font-bold text-slate-900">
                            <div>{s.name || "Student"}</div>
                            <div className="text-xs text-slate-400 font-normal">{s.email}</div>
                          </td>
                          <td className="p-4 font-medium text-slate-500">{s.time}</td>
                          <td className="p-4">
                            <StatusBadge status={s.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  );
};

export default AdminDashboard;
