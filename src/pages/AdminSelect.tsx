import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Shield, GraduationCap, ArrowLeft, ArrowRight } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";

export default function AdminSelect() {
  const navigate = useNavigate();

  const roles = [
    {
      title: "Head of Department",
      description: "Departmental operations, CA approvals, staff directory oversight",
      icon: Crown,
      path: "/hod-login",
      color: "bg-slate-900 text-white"
    },
    {
      title: "Class Administrator",
      description: "Classroom attendance management & student roster control",
      icon: Shield,
      path: "/ca-login",
      color: "bg-emerald-600 text-white"
    },
    {
      title: "Faculty Member",
      description: "Conduct teaching sessions & launch dynamic QR attendance",
      icon: GraduationCap,
      path: "/faculty-login",
      color: "bg-slate-800 text-white"
    }
  ];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6 text-left">
        <div className="flex justify-start">
          <button 
            onClick={() => navigate(-1)} 
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
        </div>

        {/* Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
              Institutional Authority Gateway
            </span>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Select Administrative Authority
            </h1>
            <p className="text-sm text-slate-500">
              Choose your designated institutional role to access the specialized management terminal.
            </p>
          </div>
          <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 shadow-sm border-slate-200 shrink-0" />
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {roles.map((role, i) => (
            <motion.button
              key={role.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => navigate(role.path)}
              className="group p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all flex flex-col justify-between text-left space-y-6"
            >
              <div className="space-y-4">
                <div className={`w-12 h-12 rounded-2xl ${role.color} flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}>
                  <role.icon size={24} />
                </div>
                
                <div className="space-y-1.5">
                  <h3 className="text-xl font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                    {role.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {role.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 group-hover:text-emerald-700 transition-colors pt-4 border-t border-slate-100">
                <span>Enter Terminal</span>
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}