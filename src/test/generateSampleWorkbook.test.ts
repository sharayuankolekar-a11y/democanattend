import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildAttendanceReportExcel,
  calculateAttendanceSummary,
  SessionInformation,
  StudentAttendanceRow,
} from "../lib/attendanceReport";

describe("Generate Sample Excel Workbook", () => {
  it("builds and writes a real .xlsx file to disk and verifies integrity", async () => {
    const sessionInfo: SessionInformation = {
      institution: "Canara Engineering College",
      subjectName: "Data Structures & Algorithms",
      facultyName: "Dr. Rajesh Kumar",
      caName: "Prof. Suresh Rao",
      semester: "5th Semester",
      section: "Section C",
      sessionDate: "18-11-2026",
      sessionStartTime: "11:50:00 AM",
      sessionEndTime: "11:50:30 AM",
    };

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
        name: "Rahul Verma",
        usn: "4CB24CS101",
        email: "rahul.v@gmail.com",
        status: "PRESENT",
        scanTime: "11:50:20 AM",
      },
      {
        slNo: 3,
        name: "Ananya Hegde",
        usn: "4CB24CS012",
        email: "ananya.h@gmail.com",
        status: "ABSENT",
        scanTime: "Not scanned",
      },
      {
        slNo: 4,
        name: "Vikram Shenoy",
        usn: "4CB24CS180",
        email: "vikram.s@gmail.com",
        status: "PRESENT",
        scanTime: "Not Recorded", // Edge case: present but timestamp missing
      },
    ];

    const summary = calculateAttendanceSummary(60, 4, 3);
    const blob = await buildAttendanceReportExcel(sessionInfo, summary, students);

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    expect(buffer.length).toBeGreaterThan(2000);

    const outputPath = path.resolve("./CanAttend_Sample_Report.xlsx");
    fs.writeFileSync(outputPath, buffer);

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(2000);

    // Clean up sample file
    fs.unlinkSync(outputPath);
  });
});
