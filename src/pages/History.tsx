import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, 
  Calendar, 
  Award, 
  CheckCircle2, 
  XCircle, 
  Clock3, 
  BookOpen, 
  Clock, 
  User, 
  MapPin, 
  TrendingUp,
  BarChart2
} from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { motion } from "framer-motion";

import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import {
  StudentSession,
  getStoredStudentSession,
  clearStoredStudentSession,
  validateStudentSession,
  verifyStudentLoginApproval,
} from "@/lib/studentAuth";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Helper to parse time string ("09:00", "09:00 AM", "14:10", "02:10 PM") to Date object on targetDate
const parseTimeToDate = (timeStr: string, targetDate: Date = new Date()): Date => {
  const d = new Date(targetDate);
  if (!timeStr) return d;

  let hours = 9;
  let minutes = 0;

  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (ampmMatch) {
    hours = parseInt(ampmMatch[1], 10);
    minutes = parseInt(ampmMatch[2], 10);
    const ampm = ampmMatch[3]?.toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  } else {
    const parts = timeStr.split(":");
    if (parts.length >= 2) {
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    }
  }

  d.setHours(hours, minutes, 0, 0);
  return d;
};

// Helper to format time for display (12h format)
const formatTime12h = (timeStr: string): string => {
  if (!timeStr) return "";
  if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
};

export interface EvaluatedHistoryRecord {
  id: string;
  day: string;
  subject: string;
  startTime: string;
  endTime: string;
  faculty?: string;
  room?: string;
  status: "PRESENT" | "ABSENT" | "UPCOMING";
  dateStr: string;
  dateObj: Date;
  periodStart: Date;
  periodEnd: Date;
}

interface TimetablePeriod {
  id: string;
  day?: string;
  subject?: string;
  startTime?: string;
  endTime?: string;
  faculty?: string;
  room?: string;
  caId?: string;
  sessionId?: number;
}

interface AttendanceHistoryRow {
  id: string;
  status?: string;
  subject?: string;
  caId?: string;
  sessionId?: number;
  time?: { toDate?: () => Date; seconds?: number } | string | Date;
}

const History = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [timetable, setTimetable] = useState<TimetablePeriod[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState<string>("Monday");

  useEffect(() => {
    let isMounted = true;
    const currentSession = getStoredStudentSession();
    const validation = validateStudentSession(currentSession, "History");

    if (!validation.isValid || !currentSession) {
      clearStoredStudentSession();
      navigate("/student-login", {
        replace: true,
        state: { error: validation.reason || "MyTrack access requires an approved login session from your Class Advisor. Please log in." },
      });
      return;
    }
    setSession(currentSession);

    // Verify student doc in Firestore in real-time
    const studentRef = doc(db, "students", currentSession.id);
    const unsubStudent = onSnapshot(
      studentRef,
      (docSnap) => {
        if (!isMounted) return;
        if (!docSnap.exists()) {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your student record was deleted by your Class Advisor. Please contact your CA." },
          });
          return;
        }
        const data = docSnap.data();
        const status = (data.status || "").toLowerCase().trim();
        if (status === "pending" || status === "rejected") {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your student registration is no longer active. Please contact your Class Advisor." },
          });
          return;
        }
      },
      (error) => {
        console.error("History student onSnapshot error:", error);
      }
    );

    // Real-time listener for login approval revocation
    const unsubRequest = onSnapshot(
      doc(db, "student_login_requests", currentSession.loginRequestId!),
      (reqSnap) => {
        if (!isMounted) return;
        if (!reqSnap.exists() || reqSnap.data().status !== "approved") {
          clearStoredStudentSession();
          navigate("/student-login", {
            replace: true,
            state: { error: "Your login approval has ended or was revoked by your Class Advisor." },
          });
        }
      },
      (err) => console.warn("History login request listener error:", err)
    );

    // Set today's day automatically
    const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
    if (DAYS_OF_WEEK.includes(todayName)) {
      setActiveDay(todayName);
    }

    return () => {
      isMounted = false;
      unsubStudent();
      unsubRequest();
    };
  }, [navigate]);

  // Real-time Timetable Listener
  useEffect(() => {
    if (!session || !session.class) return;

    const qTimetable = query(
      collection(db, "timetable"),
      where("class", "==", session.class)
    );

    const unsubTimetable = onSnapshot(qTimetable, (snapshot) => {
      const list = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      // Sort chronologically by day & start time
      list.sort((a: TimetablePeriod, b: TimetablePeriod) => {
        const dayA = DAYS_OF_WEEK.indexOf(a.day || "");
        const dayB = DAYS_OF_WEEK.indexOf(b.day || "");
        if (dayA !== dayB) return dayA - dayB;
        return (a.startTime || "").localeCompare(b.startTime || "");
      });

      setTimetable(list);
    });

    return () => unsubTimetable();
  }, [session?.class]);

  // Real-time Attendance Listener
  useEffect(() => {
    if (!session || !session.usn) return;

    const qAttendance = query(
      collection(db, "attendance"),
      where("usn", "==", session.usn)
    );

    const unsubAttendance = onSnapshot(qAttendance, (snapshot) => {
      const records = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setAttendanceRecords(records);
    });

    return () => unsubAttendance();
  }, [session?.usn]);

  // Helper: Evaluate status for a period on a date
  const evaluatePeriod = (period: TimetablePeriod, targetDate: Date): EvaluatedHistoryRecord => {
    const periodStart = parseTimeToDate(period.startTime, targetDate);
    const periodEnd = parseTimeToDate(period.endTime, targetDate);
    const now = new Date();

    const dateStr = targetDate.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const isScanned = attendanceRecords.some((att) => {
      const statusLower = (att.status || "").toLowerCase();
      if (statusLower !== "present") return false;

      let attDate: Date | null = null;
      const t = att.time;
      if (t && typeof t === "object" && "toDate" in t && typeof t.toDate === "function") {
        attDate = t.toDate();
      } else if (t && typeof t === "object" && "seconds" in t && typeof t.seconds === "number") {
        attDate = new Date(t.seconds * 1000);
      } else if (t) {
        attDate = new Date(t as string | Date);
      }

      if (!attDate || isNaN(attDate.getTime())) return false;

      const sameDay =
        attDate.getFullYear() === targetDate.getFullYear() &&
        attDate.getMonth() === targetDate.getMonth() &&
        attDate.getDate() === targetDate.getDate();

      if (!sameDay) return false;

      const subjMatch =
        att.subject &&
        period.subject &&
        att.subject.trim().toLowerCase() === period.subject.trim().toLowerCase();

      const caMatch = att.caId && period.caId && att.caId === period.caId;
      const sessionMatch = att.sessionId && period.sessionId && att.sessionId === period.sessionId;

      const timeDiff = Math.abs(attDate.getTime() - periodStart.getTime());
      const withinWindow = timeDiff <= 4 * 60 * 60 * 1000;

      return subjMatch || caMatch || sessionMatch || (sameDay && withinWindow);
    });

    let status: "PRESENT" | "ABSENT" | "UPCOMING" = "UPCOMING";

    if (isScanned) {
      status = "PRESENT";
    } else if (now.getTime() > periodEnd.getTime()) {
      status = "ABSENT";
    } else {
      status = "UPCOMING";
    }

    return {
      id: `${period.id || period.subject}-${targetDate.toISOString().slice(0, 10)}`,
      day: period.day,
      subject: period.subject || "Subject",
      startTime: period.startTime || "09:00",
      endTime: period.endTime || "10:00",
      faculty: period.faculty || "",
      room: period.room || "",
      status,
      dateStr,
      dateObj: targetDate,
      periodStart,
      periodEnd,
    };
  };

  // Generate history across past 14 days up to today
  const historyList: EvaluatedHistoryRecord[] = [];
  const todayDate = new Date();
  const todayName = todayDate.toLocaleDateString("en-US", { weekday: "long" });

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(todayDate.getDate() - i);
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" });

    const daySlots = timetable.filter(
      (p) => p.day?.toLowerCase() === dayName.toLowerCase()
    );

    daySlots.forEach((p) => {
      historyList.push(evaluatePeriod(p, d));
    });
  }

  // Sort history newest period first
  historyList.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());

  // Calculations for Completed Periods
  const completedPeriods = historyList.filter(
    (h) => h.status === "PRESENT" || h.status === "ABSENT"
  );
  const presentCount = completedPeriods.filter((h) => h.status === "PRESENT").length;
  const absentCount = completedPeriods.filter((h) => h.status === "ABSENT").length;
  const totalClassesCount = completedPeriods.length;
  const percentage =
    totalClassesCount > 0
      ? Math.round((presentCount / totalClassesCount) * 100)
      : 0;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans text-slate-600">
        <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="font-semibold text-sm">Loading MyTrack...</span>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8 text-left">
        
        {/* TOP NAVIGATION & HEADER */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </button>

          <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-800 text-xs font-bold">
            <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
            <span>Class {session?.class || "5th C"}</span>
          </div>
        </div>

        {/* PAGE TITLE */}
        <div className="space-y-1">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-600 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            ATTENDANCE & SCHEDULE PORTAL
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            MyTrack
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm font-medium">
            Complete attendance overview, class timetable & period history logs for {session?.name}.
          </p>
        </div>

        {/* SECTION A: ATTENDANCE OVERVIEW (SUMMARY) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                SECTION A
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                Attendance Overview
              </h2>
            </div>
            <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-2xl border border-emerald-200 text-emerald-800 text-xs font-bold shrink-0">
              <Award className="w-4 h-4 text-emerald-600" />
              <span>Timetable Synchronized</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Total Classes */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Total Classes
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                {totalClassesCount}
              </p>
              <p className="text-[11px] text-slate-400 font-medium">Completed periods</p>
            </div>

            {/* Present */}
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 space-y-1">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                Present
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700">
                {presentCount}
              </p>
              <p className="text-[11px] text-emerald-600 font-medium">Scanned successfully</p>
            </div>

            {/* Absent */}
            <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200/80 space-y-1">
              <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">
                Absent
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold text-rose-700">
                {absentCount}
              </p>
              <p className="text-[11px] text-rose-600 font-medium">Finished without scan</p>
            </div>

            {/* Attendance % */}
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-1 shadow-md">
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Attendance %
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold text-white">
                {percentage}%
              </p>
              <p className="text-[11px] text-slate-300 font-medium">Overall ratio</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between text-xs font-bold text-slate-600">
              <span>Class Attendance Rate</span>
              <span className="text-emerald-700 font-extrabold">{percentage}%</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden p-0.5 border border-slate-200">
              <motion.div
                className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
          </div>
        </motion.div>

        {/* SECTION B: CLASS TIMETABLE & LIVE STATUS */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
            <div className="space-y-0.5">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                SECTION B
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                Class Timetable & Live Status
              </h2>
            </div>

            {/* Day Selector Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 max-w-full">
              {DAYS_OF_WEEK.map((day) => {
                const isActive = activeDay === day;
                const isToday = day.toLowerCase() === todayName.toLowerCase();
                return (
                  <button
                    key={day}
                    onClick={() => setActiveDay(day)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      isActive
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {day.slice(0, 3)}
                    {isToday && <span className="ml-1 text-[10px] text-emerald-400 font-extrabold">• Today</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timetable Period Cards for Active Day */}
          <div className="space-y-3">
            {(() => {
              const selectedDaySlots = timetable.filter(
                (p) => p.day?.toLowerCase() === activeDay.toLowerCase()
              );

              if (selectedDaySlots.length === 0) {
                return (
                  <div className="py-12 text-center bg-slate-50 rounded-2xl border border-slate-200/80">
                    <Calendar className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-slate-700 text-sm">No periods scheduled for {activeDay}.</p>
                    <p className="text-xs text-slate-400 mt-1">Select another day or check back later.</p>
                  </div>
                );
              }

              // Determine target date for evaluated status
              const targetDate = new Date();
              const dayOffset =
                DAYS_OF_WEEK.indexOf(activeDay) - DAYS_OF_WEEK.indexOf(todayName);
              targetDate.setDate(todayDate.getDate() + dayOffset);

              return selectedDaySlots.map((period, idx) => {
                const evaluated = evaluatePeriod(period, targetDate);

                return (
                  <div
                    key={period.id || idx}
                    className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start sm:items-center gap-4">
                      {/* Time Badge */}
                      <div className="p-3 rounded-xl bg-slate-900 text-white text-center shrink-0 min-w-[100px]">
                        <div className="text-xs font-bold text-emerald-400 flex items-center justify-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatTime12h(period.startTime)}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 font-medium">
                          to {formatTime12h(period.endTime)}
                        </div>
                      </div>

                      {/* Subject Info */}
                      <div className="space-y-1">
                        <h3 className="font-extrabold text-base sm:text-lg text-slate-900 leading-tight">
                          {period.subject}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium">
                          {period.faculty && (
                            <span className="flex items-center gap-1 text-slate-700">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              {period.faculty}
                            </span>
                          )}
                          {period.room && (
                            <span className="flex items-center gap-1 text-slate-600 bg-slate-200/70 px-2 py-0.5 rounded-md text-[11px]">
                              <MapPin className="w-3 h-3 text-slate-500" />
                              {period.room}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      {evaluated.status === "PRESENT" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold shadow-sm">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>PRESENT</span>
                        </span>
                      )}

                      {evaluated.status === "ABSENT" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-100 text-rose-800 border border-rose-300 text-xs font-bold shadow-sm">
                          <XCircle className="w-4 h-4 text-rose-600" />
                          <span>ABSENT</span>
                        </span>
                      )}

                      {evaluated.status === "UPCOMING" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold">
                          <Clock3 className="w-4 h-4 text-slate-500" />
                          <span>UPCOMING</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </motion.div>

        {/* SECTION C: ATTENDANCE HISTORY LOGS */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6"
        >
          <div className="space-y-0.5 pb-2 border-b border-slate-100">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
              SECTION C
            </span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Attendance History Logs
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Period-by-period record logs comparing timetable schedules against QR attendance scans.
            </p>
          </div>

          <div className="space-y-3">
            {historyList.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center border border-slate-200">
                <Calendar className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p className="font-semibold text-slate-600 text-base">
                  No timetable history records found.
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Class attendance will populate automatically when sessions complete.
                </p>
              </div>
            ) : (
              historyList.map((item, i) => {
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.4) }}
                    className="bg-slate-50/50 hover:bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-start sm:items-center gap-4">
                      {/* Date Badge */}
                      <div className="p-3 rounded-xl bg-slate-100 text-slate-800 text-center shrink-0 border border-slate-200 min-w-[95px]">
                        <div className="text-xs font-bold text-slate-900">
                          {item.dateStr}
                        </div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase">
                          {item.day}
                        </div>
                      </div>

                      {/* Subject & Time Info */}
                      <div className="space-y-1">
                        <h3 className="font-extrabold text-base text-slate-900 leading-tight">
                          {item.subject}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium">
                          <span className="flex items-center gap-1 font-semibold text-slate-700">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {formatTime12h(item.startTime)} – {formatTime12h(item.endTime)}
                          </span>
                          {item.faculty && <span>• {item.faculty}</span>}
                          {item.room && <span className="text-slate-400">• {item.room}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="self-start sm:self-center">
                      {item.status === "PRESENT" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>PRESENT</span>
                        </span>
                      )}

                      {item.status === "ABSENT" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-100 text-rose-800 border border-rose-300 text-xs font-bold">
                          <XCircle className="w-4 h-4 text-rose-600" />
                          <span>ABSENT</span>
                        </span>
                      )}

                      {item.status === "UPCOMING" && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold">
                          <Clock3 className="w-4 h-4 text-slate-400" />
                          <span>UPCOMING</span>
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </motion.div>

      </div>
    </AppLayout>
  );
};

export default History;