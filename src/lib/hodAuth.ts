import { db } from "../firebase";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDoc 
} from "firebase/firestore";
import { 
  claimDepartmentAsFirstHOD, 
  FirstHODRegistrationParams, 
  FirstHODRegistrationResult,
  getActiveDepartments,
  normalizeEmail 
} from "./departmentService";

export interface HODRecord {
  id?: string;
  name: string;
  email: string;
  departmentId?: string;
  departmentName?: string;
  departmentCode?: string;
  department?: string;
  designation?: string;
  contactNumber?: string;
  phone?: string;
  uid?: string;
  role: string;
  status: "pending" | "approved" | "rejected";
  createdAt?: string;
  approvedAt?: string;
  source?: "teachers" | "hod_requests" | "hods" | "departments";
}

export interface HODVerificationResult {
  isApproved: boolean;
  isPending: boolean;
  isNotFound?: boolean;
  status?: string;
  message: string;
  data?: HODRecord;
  docId?: string;
  source?: string;
  departmentId?: string;
  departmentName?: string;
  departmentCode?: string;
}

export { normalizeEmail };

/**
 * Resolves a department ID from an existing department name or code
 */
const resolveDepartmentMeta = async (
  deptNameOrCode?: string
): Promise<{ id: string; name: string; code: string } | null> => {
  if (!deptNameOrCode) return null;
  try {
    const activeDepts = await getActiveDepartments();
    const clean = deptNameOrCode.trim().toLowerCase();
    const match = activeDepts.find(
      (d) => d.id === deptNameOrCode || d.name.toLowerCase() === clean || d.code.toLowerCase() === clean
    );
    if (match) return { id: match.id, name: match.name, code: match.code };
    return null;
  } catch {
    return null;
  }
};

/**
 * Verifies whether a given email address belongs to an authorized, approved HOD.
 * Checks Firestore collections in priority order:
 * 1. 'hods' (centralized multi-department HOD collection)
 * 2. 'departments' (where currentHodEmail matches)
 * 3. 'teachers' (where role === 'hod')
 * 4. 'hod_requests' (historical requests)
 */
export const verifyHODAuthorization = async (rawEmail: string): Promise<HODVerificationResult> => {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return {
      isApproved: false,
      isPending: false,
      isNotFound: true,
      message: "No email address provided.",
    };
  }

  try {
    // 1. Check 'hods' collection (Highest Priority)
    const hodsRef = collection(db, "hods");
    const qHods = query(hodsRef, where("email", "==", email));
    const hodSnap = await getDocs(qHods);

    for (const d of hodSnap.docs) {
      const data = d.data();
      const status = (data.status || "").toLowerCase();
      let deptId = data.departmentId;
      let deptName = data.departmentName || data.department;
      let deptCode = data.departmentCode;

      if (!deptId && deptName) {
        const meta = await resolveDepartmentMeta(deptName);
        if (meta) {
          deptId = meta.id;
          deptName = meta.name;
          deptCode = meta.code;
        }
      }

      const hodRec: HODRecord = {
        id: d.id,
        ...data,
        name: data.name || "Head of Department",
        email: email,
        role: "hod",
        status: status as HODRecord["status"],
        departmentId: deptId,
        departmentName: deptName,
        departmentCode: deptCode,
        department: deptName,
        source: "hods",
      };

      if (status === "pending") {
        return {
          isApproved: false,
          isPending: true,
          status: "pending",
          message: "Your Head of Department registration is currently pending administrative approval.",
          data: hodRec,
          docId: d.id,
          source: "hods",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      }
      if (status === "rejected") {
        return {
          isApproved: false,
          isPending: false,
          status: "rejected",
          message: "Your Head of Department registration was dismissed.",
          data: hodRec,
          docId: d.id,
          source: "hods",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      }
      return {
        isApproved: true,
        isPending: false,
        status: "approved",
        message: "Authorization verified.",
        data: hodRec,
        docId: d.id,
        source: "hods",
        departmentId: deptId,
        departmentName: deptName,
        departmentCode: deptCode,
      };
    }

    // 2. Check 'departments' collection for active HOD pointer
    const deptsRef = collection(db, "departments");
    const qDepts = query(deptsRef, where("currentHodEmail", "==", email));
    const deptsSnap = await getDocs(qDepts);

    for (const d of deptsSnap.docs) {
      const deptData = d.data();
      if (deptData.status === "active") {
        const hodRec: HODRecord = {
          id: deptData.currentHodId || d.id,
          name: deptData.currentHodName || "Head of Department",
          email: email,
          departmentId: d.id,
          departmentName: deptData.name,
          departmentCode: deptData.code,
          department: deptData.name,
          role: "hod",
          status: "approved",
          source: "departments",
        };

        return {
          isApproved: true,
          isPending: false,
          status: "approved",
          message: "Authorization verified via department registry.",
          data: hodRec,
          docId: deptData.currentHodId || d.id,
          source: "departments",
          departmentId: d.id,
          departmentName: deptData.name,
          departmentCode: deptData.code,
        };
      }
    }

    // 3. Check 'teachers' collection
    const teachersRef = collection(db, "teachers");
    const qTeacher = query(teachersRef, where("email", "==", email));
    const teacherSnap = await getDocs(qTeacher);

    for (const d of teacherSnap.docs) {
      const data = d.data();
      const role = (data.role || "").toLowerCase();
      const status = (data.status || "").toLowerCase();

      if (role === "hod") {
        let deptId = data.departmentId;
        let deptName = data.departmentName || data.department;
        let deptCode = data.departmentCode;

        if (!deptId && deptName) {
          const meta = await resolveDepartmentMeta(deptName);
          if (meta) {
            deptId = meta.id;
            deptName = meta.name;
            deptCode = meta.code;
          }
        }

        const hodRec: HODRecord = {
          id: d.id,
          ...data,
          name: data.name || "Head of Department",
          email: email,
          role: "hod",
          status: status as HODRecord["status"],
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
          department: deptName,
          source: "teachers",
        };

        if (status === "pending") {
          return {
            isApproved: false,
            isPending: true,
            status: "pending",
            message: "Your Head of Department registration is currently pending administrative approval.",
            data: hodRec,
            docId: d.id,
            source: "teachers",
            departmentId: deptId,
            departmentName: deptName,
            departmentCode: deptCode,
          };
        }
        if (status === "rejected") {
          return {
            isApproved: false,
            isPending: false,
            status: "rejected",
            message: "Your Head of Department registration was rejected by an administrator.",
            data: hodRec,
            docId: d.id,
            source: "teachers",
            departmentId: deptId,
            departmentName: deptName,
            departmentCode: deptCode,
          };
        }
        return {
          isApproved: true,
          isPending: false,
          status: "approved",
          message: "Authorization verified.",
          data: hodRec,
          docId: d.id,
          source: "teachers",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      }
    }

    // 4. Check 'hod_requests' collection
    const hodReqRef = collection(db, "hod_requests");
    const qReq = query(hodReqRef, where("email", "==", email));
    const reqSnap = await getDocs(qReq);

    for (const d of reqSnap.docs) {
      const data = d.data();
      const status = (data.status || "").toLowerCase();
      let deptId = data.departmentId;
      let deptName = data.departmentName || data.department;
      let deptCode = data.departmentCode;

      if (!deptId && deptName) {
        const meta = await resolveDepartmentMeta(deptName);
        if (meta) {
          deptId = meta.id;
          deptName = meta.name;
          deptCode = meta.code;
        }
      }

      const hodRec: HODRecord = {
        id: d.id,
        ...data,
        name: data.name || "Head of Department",
        email: email,
        role: "hod",
        status: status as HODRecord["status"],
        departmentId: deptId,
        departmentName: deptName,
        departmentCode: deptCode,
        department: deptName,
        source: "hod_requests",
      };

      if (status === "approved") {
        return {
          isApproved: true,
          isPending: false,
          status: "approved",
          message: "Authorization verified.",
          data: hodRec,
          docId: d.id,
          source: "hod_requests",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      } else if (status === "pending" || !status) {
        return {
          isApproved: false,
          isPending: true,
          status: "pending",
          message: "Your HOD account registration is currently pending administrative approval. You will be able to access the terminal once approved.",
          data: hodRec,
          docId: d.id,
          source: "hod_requests",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      } else if (status === "rejected") {
        return {
          isApproved: false,
          isPending: false,
          status: "rejected",
          message: "Your HOD account registration was dismissed by the administrator.",
          data: hodRec,
          docId: d.id,
          source: "hod_requests",
          departmentId: deptId,
          departmentName: deptName,
          departmentCode: deptCode,
        };
      }
    }

    // No record found
    return {
      isApproved: false,
      isPending: false,
      isNotFound: true,
      message: `Access Denied: The Google account (${email}) is not registered or approved as a Head of Department. If you are a department head, please register your account via 'New HOD – Create Account'.`,
    };
  } catch (error) {
    console.error("Error verifying HOD authorization in Firestore:", error);
    return {
      isApproved: false,
      isPending: false,
      message: "An error occurred while verifying departmental authorization credentials.",
    };
  }
};

/**
 * Registers a new HOD via the atomic First-HOD onboarding rule.
 * Checks whether an active HOD exists for that department, and if none exists,
 * automatically claims the department and registers the applicant as active HOD.
 */
export const registerFirstTimeHOD = async (
  params: FirstHODRegistrationParams
): Promise<FirstHODRegistrationResult> => {
  return await claimDepartmentAsFirstHOD(params);
};

/**
 * Legacy support for manual HOD registration request
 */
export const registerNewHOD = async (formData: {
  name: string;
  email: string;
  departmentId?: string;
  department: string;
  designation: string;
  contactNumber: string;
  uid: string;
}): Promise<string> => {
  const email = normalizeEmail(formData.email);
  const docRef = await addDoc(collection(db, "hod_requests"), {
    name: formData.name.trim(),
    email: email,
    departmentId: formData.departmentId || "",
    department: formData.department.trim(),
    designation: formData.designation.trim(),
    contactNumber: formData.contactNumber.trim(),
    phone: formData.contactNumber.trim(),
    uid: formData.uid,
    role: "hod",
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  return docRef.id;
};

/**
 * Approves a pending HOD request
 */
export const approveHODRequest = async (
  requestId: string,
  reqData: {
    email?: string;
    name?: string;
    departmentId?: string;
    department?: string;
    designation?: string;
    contactNumber?: string;
    phone?: string;
    uid?: string;
  }
): Promise<void> => {
  const email = normalizeEmail(reqData.email || "");

  await addDoc(collection(db, "teachers"), {
    name: reqData.name,
    email: email,
    departmentId: reqData.departmentId || "",
    department: reqData.department || "",
    designation: reqData.designation || "Head of Department",
    contactNumber: reqData.contactNumber || reqData.phone || "",
    role: "hod",
    status: "approved",
    uid: reqData.uid || "",
    approvedAt: new Date().toISOString(),
  });

  await updateDoc(doc(db, "hod_requests", requestId), {
    status: "approved",
    approvedAt: new Date().toISOString(),
  });
};

/**
 * Rejects or dismisses a pending HOD request
 */
export const rejectHODRequest = async (requestId: string): Promise<void> => {
  await deleteDoc(doc(db, "hod_requests", requestId));
};
