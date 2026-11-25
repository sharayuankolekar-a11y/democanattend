import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/AppLayout";
import FaceChallengeCapture from "@/components/FaceChallengeCapture";
import { faceApi, getStudentApprovalPayload, isFaceServiceConfigured } from "@/lib/faceService";
import { getStoredStudentSession, validateStudentSession, clearStoredStudentSession } from "@/lib/studentAuth";
import { toast } from "@/components/ui/use-toast";

type Challenge = { turn: "left" | "right"; light: { colors: number[][]; stepMs: number } };

export default function FaceEnrollment() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState(false);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const session = getStoredStudentSession();
    const valid = validateStudentSession(session, "Face Enrollment");
    if (!valid.isValid || !session) { clearStoredStudentSession(); navigate("/student-login", { replace: true }); return; }
    if (!isFaceServiceConfigured()) { setLoading(false); setEnrolled(false); return; }
    faceApi<{ enrolled: boolean }>("/face/status", getStudentApprovalPayload())
      .then((result) => setEnrolled(result.enrolled))
      .catch((error) => toast({ variant: "destructive", title: "Face profile status unavailable", description: error.message }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const begin = async () => {
    setStarting(true);
    try {
      const result = await faceApi<{ challenge: Challenge; ticket: string }>("/face/enroll/begin", { ...getStudentApprovalPayload(), consent: true });
      setTicket(result.ticket);
      setChallenge(result.challenge);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not start enrollment", description: error instanceof Error ? error.message : "Please try again." });
    } finally { setStarting(false); }
  };

  const complete = async (frames: { phase: "front" | "light" | "turn"; t: number; image: string }[]) => {
    if (!ticket) throw new Error("Enrollment ticket expired. Start enrollment again.");
    try {
      await faceApi("/face/enroll/complete", { ...getStudentApprovalPayload(), ticket, frames });
      setChallenge(null); setTicket(null); setEnrolled(true);
      toast({ title: "Face profile enrolled", description: "Your face verification profile has been saved securely." });
    } catch (error) {
      setChallenge(null); setTicket(null);
      toast({ variant: "destructive", title: "Enrollment was not completed", description: error instanceof Error ? error.message : "Please start enrollment again." });
      throw error;
    }
  };

  const cancel = () => { setChallenge(null); setTicket(null); };

  return <AppLayout><div className="max-w-2xl mx-auto p-4 space-y-6">
    <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 text-sm text-slate-600"><ArrowLeft size={16}/> Back to Dashboard</button>
    <div className="bg-white border rounded-2xl p-6 space-y-4">
      <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center"><ShieldCheck /></div>
      <h1 className="text-2xl font-bold text-slate-900">Face enrollment</h1>
      <p className="text-sm text-slate-600">Register your face once so CanAttend can verify that the person scanning an attendance QR is the approved student.</p>
      {!isFaceServiceConfigured() && <p className="rounded-lg bg-amber-50 text-amber-800 p-3 text-sm">Face service is not configured yet. Set <code>VITE_FACE_SERVICE_URL</code> to your deployed face-service URL.</p>}
      {loading ? <div className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin"/> Checking your profile…</div> : enrolled ? <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2/> Face profile enrolled</div> : <>
        <label className="flex gap-3 items-start text-sm text-slate-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1"/><span>I consent to capturing face images to create an encrypted face template for attendance verification. I understand this is used for CanAttend attendance checks.</span></label>
        <button onClick={begin} disabled={!consent || starting || !isFaceServiceConfigured()} className="w-full rounded-xl bg-slate-900 text-white py-3 font-semibold disabled:opacity-50">{starting ? "Preparing…" : "Start face enrollment"}</button>
      </>}
    </div>
  </div>{challenge && <FaceChallengeCapture mode="enroll" challenge={challenge} onCancel={cancel} onComplete={complete}/>}</AppLayout>;
}
