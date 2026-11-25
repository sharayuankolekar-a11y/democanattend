import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldAlert, ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";

const RequestCA = () => {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="max-w-md mx-auto space-y-6 text-left">
        <div className="flex justify-start">
          <button 
            onClick={() => navigate("/admin-select")} 
            className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-sm text-center space-y-6"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <ShieldCheck size={32} />
          </div>

          <div className="space-y-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-extrabold bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wider">
              Institutional Policy
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">HOD Appointment Required</h1>
            <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
              Under CanAttend institutional rules, Class Advisors are appointed exclusively by the <strong>Head of Department</strong> from approved faculty members. Independent registration is disabled.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={() => navigate("/ca-login")}
              className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-2xl font-bold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>Go to Class Advisor Portal</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
};

export default RequestCA;
