import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Confetti from "react-confetti";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import Countdown from "../components/Countdown";
import StateBadge from "../components/StateBadge";
import { api, wsUrl } from "../lib/api";
import { useAuth, loginRedirect } from "../lib/auth";
import {
  Lightning, Users, CheckCircle, Lock, Storefront, ArrowRight,
  ReceiptX, ShieldCheck, Confetti as ConfettiIcon, Truck,
} from "@phosphor-icons/react";

export default function VPPDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [vpp, setVpp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [participants, setParticipants] = useState([]);
  const prevState = useRef(null);

  const load = async () => {
    const { data } = await api.get(`/vpps/${id}`);
    setVpp(data);
    setParticipants(data.recent_participants || []);
    setLoading(false);
    if (prevState.current && prevState.current !== data.state && (data.state === "powered" || data.state === "locked")) {
      setShowConfetti(true);
      toast.success("⚡ PARTY POWERED! Price locked.");
      setTimeout(() => setShowConfetti(false), 4500);
    }
    prevState.current = data.state;
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    let ws;
    let closed = false;
    try {
      ws = new WebSocket(wsUrl(`/api/ws/vpp/${id}`));
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.vpp) {
            setVpp((prev) => ({ ...(prev || {}), ...msg.vpp, recent_participants: prev?.recent_participants || [] }));
          }
          if (msg.type === "user_joined" && msg.user_name) {
            setParticipants((p) => [{ display_name: msg.user_name, joined_at: new Date().toISOString() }, ...p].slice(0, 10));
            toast(`${msg.user_name} just joined the party ⚡`);
          }
          if (msg.type === "state_change" && msg.vpp?.state && (msg.vpp.state === "powered" || msg.vpp.state === "locked")) {
            if (prevState.current !== msg.vpp.state) {
              setShowConfetti(true);
              toast.success("⚡ PARTY POWERED! Price locked.");
              setTimeout(() => setShowConfetti(false), 4500);
              prevState.current = msg.vpp.state;
            }
          }
        } catch {}
      };
    } catch {}
    return () => {
      closed = true;
      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        else if (ws) ws.onopen = () => ws.close();
      } catch {}
    };
  }, [id]);

  const handleJoin = async () => {
    if (!user) {
      loginRedirect();
      return;
    }
    setJoining(true);
    try {
      const { data } = await api.post(`/vpps/${id}/join`);
      setVpp((prev) => ({ ...prev, ...data.vpp, has_joined: true }));
      toast.success("You're in! ⚡");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to join");
    } finally {
      setJoining(false);
    }
  };

  if (loading || !vpp) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono text-sm uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  const progress = Math.min(100, vpp.progress_pct ?? 0);
  const remaining = Math.max(0, vpp.threshold - vpp.participants_count);
  const canCheckout = vpp.has_joined && !vpp.has_paid && (vpp.state === "locked" || vpp.state === "executing");
  const canJoin = vpp.state === "active" || (vpp.state === "locked" && !vpp.has_joined);

  return (
    <div className="min-h-screen bg-white">
      {showConfetti && <Confetti recycle={false} numberOfPieces={250} colors={["#FF5400", "#0021A5", "#FFD600", "#00C853"]} />}
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT: Product */}
        <div className="lg:col-span-7">
          <Link to="/browse" className="text-xs font-mono uppercase tracking-widest text-[#525252] hover:text-ink mb-4 inline-block">
            ← Back to parties
          </Link>

          <div className="border-2 border-ink bg-white shadow-brut overflow-hidden mb-6">
            <img src={vpp.image_url} alt={vpp.title} className="w-full aspect-[4/3] object-cover border-b-2 border-ink" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <StateBadge state={vpp.state} progressPct={progress} />
                <span className="border-2 border-ink bg-[#F4F4F4] px-2 py-1 text-[10px] font-bold uppercase tracking-widest font-mono">
                  {vpp.category}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-[#525252]">
                  <Storefront weight="bold" size={12} /> {vpp.supplier_name}
                </span>
              </div>

              <h1 className="font-display text-3xl sm:text-5xl uppercase tracking-tighter leading-[0.95] mb-4" data-testid="vpp-title">
                {vpp.title}
              </h1>
              <p className="text-[#525252] leading-relaxed mb-6">{vpp.description}</p>

              <div className="grid grid-cols-3 gap-3">
                <Tile label="Retail" value={`£${vpp.retail_price}`} muted />
                <Tile label="Party Price" value={`£${vpp.customer_price}`} highlight />
                <Tile label="You Save" value={`£${(vpp.retail_price - vpp.customer_price).toFixed(0)}`} accent />
              </div>
            </div>
          </div>

          {/* Recent participants */}
          <div className="border-2 border-ink bg-white shadow-brut p-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono text-[#525252] mb-3">Recent joiners</div>
            {participants.length === 0 ? (
              <div className="font-mono text-sm uppercase tracking-widest text-[#525252]">Be the first to join.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participants.map((p, i) => (
                  <div key={i} className="border-2 border-ink bg-[#F4F4F4] px-2 py-1 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-4 h-4 bg-[#FFD600] border border-ink flex items-center justify-center text-[9px] font-bold">
                      {p.display_name?.[0] || "?"}
                    </span>
                    {p.display_name || "Someone"}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Live Party Panel */}
        <div className="lg:col-span-5">
          <div className="sticky top-24 space-y-5">
            <div className="border-2 border-ink bg-ink text-white shadow-brut-lg p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono text-[#FFD600] mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF5400] animate-pulse" />
                Live Party
              </div>

              <div className="font-display text-5xl mb-1" data-testid="participants-count">
                {vpp.participants_count} <span className="text-2xl text-white/60">/ {vpp.threshold}</span>
              </div>
              <div className="font-mono text-xs uppercase tracking-widest mb-5 text-white/70">
                Members joined
              </div>

              <div className="h-5 border-2 border-white bg-ink relative overflow-hidden mb-3">
                <div
                  className="h-full"
                  style={{
                    width: `${progress}%`,
                    background: progress >= 100 ? "#00C853" : progress >= 75 ? "#FFD600" : "#FF5400",
                    transition: "width 600ms ease",
                  }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest font-mono mb-5">
                <span>{Math.round(progress)}% POWERED</span>
                <span className="text-[#FFD600]">{remaining > 0 ? `${remaining} TO GO` : "POWERED ⚡"}</span>
              </div>

              <div className="mb-5">
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-white/60 mb-2">Party closes in</div>
                <Countdown deadline={vpp.deadline} />
              </div>

              {vpp.has_paid ? (
                <div className="bg-[#00C853] text-ink border-2 border-white p-4 flex items-center gap-2 font-bold uppercase tracking-wider text-sm">
                  <CheckCircle weight="fill" size={20} /> Order Confirmed
                </div>
              ) : canCheckout ? (
                <button
                  onClick={() => navigate(`/checkout/${vpp.vpp_id}`)}
                  className="w-full bg-[#FF5400] text-white border-2 border-white font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2"
                  data-testid="checkout-btn"
                >
                  <Lock weight="fill" /> Checkout — £{vpp.customer_price}
                </button>
              ) : vpp.has_joined ? (
                <div className="bg-[#FFD600] text-ink border-2 border-white p-4 flex items-center gap-2 font-bold uppercase tracking-wider text-sm">
                  <Lightning weight="fill" size={20} /> You're In — Waiting for Lock
                </div>
              ) : canJoin ? (
                <button
                  onClick={handleJoin}
                  disabled={joining}
                  className="w-full bg-[#FF5400] text-white border-2 border-white font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2 disabled:opacity-60"
                  data-testid="join-party-btn"
                  id="join-vpp-button"
                >
                  <Lightning weight="fill" /> {joining ? "Joining..." : "Join Party"}
                </button>
              ) : (
                <div className="bg-[#525252] text-white border-2 border-white p-4 flex items-center gap-2 font-bold uppercase tracking-wider text-sm">
                  <ReceiptX weight="fill" size={20} /> Party {vpp.state}
                </div>
              )}

              <div className="mt-4 text-xs text-white/60 font-mono leading-relaxed">
                Joining is free. You only pay when the party powers up and the price locks.
              </div>
            </div>

            {/* Trust strip */}
            <div className="border-2 border-ink bg-white shadow-brut-sm p-4 space-y-2">
              {[
                { icon: ShieldCheck, text: "Locked price · No surprises" },
                { icon: Lock, text: "Stripe-secured payments" },
                { icon: Truck, text: "Supplier-direct fulfilment" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-xs font-mono uppercase tracking-tight">
                  <Icon weight="bold" size={16} className="text-[#FF5400]" /> {text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, muted, highlight, accent }) {
  const bg = highlight ? "#FFD600" : accent ? "#00C853" : "#F4F4F4";
  return (
    <div className="border-2 border-ink p-3 shadow-brut-sm" style={{ background: bg }}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1 text-ink/70">{label}</div>
      <div className={`font-display text-2xl ${muted ? "line-through text-ink/60" : ""}`}>{value}</div>
    </div>
  );
}
