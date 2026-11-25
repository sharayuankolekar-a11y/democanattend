import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import {
  generateAttendanceReportFilename,
  buildAttendanceReportExcel,
  downloadAttendanceReportExcel,
  buildAttendanceReportCsv,
  calculateAttendanceSummary,
  formatReportDate,
  formatReportTime,
  formatScanTime,
  formatReportSemester,
  formatReportSection,
  extractSemesterNumber,
  extractSectionLetter,
  toValidDate,
  SessionInformation,
  StudentAttendanceRow,
} from "../lib/attendanceReport";

describe("Attendance Report Generator - Unit Tests", () => {
  const baseSessionInfo: SessionInformation = {
    institution: "Canara Engineering College",
    subjectName: "DSA",
    facultyName: "Dr. Rajesh Kumar",
    caName: "Prof. Suresh Rao",
    semester: "5th Semester",
    section: "Section C",
    sessionDate: "18-11-2026",
    sessionStartTime: "11:50:00 AM",
    sessionEndTime: "11:50:30 AM",
  };

  describe("1. Date & Time Conversion & Formatting (Asia/Kolkata)", () => {
    it("converts Firebase Timestamp objects with toDate() into Date objects", () => {
      const mockDate = new Date("2026-11-18T06:20:15.000Z"); // 11:50:15 AM IST
      const firebaseTimestamp = {
        toDate: () => mockDate,
      };

      const parsed = toValidDate(firebaseTimestamp);
      expect(parsed).toEqual(mockDate);
      expect(formatReportDate(firebaseTimestamp)).toBe("18-11-2026");
      expect(formatReportTime(firebaseTimestamp)).toBe("11:50:15 AM");
    });

    it("converts Firebase Timestamp seconds and nanoseconds into Date objects", () => {
      // 1795000000 corresponds to a unix epoch timestamp
      const seconds = 1795000000;
      const firebaseRaw = { seconds, nanoseconds: 0 };
      const parsed = toValidDate(firebaseRaw);
      expect(parsed).not.toBeNull();
      expect(parsed?.getTime()).toBe(seconds * 1000);
    });

    it("formats dates as DD-MM-YYYY in Asia/Kolkata timezone", () => {
      // UTC 2026-11-17T20:00:00Z -> IST 2026-11-18T01:30:00+05:30 (Day 18 in IST)
      const lateDate = new Date("2026-11-17T20:00:00Z");
      expect(formatReportDate(lateDate)).toBe("18-11-2026");
    });

    it("formats times as hh:mm:ss AM/PM in Asia/Kolkata timezone", () => {
      // UTC 06:20:15Z is IST 11:50:15 AM
      const time = new Date("2026-11-18T06:20:15Z");
      expect(formatReportTime(time)).toBe("11:50:15 AM");
    });

    it("never fabricates dates/times; displays 'Not Available' or 'Not Recorded' for missing timestamps", () => {
      expect(formatReportDate(null)).toBe("Not Available");
      expect(formatReportDate(undefined)).toBe("Not Available");
      expect(formatReportDate("")).toBe("Not Available");

      expect(formatReportTime(null)).toBe("Not Recorded");
      expect(formatReportTime(undefined)).toBe("Not Recorded");
      expect(formatReportTime("")).toBe("Not Recorded");
    });

    it("formats scan time: 'Not scanned' for ABSENT, 'Not Recorded' if PRESENT without timestamp", () => {
      expect(formatScanTime(null, "ABSENT")).toBe("Not scanned");
      expect(formatScanTime(undefined, "ABSENT")).toBe("Not scanned");

      // Present but timestamp genuinely missing
      expect(formatScanTime(null, "PRESENT")).toBe("Not Recorded");
      expect(formatScanTime(undefined, "PRESENT")).toBe("Not Recorded");

      // Present with valid timestamp
      const scanDate = new Date("2026-11-18T06:20:15Z");
      expect(formatScanTime(scanDate, "PRESENT")).toBe("11:50:15 AM");
    });
  });

  describe("2. Filename Generation", () => {
    it("generates exact filename format specified: CanAttend_DSA_5thSem_SectionC_18-11-2026.xlsx", () => {
      const filename = generateAttendanceReportFilename({
        subject: "DSA",
        semester: "5th Semester",
        section: "Section C",
        sessionDate: "18-11-2026",
        extension: "xlsx",
      });
      expect(filename).toBe("CanAttend_DSA_5thSem_SectionC_18-11-2026.xlsx");
    });

    it("handles class string format like '5th C'", () => {
      const filename = generateAttendanceReportFilename({
        subject: "DSA",
        classStr: "5th C",
        sessionDate: "18-11-2026",
        extension: "xlsx",
      });
      expect(filename).toBe("CanAttend_DSA_5thSem_SectionC_18-11-2026.xlsx");
    });

    it("sanitizes subject with spaces or special characters", () => {
      const filename = generateAttendanceReportFilename({
        subject: "Data Structures & Algorithms",
        semester: "3rd Semester",
        section: "A",
        sessionDate: "18-11-2026",
        extension: "xlsx",
      });
      expect(filename).toBe("CanAttend_Data_Structures_&_Algorithms_3rdSem_SectionA_18-11-2026.xlsx");
    });

    it("extracts semester and section letters accurately", () => {
      expect(extractSemesterNumber("5th Semester")).toBe("5");
      expect(extractSemesterNumber(undefined, "6th B")).toBe("6");
      expect(extractSectionLetter("Section C")).toBe("C");
      expect(extractSectionLetter("C")).toBe("C");
      expect(extractSectionLetter(undefined, "7th D")).toBe("D");
    });
  });

  describe("3. Summary Calculations", () => {
    it("calculates 100% when all students present", () => {
      const summary = calculateAttendanceSummary(60, 45, 45);
      expect(summary.totalEnrolled).toBe(60);
      expect(summary.totalSelected).toBe(45);
      expect(summary.totalPresent).toBe(45);
      expect(summary.totalAbsent).toBe(0);
      expect(summary.attendancePercentage).toBe("100.00%");
      expect(summary.totalPresent + summary.totalAbsent).toBe(summary.totalSelected);
    });

    it("calculates 0% when no students present", () => {
      const summary = calculateAttendanceSummary(60, 45, 0);
      expect(summary.totalEnrolled).toBe(60);
      expect(summary.totalSelected).toBe(45);
      expect(summary.totalPresent).toBe(0);
      expect(summary.totalAbsent).toBe(45);
      expect(summary.attendancePercentage).toBe("0.00%");
      expect(summary.totalPresent + summary.totalAbsent).toBe(summary.totalSelected);
    });

    it("calculates percentage when some present and some absent", () => {
      const summary = calculateAttendanceSummary(60, 40, 30);
      expect(summary.totalSelected).toBe(40);
      expect(summary.totalPresent).toBe(30);
      expect(summary.totalAbsent).toBe(10);
      expect(summary.attendancePercentage).toBe("75.00%");
      expect(summary.totalPresent + summary.totalAbsent).toBe(summary.totalSelected);
    });

    it("handles zero selected students safely without dividing by zero", () => {
      const summary = calculateAttendanceSummary(60, 0, 0);
      expect(summary.totalSelected).toBe(0);
      expect(summary.totalPresent).toBe(0);
      expect(summary.totalAbsent).toBe(0);
      expect(summary.attendancePercentage).toBe("0.00%");
    });
  });

  describe("4. Excel Workbook (.xlsx) Generation & Formatting", () => {
    it("generates a fully-styled Excel workbook with required column widths, borders, and frozen panes", async () => {
      const students: StudentAttendanceRow[] = [
        {
          slNo: 1,
          name: "Suhas S Pai",
          usn: "4CB24CS155",
          email: "suhaspai13@gmail.com",
          status: "PRESENT",
          scanTime: "11:50:15 AM",
        },
        {
          slNo: 2,
          name: "Ananya Hegde",
          usn: "4CB24CS012",
          email: "ananya.h@gmail.com",
          status: "ABSENT",
          scanTime: "Not scanned",
        },
      ];

      const summary = calculateAttendanceSummary(60, 2, 1);
      const blob = await buildAttendanceReportExcel(baseSessionInfo, summary, students);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(blob.size).toBeGreaterThan(1000);

      // Verify the generated Excel workbook using ExcelJS reader
      const arrayBuffer = await blob.arrayBuffer();
      const loadedWb = new ExcelJS.Workbook();
      await loadedWb.xlsx.load(arrayBuffer);

      const ws = loadedWb.getWorksheet("Attendance Report");
      expect(ws).toBeDefined();

      // Check Column Widths: Sl. No.: 10, Student Name: 25, USN: 20, Gmail: 35, Attendance Status: 20, Scan Time: 25
      const cols = ws?.columns;
      expect(cols).toBeDefined();
      expect(cols?.[0].width).toBe(10);
      expect(cols?.[1].width).toBe(25);
      expect(cols?.[2].width).toBe(20);
      expect(cols?.[3].width).toBe(35);
      expect(cols?.[4].width).toBe(20);
      expect(cols?.[5].width).toBe(25);

      // Check Top Institution Banner
      const banner = ws?.getCell("A1");
      expect(banner?.value).toBe("CANARA ENGINEERING COLLEGE");
      expect(banner?.font?.bold).toBe(true);

      // Check Frozen Panes
      const views = ws?.views as Array<Partial<ExcelJS.WorksheetViewFrozen>> | undefined;
      expect(views).toBeDefined();
      expect(views?.[0].state).toBe("frozen");
      expect(views?.[0].ySplit).toBeGreaterThan(20);

      // Verify Table Header
      const headerRowIndex = views?.[0].ySplit as number;
      expect(ws?.getCell(headerRowIndex, 1).value).toBe("Sl. No.");
      expect(ws?.getCell(headerRowIndex, 2).value).toBe("Student Name");
      expect(ws?.getCell(headerRowIndex, 3).value).toBe("USN");
      expect(ws?.getCell(headerRowIndex, 4).value).toBe("Gmail");
      expect(ws?.getCell(headerRowIndex, 5).value).toBe("Attendance Status");
      expect(ws?.getCell(headerRowIndex, 6).value).toBe("Scan Time");

      // Verify Present & Absent styling
      const presentRow = headerRowIndex + 1;
      const absentRow = headerRowIndex + 2;

      const presentStatusCell = ws?.getCell(presentRow, 5);
      expect(presentStatusCell?.value).toBe("PRESENT");
      // Color fill for PRESENT: DCFCE7
      const presentFill = presentStatusCell?.fill as ExcelJS.FillPattern;
      expect(presentFill?.fgColor?.argb).toContain("DCFCE7");

      const absentStatusCell = ws?.getCell(absentRow, 5);
      expect(absentStatusCell?.value).toBe("ABSENT");
      // Color fill for ABSENT: FEE2E2
      const absentFill = absentStatusCell?.fill as ExcelJS.FillPattern;
      expect(absentFill?.fgColor?.argb).toContain("FEE2E2");

      // Verify Scan Times
      expect(ws?.getCell(presentRow, 6).value).toBe("11:50:15 AM");
      expect(ws?.getCell(absentRow, 6).value).toBe("Not scanned");
    });
  });

  describe("5. CSV Report Generation (Fallback)", () => {
    it("generates CSV with matching PRESENT and ABSENT status and scan times", () => {
      const students: StudentAttendanceRow[] = [
        {
          slNo: 1,
          name: "Suhas S Pai",
          usn: "4CB24CS155",
          email: "suhaspai13@gmail.com",
          status: "PRESENT",
          scanTime: "11:50:15 AM",
        },
        {
          slNo: 2,
          name: "Ananya Hegde",
          usn: "4CB24CS012",
          email: "ananya.h@gmail.com",
          status: "ABSENT",
          scanTime: "Not scanned",
        },
      ];

      const summary = calculateAttendanceSummary(60, 2, 1);
      const csv = buildAttendanceReportCsv(baseSessionInfo, summary, students);

      expect(csv).toContain("Total selected students,2");
      expect(csv).toContain("Total present students,1");
      expect(csv).toContain("Total absent students,1");
      expect(csv).toContain("Attendance percentage,50.00%");
      expect(csv).toContain("1,Suhas S Pai,4CB24CS155,suhaspai13@gmail.com,PRESENT,11:50:15 AM");
      expect(csv).toContain("2,Ananya Hegde,4CB24CS012,ananya.h@gmail.com,ABSENT,Not scanned");
    });
  });

  describe("6. Download Execution", () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;

    beforeEach(() => {
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
      window.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it("triggers Excel download through blob URL", () => {
      const blob = new Blob(["dummy content"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      downloadAttendanceReportExcel("CanAttend_Test.xlsx", blob);

      expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

      clickSpy.mockRestore();
    });
  });
});
