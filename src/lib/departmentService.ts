import { db } from "../firebase";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  runTransaction 
} from "firebase/firestore";

export interface DepartmentRecord {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  currentHodId?: string | null;
  currentHodEmail?: string | null;
  currentHodName?: string | null;
  claimedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const INITIAL_DEPARTMENTS: Array<{ id: string; name: string; code: string }> = [
  { id: "dept_cse", name: "Computer Science & Engineering", code: "CSE" },
  { id: "dept_ise", name: "Information Science & Engineering", code: "ISE" },
  { id: "dept_ece", name: "Electronics & Communication Engineering", code: "ECE" },
  { id: "dept_me", name: "Mechanical Engineering", code: "ME" },
  { id: "dept_csd", name: "Computer Science & Design", code: "CSD" },
  { id: "dept_csbs", name: "Computer Science & Business Systems", code: "CSBS" },
  { id: "dept_aiml", name: "Artificial Intelligence & Machine Learning", code: "AIML" },
];

/**
 * Normalizes email address for consistent comparison
 */
export const normalizeEmail = (email: string | undefined | null): string => {
  return email ? email.trim().toLowerCase() : "";
};

/**
 * Fetches all active academic departments from the 'departments' collection.
 * If the collection is empty, automatically initializes standard departments.
 */
export const getActiveDepartments = async (): Promise<DepartmentRecord[]> => {
  try {
    const deptRef = collection(db, "departments");
    const snap = await getDocs(deptRef);

    // Add any newly supported standard departments without overwriting existing
    // department records or their appointed HODs. This also upgrades databases
    // that were initialized by an older version of CanAttend.
    const existingIds = new Set(snap.docs.map((departmentDoc) => departmentDoc.id));
    const missingDepartments = INITIAL_DEPARTMENTS.filter((item) => !existingIds.has(item.id));

    for (const item of missingDepartments) {
      const dRef = doc(db, "departments", item.id);
      const record: DepartmentRecord = {
        id: item.id,
        name: item.name,
        code: item.code,
        status: "active",
        currentHodId: null,
        currentHodEmail: null,
        currentHodName: null,
        createdAt: new Date().toISOString(),
      };
      await setDoc(dRef, record);
    }

    const refreshedSnap = missingDepartments.length > 0
      ? await getDocs(deptRef)
      : snap;

    const list = refreshedSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as DepartmentRecord[];

    // Filter active and sort alphabetically
    return list
      .filter((d) => d.status !== "inactive")
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Error fetching active departments:", error);
    // Return fallback list if Firestore call fails
    return INITIAL_DEPARTMENTS.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      status: "active",
    }));
  }
};

/**
 * Fetches departments that have an active, approved Head of Department.
 * Requirement: Faculty registration options must load only from departments that have an active, approved HOD.
 */
export const getDepartmentsWithActiveHOD = async (): Promise<DepartmentRecord[]> => {
  try {
    const depts = await getActiveDepartments();
    return depts.filter(
      (d) => Boolean(d.currentHodId && d.currentHodEmail) && d.status !== "inactive"
    );
  } catch (error) {
    console.error("Error fetching departments with active HOD:", error);
    return [];
  }
};

/**
 * Fetches departments that currently DO NOT have an active Head of Department.
 * Requirement: New HOD registration must show only unclaimed departments.
 */
export const getUnclaimedDepartments = async (): Promise<DepartmentRecord[]> => {
  try {
    const depts = await getActiveDepartments();
    return depts.filter(
      (d) => (!d.currentHodId || !d.currentHodEmail) && d.status !== "inactive"
    );
  } catch (error) {
    console.error("Error fetching unclaimed departments:", error);
    return [];
  }
};

/**
 * Fetches a single department by its unique document ID
 */
export const getDepartmentById = async (departmentId: string): Promise<DepartmentRecord | null> => {
  if (!departmentId) return null;
  try {
    const snap = await getDoc(doc(db, "departments", departmentId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as DepartmentRecord;
  } catch (error) {
    console.error(`Error fetching department ${departmentId}:`, error);
    return null;
  }
};

export interface FirstHODRegistrationParams {
  departmentId: string;
  fullName: string;
  email: string;
  contactNumber: string;
  designation?: string;
  uid: string;
  isNewDepartment?: boolean;
  newDepartmentName?: string;
  newDepartmentCode?: string;
}

export interface FirstHODRegistrationResult {
  success: boolean;
  message: string;
  hodId?: string;
  department?: DepartmentRecord;
  isExistingActiveHOD?: boolean;
}

/**
 * Atomically claims an academic department for the first HOD of that department.
 * Uses a Firestore transaction to ensure:
 * 1. Read department doc state.
 * 2. If an active HOD is already appointed, reject atomically (prevents concurrent claims).
 * 3. Create HOD record in 'hods' collection.
 * 4. Update 'departments' document with currentHodId, currentHodEmail, currentHodName, and claimedAt.
 * 5. Mirror in 'teachers' and 'hod_requests' for cross-system consistency.
 */
export const claimDepartmentAsFirstHOD = async (
  params: FirstHODRegistrationParams
): Promise<FirstHODRegistrationResult> => {
  const cleanEmail = normalizeEmail(params.email);
  const cleanName = params.fullName.trim();
  const cleanPhone = params.contactNumber.trim();
  const cleanDesignation = (params.designation || "Professor & Head of Department").trim();
  const deptId = params.departmentId ? params.departmentId.trim() : "";

  if (!cleanEmail || !cleanName || (!deptId && !params.isNewDepartment) || !params.uid) {
    return {
      success: false,
      message: "Missing required registration details. Please verify all fields.",
    };
  }

  try {
    const result = await runTransaction(db, async (transaction) => {
      const nowIso = new Date().toISOString();
      let deptRef: ReturnType<typeof doc>;
      let deptData: DepartmentRecord;

      // Support dynamic creation and claiming of new departments on-the-fly
      if (params.isNewDepartment && params.newDepartmentName) {
        const cleanDeptName = params.newDepartmentName.trim();
        const code = (params.newDepartmentCode || cleanDeptName.substring(0, 4)).trim().toUpperCase();
        const customId = `dept_${code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
        deptRef = doc(db, "departments", customId);
        const existingDept = await transaction.get(deptRef);

        if (existingDept.exists()) {
          deptData = existingDept.data() as DepartmentRecord;
          if (deptData.currentHodId && deptData.currentHodEmail) {
            throw new Error(`Department "${deptData.name}" already exists and has an active HOD (${deptData.currentHodEmail}).`);
          }
        } else {
          deptData = {
            id: customId,
            name: cleanDeptName,
            code: code,
            status: "active",
            createdAt: nowIso,
          };
          transaction.set(deptRef, deptData);
        }
      } else {
        // 1. Read the target department document
        deptRef = doc(db, "departments", deptId);
        const deptSnap = await transaction.get(deptRef);

        if (!deptSnap.exists()) {
          throw new Error("Selected department does not exist in the institutional registry.");
        }

        deptData = deptSnap.data() as DepartmentRecord;
      }

      // 2. Check if an active HOD is already appointed for this department
      if (deptData.currentHodId && deptData.currentHodEmail) {
        // If this exact user is already the appointed HOD, allow them through
        if (normalizeEmail(deptData.currentHodEmail) === cleanEmail) {
          return {
            success: true,
            isExistingActiveHOD: true,
            hodId: deptData.currentHodId,
            department: { ...deptData, id: deptRef.id },
            message: `Welcome back, ${deptData.currentHodName || cleanName}. Access granted to your departmental terminal.`,
          };
        }

        // Another HOD already holds this department
        throw new Error(
          `Department "${deptData.name}" already has an active Head of Department (${deptData.currentHodName || deptData.currentHodEmail}). Only one active HOD is authorized per department.`
        );
      }

      // 3. Generate a new HOD document reference in 'hods'
      const newHodRef = doc(collection(db, "hods"));

      const newHodData = {
        name: cleanName,
        email: cleanEmail,
        departmentId: deptRef.id,
        departmentName: deptData.name,
        departmentCode: deptData.code,
        department: deptData.name,
        designation: cleanDesignation,
        contactNumber: cleanPhone,
        phone: cleanPhone,
        uid: params.uid,
        role: "hod",
        status: "approved",
        isFirstHOD: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // 4. Update 'departments' document atomically with HOD reference
      transaction.update(deptRef, {
        currentHodId: newHodRef.id,
        currentHodEmail: cleanEmail,
        currentHodName: cleanName,
        claimedAt: nowIso,
        updatedAt: nowIso,
        status: "active",
      });

      // 5. Write HOD record in 'hods'
      transaction.set(newHodRef, newHodData);

      // 6. Write record in 'teachers' collection for role authorization
      const teacherDocRef = doc(collection(db, "teachers"));
      transaction.set(teacherDocRef, {
        name: cleanName,
        email: cleanEmail,
        departmentId: deptRef.id,
        department: deptData.name,
        departmentCode: deptData.code,
        designation: cleanDesignation,
        contactNumber: cleanPhone,
        phone: cleanPhone,
        role: "hod",
        status: "approved",
        uid: params.uid,
        hodDocId: newHodRef.id,
        createdAt: nowIso,
      });

      // 7. Write record in 'hod_requests' for audit history
      const hodReqDocRef = doc(collection(db, "hod_requests"));
      transaction.set(hodReqDocRef, {
        name: cleanName,
        email: cleanEmail,
        departmentId: deptRef.id,
        department: deptData.name,
        departmentCode: deptData.code,
        designation: cleanDesignation,
        contactNumber: cleanPhone,
        phone: cleanPhone,
        uid: params.uid,
        role: "hod",
        status: "approved",
        approvedAt: nowIso,
        createdAt: nowIso,
      });

      return {
        success: true,
        hodId: newHodRef.id,
        department: { ...deptData, id: deptRef.id, currentHodId: newHodRef.id, currentHodEmail: cleanEmail, currentHodName: cleanName },
        message: `Department "${deptData.name}" claimed successfully! You are registered as the active Head of Department.`,
      };
    });

    return result;
  } catch (error: unknown) {
    console.error("claimDepartmentAsFirstHOD transaction error:", error);
    return {
      success: false,
      message: (error as { message?: string })?.message || "Failed to complete HOD registration. Please try again.",
    };
  }
};
