import ExcelJS from "exceljs";
import { parseClassSemesterAndSection } from "./caAuth";

export interface SessionInformation {
  institution?: string;
  subjectName: string;
  facultyName: string;
  caName: string;
  semester: string;
  section: string;
  sessionDate: string; // Formatted as DD-MM-YYYY
  sessionStartTime: string; // Formatted as hh:mm:ss AM/PM
  sessionEndTime: string; // Formatted as hh:mm:ss AM/PM
}

export interface AttendanceSummary {
  totalEnrolled: number;
  totalSelected: number;
  totalPresent: number;
  totalAbsent: number;
  attendancePercentage: string;
}

export interface StudentAttendanceRow {
  slNo?: number;
  name: string;
  usn: string;
  email: string;
  status: "PRESENT" | "ABSENT";
  scanTime: string; // Formatted as hh:mm:ss AM/PM or "Not scanned" / "Not Recorded"
}

/**
 * Converts any Firestore timestamp, Date, number (epoch ms), or ISO string
 * safely into a JS Date object. Returns null if invalid or missing.
 * Prevents phantom/fabricated dates.
 */
export function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  let d: Date | null = null;
  const ts = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof ts?.toDate === "function") {
    d = ts.toDate();
  } else if (ts?.seconds !== undefined) {
    d = new Date(ts.seconds * 1000 + (ts.nanoseconds || 0) / 1000000);
  } else if (value instanceof Date) {
    d = value;
  } else if (typeof value === "number") {
    // Check whether epoch is in seconds or milliseconds
    d = value < 10000000000 ? new Date(value * 1000) : new Date(value);
  } else if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) d = new Date(parsed);
  }
  if (!d || isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formats a timestamp into DD-MM-YYYY using Asia/Kolkata timezone.
 * Returns fallback if date genuinely does not exist (never fabricates current date).
 */
export function formatReportDate(time: unknown, fallback = "Not Available"): string {
  const d = toValidDate(time);
  if (!d) return fallback;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return formatter.format(d).replace(/\//g, "-");
}

/**
 * Formats a timestamp into hh:mm:ss AM/PM using Asia/Kolkata timezone.
 * Returns fallback if time genuinely does not exist (never fabricates current time).
 */
export function formatReportTime(time: unknown, fallback = "Not Recorded"): string {
  const d = toValidDate(time);
  if (!d) return fallback;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return formatter.format(d);
}

/**
 * Formats student attendance scan time in Asia/Kolkata timezone:
 * - If student is ABSENT: returns "Not scanned"
 * - If student is PRESENT with valid timestamp: returns hh:mm:ss AM/PM
 * - If student is PRESENT but timestamp genuinely missing: returns "Not Recorded"
 */
export function formatScanTime(time: unknown, status?: string): string {
  const normalizedStatus = (status || "").toUpperCase();
  if (normalizedStatus === "ABSENT") {
    return "Not scanned";
  }
  const d = toValidDate(time);
  if (!d) {
    return normalizedStatus === "PRESENT" ? "Not Recorded" : "Not scanned";
  }
  return formatReportTime(d, "Not Recorded");
}

/**
 * Extracts a normalized semester number ('1'..'8') from semester string or class string.
 */
export function extractSemesterNumber(semStr?: string, classStr?: string): string {
  if (semStr) {
    const match = semStr.match(/([1-8])/);
    if (match) return match[1];
  }
  if (classStr) {
    const { semesterNumber } = parseClassSemesterAndSection(classStr);
    if (semesterNumber) return semesterNumber;
  }
  return "";
}

/**
 * Extracts a normalized single section letter ('A'..'Z') from section string or class string.
 */
export function extractSectionLetter(secStr?: string, classStr?: string): string {
  if (secStr) {
    const trimmed = secStr.trim().toUpperCase();
    if (/^[A-Z]$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(?:SECTION|SEC)?\s*[-–:]?\s*([A-Z])$/i) || trimmed.match(/([A-Z])$/);
    if (match) return match[1].toUpperCase();
  }
  if (classStr) {
    const { sectionLetter } = parseClassSemesterAndSection(classStr);
    if (sectionLetter) return sectionLetter.toUpperCase();
  }
  return "";
}

/**
 * Normalizes subject names into clean filename components.
 */
export function formatFilenameSubject(subject?: string): string {
  if (!subject) return "Attendance";
  const sanitized = subject.trim().replace(/[/\\?%*:|"<>]/g, "");
  return sanitized.replace(/\s+/g, "_") || "Attendance";
}

/**
 * Formats semester for filename: e.g. "5th Semester" -> "5thSem"
 */
export function formatFilenameSemester(semStr?: string, classStr?: string): string {
  const semesterNumber = extractSemesterNumber(semStr, classStr);
  if (semesterNumber) {
    const n = parseInt(semesterNumber, 10);
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix}Sem`;
  }
  const clean = (semStr || "Sem").replace(/[^a-zA-Z0-9]/g, "");
  return clean || "Sem";
}

/**
 * Formats section for filename: e.g. "C" -> "SectionC", "Section C" -> "SectionC"
 */
export function formatFilenameSection(secStr?: string, classStr?: string): string {
  const sectionLetter = extractSectionLetter(secStr, classStr);
  if (sectionLetter) {
    return `Section${sectionLetter.toUpperCase()}`;
  }
  const clean = (secStr || "Sec").replace(/[^a-zA-Z0-9]/g, "");
  return clean.toLowerCase().startsWith("section") ? clean : `Section${clean}`;
}

/**
 * Formats human-readable semester for reports: e.g. "5th Semester"
 */
export function formatReportSemester(semStr?: string, classStr?: string): string {
  const semesterNumber = extractSemesterNumber(semStr, classStr);
  if (semesterNumber) {
    const n = parseInt(semesterNumber, 10);
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix} Semester`;
  }
  return semStr || "Not Available";
}

/**
 * Formats human-readable section for reports: e.g. "Section C"
 */
export function formatReportSection(secStr?: string, classStr?: string): string {
  const sectionLetter = extractSectionLetter(secStr, classStr);
  if (sectionLetter) {
    return `Section ${sectionLetter.toUpperCase()}`;
  }
  return secStr || "Not Available";
}

/**
 * Dynamically builds the required attendance report filename:
 * e.g. CanAttend_DSA_5thSem_SectionC_18-11-2026.xlsx
 */
export function generateAttendanceReportFilename(params: {
  subject?: string;
  semester?: string;
  section?: string;
  classStr?: string;
  sessionDate?: string;
  extension?: "xlsx" | "csv";
}): string {
  const cleanSubject = formatFilenameSubject(params.subject);
  const cleanSemester = formatFilenameSemester(params.semester, params.classStr);
  const cleanSection = formatFilenameSection(params.section, params.classStr);
  const cleanDate = params.sessionDate || formatReportDate(new Date());
  const ext = params.extension || "xlsx";

  return `CanAttend_${cleanSubject}_${cleanSemester}_${cleanSection}_${cleanDate}.${ext}`;
}

/**
 * Calculates correct summary figures where Total Present + Total Absent = Total Selected
 */
export function calculateAttendanceSummary(
  totalEnrolled: number,
  selectedStudentsCount: number,
  presentStudentsCount: number
): AttendanceSummary {
  const totalSelected = Math.max(0, selectedStudentsCount);
  const totalPresent = Math.min(totalSelected, Math.max(0, presentStudentsCount));
  const totalAbsent = Math.max(0, totalSelected - totalPresent);
  const percentageNum = totalSelected > 0 ? (totalPresent / totalSelected) * 100 : 0;
  const attendancePercentage = `${percentageNum.toFixed(2)}%`;

  return {
    totalEnrolled: Math.max(0, totalEnrolled),
    totalSelected,
    totalPresent,
    totalAbsent,
    attendancePercentage,
  };
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "CBD5E1" } },
  left: { style: "thin", color: { argb: "CBD5E1" } },
  bottom: { style: "thin", color: { argb: "CBD5E1" } },
  right: { style: "thin", color: { argb: "CBD5E1" } },
};

/**
 * Builds a professionally formatted Microsoft Excel (.xlsx) workbook with:
 * - Specific column widths (10, 25, 20, 35, 20, 25)
 * - Session Information and Summary sections with bold labels & borders
 * - Color-highlighted PRESENT (soft emerald) and ABSENT (soft rose) statuses
 * - Frozen student table header
 * - Text wrapping and middle vertical alignment throughout
 */
export async function buildAttendanceReportExcel(
  sessionInfo: SessionInformation,
  summary: AttendanceSummary,
  students: StudentAttendanceRow[]
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CanAttend - Canara Engineering College";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Attendance Report", {
    properties: { defaultRowHeight: 22 },
  });

  // Explicit Column Widths matching requirements exactly:
  // Sl. No.: 10, Student Name: 25, USN: 20, Gmail: 35, Attendance Status: 20, Scan Time: 25
  worksheet.columns = [
    { key: "col1", width: 10 },
    { key: "col2", width: 25 },
    { key: "col3", width: 20 },
    { key: "col4", width: 35 },
    { key: "col5", width: 20 },
    { key: "col6", width: 25 },
  ];

  let currentRowIndex = 1;

  // Helper to apply borders to a range of cells
  const applyRangeBorder = (startRow: number, startCol: number, endRow: number, endCol: number) => {
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const cell = worksheet.getCell(r, c);
        cell.border = THIN_BORDER;
      }
    }
  };

  // 1. INSTITUTION TOP BANNER
  worksheet.mergeCells(`A${currentRowIndex}:F${currentRowIndex}`);
  const bannerCell = worksheet.getCell(`A${currentRowIndex}`);
  bannerCell.value = "CANARA ENGINEERING COLLEGE";
  bannerCell.font = { name: "Segoe UI", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  bannerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0F172A" } };
  bannerCell.alignment = { vertical: "middle", horizontal: "center" };
  worksheet.getRow(currentRowIndex).height = 30;
  currentRowIndex++;

  // 1b. SUB-HEADER
  worksheet.mergeCells(`A${currentRowIndex}:F${currentRowIndex}`);
  const subHeaderCell = worksheet.getCell(`A${currentRowIndex}`);
  subHeaderCell.value = "FACULTY ATTENDANCE SESSION REPORT";
  subHeaderCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "34D399" } };
  subHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E293B" } };
  subHeaderCell.alignment = { vertical: "middle", horizontal: "center" };
  worksheet.getRow(currentRowIndex).height = 22;
  currentRowIndex++;

  // Blank separator
  worksheet.getRow(currentRowIndex).height = 10;
  currentRowIndex++;

  // 2. SESSION INFORMATION SECTION HEADING
  worksheet.mergeCells(`A${currentRowIndex}:F${currentRowIndex}`);
  const sessionHead = worksheet.getCell(`A${currentRowIndex}`);
  sessionHead.value = "SESSION INFORMATION";
  sessionHead.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0F172A" } };
  sessionHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
  sessionHead.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  applyRangeBorder(currentRowIndex, 1, currentRowIndex, 6);
  worksheet.getRow(currentRowIndex).height = 24;
  currentRowIndex++;

  // Session Info Rows (Labels in Cols A-B width 35, Values in Cols C-F width 100)
  const sessionDataRows: [string, string][] = [
    ["Institution", sessionInfo.institution || "Canara Engineering College"],
    ["Subject name", sessionInfo.subjectName || "Not Available"],
    ["Faculty name", sessionInfo.facultyName || "Not Available"],
    ["Class Advisor name", sessionInfo.caName || "Not Available"],
    ["Semester", sessionInfo.semester || "Not Available"],
    ["Section", sessionInfo.section || "Not Available"],
    ["Session date", sessionInfo.sessionDate || "Not Available"],
    ["Session start time", sessionInfo.sessionStartTime || "Not Recorded"],
    ["Session end time", sessionInfo.sessionEndTime || "Not Recorded"],
  ];

  for (const [label, val] of sessionDataRows) {
    worksheet.mergeCells(`A${currentRowIndex}:B${currentRowIndex}`);
    worksheet.mergeCells(`C${currentRowIndex}:F${currentRowIndex}`);

    const labelCell = worksheet.getCell(`A${currentRowIndex}`);
    labelCell.value = label;
    labelCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "334155" } };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
    labelCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };

    const valCell = worksheet.getCell(`C${currentRowIndex}`);
    valCell.value = val;
    valCell.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    valCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    applyRangeBorder(currentRowIndex, 1, currentRowIndex, 6);
    worksheet.getRow(currentRowIndex).height = 22;
    currentRowIndex++;
  }

  // Blank separator
  worksheet.getRow(currentRowIndex).height = 10;
  currentRowIndex++;

  // 3. ATTENDANCE SUMMARY SECTION HEADING
  worksheet.mergeCells(`A${currentRowIndex}:F${currentRowIndex}`);
  const summaryHead = worksheet.getCell(`A${currentRowIndex}`);
  summaryHead.value = "ATTENDANCE SUMMARY";
  summaryHead.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0F172A" } };
  summaryHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
  summaryHead.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  applyRangeBorder(currentRowIndex, 1, currentRowIndex, 6);
  worksheet.getRow(currentRowIndex).height = 24;
  currentRowIndex++;

  // Summary Rows
  const summaryDataRows: [string, string | number][] = [
    ["Total enrolled students", summary.totalEnrolled],
    ["Total selected students", summary.totalSelected],
    ["Total present students", summary.totalPresent],
    ["Total absent students", summary.totalAbsent],
    ["Attendance percentage", summary.attendancePercentage],
  ];

  for (const [label, val] of summaryDataRows) {
    worksheet.mergeCells(`A${currentRowIndex}:B${currentRowIndex}`);
    worksheet.mergeCells(`C${currentRowIndex}:F${currentRowIndex}`);

    const labelCell = worksheet.getCell(`A${currentRowIndex}`);
    labelCell.value = label;
    labelCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "334155" } };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
    labelCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };

    const valCell = worksheet.getCell(`C${currentRowIndex}`);
    valCell.value = val;
    valCell.font = {
      name: "Segoe UI",
      size: 10,
      bold: label === "Attendance percentage",
      color: { argb: label === "Attendance percentage" ? "047857" : "0F172A" },
    };
    valCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    applyRangeBorder(currentRowIndex, 1, currentRowIndex, 6);
    worksheet.getRow(currentRowIndex).height = 22;
    currentRowIndex++;
  }

  // Blank separator
  worksheet.getRow(currentRowIndex).height = 12;
  currentRowIndex++;

  // 4. STUDENT ATTENDANCE TABLE SECTION HEADING
  worksheet.mergeCells(`A${currentRowIndex}:F${currentRowIndex}`);
  const tableHead = worksheet.getCell(`A${currentRowIndex}`);
  tableHead.value = "STUDENT ATTENDANCE TABLE";
  tableHead.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0F172A" } };
  tableHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
  tableHead.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  applyRangeBorder(currentRowIndex, 1, currentRowIndex, 6);
  worksheet.getRow(currentRowIndex).height = 24;
  currentRowIndex++;

  // 5. TABLE COLUMN HEADERS
  const tableHeaderRowIndex = currentRowIndex;
  const headers = [
    { title: "Sl. No.", align: "center" as const },
    { title: "Student Name", align: "left" as const },
    { title: "USN", align: "center" as const },
    { title: "Gmail", align: "left" as const },
    { title: "Attendance Status", align: "center" as const },
    { title: "Scan Time", align: "center" as const },
  ];

  headers.forEach((h, idx) => {
    const cell = worksheet.getCell(tableHeaderRowIndex, idx + 1);
    cell.value = h.title;
    cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: h.align, wrapText: true };
    cell.border = THIN_BORDER;
  });
  worksheet.getRow(tableHeaderRowIndex).height = 26;
  currentRowIndex++;

  // 6. STUDENT ROWS
  students.forEach((s, idx) => {
    const rowNum = currentRowIndex;
    const slNo = s.slNo !== undefined ? s.slNo : idx + 1;
    const isPresent = s.status === "PRESENT";
    const isEven = idx % 2 === 0;
    const baseRowBg = isEven ? "FFFFFFFF" : "FFF8FAFC";

    // Col A: Sl. No.
    const c1 = worksheet.getCell(rowNum, 1);
    c1.value = slNo;
    c1.font = { name: "Segoe UI", size: 10, color: { argb: "334155" } };
    c1.alignment = { vertical: "middle", horizontal: "center" };
    c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseRowBg } };
    c1.border = THIN_BORDER;

    // Col B: Student Name
    const c2 = worksheet.getCell(rowNum, 2);
    c2.value = s.name;
    c2.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "0F172A" } };
    c2.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseRowBg } };
    c2.border = THIN_BORDER;

    // Col C: USN
    const c3 = worksheet.getCell(rowNum, 3);
    c3.value = s.usn;
    c3.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "334155" } };
    c3.alignment = { vertical: "middle", horizontal: "center" };
    c3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseRowBg } };
    c3.border = THIN_BORDER;

    // Col D: Gmail
    const c4 = worksheet.getCell(rowNum, 4);
    c4.value = s.email;
    c4.font = { name: "Segoe UI", size: 10, color: { argb: "475569" } };
    c4.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    c4.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseRowBg } };
    c4.border = THIN_BORDER;

    // Col E: Attendance Status (Highlighted PRESENT in Emerald, ABSENT in Rose)
    const c5 = worksheet.getCell(rowNum, 5);
    c5.value = s.status;
    c5.font = {
      name: "Segoe UI",
      size: 10,
      bold: true,
      color: { argb: isPresent ? "166534" : "991B1B" },
    };
    c5.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isPresent ? "DCFCE7" : "FEE2E2" },
    };
    c5.alignment = { vertical: "middle", horizontal: "center" };
    c5.border = THIN_BORDER;

    // Col F: Scan Time
    const c6 = worksheet.getCell(rowNum, 6);
    c6.value = s.scanTime;
    c6.font = {
      name: "Segoe UI",
      size: 10,
      italic: s.scanTime === "Not scanned" || s.scanTime === "Not Recorded",
      color: {
        argb:
          s.scanTime === "Not scanned"
            ? "64748B"
            : s.scanTime === "Not Recorded"
              ? "94A3B8"
              : "0F172A",
      },
    };
    c6.alignment = { vertical: "middle", horizontal: "center" };
    c6.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseRowBg } };
    c6.border = THIN_BORDER;

    worksheet.getRow(rowNum).height = 24;
    currentRowIndex++;
  });

  // Freeze Table Column Header so scrolling down preserves column headers
  worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: tableHeaderRowIndex }];

  // Write workbook to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Initiates browser download of the generated Excel (.xlsx) file.
 */
export function downloadAttendanceReportExcel(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escapes fields for CSV fallback compliance
 */
export function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates plain CSV string (kept for backward-compatible fallback)
 */
export function buildAttendanceReportCsv(
  sessionInfo: SessionInformation,
  summary: AttendanceSummary,
  students: StudentAttendanceRow[]
): string {
  const lines: string[] = [];

  lines.push("Session Information");
  lines.push(`Institution,${escapeCsvValue(sessionInfo.institution || "Canara Engineering College")}`);
  lines.push(`Subject name,${escapeCsvValue(sessionInfo.subjectName || "Not Available")}`);
  lines.push(`Faculty name,${escapeCsvValue(sessionInfo.facultyName || "Not Available")}`);
  lines.push(`Class Advisor name,${escapeCsvValue(sessionInfo.caName || "Not Available")}`);
  lines.push(`Semester,${escapeCsvValue(sessionInfo.semester || "Not Available")}`);
  lines.push(`Section,${escapeCsvValue(sessionInfo.section || "Not Available")}`);
  lines.push(`Session date,${escapeCsvValue(sessionInfo.sessionDate || "Not Available")}`);
  lines.push(`Session start time,${escapeCsvValue(sessionInfo.sessionStartTime || "Not Recorded")}`);
  lines.push(`Session end time,${escapeCsvValue(sessionInfo.sessionEndTime || "Not Recorded")}`);
  lines.push("");

  lines.push("Attendance Summary");
  lines.push(`Total enrolled students,${summary.totalEnrolled}`);
  lines.push(`Total selected students,${summary.totalSelected}`);
  lines.push(`Total present students,${summary.totalPresent}`);
  lines.push(`Total absent students,${summary.totalAbsent}`);
  lines.push(`Attendance percentage,${escapeCsvValue(summary.attendancePercentage)}`);
  lines.push("");

  lines.push("Student Attendance Table");
  lines.push("Sl. No.,Student Name,USN,Gmail,Attendance Status,Scan Time");

  students.forEach((s, idx) => {
    const slNo = s.slNo !== undefined ? s.slNo : idx + 1;
    lines.push(
      [
        slNo,
        escapeCsvValue(s.name),
        escapeCsvValue(s.usn),
        escapeCsvValue(s.email),
        escapeCsvValue(s.status),
        escapeCsvValue(s.scanTime),
      ].join(",")
    );
  });

  return lines.join("\r\n");
}

export function downloadAttendanceReportCsv(filename: string, csvContent: string): void {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
