import AdminLogin from "./pages/AdminLogin";
import AdminSelect from "./pages/AdminSelect";
import RequestCA from "./pages/RequestCA";
import HODDashboard from "./pages/HODDashboard";
import HODLogin from "./pages/HODLogin";
import HODApprovalManagement from "./pages/HODApprovalManagement";
import HODStaffDirectory from "./pages/HODStaffDirectory";
import HODCAAppointments from "./pages/HODCAAppointments";
import CADashboard from "./pages/CADashboard";
import CATimetable from "./pages/CATimetable";
import CAStudentApprovals from "./pages/CAStudentApprovals";
import FacultyLogin from "./pages/FacultyLogin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import FacultyDashboard from "./pages/FacultyDashboard";
import FacultyPendingApproval from "./pages/FacultyPendingApproval";
import CALogin from "./pages/CALogin";


import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Scanner from "./pages/Scanner";
import History from "./pages/History";
import AdminDashboard from "./pages/AdminDashboard";
import NotFound from "./pages/NotFound";
import FacultySession from "./pages/FacultySession";
import FacultySubjects from "./pages/FacultySubjects";
import AddSubject from "./pages/AddSubject";

import StudentLogin from "./pages/StudentLogin";
import FaceEnrollment from "./pages/FaceEnrollment";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
          <Route path="/student-login" element={<StudentLogin />} />
          <Route path="/faculty/add-subject" element={<AddSubject />} />
<Route path="/admin-login" element={<AdminLogin />} />
<Route path="/admin-select" element={<AdminSelect />} />
<Route path="/request-ca" element={<RequestCA />} />
<Route path="/hod-login" element={<HODLogin />} />
<Route path="/hod-register" element={<HODLogin initialMode="register" />} />
<Route path="/hod-dashboard" element={<HODDashboard />} />
<Route path="/hod/approval-management" element={<HODApprovalManagement />} />
<Route path="/hod/staff-directory" element={<HODStaffDirectory />} />
<Route path="/hod/ca-appointments" element={<HODCAAppointments />} />
<Route path="/ca" element={<CADashboard />} />
<Route path="/ca/timetable" element={<CATimetable />} />
<Route path="/ca/student-approvals" element={<CAStudentApprovals />} />
<Route path="/ca-login" element={<CALogin />} />
<Route path="/faculty/session/:caId" element={<FacultySession />} />

<Route path="/faculty" element={<FacultySubjects />} />
<Route path="/faculty/dashboard" element={<FacultyDashboard />} />
<Route path="/faculty/pending-approval" element={<FacultyPendingApproval />} />

<Route path="/faculty-login" element={<FacultyLogin />} />
<Route path="/" element={<Landing />} />
<Route path="/dashboard" element={<Dashboard />} />
<Route path="/scanner" element={<Scanner />} />
          <Route path="/face-enrollment" element={<FaceEnrollment />} />
<Route path="/history" element={<History />} />
<Route path="/admin" element={<AdminSelect />} />
<Route path="*" element={<NotFound />} />

<Route path="/faculty/subjects" element={<FacultySubjects />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;