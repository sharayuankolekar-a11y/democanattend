import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { GraduationCap } from "lucide-react";
import { CollegeLogo } from "@/components/CollegeLogo";

interface AppLayoutProps {
  children: ReactNode;
  fullViewport?: boolean;
}

const AppLayout = ({ children, fullViewport = false }: AppLayoutProps) => {
  const location = useLocation();

  if (fullViewport) {
    return (
      <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-500/20 selection:text-emerald-900 relative">
        {/* 🔹 AMBIENT BACKDROP GRADIENT BLURS */}
        <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vh] rounded-full bg-slate-900/5 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vh] rounded-full bg-emerald-500/10 blur-[120px]" />
          <div className="absolute top-[30%] left-[35%] w-[35vw] h-[35vh] rounded-full bg-slate-400/5 blur-[100px]" />
        </div>

        {/* 🔹 COMPACT TOP BAR NAVIGATION FOR FULL VIEWPORT MODE */}
        <nav className="shrink-0 h-14 px-4 sm:px-8 flex justify-center backdrop-blur-md bg-white/90 border-b border-slate-200/60 shadow-xs z-50">
          <div className="max-w-7xl w-full flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5 group">
              <CollegeLogo size="sm" showContainer containerClassName="w-8 h-8 shadow-xs group-hover:border-emerald-500 transition-colors" />
              <div className="flex flex-col text-left bg-slate-900 px-2.5 py-1 rounded-xl border border-slate-800 shadow-xs">
                <span className="font-extrabold text-xs tracking-tight leading-tight">
                  <span className="text-emerald-400">Can</span><span className="text-white">Attend</span>
                </span>
                <span className="text-[9px] font-semibold text-slate-300 tracking-wider uppercase">
                  Canara Engineering College
                </span>
              </div>
            </Link>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold">
              <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />
              <span>Academic Portal</span>
            </div>
          </div>
        </nav>

        {/* 🔹 MAIN FULL-VIEWPORT CONTENT VIEW */}
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex-1 min-h-0 p-3 sm:p-4 overflow-hidden flex flex-col"
        >
          <div className="max-w-7xl mx-auto w-full h-full flex flex-col overflow-hidden">
            {children}
          </div>
        </motion.main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-500/20 selection:text-emerald-900 relative overflow-x-hidden">
      {/* 🔹 AMBIENT BACKDROP GRADIENT BLURS */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vh] rounded-full bg-slate-900/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vh] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute top-[30%] left-[35%] w-[35vw] h-[35vh] rounded-full bg-slate-400/5 blur-[100px]" />
      </div>

      {/* 🔹 TOP BAR NAVIGATION */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 py-3 sm:px-8 flex justify-center backdrop-blur-md bg-white/80 border-b border-slate-200/60 shadow-sm">
        <div className="max-w-7xl w-full flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <CollegeLogo size="md" showContainer containerClassName="w-10 h-10 shadow-sm group-hover:border-emerald-500 transition-colors" />
            <div className="flex flex-col text-left bg-slate-900 px-3 py-1 rounded-xl border border-slate-800 shadow-xs">
              <span className="font-extrabold text-sm tracking-tight leading-tight">
                <span className="text-emerald-400">Can</span><span className="text-white">Attend</span>
              </span>
              <span className="text-[10px] font-semibold text-slate-300 tracking-wider uppercase">
                Canara Engineering College
              </span>
            </div>
          </Link>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold">
            <GraduationCap className="w-4 h-4 text-emerald-600" />
            <span>Academic Portal</span>
          </div>
        </div>
      </nav>

      {/* 🔹 MAIN CONTENT VIEW */}
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex-1 pt-24 pb-12 px-4 sm:px-6 md:px-8"
      >
        <div className="max-w-7xl mx-auto w-full">
          {children}
        </div>
      </motion.main>

      {/* 🔹 FOOTER */}
      <footer className="py-6 px-4 border-t border-slate-200/80 bg-white/50 text-center text-xs font-medium text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center text-center">
          <span>© Canara Engineering College • CanAttend Suite</span>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
