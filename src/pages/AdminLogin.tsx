import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Lock, AlertCircle } from "lucide-react";
import AppLayout from "@/layouts/AppLayout";
import { CollegeLogo } from "@/components/CollegeLogo";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = () => {
    setError(null);
    if (password === "admin123") {
      navigate("/admin-select");
    } else {
      setError("Incorrect administrator password. Please try again.");
    }
  };

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        handleLogin();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [password]);

  return (
    <AppLayout>
      <div className="max-w-md mx-auto space-y-6">
        <div className="flex justify-start">
          <button 
            onClick={() => navigate(-1)} 
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-900/5 text-left space-y-6"
        >
          <header className="text-center space-y-2">
            <CollegeLogo size="lg" showContainer containerClassName="w-16 h-16 mx-auto mb-3 shadow-md border-slate-200" />
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Admin Access</h1>
            <p className="text-xs text-slate-500">Enter executive terminal password to continue</p>
          </header>

          {/* Authorization Alert Banner (matches Faculty Access Terminal) */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-3 shadow-xs relative z-10"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-900">Authorization Alert</p>
                <p className="leading-relaxed">{error}</p>
              </div>
            </motion.div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 ml-1">
                Admin Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full py-3.5 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
              </div>
            </div>

            <button
              onClick={handleLogin}
              className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-md mt-2"
            >
              Continue to Admin Gateway
            </button>
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
}