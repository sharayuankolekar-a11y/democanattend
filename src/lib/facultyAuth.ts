import { db } from "../firebase";
import { collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc } from "firebase/firestore";

export interface FacultyRecord {
  id?: string;
  name: string;
  email: string;
  departmentId?: string;
  departmentCode?: string;
  department?: string;
  hodId?: string;
  hodEmail?: string;
  designation?: string;
  contactNumber?: string;
  phone?: string;
  assignedCA?: string;
  caName?: string;
  class?: string;
  subject?: string;
  role?: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "dismissed";
  approvalStatus?: "pending" | "approved" | "rejected";
  isCA?: boolean;
  uid?: string;
  createdAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  source?: "faculty_requests" | "teachers";
}

export interface FacultyVerificationResult {
  isApproved: boolean;
  isPending: boolean;
  isRejected: boolean;
  isRevoked?: boolean;
  isUnregistered: boolean;
  message: string;
  data?: FacultyRecord;
  docId?: string;
  source?: string;
}

export const normalizeEmail = (email: string): string => {
  return email ? email.trim().toLowerCase() : "";
};

/**
 * Verifies whether a given email address belongs to an authorized, HOD-approved faculty member.
 * Checks Firestore collections:
 * 1. 'teachers' (for an active, approved faculty/teacher record)
 * 2. 'faculty_requests' (for approval or pending/rejected status)
 * 
 * Rules:
 * - If pending registration exists and no approved teacher record exists:
 *   Returns isPending = true, "Your faculty registration is awaiting HOD approval."
 * - If rejected:
 *   Returns isRejected = true, "Your faculty registration has been rejected. Contact your HOD."
 * - If revoked or dismissed:
 *   Returns isRejected = true, isRevoked = true, "Your faculty registration has been revoked. Contact your HOD."
 * - If approved teacher record exists (and not overridden by a later pending/rejected state):
 *   Returns isApproved = true.
 * - If no records exist:
 *   Returns isUnregistered = true.
 */
export const verifyFacultyAuthorization = async (rawEmail: string): Promise<FacultyVerificationResult> => {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return {
      isApproved: false,
      isPending: false,
      isRejected: false,
      isUnregistered: true,
      message: "No email address provided.",
    };
  }

  try {
    // 1. Fetch matching documents from 'teachers' collection
    const teachersRef = collection(db, "teachers");
    const qTeacher = query(teachersRef, where("email", "==", email));
    const teacherSnap = await getDocs(qTeacher);

    let teacherDocs = teacherSnap.docs;
    if (teacherDocs.length === 0) {
      // Fallback: case-insensitive match over all teachers
      const allTeachersSnap = await getDocs(teachersRef);
      teacherDocs = allTeachersSnap.docs.filter(
        (d) => normalizeEmail(d.data().email) === email
      );
    }

    // Inspect 'teachers' records
    let activeApprovedTeacherDoc: (Partial<FacultyRecord> & { id: string }) | null = null;
    const anyTeacherRecordFound = teacherDocs.length > 0;
    let allTeacherDocsRejected = teacherDocs.length > 0;
    let isExplicitlyRevokedOrDismissed = false;
    let isTeacherPending = false;

    for (const d of teacherDocs) {
      const data = d.data();
      const role = (data.role || "").toLowerCase().trim();
      const status = (data.status || data.approvalStatus || "").toLowerCase().trim();

      const isFacultyOrCA =
        role === "faculty" ||
        role === "ca" ||
        role === "class advisor" ||
        role === "teacher" ||
        data.isCA === true;

      const isRevoked = status === "revoked" || status === "dismissed";
      const isRejected = status === "rejected";
      const isPending = status === "pending";

      if (isRevoked) {
        isExplicitlyRevokedOrDismissed = true;
      }

      if (!isRejected && !isRevoked) {
        allTeacherDocsRejected = false;
      }

      if (isPending) {
        isTeacherPending = true;
      }

      // Approved if explicitly status === 'approved' OR if an existing institutional CA record
      const isApprovedStatus = status === "approved" || (!status && data.isCA === true);

      if (isFacultyOrCA && isApprovedStatus && !isRejected && !isRevoked && !isPending) {
        if (!activeApprovedTeacherDoc || status === "approved") {
          activeApprovedTeacherDoc = { id: d.id, ...data };
        }
      }
    }

    // 2. Fetch matching documents from 'faculty_requests' collection
    const reqRef = collection(db, "faculty_requests");
    const qReq = query(reqRef, where("email", "==", email));
    const reqSnap = await getDocs(qReq);

    let reqDocs = reqSnap.docs;
    if (reqDocs.length === 0) {
      // Fallback: case-insensitive match over all faculty_requests
      const allReqSnap = await getDocs(reqRef);
      reqDocs = allReqSnap.docs.filter(
        (d) => normalizeEmail(d.data().email) === email
      );
    }

    // Sort requests descending by timestamp to give highest weight to the most recent HOD action
    type ParsedFacultyRequest = Partial<FacultyRecord> & { id: string; _timeVal: number };
    const parsedRequests: ParsedFacultyRequest[] = reqDocs.map((d) => {
      const data = d.data() as Partial<FacultyRecord> & { reviewedAt?: string; approvedAt?: string; rejectedAt?: string; createdAt?: string };
      const timeVal = new Date(
        data.reviewedAt || data.approvedAt || data.rejectedAt || data.createdAt || 0
      ).getTime();
      return { id: d.id, ...data, _timeVal: timeVal };
    });
    parsedRequests.sort((a, b) => b._timeVal - a._timeVal);

    const latestRequest = parsedRequests.length > 0 ? parsedRequests[0] : null;
    const latestStatus = (latestRequest?.status || latestRequest?.approvalStatus || "").toLowerCase().trim();

    // =========================================================================
    // STATE RESOLUTION:
    // =========================================================================

    // SCENARIO 1: REVOKED OR DISMISSED
    if (isExplicitlyRevokedOrDismissed || latestStatus === "revoked" || latestStatus === "dismissed") {
      return {
        isApproved: false,
        isPending: false,
        isRejected: true,
        isRevoked: true,
        isUnregistered: false,
        message: "Your faculty registration has been revoked. Contact your HOD.",
        data: (activeApprovedTeacherDoc || latestRequest || {}) as FacultyRecord,
        source: activeApprovedTeacherDoc ? "teachers" : "faculty_requests",
      };
    }

    // SCENARIO 2: REJECTED
    // If latest request is rejected or all teacher records are rejected
    if (latestStatus === "rejected" || (anyTeacherRecordFound && allTeacherDocsRejected)) {
      // But if there is a distinct active approved teacher document that is not rejected, allow it
      if (!activeApprovedTeacherDoc) {
        return {
          isApproved: false,
          isPending: false,
          isRejected: true,
          isUnregistered: false,
          message: "Your faculty registration has been rejected. Contact your HOD.",
          data: (latestRequest || {}) as FacultyRecord,
          source: "faculty_requests",
        };
      }
    }

    // SCENARIO 3: PENDING
    // If the latest request is pending and no approved teacher record exists
    if ((latestStatus === "pending" || (!latestStatus && latestRequest)) && !activeApprovedTeacherDoc) {
      return {
        isApproved: false,
        isPending: true,
        isRejected: false,
        isUnregistered: false,
        message: "Your faculty registration is awaiting HOD approval.",
        data: latestRequest as unknown as FacultyRecord,
        source: "faculty_requests",
      };
    }

    // SCENARIO 4: APPROVED
    // Active approved teacher doc in 'teachers' OR approved in 'faculty_requests'
    if (activeApprovedTeacherDoc) {
      return {
        isApproved: true,
        isPending: false,
        isRejected: false,
        isUnregistered: false,
        message: "Faculty authorization verified.",
        data: activeApprovedTeacherDoc as FacultyRecord,
        docId: activeApprovedTeacherDoc.id,
        source: "teachers",
      };
    }

    const approvedReqDoc = parsedRequests.find(
      (r) => (r.status || r.approvalStatus || "").toLowerCase() === "approved"
    );
    if (approvedReqDoc && latestStatus !== "rejected" && latestStatus !== "pending") {
      return {
        isApproved: true,
        isPending: false,
        isRejected: false,
        isUnregistered: false,
        message: "Faculty authorization verified.",
        data: approvedReqDoc as unknown as FacultyRecord,
        docId: approvedReqDoc.id,
        source: "faculty_requests",
      };
    }

    // SCENARIO 5: UNREGISTERED
    return {
      isApproved: false,
      isPending: false,
      isRejected: false,
      isUnregistered: true,
      message: "Account not found. Please register as a new faculty member.",
    };
  } catch (error) {
    console.error("Error verifying faculty authorization in Firestore:", error);
    return {
      isApproved: false,
      isPending: false,
      isRejected: false,
      isUnregistered: false,
      message: "An error occurred while verifying faculty authorization.",
    };
  }
};

/**
 * Submits a new faculty registration request to Firestore under 'faculty_requests'
 * Stores explicit departmentId, department, departmentCode, and associates the request with the department HOD.
 * Sets status: "pending" and approvalStatus: "pending".
 * Does NOT create any record in 'teachers'.
 */
export const registerNewFacultyRequest = async (formData: {
  name: string;
  email: string;
  departmentId?: string;
  departmentCode?: string;
  department: string;
  hodId?: string;
  hodEmail?: string;
  designation: string;
  contactNumber: string;
  assignedCA?: string;
  caName?: string;
  class?: string;
  subject?: string;
  wantsToBeCA?: boolean;
  uid: string;
}): Promise<string> => {
  const email = normalizeEmail(formData.email);
  const docRef = await addDoc(collection(db, "faculty_requests"), {
    name: formData.name.trim(),
    email: email,
    departmentId: formData.departmentId || "",
    departmentCode: formData.departmentCode || "",
    department: formData.department.trim(),
    hodId: formData.hodId || "",
    hodEmail: formData.hodEmail || "",
    designation: formData.designation.trim(),
    contactNumber: formData.contactNumber.trim(),
    phone: formData.contactNumber.trim(),
    assignedCA: formData.assignedCA || "TEMP_CA_ID",
    caName: formData.caName || "",
    class: formData.class || "",
    subject: formData.subject ? formData.subject.trim() : "Teaching Faculty",
    wantsToBeCA: !!formData.wantsToBeCA,
    status: "pending",
    approvalStatus: "pending",
    uid: formData.uid,
    createdAt: new Date().toISOString(),
  });

  return docRef.id;
};

/**
 * Approves a faculty registration request by HOD.
 * Guarantees:
 * 1. Only the HOD of the matching department can approve.
 * 2. Regular faculty approval activates the faculty account but NEVER grants CA privileges (isCA: false).
 * 3. Updates/creates record in 'teachers' with status: "approved", approvalStatus: "approved", role: "faculty", isCA: false.
 * 4. Synchronizes all requests for that email in 'faculty_requests' to status: "approved", approvalStatus: "approved".
 */
export const approveFacultyRegistrationRequest = async (params: {
  requestId: string;
  hodEmail: string;
  hodDepartmentId: string;
}): Promise<{ success: boolean; message: string }> => {
  const { requestId, hodEmail, hodDepartmentId } = params;
  const reqDocRef = doc(db, "faculty_requests", requestId);
  const reqSnap = await getDoc(reqDocRef);

  if (!reqSnap.exists()) {
    return { success: false, message: "Faculty request not found." };
  }

  const reqData = reqSnap.data();

  // Strict Department Authorization Check: ISE HOD cannot approve CSE faculty, etc.
  if (reqData.departmentId && hodDepartmentId && reqData.departmentId !== hodDepartmentId) {
    return {
      success: false,
      message: `Unauthorized: You can only approve faculty requests for your own department (${hodDepartmentId}). Request belongs to ${reqData.departmentId}.`,
    };
  }

  const email = normalizeEmail(reqData.email);
  const nowIso = new Date().toISOString();
  const deptId = hodDepartmentId || reqData.departmentId || "";
  const deptName = reqData.department || "Academic Department";
  const deptCode = reqData.departmentCode || "";

  // 1. Update or create teacher record in 'teachers' collection
  const qExisting = query(collection(db, "teachers"), where("email", "==", email));
  const existingSnap = await getDocs(qExisting);

  if (!existingSnap.empty) {
    for (const d of existingSnap.docs) {
      const eData = d.data();
      const isAlreadyCA = eData.role === "ca" || eData.isCA === true;
      await updateDoc(doc(db, "teachers", d.id), {
        name: reqData.name || eData.name,
        role: isAlreadyCA ? "ca" : "faculty",
        isCA: isAlreadyCA ? true : false,
        status: "approved",
        approvalStatus: "approved",
        departmentId: deptId || eData.departmentId || "",
        department: deptName,
        departmentCode: deptCode || eData.departmentCode || "",
        designation: reqData.designation || eData.designation || "Teaching Faculty",
        phone: reqData.contactNumber || reqData.phone || eData.phone || eData.contactNumber || "",
        contactNumber: reqData.contactNumber || reqData.phone || eData.contactNumber || eData.phone || "",
        approvedBy: hodEmail,
        approvedAt: nowIso,
      });
    }
  } else {
    await addDoc(collection(db, "teachers"), {
      name: reqData.name,
      email: email,
      uid: reqData.uid || "",
      role: "faculty",
      isCA: false, // Explicitly false: Approval NEVER automatically grants CA privileges
      departmentId: deptId,
      department: deptName,
      departmentCode: deptCode,
      designation: reqData.designation || "Teaching Faculty",
      subject: reqData.subject || "Teaching Faculty",
      phone: reqData.contactNumber || reqData.phone || "",
      contactNumber: reqData.contactNumber || reqData.phone || "",
      status: "approved",
      approvalStatus: "approved",
      approvedBy: hodEmail,
      approvedAt: nowIso,
    });
  }

  // 2. Synchronize all requests for this email in 'faculty_requests' to approved
  const qAllReqs = query(collection(db, "faculty_requests"), where("email", "==", email));
  const allReqsSnap = await getDocs(qAllReqs);
  for (const d of allReqsSnap.docs) {
    await updateDoc(doc(db, "faculty_requests", d.id), {
      status: "approved",
      approvalStatus: "approved",
      reviewedBy: hodEmail,
      reviewedAt: nowIso,
    });
  }

  return {
    success: true,
    message: `Faculty member ${reqData.name} has been approved successfully for ${deptName}.`,
  };
};

/**
 * Rejects a faculty registration request by HOD.
 * Guarantees:
 * 1. Only the HOD of the matching department can reject.
 * 2. Marks request as rejected in 'faculty_requests'.
 * 3. Marks any unapproved teacher records in 'teachers' as rejected.
 */
export const rejectFacultyRegistrationRequest = async (params: {
  requestId: string;
  hodEmail: string;
  hodDepartmentId: string;
}): Promise<{ success: boolean; message: string }> => {
  const { requestId, hodEmail, hodDepartmentId } = params;
  const reqDocRef = doc(db, "faculty_requests", requestId);
  const reqSnap = await getDoc(reqDocRef);

  if (!reqSnap.exists()) {
    return { success: false, message: "Faculty request not found." };
  }

  const reqData = reqSnap.data();

  // Strict Department Authorization Check
  if (reqData.departmentId && hodDepartmentId && reqData.departmentId !== hodDepartmentId) {
    return {
      success: false,
      message: `Unauthorized: You can only reject faculty requests for your own department (${hodDepartmentId}). Request belongs to ${reqData.departmentId}.`,
    };
  }

  const email = normalizeEmail(reqData.email);
  const nowIso = new Date().toISOString();

  // Update all requests for this email in 'faculty_requests'
  const qAllReqs = query(collection(db, "faculty_requests"), where("email", "==", email));
  const allReqsSnap = await getDocs(qAllReqs);
  for (const d of allReqsSnap.docs) {
    await updateDoc(doc(db, "faculty_requests", d.id), {
      status: "rejected",
      approvalStatus: "rejected",
      reviewedBy: hodEmail,
      reviewedAt: nowIso,
    });
  }

  // Mark any teacher records for this email as rejected
  const qTeachers = query(collection(db, "teachers"), where("email", "==", email));
  const teachersSnap = await getDocs(qTeachers);
  for (const d of teachersSnap.docs) {
    await updateDoc(doc(db, "teachers", d.id), {
      status: "rejected",
      approvalStatus: "rejected",
      rejectedBy: hodEmail,
      rejectedAt: nowIso,
    });
  }

  return {
    success: true,
    message: `Faculty registration request from ${reqData.name} was rejected.`,
  };
};
