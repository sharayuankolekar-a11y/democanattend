import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Ghost } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20 overflow-hidden">
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative">
        {/* Abstract shapes for premium feel */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-secondary/10 rounded-full blur-[80px]" />

        <motion.div
           initial={{ opacity: 0, y: 30 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 1, ease: "circOut" }}
           className="text-center space-y-12 relative z-10"
        >
          <div className="space-y-6">
            <motion.div 
               initial={{ scale: 0.8 }}
               animate={{ scale: 1 }}
               className="text-[12rem] md:text-[18rem] font-serif font-black text-black/5 leading-none tracking-tighter select-none"
            >
              404
            </motion.div>
            
            <div className="space-y-4 -mt-20 md:-mt-32">
               <div className="w-16 h-16 bg-black text-white rounded-2xl flex items-center justify-center mx-auto shadow-2xl mb-8 rotate-12">
                  <Ghost size={32} />
               </div>
               <h1 className="text-5xl md:text-7xl font-serif font-bold text-foreground tracking-tighter">Lost in Space</h1>
               <p className="font-body text-muted-foreground italic text-xl max-w-lg mx-auto leading-relaxed">
                 The page you are looking for has either moved to another dimension or never existed in this institutional reality.
               </p>
            </div>
          </div>

          <button
            onClick={() => navigate("/")}
            className="group glass-morphism px-12 py-5 rounded-full flex items-center gap-4 text-lg font-serif italic text-muted-foreground hover:text-black transition-all duration-500 border-white/20 shadow-pinterest hover:shadow-2xl"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-2 transition-transform" />
            Return to Civilization
          </button>
        </motion.div>
      </main>

      <footer className="p-12 text-center">
        <p className="text-xs text-muted-foreground font-serif tracking-[0.2em] uppercase opacity-40">
           <span className="text-emerald-500 font-bold">Can</span><span className="text-foreground font-bold">Attend</span> • Institutional Error Terminal
        </p>
      </footer>
    </div>
  );
};

export default NotFound;

