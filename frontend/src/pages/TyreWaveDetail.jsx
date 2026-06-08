import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { track } from "../lib/firebase";
import {
  Lightning, Lock, ArrowRight, CheckCircle, Clock, ShieldCheck, X,
  CaretDown, Sparkle,
} from "@phosphor-icons/react";

const AVAIL_LABEL = {
  in_stock: { label: "In Stock", color: "#00C853" },
  limited: { label: "Limited Availability", color: "#FFD600" },
  supplier_confirming: { label: "Supplier Confirming", color: "#0021A5", text: "#fff" },
  out_of_stock: { label: "Out of Stock", color: "#525252", text: "#fff" },
};

export default function TyreWaveDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pg, setPg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState("");
  const [joining, setJoining] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get(`/tyre/waves/${id}`);
      setPg(data);
      setSelectedSize(data.selected_size || "");
    } catch (err) {
      console.error("Tyre wave fetch failed", err);
      toast.error("Wave not found");
      navigate("/tyres");
    }
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { reload(); }, [reload]);

  // Real-time wave updates
  useEffect(() => {
    if (!pg?.wave?.wave_id) return undefined;
    const ws = new WebSocket(wsUrl(`/api/ws/tyrewave/${pg.wave.wave_id}`));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.wave) {
          setPg((prev) => prev ? { ...prev, wave: msg.wave } : prev);
          setPulse(true);
          setTimeout(() => setPulse(false), 500);
        }
      } catch (err) {
        console.warn("Bad tyrewave WS payload", err);
      }
    };
    return () => {
      try { ws.close(); } catch (err) { console.warn("WS close error", err); }
    };
  }, [pg?.wave?.wave_id]);

  const selectedSizeDoc = useMemo(
    () => (pg?.sizes || []).find((s) => s.tyre_size === selectedSize),
    [pg, selectedSize]
  );

  const join = async () => {
    if (!user) {
      toast.info("Sign in to join this Wave");
      navigate("/login", { state: { from: `/tyre-wave/${id}` } });
      return;
    }
    if (!selectedSize) { toast.error("Pick your tyre size first"); return; }
    if (!acceptTerms && !pg.has_joined) {
      toast.error("Please accept the Terms & Privacy to continue");
      return;
    }
    setJoining(true);
    try {
      // Log T&Cs acceptance BEFORE join so the audit trail captures intent
      if (!pg.has_joined) {
        try {
          await Promise.all([
            api.post("/terms/accept", { doc_id: "terms", version: "1.0", context: `tyre_join:${id}` }),
            api.post("/terms/accept", { doc_id: "privacy", version: "1.0", context: `tyre_join:${id}` }),
          ]);
        } catch (err) {
          console.warn("Terms acceptance log failed", err);
        }
      }
      const { data } = await api.post(`/tyre/waves/${id}/join`, { selected_size: selectedSize });
      if (data?.wave) setPg((prev) => ({ ...prev, wave: data.wave, has_joined: true, selected_size: data.selected_size }));
      track("tyre_wave_join", {
        wave_id: data?.wave?.wave_id || id,
        product_group_id: id,
        selected_size: selectedSize,
        already_joined: Boolean(data?.already_joined),
      });
      toast.success(data.already_joined ? "Updated size" : "Joined — card will be charged only when the Wave fills");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not join wave");
    } finally { setJoining(false); }
  };

  if (loading || !pg) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading wave…</div>
      </div>
    );
  }

  const wave = pg.wave;
  const stats = pg.stats || {};
  const pct = wave.progress_pct || 0;
  const locked = wave.state === "locked";
  const [lo, hi] = stats.savings_band_pct || [15, 25];

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Link to="/tyres" className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 mb-4">
          ← Back to Waves
        </Link>

        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6">
          {/* LEFT: Hero + sizes */}
          <div>
            <div className="border-2 border-ink bg-white shadow-brut overflow-hidden">
              <div className="relative h-56 sm:h-72 border-b-2 border-ink bg-[#F4F4F4] overflow-hidden">
                <img src={pg.hero_image_url} alt="" className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                  <span className="bg-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
                    <Lightning weight="fill" className="text-[#FF5400]" size={10} /> Live Wave
                  </span>
                  {locked && (
                    <span className="bg-[#00C853] border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
                      <Lock weight="fill" size={10}/> Locked
                    </span>
                  )}
                </div>
                <div className="absolute bottom-3 right-3 bg-ink text-white font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
                  Estimated save {lo}–{hi}%
                </div>
              </div>
              <div className="p-5 sm:p-6">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF5400] mb-2">{pg.brand}</div>
                <h1 className="font-display text-3xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">{pg.model}</h1>
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A] mt-2">{pg.category}</div>
                {pg.description && (
                  <p className="mt-4 text-[15px] text-[#1A1A1A] leading-relaxed max-w-prose">{pg.description}</p>
                )}
              </div>
            </div>

            {/* Sizes panel */}
            <div className="mt-6 border-2 border-ink bg-white shadow-brut p-5 sm:p-6" data-testid="sizes-panel">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400]">Step 1</div>
                  <h2 className="font-display text-2xl uppercase">Select your size</h2>
                </div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A]">{stats.size_count} sizes · {stats.total_inventory} units</span>
              </div>

              {/* size dropdown for mobile/quick */}
              <div className="grid sm:hidden mb-4">
                <div className="relative">
                  <select
                    value={selectedSize}
                    onChange={(e) => setSelectedSize(e.target.value)}
                    className="w-full border-2 border-ink px-3 py-3 font-mono text-base appearance-none bg-white"
                    data-testid="size-select"
                  >
                    <option value="">Choose a size…</option>
                    {pg.sizes.map((s) => (
                      <option key={s.size_id} value={s.tyre_size} disabled={s.availability === "out_of_stock"}>
                        {s.tyre_size} {s.availability === "out_of_stock" ? "· Out of Stock" : ""}
                      </option>
                    ))}
                  </select>
                  <CaretDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" weight="bold" />
                </div>
              </div>

              {/* size grid (sm+) */}
              <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 gap-3">
                {pg.sizes.map((s) => {
                  const meta = AVAIL_LABEL[s.availability] || AVAIL_LABEL.in_stock;
                  const isSel = selectedSize === s.tyre_size;
                  const disabled = s.availability === "out_of_stock";
                  return (
                    <button
                      key={s.size_id}
                      onClick={() => !disabled && setSelectedSize(s.tyre_size)}
                      disabled={disabled}
                      className={`text-left border-2 border-ink p-3 transition-all ${isSel ? "bg-ink text-white shadow-brut-sm translate-x-[2px] translate-y-[2px]" : "bg-white shadow-brut-sm hover-brut"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                      data-testid={`size-tile-${s.tyre_size}`}
                    >
                      <div className="font-display text-lg tracking-tighter">{s.tyre_size}</div>
                      <div className="font-mono text-[10px] uppercase tracking-widest mt-1 flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5" style={{ background: meta.color }} />
                        {meta.label}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-widest opacity-70 mt-0.5">
                        ETA {s.eta_days}d · RRP £{s.retail_price.toFixed(0)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected size details */}
              {selectedSizeDoc && (
                <div className="mt-5 border-t-2 border-ink pt-4 grid sm:grid-cols-3 gap-4" data-testid="size-summary">
                  <InfoTile label="Availability" value={(AVAIL_LABEL[selectedSizeDoc.availability] || AVAIL_LABEL.in_stock).label} />
                  <InfoTile label="Estimated Delivery" value={`${selectedSizeDoc.eta_days}–${selectedSizeDoc.eta_days + 2} Days`} />
                  <InfoTile label="High-street RRP" value={`£${selectedSizeDoc.retail_price.toFixed(2)}`} />
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Wave + Join */}
          <div className="lg:sticky lg:top-24 self-start">
            <div className={`border-2 border-ink bg-white shadow-brut p-5 sm:p-6 ${pulse ? "ring-4 ring-[#FF5400]" : ""} transition-all duration-300`}>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Wave Progress</div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-5xl tabular-nums" data-testid="wave-count">{wave.participants_count}</span>
                <span className="font-mono text-sm uppercase tracking-widest text-[#3A3A3A]">/ {wave.target_count} Joined</span>
              </div>
              <div className="mt-3 w-full h-3 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
                <div
                  className="h-full bg-[#FF5400] transition-all duration-700"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
                {locked ? "Wave locked — supplier confirming dispatch" :
                  pct >= 90 ? "Estimated unlock: Today" :
                  pct >= 60 ? "Estimated unlock: 24h" :
                  pct >= 30 ? "Estimated unlock: This week" : "Filling up quickly"}
              </div>

              {/* Price reveal */}
              <div className="mt-5 border-t-2 border-ink pt-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-1">Your Collective Price</div>
                {locked ? (
                  <div className="font-display text-3xl tracking-tighter">Revealed at checkout</div>
                ) : (
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-display text-2xl tracking-tighter inline-flex items-center gap-2">
                      <Lock weight="bold" /> Unlocks at completion
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-widest text-[#FF5400]">Est. save {lo}–{hi}%</span>
                  </div>
                )}
              </div>

              {/* CTA */}
              {pg.has_joined ? (
                <div className="mt-5 border-2 border-ink bg-[#00C853] text-ink p-3 inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest">
                  <CheckCircle weight="fill" /> You&apos;re in — size {pg.selected_size}
                </div>
              ) : (
                <>
                  <label className="mt-5 flex items-start gap-2 cursor-pointer" data-testid="accept-terms-label">
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-1 w-4 h-4 accent-[#FF5400]"
                      data-testid="accept-terms-checkbox"
                    />
                    <span className="text-[11px] font-mono leading-relaxed text-[#1A1A1A]">
                      I agree to the <Link to="/terms" className="underline" target="_blank">Terms of Service</Link>
                      {" "}and <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>,
                      and authorise a card pre-authorisation that will only be captured when this Wave fills.
                    </span>
                  </label>
                  <button
                    onClick={join}
                    disabled={!selectedSize || joining || locked || !acceptTerms}
                    className="mt-3 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-5 py-4 text-sm shadow-brut hover-brut inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="join-wave-btn"
                  >
                    {joining ? "Joining…" : <>Join Wave <ArrowRight weight="bold" /></>}
                  </button>
                </>
              )}

              <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] flex items-center gap-1.5">
                <ShieldCheck weight="bold" /> Pre-authorise now · Charged only when Wave fills
              </div>
            </div>

            {/* Trust strip */}
            <div className="mt-4 border-2 border-ink bg-white shadow-brut-sm p-4 grid grid-cols-3 gap-3 text-center">
              <Trust label="One supplier" sub="One batch" />
              <Trust label="Locked price" sub="On unlock" />
              <Trust label="No charge" sub="Until filled" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="border-2 border-ink bg-[#FAFAFA] p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">{label}</div>
      <div className="font-display text-lg tracking-tight mt-0.5">{value}</div>
    </div>
  );
}

function Trust({ label, sub }) {
  return (
    <div>
      <div className="font-bold uppercase text-[10px] tracking-widest font-mono">{label}</div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">{sub}</div>
    </div>
  );
}
