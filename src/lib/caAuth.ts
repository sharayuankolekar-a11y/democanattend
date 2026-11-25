import { db } from "../firebase";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc, 
  writeBatch,
  getDoc,
  serverTimestamp 
} from "firebase/firestore";

export interface CAAppointmentRecord {
  id?: string;
  facultyDocId: string;
  facultyName: string;
  facultyEmail: string;
  departmentId?: string;
  departmentName?: string;
  departmentCode?: string;
  department: string;
  designation?: string;
  semester: string;
  section: string;
  class: string;
  shortClass: string;
  status: "active" | "replaced" | "revoked";
  appointedBy: string;
  appointedAt: string;
  replacedAt?: string;
  replacedByFacultyDocId?: string;
  replacedByFacultyName?: string;
  replacedByHOD?: string;
  revokedAt?: string;
  revokedByHOD?: string;
}

export interface CAVerificationResult {
  isApproved: boolean;
  isPending?: boolean;
  isNotAppointed?: boolean;
  isRejected?: boolean;
  isUnregistered?: boolean;
  message: string;
  data?: Record<string, unknown>;
  appointment?: CAAppointmentRecord;
  docId?: string;
  assignedClass?: string;
  semester?: string;
  section?: string;
  shortClass?: string;
  source?: string;
}

/**
 * Normalizes email address for consistent comparison
 */
export const normalizeEmail = (email: string): string => {
  return email ? email.trim().toLowerCase() : "";
};

/**
 * Formats a short class string (e.g. "5th Semester", "C" -> "5th C")
 */
export const formatShortClass = (semester: string, section: string): string => {
  const semNum = semester.replace(/[^0-9]/g, "");
  return semNum ? `${semNum}th ${section.trim().toUpperCase()}` : `${semester} ${section}`;
};

/**
 * Extracts semester number ('1'..'8') and section letter ('A'..'D') from any class string format.
 * Examples:
 * - "5th Semester – Section C" -> { semesterNumber: "5", sectionLetter: "C" }
 * - "5th C" -> { semesterNumber: "5", sectionLetter: "C" }
 * - "5-C" -> { semesterNumber: "5", sectionLetter: "C" }
 * - "5 C" -> { semesterNumber: "5", sectionLetter: "C" }
 */
export const parseClassSemesterAndSection = (
  classStr?: string,
  sem?: string,
  sec?: string
): { semesterNumber: string; sectionLetter: string } => {
  let sNum = "";
  let sSec = "";

  if (sem) {
    const match = sem.match(/([1-8])/);
    if (match) sNum = match[1];
  }
  if (sec) {
    const match = sec.trim().toUpperCase().match(/([A-Z])/);
    if (match) sSec = match[1];
  }

  const raw = (classStr || "").trim();
  if ((!sNum || !sSec) && raw) {
    // 1. Extract semester digit (1-8)
    if (!sNum) {
      const semMatch = raw.match(/([1-8])(?:st|nd|rd|th)?(?:\s*sem|\s*semester)?/i);
      if (semMatch) {
        sNum = semMatch[1];
      }
    }

    // 2. Extract section letter (A-Z)
    if (!sSec) {
      const secMatch =
        raw.match(/(?:section|sec|–|-|\s)\s*([A-Za-z])(?:\s|$)/i) ||
        raw.match(/([A-Za-z])$/);
      if (secMatch) {
        sSec = secMatch[1].toUpperCase();
      }
    }
  }

  return { semesterNumber: sNum, sectionLetter: sSec };
};

export interface ActiveCAAppointmentResolution {
  found: boolean;
  appointment?: CAAppointmentRecord;
  appointmentId?: string;
  facultyDocId?: string;
  facultyName?: string;
  facultyEmail?: string;
  class?: string;
  shortClass?: string;
  semester?: string;
  section?: string;
  message?: string;
}

/**
 * Resolves the currently active Class Advisor appointment for a given class/semester/section.
 * Uses the HOD-managed 'ca_appointments' collection as the SINGLE SOURCE OF TRUTH.
 */
export const getActiveCAAppointmentForClass = async (
  classStr?: string,
  sem?: string,
  sec?: string
): Promise<ActiveCAAppointmentResolution> => {
  const { semesterNumber, sectionLetter } = parseClassSemesterAndSection(classStr, sem, sec);
  const cleanClassStr = (classStr || "").trim().toLowerCase();

  try {
    const apptsRef = collection(db, "ca_appointments");
    const qActive = query(apptsRef, where("status", "==", "active"));
    const snap = await getDocs(qActive);

    if (snap.empty) {
      return {
        found: false,
        message: `No active Class Advisor appointment found for ${classStr || "this class"}.`,
      };
    }

    let matchedDoc: (typeof snap.docs)[number] | null = null;

    for (const d of snap.docs) {
      const data = d.data() as CAAppointmentRecord;
      const apptClass = (data.class || "").trim().toLowerCase();
      const apptShort = (data.shortClass || "").trim().toLowerCase();

      // 1. Direct string match on class or shortClass
      if (cleanClassStr && (apptClass === cleanClassStr || apptShort === cleanClassStr)) {
        matchedDoc = d;
        break;
      }

      // 2. Match by parsed semester number & section letter
      if (semesterNumber && sectionLetter) {
        const parsedAppt = parseClassSemesterAndSection(data.class, data.semester, data.section);
        if (
          parsedAppt.semesterNumber === semesterNumber &&
          parsedAppt.sectionLetter === sectionLetter
        ) {
          matchedDoc = d;
          break;
        }
      }
    }

    if (!matchedDoc) {
      return {
        found: false,
        message: `No active Class Advisor is currently appointed for ${classStr || "this class"}.`,
      };
    }

    const apptData = matchedDoc.data() as CAAppointmentRecord;
    return {
      found: true,
      appointment: { id: matchedDoc.id, ...apptData },
      appointmentId: matchedDoc.id,
      facultyDocId: apptData.facultyDocId,
      facultyName: apptData.facultyName,
      facultyEmail: apptData.facultyEmail,
      class: apptData.class,
      shortClass: apptData.shortClass || formatShortClass(apptData.semester, apptData.section),
      semester: apptData.semester,
      section: apptData.section,
      message: `Active Class Advisor resolved: ${apptData.facultyName}`,
    };
  } catch (error) {
    console.error("Error resolving active CA appointment for class:", error);
    return {
      found: false,
      message: "An error occurred while resolving the active Class Advisor.",
    };
  }
};

/**
 * Resolves the active CA appointment for a student using a multi-strategy lookup:
 * 1. By student.caAppointmentId (if active in ca_appointments)
 * 2. By student.class, student.semester, student.section (via getActiveCAAppointmentForClass)
 * 3. By student.shortClass (via getActiveCAAppointmentForClass)
 * 4. By student.caId or student.createdBy matching facultyDocId in active ca_appointments
 * 
 * If resolved and student has an 'id' in Firestore, self-heals the student document so that
 * class, semester, section, shortClass, caId, caName, and caAppointmentId stay in sync.
 */
export const resolveStudentActiveCAAppointment = async (student: {
  id?: string;
  class?: string;
  semester?: string;
  section?: string;
  shortClass?: string;
  caAppointmentId?: string;
  caId?: string;
  createdBy?: string;
}): Promise<ActiveCAAppointmentResolution> => {
  if (!student) {
    return {
      found: false,
      message: "No student details provided for Class Advisor resolution.",
    };
  }

  try {
    // Strategy 1: Check direct caAppointmentId if present
    if (student.caAppointmentId) {
      try {
        const apptDoc = await getDoc(doc(db, "ca_appointments", student.caAppointmentId));
        if (apptDoc.exists()) {
          const apptData = apptDoc.data() as CAAppointmentRecord;
          if (apptData.status === "active") {
            const res: ActiveCAAppointmentResolution = {
              found: true,
              appointment: { id: apptDoc.id, ...apptData },
              appointmentId: apptDoc.id,
              facultyDocId: apptData.facultyDocId,
              facultyName: apptData.facultyName,
              facultyEmail: apptData.facultyEmail,
              class: apptData.class,
              shortClass: apptData.shortClass || formatShortClass(apptData.semester, apptData.section),
              semester: apptData.semester,
              section: apptData.section,
              message: `Active Class Advisor resolved: ${apptData.facultyName}`,
            };
            if (student.id) {
              await healStudentAppointmentFields(student.id, res.appointment!);
            }
            return res;
          }
        }
      } catch (e) {
        console.warn("Direct appointment lookup by ID error:", e);
      }
    }

    // Strategy 2: Match by student class / semester / section
    const byClass = await getActiveCAAppointmentForClass(
      student.class,
      student.semester,
      student.section
    );
    if (byClass.found && byClass.appointment) {
      if (student.id) {
        await healStudentAppointmentFields(student.id, byClass.appointment);
      }
      return byClass;
    }

    // Strategy 3: Match by student shortClass if distinct
    if (student.shortClass && student.shortClass !== student.class) {
      const byShort = await getActiveCAAppointmentForClass(student.shortClass);
      if (byShort.found && byShort.appointment) {
        if (student.id) {
          await healStudentAppointmentFields(student.id, byShort.appointment);
        }
        return byShort;
      }
    }

    // Strategy 4: Match by facultyDocId (caId or createdBy) in active appointments
    const facultyId = student.caId || student.createdBy;
    if (facultyId) {
      const qFaculty = query(
        collection(db, "ca_appointments"),
        where("facultyDocId", "==", facultyId),
        where("status", "==", "active")
      );
      const snapFaculty = await getDocs(qFaculty);
      if (!snapFaculty.empty) {
        const matched = snapFaculty.docs[0];
        const apptData = matched.data() as CAAppointmentRecord;
        const res: ActiveCAAppointmentResolution = {
          found: true,
          appointment: { id: matched.id, ...apptData },
          appointmentId: matched.id,
          facultyDocId: apptData.facultyDocId,
          facultyName: apptData.facultyName,
          facultyEmail: apptData.facultyEmail,
          class: apptData.class,
          shortClass: apptData.shortClass || formatShortClass(apptData.semester, apptData.section),
          semester: apptData.semester,
          section: apptData.section,
          message: `Active Class Advisor resolved: ${apptData.facultyName}`,
        };
        if (student.id) {
          await healStudentAppointmentFields(student.id, res.appointment!);
        }
        return res;
      }
    }

    return {
      found: false,
      message: `No active Class Advisor is currently appointed for ${student.class || student.shortClass || "your class"}. Please contact your Head of Department.`,
    };
  } catch (error: unknown) {
    console.error("Error in resolveStudentActiveCAAppointment:", error);
    return {
      found: false,
      message: "An error occurred while resolving your Class Advisor. Please try again.",
    };
  }
};

const healStudentAppointmentFields = async (
  studentId: string | undefined,
  appt: CAAppointmentRecord
) => {
  if (!studentId || !appt) return;
  try {
    const sDocRef = doc(db, "students", studentId);
    const sSnap = await getDoc(sDocRef);
    if (!sSnap.exists()) return;
    const current = sSnap.data();

    const updates: Record<string, unknown> = {};
    if (appt.id && current.caAppointmentId !== appt.id) updates.caAppointmentId = appt.id;
    if (appt.facultyDocId && current.caId !== appt.facultyDocId) updates.caId = appt.facultyDocId;
    if (appt.facultyName && current.caName !== appt.facultyName) updates.caName = appt.facultyName;
    if (appt.class && current.class !== appt.class) updates.class = appt.class;
    if (appt.semester && current.semester !== appt.semester) updates.semester = appt.semester;
    if (appt.section && current.section !== appt.section) updates.section = appt.section;
    if (appt.shortClass && current.shortClass !== appt.shortClass) updates.shortClass = appt.shortClass;
    if (!current.caSelected) updates.caSelected = true;

    if (Object.keys(updates).length > 0) {
      await updateDoc(sDocRef, updates);
    }
  } catch (e) {
    console.warn("Self-healing student appointment fields warning:", e);
  }
};

/**
 * Reassigns any pending student login requests for a specific class to the currently active CA appointment.
 * Ensures orphaned pending requests (e.g. from a replaced CA) are routed to the new active CA.
 * Does not delete student records, duplicate requests, or modify approved attendance records.
 */
export const syncPendingRequestsForClass = async (
  classStr: string,
  activeAppt: {
    appointmentId: string;
    facultyDocId: string;
    facultyName: string;
    facultyEmail?: string;
    class: string;
    shortClass?: string;
    semester?: string;
    section?: string;
  }
): Promise<{ reassignedCount: number }> => {
  if (!activeAppt?.appointmentId || !activeAppt?.facultyDocId) {
    return { reassignedCount: 0 };
  }

  const { semesterNumber, sectionLetter } = parseClassSemesterAndSection(
    classStr,
    activeAppt.semester,
    activeAppt.section
  );

  try {
    const requestsRef = collection(db, "student_login_requests");
    const qPending = query(requestsRef, where("status", "==", "pending"));
    const snap = await getDocs(qPending);

    if (snap.empty) return { reassignedCount: 0 };

    const batch = writeBatch(db);
    let reassignedCount = 0;
    const nowIso = new Date().toISOString();

    for (const d of snap.docs) {
      const data = d.data();
      const reqClass = (data.class || "").trim().toLowerCase();
      const reqShort = (data.shortClass || "").trim().toLowerCase();
      const targetClass = (activeAppt.class || "").trim().toLowerCase();
      const targetShort = (activeAppt.shortClass || "").trim().toLowerCase();

      let matchesClass =
        reqClass === targetClass ||
        reqShort === targetShort ||
        reqClass === targetShort ||
        reqShort === targetClass;

      if (!matchesClass && semesterNumber && sectionLetter) {
        const reqParsed = parseClassSemesterAndSection(data.class, data.semester, data.section);
        matchesClass =
          reqParsed.semesterNumber === semesterNumber &&
          reqParsed.sectionLetter === sectionLetter;
      }

      if (matchesClass) {
        // If already pointing to this active appointment and faculty, skip
        if (
          data.caAppointmentId === activeAppt.appointmentId &&
          data.assignedFacultyDocId === activeAppt.facultyDocId
        ) {
          continue;
        }

        batch.update(doc(db, "student_login_requests", d.id), {
          caAppointmentId: activeAppt.appointmentId,
          assignedFacultyDocId: activeAppt.facultyDocId,
          caId: activeAppt.facultyDocId, // backward-compatible alias
          caName: activeAppt.facultyName,
          caEmail: activeAppt.facultyEmail || "",
          class: activeAppt.class,
          shortClass: activeAppt.shortClass || "",
          reassignedAt: nowIso,
          reassignedReason: "Reassigned to current active HOD-appointed CA",
        });
        reassignedCount++;
      }
    }

    if (reassignedCount > 0) {
      await batch.commit();
      console.log(`Reassigned ${reassignedCount} pending requests to CA ${activeAppt.facultyName}`);
    }

    return { reassignedCount };
  } catch (error) {
    console.error("Error syncing pending requests for class:", error);
    return { reassignedCount: 0 };
  }
};

/**
 * Verifies whether a given email address belongs to an approved faculty member with an ACTIVE CA appointment.
 * 
 * Rules:
 * 1. Must be an approved faculty member in the 'teachers' collection.
 * 2. Must possess an active CA appointment in the 'ca_appointments' collection (or active CA flags).
 * 3. Returns the assigned semester, section, and class name directly from the verified appointment record.
 */
export const verifyCAAuthorization = async (rawEmail: string): Promise<CAVerificationResult> => {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return {
      isApproved: false,
      isUnregistered: true,
      message: "No email address provided.",
    };
  }

  try {
    // 1. Verify existence and approval in 'teachers' collection
    const teachersRef = collection(db, "teachers");
    const qTeacher = query(teachersRef, where("email", "==", email));
    const teacherSnap = await getDocs(qTeacher);

    if (teacherSnap.empty) {
      return {
        isApproved: false,
        isUnregistered: true,
        message: "Account not found in the institutional faculty registry. Only approved faculty members can be appointed as Class Advisors.",
      };
    }

    const teacherDoc = teacherSnap.docs[0];
    const teacherData = teacherDoc.data();
    const status = (teacherData.status || "").toLowerCase().trim();

    if (status === "rejected") {
      return {
        isApproved: false,
        isRejected: true,
        message: "Your institutional faculty access has been revoked. Class Advisor privileges are unavailable.",
      };
    }

    // 2. Query active CA appointment from 'ca_appointments' collection
    const apptsRef = collection(db, "ca_appointments");
    
    // Check by facultyDocId first (strong relationship key)
    const qApptByDocId = query(
      apptsRef,
      where("facultyDocId", "==", teacherDoc.id),
      where("status", "==", "active")
    );
    let apptSnap = await getDocs(qApptByDocId);

    // Fallback check by normalized email
    if (apptSnap.empty) {
      const qApptByEmail = query(
        apptsRef,
        where("facultyEmail", "==", email),
        where("status", "==", "active")
      );
      apptSnap = await getDocs(qApptByEmail);
    }

    // 3. If no active appointment in 'ca_appointments', deny CA access
    if (apptSnap.empty) {
      return {
        isApproved: false,
        isNotAppointed: true,
        message: "You do not have an active Class Advisor appointment. Only the Head of Department can appoint Class Advisors.",
        data: { id: teacherDoc.id, ...teacherData },
        docId: teacherDoc.id,
      };
    }

    // Active appointment verified!
    const activeApptDoc = apptSnap.docs[0];
    const apptData = activeApptDoc.data() as CAAppointmentRecord;

    return {
      isApproved: true,
      message: "Class Advisor authorization and active appointment verified.",
      data: { id: teacherDoc.id, ...teacherData },
      appointment: { id: activeApptDoc.id, ...apptData },
      docId: teacherDoc.id,
      assignedClass: apptData.class,
      semester: apptData.semester,
      section: apptData.section,
      shortClass: apptData.shortClass || apptData.class,
      source: "ca_appointments",
    };
  } catch (error) {
    console.error("Error verifying CA authorization in Firestore:", error);
    return {
      isApproved: false,
      message: "An error occurred while verifying Class Advisor appointment status.",
    };
  }
};

/**
 * Appoints a faculty member as Class Advisor for a specific semester and section.
 * Automatically and atomically replaces any previous CA assigned to that class using a Firestore batch.
 * 
 * Guarantees:
 * 1. Ramesh becomes active CA for the class.
 * 2. Suresh (previous CA) loses the CA appointment for that class.
 * 3. Suresh retains his approved faculty account and can log in as Faculty.
 * 4. There is NEVER two active CAs assigned to the same class.
 * 5. Appointment history is preserved with audit timestamps.
 */
export const appointClassAdvisor = async (params: {
  facultyDocId: string;
  facultyName: string;
  facultyEmail: string;
  departmentId?: string;
  departmentCode?: string;
  department: string;
  designation?: string;
  semester: string;
  section: string;
  hodEmail: string;
}): Promise<{ success: boolean; replacedPreviousCA?: { name: string; email: string } | null; message: string }> => {
  const { facultyDocId, facultyName, facultyEmail, departmentId, departmentCode, department, designation, semester, section, hodEmail } = params;

  const normalizedEmail = normalizeEmail(facultyEmail);
  const classString = `${semester.trim()} – Section ${section.trim().toUpperCase()}`;
  const shortClass = formatShortClass(semester, section);

  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    // 1. Check if ANY faculty member is currently active CA for this exact semester & section
    const apptsRef = collection(db, "ca_appointments");
    const qActiveAll = query(apptsRef, where("status", "==", "active"));
    const activeSnap = await getDocs(qActiveAll);

    const { semesterNumber: targetSemNum, sectionLetter: targetSecLetter } = 
      parseClassSemesterAndSection(classString, semester, section);

    const previousMatchingAppts = activeSnap.docs.filter((d) => {
      const data = d.data();
      if (data.class === classString || data.shortClass === shortClass) return true;
      const parsed = parseClassSemesterAndSection(data.class, data.semester, data.section);
      if (targetSemNum && targetSecLetter && parsed.semesterNumber === targetSemNum && parsed.sectionLetter === targetSecLetter) {
        return true;
      }
      return false;
    });

    let replacedPreviousCA: { name: string; email: string } | null = null;

    // Atomically retire previous CA appointment for this class
    for (const d of previousMatchingAppts) {
      const prevData = d.data();
      replacedPreviousCA = {
        name: prevData.facultyName || "Previous CA",
        email: prevData.facultyEmail || "",
      };

      // Mark previous appointment record as "replaced"
      batch.update(doc(db, "ca_appointments", d.id), {
        status: "replaced",
        replacedAt: nowIso,
        replacedByFacultyDocId: facultyDocId,
        replacedByFacultyName: facultyName,
        replacedByHOD: hodEmail,
      });

      // Update previous CA's teacher record: revoke CA flags while keeping faculty account intact
      if (prevData.facultyDocId) {
        batch.update(doc(db, "teachers", prevData.facultyDocId), {
          isCA: false,
          caClass: null,
          caSemester: null,
          caSection: null,
          caShortClass: null,
          caAppointmentId: null,
          role: "faculty", // Retains normal faculty role
          previousCAClass: classString,
          caRevokedAt: nowIso,
        });
      }
    }

    // 2. Check if the newly selected faculty member ALREADY has an active CA appointment for ANOTHER class
    const qFacultyExistingAppt = query(
      apptsRef,
      where("facultyDocId", "==", facultyDocId),
      where("status", "==", "active")
    );
    const facultyExistingSnap = await getDocs(qFacultyExistingAppt);

    for (const d of facultyExistingSnap.docs) {
      // If previously assigned to another class, retire that appointment
      batch.update(doc(db, "ca_appointments", d.id), {
        status: "replaced",
        replacedAt: nowIso,
        replacedByHOD: hodEmail,
        reassignmentNote: `Transferred to ${classString}`,
      });
    }

    // 3. Create the new active CA appointment document in 'ca_appointments'
    const newApptRef = doc(collection(db, "ca_appointments"));
    batch.set(newApptRef, {
      facultyDocId: facultyDocId,
      facultyName: facultyName,
      facultyEmail: normalizedEmail,
      departmentId: departmentId || "",
      department: department || "",
      departmentCode: departmentCode || "",
      designation: designation || "Teaching Faculty",
      semester: semester.trim(),
      section: section.trim().toUpperCase(),
      class: classString,
      shortClass: shortClass,
      status: "active",
      appointedBy: hodEmail,
      appointedAt: nowIso,
      previousFacultyDocId: replacedPreviousCA ? previousMatchingAppts[0]?.data()?.facultyDocId || null : null,
      previousFacultyName: replacedPreviousCA ? replacedPreviousCA.name : null,
    });

    // 4. Update the newly appointed faculty member's document(s) in 'teachers'
    const newTeacherRef = doc(db, "teachers", facultyDocId);
    batch.update(newTeacherRef, {
      isCA: true,
      caClass: classString,
      caSemester: semester.trim(),
      caSection: section.trim().toUpperCase(),
      caShortClass: shortClass,
      caAppointmentId: newApptRef.id,
      class: classString, // Ensures timetable and student roster binding
      role: "ca",         // Allows CA dashboard access and CA directory listing
      appointedAsCAAt: nowIso,
      appointedAsCABy: hodEmail,
    });

    // Also update any other teacher records with the same email (e.g. for different subjects)
    if (normalizedEmail) {
      const qNewTeachers = query(collection(db, "teachers"), where("email", "==", normalizedEmail));
      const newTeachersSnap = await getDocs(qNewTeachers);
      for (const nt of newTeachersSnap.docs) {
        if (nt.id !== facultyDocId) {
          batch.update(doc(db, "teachers", nt.id), {
            isCA: true,
            caClass: classString,
            caSemester: semester.trim(),
            caSection: section.trim().toUpperCase(),
            caShortClass: shortClass,
            caAppointmentId: newApptRef.id,
            class: classString,
            role: "ca",
            appointedAsCAAt: nowIso,
            appointedAsCABy: hodEmail,
          });
        }
      }
    }

    // 5. Automatically reassign any existing pending student login requests for this class to the new CA
    const pendingReqsSnap = await getDocs(
      query(collection(db, "student_login_requests"), where("status", "==", "pending"))
    );
    const { semesterNumber, sectionLetter } = parseClassSemesterAndSection(classString, semester, section);

    for (const d of pendingReqsSnap.docs) {
      const data = d.data();
      const reqClass = (data.class || "").trim().toLowerCase();
      const reqShort = (data.shortClass || "").trim().toLowerCase();
      const targetClass = classString.toLowerCase();
      const targetShort = shortClass.toLowerCase();

      let matches =
        reqClass === targetClass ||
        reqShort === targetShort ||
        reqClass === targetShort ||
        reqShort === targetClass;

      if (!matches && semesterNumber && sectionLetter) {
        const parsed = parseClassSemesterAndSection(data.class, data.semester, data.section);
        matches =
          parsed.semesterNumber === semesterNumber &&
          parsed.sectionLetter === sectionLetter;
      }

      if (matches) {
        batch.update(doc(db, "student_login_requests", d.id), {
          caAppointmentId: newApptRef.id,
          assignedFacultyDocId: facultyDocId,
          caId: facultyDocId,
          caName: facultyName,
          caEmail: normalizedEmail,
          class: classString,
          shortClass: shortClass,
          reassignedAt: nowIso,
          reassignedReason: "Reassigned due to CA replacement by HOD",
        });
      }
    }

    // 6. Synchronize students collection records for this class with new active CA appointment
    const studentsSnap = await getDocs(collection(db, "students"));

    for (const d of studentsSnap.docs) {
      const sData = d.data();
      const sClass = (sData.class || "").trim().toLowerCase();
      let matches = sClass === classString.toLowerCase() || sClass === shortClass.toLowerCase();
      if (!matches && semesterNumber && sectionLetter) {
        const parsed = parseClassSemesterAndSection(sData.class, sData.semester, sData.section);
        matches = parsed.semesterNumber === semesterNumber && parsed.sectionLetter === sectionLetter;
      }

      if (matches) {
        batch.update(doc(db, "students", d.id), {
          caId: facultyDocId,
          caAppointmentId: newApptRef.id,
          caName: facultyName,
          caEmail: normalizedEmail,
          caSelected: true,
          class: classString,
          semester: semester.trim() || sData.semester || "",
          section: sectionLetter || sData.section || "",
          shortClass: shortClass || sData.shortClass || "",
        });
      }
    }

    // Commit all changes atomically!
    await batch.commit();

    return {
      success: true,
      replacedPreviousCA,
      message: replacedPreviousCA
        ? `Successfully appointed ${facultyName} as CA for ${classString}. Previous advisor (${replacedPreviousCA.name}) was retired from this section and retains faculty access.`
        : `Successfully appointed ${facultyName} as Class Advisor for ${classString}.`,
    };
  } catch (error: unknown) {
    console.error("Error appointing Class Advisor:", error);
    return {
      success: false,
      message: (error as { message?: string })?.message || "Failed to appoint Class Advisor. Please try again.",
    };
  }
};

/**
 * Revokes an active Class Advisor appointment.
 * Reverts the faculty member's role to 'faculty' without deleting their institutional profile.
 */
export const revokeClassAdvisorAppointment = async (params: {
  appointmentId: string;
  facultyDocId: string;
  hodEmail: string;
}): Promise<{ success: boolean; message: string }> => {
  const { appointmentId, facultyDocId, hodEmail } = params;

  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    // 1. Mark appointment as revoked
    batch.update(doc(db, "ca_appointments", appointmentId), {
      status: "revoked",
      revokedAt: nowIso,
      revokedByHOD: hodEmail,
    });

    // 2. Revert faculty record in 'teachers' collection
    let facultyEmail = "";
    try {
      const teacherDocSnap = await getDoc(doc(db, "teachers", facultyDocId));
      if (teacherDocSnap.exists()) {
        facultyEmail = (teacherDocSnap.data()?.email || "").toLowerCase().trim();
      }
    } catch (e) {
      console.warn("Could not fetch teacher doc for email during revocation:", e);
    }

    batch.update(doc(db, "teachers", facultyDocId), {
      isCA: false,
      caClass: null,
      caSemester: null,
      caSection: null,
      caShortClass: null,
      caAppointmentId: null,
      role: "faculty",
      caRevokedAt: nowIso,
      caRevokedBy: hodEmail,
    });

    // Also clear CA flags from all other teacher documents belonging to this faculty member
    if (facultyEmail) {
      const qTeachers = query(collection(db, "teachers"), where("email", "==", facultyEmail));
      const teachersSnap = await getDocs(qTeachers);
      for (const td of teachersSnap.docs) {
        if (td.id !== facultyDocId) {
          batch.update(doc(db, "teachers", td.id), {
            isCA: false,
            caClass: null,
            caSemester: null,
            caSection: null,
            caShortClass: null,
            caAppointmentId: null,
            role: "faculty",
            caRevokedAt: nowIso,
            caRevokedBy: hodEmail,
          });
        }
      }
    }

    await batch.commit();

    return {
      success: true,
      message: "Class Advisor appointment revoked. Faculty account remains active.",
    };
  } catch (error: unknown) {
    console.error("Error revoking CA appointment:", error);
    return {
      success: false,
      message: (error as { message?: string })?.message || "Failed to revoke Class Advisor appointment.",
    };
  }
};
