import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import Confetti from "react-confetti";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { CheckCircle, ArrowRight } from "@phosphor-icons/react";

export default function CheckoutSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState("pending");
  const [attempts, setAttempts] = useState(0);

  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session_id");
  const vppId = params.get("vpp_id");

  useEffect(() => {
    if (!sessionId) { navigate("/dashboard"); return; }
    let stopped = false;
    const poll = async (n = 0) => {
      if (stopped || n > 10) return;
      try {
        const { data } = await api.get(`/checkout/status/${sessionId}`);
        if (data.payment_status === "paid") {
          setStatus("paid");
          return;
        }
        if (data.status === "expired") {
          setStatus("expired");
          return;
        }
      } catch (e) { /* ignore */ }
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
            <h1 className="font-display text-5xl sm:text-6xl uppercase tracking-tighter leading-[0.9] mb-4">
              Locked in!<br />Order confirmed.
            </h1>
            <p className="text-[#525252] mb-8 max-w-md mx-auto">
              You're part of this party. Once the supplier dispatches the batch, you'll get a tracking notification.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/dashboard" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2" data-testid="success-to-dashboard">
                Go to My Parties <ArrowRight weight="bold" />
              </Link>
              {vppId && (
                <Link to={`/vpp/${vppId}`} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut">
                  View Party
                </Link>
              )}
            </div>
          </>
        ) : status === "expired" ? (
          <>
            <h1 className="font-display text-5xl uppercase mb-4">Payment expired</h1>
            <Link to={`/vpp/${vppId}`} className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm">
              Try again
            </Link>
          </>
        ) : (
          <div className="border-2 border-ink bg-white shadow-brut p-10 inline-block">
            <div className="font-mono text-sm uppercase tracking-widest mb-2">▮ Confirming payment...</div>
            <div className="font-mono text-xs text-[#525252]">Attempt {attempts + 1}/10</div>
          </div>
        )}
      </div>
    </div>
  );
}
