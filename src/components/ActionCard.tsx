import { LucideIcon, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

interface ActionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "primary";
}

export const ActionCard = ({ title, description, icon: Icon, onClick, variant = "default" }: ActionCardProps) => (
  <motion.button
    whileTap={{ scale: 0.99 }}
    whileHover={{ y: -4 }}
    onClick={onClick}
    className="group relative w-full flex flex-col items-start p-6 sm:p-8 bg-white rounded-2xl shadow-sm border border-slate-200/80 hover:border-emerald-500/40 hover:shadow-xl hover:shadow-slate-900/5 transition-all duration-300 text-left overflow-hidden"
  >
    <div className={`p-4 rounded-xl mb-5 transition-all duration-300 ${
      variant === "primary"
        ? "bg-slate-900 text-white group-hover:bg-emerald-600 shadow-md"
        : "bg-slate-100 text-slate-900 group-hover:bg-emerald-50 group-hover:text-emerald-700"
    }`}>
      <Icon size={28} strokeWidth={1.8} />
    </div>
    
    <div className="flex items-center justify-between w-full mb-2">
      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight group-hover:text-emerald-700 transition-colors duration-300">
        {title}
      </h3>
      <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-emerald-500 group-hover:text-white text-slate-400 flex items-center justify-center transition-all duration-300 shrink-0 ml-2">
        <ArrowRight size={16} />
      </div>
    </div>
    
    <p className="text-sm sm:text-base text-slate-600 font-sans leading-relaxed pr-2">
      {description}
    </p>

    {/* Subtle emerald bottom accent border on hover */}
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
  </motion.button>
);
