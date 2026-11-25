import { db } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc } from "firebase/firestore";

/**
 * Canonical Student Session structure.
 * Stored locally and shared across StudentLogin, Dashboard, Scanner, and History.
 */
export interface StudentSession {
  id: string;                 // Student Firestore document ID in 'students'
  name: string;               // Student full name
  usn: string;                // Normalized uppercase USN
  email: string;              // Normalized lowercase Gmail
  uid?: string;               // Firebase Auth UID
  class?: string;             // Registered class, e.g. "5th C"
  semester?: string;          // e.g. "5th Semester"
  section?: string;           // e.g. "C"
  shortClass?: string;        // e.g. "5th C"
  caId?: string;              // Appointed Class Advisor faculty document ID
  caName?: string;            // Appointed Class Advisor name
  caAppointmentId?: string;   // Active CA appointment document ID
  caSelected?: boolean;       // CA association flag
  loginRequestId?: string;    // Firestore doc ID in 'student_login_requests'
  sessionToken?: string;      // Unique session token matching Firestore record
}

export const STORAGE_KEY = "smart_scan_student_session";

export const getStoredStudentSession = (): StudentSession | null => {
  if (typeof window === "undefined") return null;
  try {
    const rawLocal = localStorage.getItem(STORAGE_KEY);
    const rawSession = sessionStorage.getItem(STORAGE_KEY);
    const data = rawLocal || rawSession;
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StudentSession;
  } catch (e) {
    console.error("Failed to parse stored student session:", e);
    return null;
  }
};

export const setStoredStudentSession = (session: StudentSession) => {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(session);
    localStorage.setItem(STORAGE_KEY, serialized);
    sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch (e) {
    console.error("Failed to save student session to storage:", e);
  }
};

export const clearStoredStudentSession = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear student session from storage:", e);
  }
};

export interface SessionValidationResult {
  isValid: boolean;
  reason?: string;
  diagnostics?: {
    hasSession: boolean;
    hasId: boolean;
    hasUsn: boolean;
    hasEmail: boolean;
    hasLoginRequestId: boolean;
    hasSessionToken: boolean;
  };
}

export const validateStudentSession = (
  session: StudentSession | null,
  contextTag: string = "Auth"
): SessionValidationResult => {
  const diagnostics = {
    hasSession: !!session,
    hasId: Boolean(session?.id && session.id.trim().length > 0),
    hasUsn: Boolean(session?.usn && session.usn.trim().length > 0),
    hasEmail: Boolean(session?.email && session.email.trim().length > 0),
    hasLoginRequestId: Boolean(session?.loginRequestId && session.loginRequestId.trim().length > 0),
    hasSessionToken: Boolean(session?.sessionToken && session.sessionToken.trim().length > 0),
  };

  if (!diagnostics.hasSession) {
    console.warn(`[${contextTag}] Validation failed: No student session object found in storage.`);
    return {
      isValid: false,
      reason: "Please log in with your Gmail and USN to continue.",
      diagnostics,
    };
  }

  if (!diagnostics.hasId || !diagnostics.hasUsn) {
    console.warn(`[${contextTag}] Validation failed: Missing student profile identifiers (id/usn).`, diagnostics);
    return {
      isValid: false,
      reason: "Student profile identifier missing. Please log in again.",
      diagnostics,
    };
  }

  if (!diagnostics.hasLoginRequestId || !diagnostics.hasSessionToken) {
    console.warn(`[${contextTag}] Validation failed: Missing CA approval request ID or session token.`, diagnostics);
    return {
      isValid: false,
      reason: "Scanning requires an approved login session from your Class Advisor. Please log in.",
      diagnostics,
    };
  }

  return {
    isValid: true,
    diagnostics,
  };
};

export interface StudentAuthData {
  id: string;
  name: string;
  usn: string;
  email: string;
  class?: string;
  semester?: string;
  section?: string;
  shortClass?: string;
  caAppointmentId?: string;
  caId?: string;
  caName?: string;
  caSelected?: boolean;
  status?: string;
  createdBy?: string;
}

export interface StudentLoginRequest {
  id?: string;
  studentDocId: string;
  studentName: string;
  email: string;
  usn: string;
  class: string;
  shortClass?: string;
  caAppointmentId: string;
  assignedFacultyDocId: string;
  caId: string;
  caName: string;
  caEmail?: string;
  status: "pending" | "approved" | "rejected" | "logged_out";
  sessionToken: string;
  requestedAt: string;
  timestamp: number;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  loggedOutAt?: string;
  reassignedAt?: string;
  reassignedReason?: string;
}

export interface StudentVerificationResult {
  isApproved: boolean;
  isPending: boolean;
  isRejected: boolean;
  isMismatch: boolean;
  isUnregistered: boolean;
  message: string;
  student?: StudentAuthData;
}

export const normalizeEmail = (email: string | undefined | null): string => {
  return email ? email.trim().toLowerCase() : "";
};

export const normalizeUSN = (usn: string | undefined | null): string => {
  return usn ? usn.trim().toUpperCase() : "";
};

export const generateSessionToken = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Verifies whether a student's Gmail and USN match an official student record in Firestore
 * registered by an authorized Class Advisor (CA).
 * 
 * Scenarios handled:
 * - Scenario A (Unregistered): No record exists in CA roster -> Denied with exact message.
 * - Scenario B (Registered & Approved): Valid record matching Gmail and USN -> Approved.
 * - Scenario C (Pending): Record exists but status === 'pending' -> Denied with pending message.
 * - Scenario D (Mismatch): Gmail and USN mismatch -> Denied with mismatch message.
 */
export const verifyStudentAuthorization = async (
  rawEmail: string,
  rawUsn: string
): Promise<StudentVerificationResult> => {
  const cleanEmail = normalizeEmail(rawEmail);
  const cleanUsn = normalizeUSN(rawUsn);

  if (!cleanEmail || !cleanUsn) {
    return {
      isApproved: false,
      isPending: false,
      isRejected: false,
      isMismatch: false,
      isUnregistered: false,
      message: "Please enter both your Gmail address and USN.",
    };
  }

  try {
    const studentsRef = collection(db, "students");

    // 1. Query for matching records (handles exact and trimmed/case-insensitive records)
    const exactQuery = query(
      studentsRef,
      where("email", "==", cleanEmail),
      where("usn", "==", cleanUsn)
    );
    const snap = await getDocs(exactQuery);
    let matchingDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

    if (!snap.empty) {
      matchingDocs = [...snap.docs];
    } else {
      // Fallback: check all documents in students collection to handle case-insensitivity or whitespace
      const allStudentsSnap = await getDocs(studentsRef);
      const docs = allStudentsSnap.docs;

      // Find if both email and USN match (case-insensitive & trimmed)
      matchingDocs = docs.filter((d) => {
        const data = d.data();
        return (
          normalizeEmail(data.email) === cleanEmail &&
          normalizeUSN(data.usn) === cleanUsn
        );
      });

      if (matchingDocs.length === 0) {
        // Check for Mismatches (Scenario D)
        const emailMatch = docs.find(
          (d) => normalizeEmail(d.data().email) === cleanEmail
        );
        const usnMatch = docs.find(
          (d) => normalizeUSN(d.data().usn) === cleanUsn
        );

        if (emailMatch || usnMatch) {
          return {
            isApproved: false,
            isPending: false,
            isRejected: false,
            isMismatch: true,
            isUnregistered: false,
            message:
              "The entered Gmail address and USN do not match our registered records. Please verify your details or contact your Class Advisor.",
          };
        }

        // Neither exists: Scenario A (Unregistered)
        return {
          isApproved: false,
          isPending: false,
          isRejected: false,
          isMismatch: false,
          isUnregistered: true,
          message:
            "Your student record has not been registered by your Class Advisor yet. Please contact your CA.",
        };
      }
    }

    // Filter and score documents to prioritize the canonical active roster record
    matchingDocs.sort((a, b) => {
      const aData = a.data();
      const bData = b.data();
      let aScore = 0;
      let bScore = 0;

      // Approved status gives highest priority
      if (String(aData.status || "").toLowerCase() === "approved") aScore += 100;
      if (String(bData.status || "").toLowerCase() === "approved") bScore += 100;

      // Has CA appointment / CA Id metadata
      if (aData.caAppointmentId) aScore += 40;
      if (bData.caAppointmentId) bScore += 40;
      if (aData.caId || aData.createdBy) aScore += 20;
      if (bData.caId || bData.createdBy) bScore += 20;

      // Has full class details
      if (typeof aData.class === "string" && aData.class.trim().length > 0) aScore += 20;
      if (typeof bData.class === "string" && bData.class.trim().length > 0) bScore += 20;
      if (aData.section) aScore += 10;
      if (bData.section) bScore += 10;

      // Timestamp recency
      const aTime = (aData.updatedAt || aData.createdAt) ? new Date(String(aData.updatedAt || aData.createdAt)).getTime() : 0;
      const bTime = (bData.updatedAt || bData.createdAt) ? new Date(String(bData.updatedAt || bData.createdAt)).getTime() : 0;

      if (aScore !== bScore) return bScore - aScore;
      return bTime - aTime;
    });

    const matchedDoc = matchingDocs[0];

    // Clean up any redundant duplicate docs in background
    if (matchingDocs.length > 1) {
      for (let i = 1; i < matchingDocs.length; i++) {
        const dupDoc = matchingDocs[i];
        deleteDoc(doc(db, "students", dupDoc.id)).catch((err) =>
          console.warn("Cleaned redundant duplicate student doc:", dupDoc.id, err)
        );
      }
    }

    // Matching document found: Inspect status and CA association
    const data = matchedDoc.data();
    const studentStatus = String(data.status || "").toLowerCase().trim();

    // Scenario C: Registration status is Pending
    if (studentStatus === "pending") {
      return {
        isApproved: false,
        isPending: true,
        isRejected: false,
        isMismatch: false,
        isUnregistered: false,
        message:
          "Your student registration is awaiting approval by your Class Advisor.",
      };
    }

    // Rejected / Inactive
    if (studentStatus === "rejected" || studentStatus === "deactivated") {
      return {
        isApproved: false,
        isPending: false,
        isRejected: true,
        isMismatch: false,
        isUnregistered: false,
        message:
          "Your student registration has been deactivated. Please contact your Class Advisor.",
      };
    }

    // Scenario B: Registered & Approved
    // Ensure student record has valid metadata
    const studentAuth: StudentAuthData = {
      id: matchedDoc.id,
      name: String(data.name || "Student"),
      usn: cleanUsn,
      email: cleanEmail,
      class: String(data.class || ""),
      semester: String(data.semester || ""),
      section: String(data.section || ""),
      shortClass: String(data.shortClass || ""),
      caAppointmentId: String(data.caAppointmentId || ""),
      caId: String(data.caId || data.createdBy || ""),
      caName: String(data.caName || ""),
      caSelected: Boolean((data.caSelected || data.createdBy) && (data.caId || data.createdBy)),
      status: String(data.status || "approved"),
      createdBy: String(data.createdBy || ""),
    };

    return {
      isApproved: true,
      isPending: false,
      isRejected: false,
      isMismatch: false,
      isUnregistered: false,
      message: "Student verified successfully.",
      student: studentAuth,
    };
  } catch (error: unknown) {
    console.error("Error verifying student authorization:", error);
    return {
      isApproved: false,
      isPending: false,
      isRejected: false,
      isMismatch: false,
      isUnregistered: false,
      message: "An error occurred during verification. Please try again.",
    };
  }
};

/**
 * Validates whether an active student session ID currently exists in Firestore
 * and is still in an approved/active state.
 */
export const verifyStudentDocById = async (
  studentId: string
): Promise<{
  isValid: boolean;
  reason?: "not_found" | "pending" | "rejected" | "error";
  data?: Record<string, unknown>;
}> => {
  if (!studentId) {
    return { isValid: false, reason: "not_found" };
  }

  try {
    const studentRef = doc(db, "students", studentId);
    const snap = await getDoc(studentRef);

    if (!snap.exists()) {
      return { isValid: false, reason: "not_found" };
    }

    const data = snap.data();
    const status = (data.status || "").toLowerCase().trim();

    if (status === "pending") {
      return { isValid: false, reason: "pending", data };
    }

    if (status === "rejected" || status === "deactivated") {
      return { isValid: false, reason: "rejected", data };
    }

    return { isValid: true, data };
  } catch (error) {
    console.error("Error verifying student by id:", error);
    return { isValid: false, reason: "error" };
  }
};

export interface ActiveCADetails {
  appointmentId: string;
  facultyDocId: string;
  facultyName: string;
  facultyEmail?: string;
  class: string;
  shortClass?: string;
}

/**
 * Creates a new pending login approval request in Firestore for the given student.
 * Every login attempt must generate a new unique request with a fresh sessionToken.
 * Binds strictly to the HOD's active CA appointment document ID and faculty document ID.
 */
export const createStudentLoginRequest = async (
  student: StudentAuthData,
  activeCA?: ActiveCADetails
): Promise<{
  requestId: string;
  sessionToken: string;
}> => {
  const sessionToken = generateSessionToken();

  const finalApptId = activeCA?.appointmentId || "";
  const finalFacultyDocId = activeCA?.facultyDocId || student.caId || student.createdBy || "";
  const finalCaName = activeCA?.facultyName || student.caName || "Class Advisor";
  const finalClass = activeCA?.class || student.class || "";
  const finalShortClass = activeCA?.shortClass || "";

  const newRequest: Omit<StudentLoginRequest, "id"> = {
    studentDocId: student.id,
    studentName: student.name,
    email: normalizeEmail(student.email),
    usn: normalizeUSN(student.usn),
    class: finalClass,
    shortClass: finalShortClass,
    caAppointmentId: finalApptId,
    assignedFacultyDocId: finalFacultyDocId,
    caId: finalFacultyDocId,
    caName: finalCaName,
    caEmail: activeCA?.facultyEmail || "",
    status: "pending",
    sessionToken,
    requestedAt: new Date().toISOString(),
    timestamp: Date.now(),
  };

  const docRef = await addDoc(collection(db, "student_login_requests"), newRequest);

  // Synchronize student record in 'students' with the active CA appointment
  try {
    const studentUpdate: Record<string, unknown> = {
      lastLoginRequestedAt: new Date().toISOString(),
    };
    if (finalFacultyDocId) {
      studentUpdate.caId = finalFacultyDocId;
      studentUpdate.caSelected = true;
    }
    if (finalApptId) {
      studentUpdate.caAppointmentId = finalApptId;
    }
    if (finalCaName) {
      studentUpdate.caName = finalCaName;
    }
    if (finalClass) {
      studentUpdate.class = finalClass;
    }
    await updateDoc(doc(db, "students", student.id), studentUpdate);
  } catch (err) {
    console.warn("Non-fatal: could not update student doc with active CA metadata:", err);
  }

  return {
    requestId: docRef.id,
    sessionToken,
  };
};

/**
 * Verifies that a student's session possesses an active, approved login authorization request
 * in Firestore. Checks document ID, status, token, email, and USN.
 */
export const verifyStudentLoginApproval = async (
  session: {
    id: string;
    email: string;
    usn: string;
    loginRequestId?: string;
    sessionToken?: string;
  } | null
): Promise<{
  isAuthorized: boolean;
  reason?: string;
  requestData?: Record<string, unknown>;
}> => {
  if (!session || !session.id || !session.usn || !session.email) {
    return {
      isAuthorized: false,
      reason: "Please log in with your Gmail and USN to continue.",
    };
  }

  if (!session.loginRequestId || !session.sessionToken) {
    return {
      isAuthorized: false,
      reason: "Login authorization required. Every student login must be approved by your Class Advisor.",
    };
  }

  try {
    // 1. Verify student document in 'students'
    const studentCheck = await verifyStudentDocById(session.id);
    if (!studentCheck.isValid || !studentCheck.data) {
      return {
        isAuthorized: false,
        reason:
          studentCheck.reason === "pending"
            ? "Your student registration is awaiting approval by your Class Advisor."
            : studentCheck.reason === "rejected"
            ? "Your student registration is no longer active. Please contact your Class Advisor."
            : "Your student record was not found in the official roster. Please contact your Class Advisor.",
      };
    }

    // 2. Verify login request in 'student_login_requests'
    const reqRef = doc(db, "student_login_requests", session.loginRequestId);
    const reqSnap = await getDoc(reqRef);

    if (!reqSnap.exists()) {
      return {
        isAuthorized: false,
        reason: "Login authorization record not found. Please log in again.",
      };
    }

    const reqData = reqSnap.data();

    // Check status
    if (reqData.status !== "approved") {
      return {
        isAuthorized: false,
        reason:
          reqData.status === "pending"
            ? "Your login request is still awaiting approval by your Class Advisor."
            : reqData.status === "rejected"
            ? "Your login request was rejected by your Class Advisor. Please contact your CA."
            : "Your login session has ended. Please log in again.",
      };
    }

    // Check sessionToken match
    if (reqData.sessionToken !== session.sessionToken) {
      return {
        isAuthorized: false,
        reason: "Invalid session token. Please log in again.",
      };
    }

    // Check studentDocId match
    if (reqData.studentDocId !== session.id) {
      return {
        isAuthorized: false,
        reason: "Session identity mismatch. Please log in again.",
      };
    }

    // Check email and USN match
    if (
      normalizeEmail(reqData.email) !== normalizeEmail(session.email) ||
      normalizeUSN(reqData.usn) !== normalizeUSN(session.usn)
    ) {
      return {
        isAuthorized: false,
        reason: "Session credential mismatch. Please log in again.",
      };
    }

    return {
      isAuthorized: true,
      requestData: { id: reqSnap.id, ...reqData },
    };
  } catch (error) {
    console.error("Error verifying student login approval:", error);
    return {
      isAuthorized: false,
      reason: "An error occurred while verifying login authorization. Please try again.",
    };
  }
};

/**
 * Ends a student's approved login session in Firestore by marking its status as 'logged_out'.
 */
export const endStudentLoginSession = async (
  session: { loginRequestId?: string } | null
): Promise<void> => {
  if (!session?.loginRequestId) return;
  try {
    const reqRef = doc(db, "student_login_requests", session.loginRequestId);
    await updateDoc(reqRef, {
      status: "logged_out",
      loggedOutAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Failed to mark login request as logged out:", err);
  }
};
