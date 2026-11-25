import { db } from "../firebase";
import { collection, query, where, getDocs, addDoc } from "firebase/firestore";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, provider } from "../firebase";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, GraduationCap, Building2, ArrowRight, ShieldCheck, Leaf } from "lucide-react";
import { CollegeLogo } from "@/components/CollegeLogo";
import { toast } from "@/components/ui/use-toast";

const Landing = () => {
  const navigate = useNavigate();

  const handleSignIn = async (type: string) => {
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // STUDENT FLOW
      if (type === "student") {
        navigate("/dashboard");
        return;
      }

      // ADMIN FLOW (dynamic)
      const q = query(
        collection(db, "teachers"),
        where("email", "==", user.email)
      );

      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();

        if (data.role === "ca") {
          navigate("/ca");
        } else if (data.role === "faculty") {
          navigate("/faculty");
        } else if (data.role === "teacher") {
          navigate("/admin", {
            state: { subject: data.subject }
          });
        }
      } else {
        // NOT REGISTERED → SEND REQUEST
        await addDoc(collection(db, "ca_requests"), {
          name: user.displayName,
          email: user.email,
          uid: user.uid,
          status: "pending",
        });

        await signOut(auth);
        toast({
          title: "Request Submitted",
          description: "Your CA authorization request has been submitted to the HOD for approval.",
        });
      }

    } catch (error) {
      console.error("Login error:", error);
    }
  };

  return (
    <div className="min-h-screen lg:h-screen lg:max-h-screen w-full overflow-x-hidden lg:overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-emerald-500/20 flex flex-col lg:flex-row">
      
      {/* ========================================================= */}
      {/* LEFT PANEL: FULL-HEIGHT HERO WITH CEC.JPG BACKGROUND (~52%) */}
      {/* ========================================================= */}
      <div className="relative w-full lg:w-[52%] min-h-[480px] lg:min-h-0 lg:h-full flex flex-col justify-between p-6 sm:p-10 lg:p-12 text-white bg-slate-900 overflow-hidden shrink-0">
        
        {/* Bright, Vibrant CEC.jpg Campus Photograph */}
        <img
          src="/CEC.jpg"
          alt="Canara Engineering College Campus"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-100"
        />

        {/* Subtle, Targeted Overlay Gradients only for text contrast */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/65 via-slate-950/25 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-950/40 pointer-events-none" />

        {/* TOP LEFT BRANDING & NAV */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3 drop-shadow-md">
            <CollegeLogo size="md" showContainer containerClassName="w-10 h-10 shadow-lg border-white/20" />
            <div className="text-left">
              <div className="font-extrabold text-lg leading-tight flex items-center">
                <span className="text-emerald-400">Can</span><span className="text-white">Attend</span>
              </div>
              <p className="text-[11px] font-semibold text-slate-200 uppercase tracking-wider">
                Canara Engineering College
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-100 tracking-wide drop-shadow-md">
            <span>Simple</span>
            <span>•</span>
            <span>Secure</span>
            <span>•</span>
            <span>Smart</span>
          </div>
        </div>

        {/* CENTER HERO HEADING */}
        <div className="relative z-10 my-auto py-6 text-left max-w-xl space-y-4">
          <div className="flex items-center gap-2 drop-shadow-md">
            <span className="w-6 h-0.5 bg-emerald-400 rounded-full" />
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              WELCOME TO
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.08] drop-shadow-lg">
            <span className="text-emerald-400">Can</span><span className="text-white">Attend</span> <br />
            <span className="text-emerald-400">Made Smarter.</span>
          </h1>

          <div className="space-y-2 pt-1 drop-shadow-md">
            <p className="text-lg sm:text-xl font-bold text-white">
              Canara Engineering College
            </p>
            <div className="w-12 h-0.5 bg-emerald-400 rounded-full" />
            <p className="text-sm sm:text-base text-slate-100 font-medium leading-relaxed pt-1">
              Pioneering Innovation in Tech Learning
            </p>
          </div>
        </div>

        {/* BOTTOM LEFT QUOTE */}
        <div className="relative z-10 text-left pt-4 border-t border-white/20 space-y-1 drop-shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-4 h-0.5 bg-emerald-400 rounded-full" />
            <p className="text-xs sm:text-sm font-semibold text-white italic">
              "Learn Today, Lead Tomorrow"
            </p>
          </div>
          <p className="text-[11px] text-slate-200 uppercase tracking-wider font-semibold pl-6">
            Canara Engineering College
          </p>
        </div>
      </div>

      {/* ========================================================= */}
      {/* RIGHT PANEL: CLEAN LIGHT SYSTEM ACCESS PORTAL (~48%)       */}
      {/* ========================================================= */}
      <div className="relative w-full lg:w-[48%] h-full bg-[#f4f7fa] flex flex-col justify-between p-6 sm:p-8 lg:p-10 overflow-y-auto lg:overflow-hidden shrink-0">
        
        {/* Soft Decorative Ambient Curves */}
        <div className="absolute top-0 left-0 w-48 h-48 bg-emerald-100/60 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-100/60 rounded-full blur-3xl pointer-events-none" />

        {/* TOP RIGHT INSTITUTIONAL BADGE */}
        <div className="relative z-10 flex items-center justify-end gap-3 text-right">
          <CollegeLogo size="sm" showContainer containerClassName="w-9 h-9 border-slate-200/80 shadow-sm" />
          <div className="text-right">
            <p className="font-bold text-xs text-slate-900 leading-tight">Canara Engineering College</p>
            <p className="text-[11px] text-slate-500 font-medium">Mangaluru, Karnataka</p>
          </div>
        </div>

        {/* CENTER SYSTEM ACCESS CARD */}
        <div className="relative z-10 my-auto mx-auto w-full max-w-[540px]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xl shadow-slate-200/60 space-y-6 text-left"
          >
            {/* Card Title Header */}
            <div className="space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-600">
                INSTITUTIONAL PORTAL
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                System <span className="text-emerald-600">Access</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                Sign in to your dashboard and manage attendance seamlessly.
              </p>
            </div>

            {/* Access Buttons / Cards */}
            <div className="space-y-3.5 pt-1">
              
              {/* STUDENT LOGIN CARD */}
              <button
                onClick={() => navigate("/student-login")}
                className="w-full group p-4 sm:p-4.5 rounded-2xl border border-slate-200 hover:border-emerald-500/60 bg-slate-50/80 hover:bg-emerald-50/40 transition-all duration-200 flex items-center justify-between text-left shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900 group-hover:text-emerald-700 transition-colors">
                      Student Login
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Mark presence & view history
                    </p>
                  </div>
                </div>

                <div className="w-8 h-8 rounded-full bg-white text-slate-400 group-hover:text-emerald-600 flex items-center justify-center border border-slate-200 group-hover:border-emerald-300 shadow-sm shrink-0 transition-colors">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>

              {/* ADMIN & FACULTY ACCESS CARD */}
              <button
                onClick={() => navigate("/admin-login")}
                className="w-full group p-4 sm:p-4.5 rounded-2xl border border-slate-200 hover:border-slate-800 bg-slate-50/80 hover:bg-slate-900/5 transition-all duration-200 flex items-center justify-between text-left shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-[#0a2540] text-white flex items-center justify-center shadow-md shrink-0">
                    <Shield className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900 group-hover:text-slate-950 transition-colors">
                      Admin & Faculty Access
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      HOD, CA, & Faculty Portal
                    </p>
                  </div>
                </div>

                <div className="w-8 h-8 rounded-full bg-white text-slate-400 group-hover:text-slate-900 flex items-center justify-center border border-slate-200 group-hover:border-slate-300 shadow-sm shrink-0 transition-colors">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            </div>

            {/* Google Credentials Note */}
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-1 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Use institutional Google credentials (@canaraengineering.in)</span>
            </div>

            {/* Institutional Quote Box */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 flex items-start gap-3 text-left">
              <div className="p-1.5 bg-emerald-100 rounded-lg text-emerald-600 shrink-0 mt-0.5">
                <Leaf className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs sm:text-sm font-semibold text-slate-800 italic">
                  "Building a smarter campus for a brighter tomorrow."
                </p>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Canara Engineering College
                </p>
              </div>
            </div>

          </motion.div>
        </div>

        {/* BOTTOM RIGHT FOOTER */}
        <div className="relative z-10 flex items-center justify-center gap-4 text-xs font-semibold text-slate-400 pt-4">
          <span className="w-5 h-0.5 bg-emerald-500 rounded-full" />
          <span>Secure</span>
          <span>|</span>
          <span>Reliable</span>
          <span>|</span>
          <span>Future Ready</span>
        </div>

      </div>

    </div>
  );
};

export default Landing;
