import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import {
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import {
  ArrowLeft,
  Calendar,
  Plus,
  Pencil,
  Trash2,
  Clock,
  User,
  MapPin,
  Check,
  X,
  BookOpen,
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";
import { verifyCAAuthorization } from "@/lib/caAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Fixed college day schedule (rows of the timetable grid), in order.
// "period" rows can hold subjects, "break" rows are display-only.
type ScheduleRow = { slot: string; type: "period" | "break"; label?: string };

const TIMETABLE_ROWS: ScheduleRow[] = [
  { slot: "09:00 AM – 10:00 AM", type: "period" },
  { slot: "10:00 AM – 11:00 AM", type: "period" },
  { slot: "11:00 AM – 11:20 AM", type: "break", label: "Short Break" },
  { slot: "11:20 AM – 12:20 PM", type: "period" },
  { slot: "12:20 PM – 01:15 PM", type: "period" },
  { slot: "01:15 PM – 02:10 PM", type: "break", label: "Lunch Break" },
  { slot: "02:10 PM – 03:00 PM", type: "period" },
  { slot: "03:00 PM – 03:45 PM", type: "period" },
  { slot: "03:45 PM – 04:35 PM", type: "period" },
];

// Only the period rows can have subjects
const DEFAULT_TIME_SLOTS = TIMETABLE_ROWS.filter((r) => r.type === "period").map(
  (r) => r.slot
);

// Helper to convert "HH:MM" (24h) to "hh:mm AM/PM" for display
const formatTime12h = (time24: string): string => {
  if (!time24) return "";
  if (time24.includes("AM") || time24.includes("PM")) return time24;
  const parts = time24.split(":");
  if (parts.length < 2) return time24;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return time24;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const formattedHours = hours.toString().padStart(2, "0");
  return `${formattedHours}:${minutes} ${ampm}`;
};

// Helper to convert "hh:mm AM/PM" or "HH:MM" to "HH:MM" for <input type="time" />
const formatTime24h = (timeStr: string): string => {
  if (!timeStr) return "09:00";
  if (!timeStr.includes("AM") && !timeStr.includes("PM")) return timeStr;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "09:00";
  const [, hoursStr, minutesStr, ampm] = match;
  let hours = parseInt(hoursStr, 10);
  if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
  if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, "0")}:${minutesStr}`;
};

interface Period {
  id: string;
  class: string;
  day: string;
  startTime: string;
  endTime: string;
  subject: string;
  faculty?: string;
  room?: string;
  caId?: string;
  createdAt?: unknown;
}

export default function CATimetable() {
  const navigate = useNavigate();
  const [assignedClass, setAssignedClass] = useState<string>("5th C");
  const [timetable, setTimetable] = useState<Period[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [caId, setCaId] = useState<string>("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);

  // Form state
  const [formDay, setFormDay] = useState<string>("Monday");
  const [formSubject, setFormSubject] = useState<string>("");
  const [formStartTime, setFormStartTime] = useState<string>("09:00");
  const [formEndTime, setFormEndTime] = useState<string>("10:00");
  const [formFaculty, setFormFaculty] = useState<string>("");
  const [formRoom, setFormRoom] = useState<string>("");
  const [formError, setFormError] = useState<string>("");

  // Fetch logged-in CA profile and resolve assigned class automatically
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user || !user.email) {
        navigate("/ca-login", { replace: true });
        return;
      }

      try {
        const verifyRes = await verifyCAAuthorization(user.email);
        if (verifyRes.isApproved && verifyRes.docId) {
          setCaId(verifyRes.docId);
          if (verifyRes.assignedClass) {
            setAssignedClass(verifyRes.assignedClass);
          } else if (verifyRes.shortClass) {
            setAssignedClass(verifyRes.shortClass);
          }
        } else {
          navigate("/ca-login", { 
            replace: true, 
            state: { error: verifyRes.message || "Account not authorized as Class Advisor." } 
          });
        }
      } catch (err) {
        console.error("Error fetching CA profile:", err);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // Fetch Timetable entries from Firestore automatically for assignedClass
  useEffect(() => {
    if (!assignedClass) {
      setTimetable([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, "timetable"),
      where("class", "==", assignedClass)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Period[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Period, "id">),
        }));

        // Sort chronologically by day order then start time
        list.sort((a, b) => {
          const dayA = DAYS_OF_WEEK.indexOf(a.day);
          const dayB = DAYS_OF_WEEK.indexOf(b.day);
          if (dayA !== dayB) return dayA - dayB;
          return formatTime24h(a.startTime).localeCompare(formatTime24h(b.startTime));
        });

        setTimetable(list);
        setLoading(false);
      },
      (error) => {
        console.error("Firestore timetable query error:", error);
        toast({
          title: "Error Loading Timetable",
          description: "Could not fetch timetable entries.",
          variant: "destructive",
        });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [assignedClass]);

  // The grid always shows ONLY the fixed college time slots
  const getTimeSlots = (): string[] => [...DEFAULT_TIME_SLOTS];

  const timeSlots = getTimeSlots();

  // Only periods that fall in a valid slot are shown/counted in the grid
  const visiblePeriods = timetable.filter((p) =>
    timeSlots.includes(`${p.startTime} – ${p.endTime}`)
  );

  // Open Dialog for Adding Period for default/header action
  const handleOpenAddDialog = () => {
    setEditingPeriod(null);
    setFormDay("Monday");
    setFormSubject("");
    setFormStartTime("09:00");
    setFormEndTime("10:00");
    setFormFaculty("");
    setFormRoom("");
    setFormError("");
    setDialogOpen(true);
  };

  // Open Dialog for Adding Period for a specific day
  const handleOpenAddForDay = (day: string) => {
    setEditingPeriod(null);
    setFormDay(day);
    setFormSubject("");
    setFormStartTime("09:00");
    setFormEndTime("10:00");
    setFormFaculty("");
    setFormRoom("");
    setFormError("");
    setDialogOpen(true);
  };

  // Open Dialog for Adding Period for specific cell (day + slot)
  const handleOpenAddForSlot = (day: string, slot: string) => {
    setEditingPeriod(null);
    setFormDay(day);
    const parts = slot.split("–");
    if (parts.length === 2) {
      setFormStartTime(formatTime24h(parts[0].trim()));
      setFormEndTime(formatTime24h(parts[1].trim()));
    } else {
      setFormStartTime("09:00");
      setFormEndTime("10:00");
    }
    setFormSubject("");
    setFormFaculty("");
    setFormRoom("");
    setFormError("");
    setDialogOpen(true);
  };

  // Open Dialog for Editing Period
  const handleOpenEditDialog = (period: Period) => {
    setEditingPeriod(period);
    setFormDay(period.day);
    setFormSubject(period.subject);
    setFormStartTime(formatTime24h(period.startTime));
    setFormEndTime(formatTime24h(period.endTime));
    setFormFaculty(period.faculty || "");
    setFormRoom(period.room || "");
    setFormError("");
    setDialogOpen(true);
  };

  // Save (Create or Update) Period with End Time > Start Time validation
  const handleSavePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubject.trim()) {
      setFormError("Subject name is required.");
      return;
    }
    if (!formStartTime.trim() || !formEndTime.trim()) {
      setFormError("Please select start and end times.");
      return;
    }
    if (formStartTime >= formEndTime) {
      setFormError("End time must be later than start time.");
      return;
    }

    const displayStartTime = formatTime12h(formStartTime.trim());
    const displayEndTime = formatTime12h(formEndTime.trim());

    if (!DEFAULT_TIME_SLOTS.includes(`${displayStartTime} – ${displayEndTime}`)) {
      setFormError(
        "Please use one of the fixed periods: " + DEFAULT_TIME_SLOTS.join(", ")
      );
      return;
    }

    try {

      const periodData = {
        class: assignedClass,
        day: formDay,
        subject: formSubject.trim(),
        startTime: displayStartTime,
        endTime: displayEndTime,
        faculty: formFaculty.trim() || null,
        room: formRoom.trim() || null,
        caId: caId || null,
        updatedAt: serverTimestamp(),
      };

      if (editingPeriod) {
        // Update existing period
        await updateDoc(doc(db, "timetable", editingPeriod.id), periodData);
        toast({
          title: "Period Updated",
          description: `${formSubject} on ${formDay} updated successfully.`,
        });
      } else {
        // Create new period
        await addDoc(collection(db, "timetable"), {
          ...periodData,
          createdAt: serverTimestamp(),
        });
        toast({
          title: "Period Added",
          description: `${formSubject} scheduled for ${formDay}.`,
        });
      }

      setDialogOpen(false);
    } catch (err: unknown) {
      console.error("Save Period Error:", err);
      setFormError((err as { message?: string })?.message || "Failed to save timetable period.");
    }
  };

  // Delete Period
  const handleDeletePeriod = async (id: string, subject: string) => {
    if (window.confirm(`Are you sure you want to delete the period "${subject}"?`)) {
      try {
        await deleteDoc(doc(db, "timetable", id));
        toast({
          title: "Period Deleted",
          description: `Removed "${subject}" from timetable.`,
        });
      } catch (err) {
        console.error("Delete error:", err);
        toast({
          title: "Delete Failed",
          description: "Could not delete period.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4 text-left px-2 sm:px-4">
        {/* Top Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/ca")}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 bg-slate-100 px-3.5 py-2 rounded-full border border-slate-200 transition-all shrink-0"
            >
              <ArrowLeft size={14} />
              <span>Back to CA Terminal</span>
            </button>

            <div className="space-y-0.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                <BookOpen size={12} />
                <span>Class {assignedClass}</span>
              </span>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-600" />
                Class Timetable — Class {assignedClass}
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Official weekly timetable for <span className="font-semibold text-slate-700">Class {assignedClass}</span> ({visiblePeriods.length} periods total)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CollegeLogo
              size="lg"
              showContainer
              containerClassName="w-12 h-12 shadow-xs border-slate-200 shrink-0 hidden sm:flex"
            />
            <button
              onClick={handleOpenAddDialog}
              className="flex items-center gap-2 bg-slate-900 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors shadow-xs shrink-0"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Add Period</span>
            </button>
          </div>
        </div>

        {/* FIXED WEEKLY TIMETABLE GRID MATRIX (NO HORIZONTAL SCROLLBAR) */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs w-full overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-2">
              <Clock className="w-6 h-6 animate-spin text-emerald-600" />
              <p className="text-xs font-semibold">Loading Weekly Timetable Grid...</p>
            </div>
          ) : (
            <div className="w-full rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full table-fixed text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-[11px] sm:text-xs font-bold uppercase tracking-wider border-b border-slate-800">
                    <th className="p-2 sm:p-3 text-center w-[14%] bg-slate-950 border-r border-slate-800">
                      Time Slot
                    </th>
                    {DAYS_OF_WEEK.map((day) => {
                      const count = visiblePeriods.filter((p) => p.day === day).length;
                      return (
                        <th
                          key={day}
                          onClick={() => handleOpenAddForDay(day)}
                          className="p-2 sm:p-3 text-center w-[14.33%] border-r border-slate-800 last:border-r-0 cursor-pointer hover:bg-emerald-800/90 transition-colors group"
                          title={`Click to add period for ${day}`}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="group-hover:text-emerald-300 transition-colors flex items-center gap-1 text-[11px] sm:text-xs font-bold">
                              <span>{day}</span>
                              <Plus size={11} className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400 shrink-0" />
                            </span>
                            <span className="text-[9px] sm:text-[10px] font-medium opacity-80 lowercase">
                              {count} periods
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {TIMETABLE_ROWS.map((row) => {
                    const slot = row.slot;

                    // Break rows (display only, no subjects)
                    if (row.type === "break") {
                      return (
                        <tr key={slot} className="bg-amber-50/70">
                          <td className="p-2 sm:p-3 bg-amber-50 font-extrabold text-[10px] sm:text-xs text-slate-800 text-center border-r border-slate-200/90 leading-tight">
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 text-slate-900">
                              <Clock size={12} className="text-amber-600 shrink-0 hidden sm:inline" />
                              <span>{slot}</span>
                            </div>
                          </td>
                          <td
                            colSpan={DAYS_OF_WEEK.length}
                            className="p-2 text-center text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.3em] text-amber-700"
                          >
                            {row.label}
                          </td>
                        </tr>
                      );
                    }

                    return (
                    <tr key={slot} className="hover:bg-slate-50/40 transition-colors">
                      {/* Time Slot Row Header */}
                      <td className="p-2 sm:p-3 bg-slate-50/90 font-extrabold text-[10px] sm:text-xs text-slate-800 text-center border-r border-slate-200/90 leading-tight">
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-1 text-slate-900">
                          <Clock size={12} className="text-emerald-600 shrink-0 hidden sm:inline" />
                          <span>{slot}</span>
                        </div>
                      </td>

                      {/* Day Columns (Monday to Saturday) */}
                      {DAYS_OF_WEEK.map((day) => {
                        const period = timetable.find(
                          (p) => p.day === day && `${p.startTime} – ${p.endTime}` === slot
                        );

                        return (
                          <td
                            key={`${day}-${slot}`}
                            className="p-1.5 sm:p-2 border-r border-slate-100 last:border-r-0 align-top"
                          >
                            {period ? (
                              <div className="p-2 rounded-xl bg-emerald-50/80 border border-emerald-200/90 hover:border-emerald-500 hover:shadow-xs transition-all flex flex-col justify-between space-y-1.5 h-full min-h-[75px] sm:min-h-[85px] relative group text-left">
                                <div className="flex items-start justify-between gap-1 overflow-hidden">
                                  <span className="font-extrabold text-[10px] sm:text-xs text-slate-900 bg-white px-1.5 sm:px-2 py-0.5 rounded-md border border-emerald-200 truncate max-w-full">
                                    {period.subject}
                                  </span>
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button
                                      onClick={() => handleOpenEditDialog(period)}
                                      className="p-1 text-slate-600 hover:text-emerald-700 hover:bg-white rounded-md transition-colors"
                                      title="Edit Period"
                                    >
                                      <Pencil size={11} />
                                    </button>
                                    <button
                                      onClick={() => handleDeletePeriod(period.id, period.subject)}
                                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded-md transition-colors"
                                      title="Delete Period"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </div>

                                <div className="space-y-0.5 text-[10px] text-slate-600 font-medium overflow-hidden">
                                  {period.faculty ? (
                                    <div className="flex items-center gap-1 text-slate-800 font-semibold truncate">
                                      <User size={10} className="text-slate-400 shrink-0" />
                                      <span className="truncate">{period.faculty}</span>
                                    </div>
                                  ) : (
                                    <div className="text-[9px] text-slate-400 italic">No faculty set</div>
                                  )}

                                  {period.room && (
                                    <div className="flex items-center gap-1 text-slate-700 text-[9px] truncate">
                                      <MapPin size={9} className="text-slate-400 shrink-0" />
                                      <span className="truncate">{period.room}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={() => handleOpenAddForSlot(day, slot)}
                                className="h-full min-h-[75px] sm:min-h-[85px] rounded-xl border border-dashed border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 flex items-center justify-center transition-all cursor-pointer group p-1 text-center"
                                title={`Add period for ${day} (${slot})`}
                              >
                                <span className="text-[11px] font-medium text-slate-300 group-hover:text-emerald-700 transition-colors flex items-center gap-1">
                                  <Plus size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600 shrink-0" />
                                  <span className="group-hover:inline hidden font-semibold">Add</span>
                                  <span className="group-hover:hidden">—</span>
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ADD / EDIT PERIOD DIALOG WITH NATIVE TIME PICKERS */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white border-slate-200 rounded-3xl p-6 max-w-lg shadow-2xl text-left">
          <DialogHeader className="space-y-1 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                <Calendar size={18} className="text-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {editingPeriod ? "Edit Timetable Period" : "Add Timetable Period"}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Scheduling for <span className="font-bold text-slate-900">{formDay}</span> — Class {assignedClass}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSavePeriod} className="space-y-4 pt-2">
            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <X size={14} className="shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            {/* Read-Only Target Indicator Banner */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <Calendar size={14} className="text-emerald-600" />
                <span>Scheduling for {formDay}</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-extrabold uppercase border border-emerald-200">
                Class {assignedClass}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Subject Name */}
              <div className="col-span-2">
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">
                  Subject Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Java / DBMS / Operating Systems"
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              {/* Native Start Time Picker */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">
                  Start Time *
                </label>
                <input
                  type="time"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                  required
                />
              </div>

              {/* Native End Time Picker */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">
                  End Time *
                </label>
                <input
                  type="time"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                  required
                />
              </div>

              {/* Faculty Name (Optional) */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">
                  Faculty Member (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Faculty Member"
                  value={formFaculty}
                  onChange={(e) => setFormFaculty(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Classroom Number (Optional) */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1 ml-0.5">
                  Classroom / Lab (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. LH-201 / Lab 3"
                  value={formRoom}
                  onChange={(e) => setFormRoom(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-md flex items-center gap-1.5"
              >
                <Check size={14} />
                <span>{editingPeriod ? "Save Changes" : "Schedule Period"}</span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}