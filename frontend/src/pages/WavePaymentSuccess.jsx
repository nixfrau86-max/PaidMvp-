import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import Confetti from "react-confetti";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { CheckCircle, ArrowRight, Wrench } from "@phosphor-icons/react";
import { logWarn } from "../lib/log";

export default function WavePaymentSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState("pending");
  const [attempts, setAttempts] = useState(0);

  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session_id");

  useEffect(() => {
    if (!sessionId) { navigate("/dashboard"); return; }
    let stopped = false;
    const poll = async (n = 0) => {
      if (stopped || n > 10) { if (!stopped) setStatus("timeout"); return; }
      try {
        const { data } = await api.get(`/wave-checkout/status/${sessionId}`);
        if (data.payment_status === "paid") { setStatus("paid"); return; }
        if (data.status === "expired") { setStatus("expired"); return; }
      } catch (err) { logWarn("Wave payment status poll error", err); }
      setAttempts(n + 1);
      setTimeout(() => poll(n + 1), 2000);
    };
    poll();
    return () => { stopped = true; };
  }, [sessionId, navigate]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      {status === "paid" && <Confetti recycle={false} numberOfPieces={300} colors={["#FF5400", "#0021A5", "#FFD600", "#00C853"]} />}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        {status === "paid" ? (
          <>
            <div className="inline-flex items-center justify-center w-20 h-20 bg-[#00C853] border-2 border-ink shadow-brut mb-6">
              <CheckCircle weight="fill" size={48} className="text-ink" />
            </div>
            <h1 className="font-display text-5xl sm:text-6xl uppercase tracking-tighter leading-[0.9] mb-4">Paid!<br />You're locked in.</h1>
            <p className="text-[#3A3A3A] mb-3 max-w-md mx-auto">
              Your bundled payment is complete. The supplier will dispatch the batch — you'll be notified when it's on the way.
            </p>
            <p className="text-[#3A3A3A] mb-8 max-w-md mx-auto font-mono text-xs uppercase tracking-widest inline-flex items-center gap-1">
              <Wrench weight="bold" size={12} /> If you booked a fitting, your garage + slot are now confirmed.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/dashboard" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2" data-testid="wave-success-dashboard">
                Go to My Waves <ArrowRight weight="bold" />
              </Link>
              <Link to="/waves" className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut">Browse Waves</Link>
            </div>
          </>
        ) : status === "expired" || status === "timeout" ? (
          <>
            <h1 className="font-display text-5xl uppercase mb-4">{status === "expired" ? "Payment expired" : "Still processing"}</h1>
            <p className="text-[#3A3A3A] mb-6">{status === "expired" ? "That session expired — please try again from My Waves." : "Your payment is taking a moment. Check My Waves shortly."}</p>
            <Link to="/dashboard" className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm">Go to My Waves</Link>
          </>
        ) : (
          <div className="border-2 border-ink bg-white shadow-brut p-10 inline-block">
            <div className="font-mono text-sm uppercase tracking-widest mb-2">▮ Confirming payment…</div>
            <div className="font-mono text-xs text-[#3A3A3A]">Attempt {attempts + 1}/10</div>
          </div>
        )}
      </div>
    </div>
  );
}
