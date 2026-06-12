import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { track } from "../lib/firebase";
import { Lightning, ArrowRight, ShieldCheck, MapPin, Minus, Plus, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";

const STATE_LABEL = {
  open: "Open — accepting members",
  almost_full: "Almost full — closing soon",
  activated: "Activated — minimum reached",
  processing: "Processing payments",
  fulfilment: "In fulfilment",
  completed: "Completed",
  expired: "Expired",
};

export default function WaveDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [w, setW] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);
  const [selProduct, setSelProduct] = useState("");
  const [selVariant, setSelVariant] = useState("");
  const [qty, setQty] = useState(1);
  const [garages, setGarages] = useState([]);
  const [garageId, setGarageId] = useState("");
  const [slotDays, setSlotDays] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null); // { iso, label, date }
  const [address, setAddress] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [joining, setJoining] = useState(false);
  const [allowance, setAllowance] = useState(null);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get(`/waves/${id}`);
      setW(data);
      if (data.products?.length) setSelProduct((prev) => prev || data.products[0].product_id);
    } catch (err) {
      console.error("wave fetch failed", err);
      toast.error("Wave not found");
      navigate("/waves");
    }
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (w?.category === "tyres") {
      api.get("/garages").then(({ data }) => setGarages(data)).catch((err) => console.warn("garages load failed", err));
    }
  }, [w?.category]);

  // Load fitting slots when a garage is selected (tyres only)
  useEffect(() => {
    if (w?.category !== "tyres" || !garageId) { setSlotDays([]); setSelectedSlot(null); return; }
    setSelectedSlot(null);
    setSlotsLoading(true);
    api.get(`/garages/${garageId}/slots?days=12&min_lead_days=2`)
      .then(({ data }) => setSlotDays((data.days || []).filter((d) => d.slots.length > 0)))
      .catch((err) => { console.warn("slots load failed", err); setSlotDays([]); })
      .finally(() => setSlotsLoading(false));
  }, [garageId, w?.category]);

  useEffect(() => {
    if (!w?.wave_id) return undefined;
    const ws = new WebSocket(wsUrl(`/api/ws/wave/${w.wave_id}`));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === "wave_update") {
          setW((prev) => prev ? { ...prev, units_committed: msg.units_committed ?? prev.units_committed, participants_count: msg.participants_count ?? prev.participants_count, state: msg.state ?? prev.state, progress_pct: msg.progress_pct ?? prev.progress_pct } : prev);
          setPulse(true);
          setTimeout(() => setPulse(false), 500);
        }
      } catch (err) { console.warn("Bad wave WS payload", err); }
    };
    return () => { try { ws.close(); } catch (err) { console.warn("WS close", err); } };
  }, [w?.wave_id]);

  const product = useMemo(() => (w?.products || []).find((p) => p.product_id === selProduct), [w, selProduct]);
  const variant = useMemo(() => (product?.variants || []).find((v) => v.variant_id === selVariant), [product, selVariant]);

  const loadAllowance = useCallback(() => {
    if (!w?.category || !user) { setAllowance(null); return; }
    api.get(`/me/unit-allowance?category=${w.category}`)
      .then(({ data }) => setAllowance(data))
      .catch(() => setAllowance(null));
  }, [w?.category, user]);

  useEffect(() => { loadAllowance(); }, [loadAllowance]);

  // Keep qty within both the variant stock AND the remaining annual allowance.
  const maxQty = useMemo(() => {
    const stock = variant?.available ?? 1;
    const rem = allowance ? allowance.remaining : stock;
    return Math.max(0, Math.min(stock, rem));
  }, [variant, allowance]);

  useEffect(() => {
    if (maxQty >= 1 && qty > maxQty) setQty(maxQty);
  }, [maxQty, qty]);

  const join = async () => {
    if (!user) {
      toast.info("Sign in to join this Wave");
      navigate("/login", { state: { from: `/wave/${id}` } });
      return;
    }
    if (!variant) { toast.error("Select a product option first"); return; }
    if (w.category === "tyres" && !garageId) { toast.error("Select an approved fitting garage"); return; }
    if (w.category === "tyres" && !selectedSlot) { toast.error("Pick a preferred fitting slot"); return; }
    if (w.category !== "tyres" && !address.trim()) { toast.error("Enter a delivery address"); return; }
    if (!acceptTerms) { toast.error("Please accept the Terms & Privacy to continue"); return; }
    setJoining(true);
    try {
      const payload = {
        items: [{ product_id: product.product_id, variant_id: variant.variant_id, qty }],
        accept_terms: true,
      };
      if (w.category === "tyres") {
        payload.garage_id = garageId;
        payload.fitting_slot_iso = selectedSlot.iso;
        payload.fitting_slot_label = selectedSlot.label;
      } else {
        payload.delivery_address = address.trim();
      }
      const { data } = await api.post(`/waves/${id}/join`, payload);
      track("wave_join", { wave_id: id, category: w.category, units: qty });
      toast.success(`Reserved ${qty} unit${qty > 1 ? "s" : ""} — secured for ${data.reservation_minutes} min. Card captured only on activation.`);
      reload();
      loadAllowance();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not join wave");
    } finally { setJoining(false); }
  };

  if (loading || !w) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading wave…</div>
      </div>
    );
  }

  const pct = w.progress_pct || 0;
  const atCapacity = (w.units_committed || 0) >= (w.ideal_target || 0);
  const accepting = ["open", "almost_full", "activated"].includes(w.state) && !atCapacity;
  const saving = variant ? Math.max(0, variant.retail_price - variant.wave_price) : 0;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Link to="/waves" className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 mb-4">← Back to Waves</Link>

        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6">
          {/* LEFT */}
          <div>
            <div className="border-2 border-ink bg-white shadow-brut overflow-hidden">
              <div className="relative h-44 sm:h-56 border-b-2 border-ink bg-ink flex items-end p-5" style={{ background: "linear-gradient(135deg,#0A0A0A,#2b2b2b 70%,#FF5400 160%)" }}>
                <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                  <span className="bg-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
                    <MapPin weight="fill" className="text-[#FF5400]" size={10} /> {w.region_name}
                  </span>
                  <span className="bg-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
                    <Lightning weight="fill" className="text-[#FF5400]" size={10} /> {w.category_label}
                  </span>
                </div>
                <span className="font-display text-white text-3xl sm:text-4xl uppercase tracking-tighter leading-none">{w.brand}</span>
              </div>
              <div className="p-5 sm:p-6">
                <h1 className="font-display text-3xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">{w.title}</h1>
                {w.description && <p className="mt-4 text-[15px] text-[#1A1A1A] leading-relaxed max-w-prose">{w.description}</p>}
                {w.eta && <div className="mt-3 font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">ETA · {w.eta}</div>}
              </div>
            </div>

            {/* Step 1: choose model + option */}
            <div className="mt-6 border-2 border-ink bg-white shadow-brut p-5 sm:p-6" data-testid="select-panel">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400]">Step 1</div>
              <h2 className="font-display text-2xl uppercase mb-4">Choose your product</h2>

              {w.products.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {w.products.map((p) => (
                    <button key={p.product_id} onClick={() => { setSelProduct(p.product_id); setSelVariant(""); }}
                      className={`border-2 border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-widest ${selProduct === p.product_id ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
                      data-testid={`product-tab-${p.product_id}`}>{p.model}</button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {(product?.variants || []).map((v) => {
                  const isSel = selVariant === v.variant_id;
                  const out = v.available <= 0;
                  return (
                    <button key={v.variant_id} disabled={out} onClick={() => setSelVariant(v.variant_id)}
                      className={`text-left border-2 border-ink p-3 transition-all ${isSel ? "bg-ink text-white shadow-brut-sm translate-x-[2px] translate-y-[2px]" : "bg-white shadow-brut-sm hover-brut"} ${out ? "opacity-40 cursor-not-allowed" : ""}`}
                      data-testid={`variant-tile-${v.variant_id}`}>
                      <div className="font-display text-lg tracking-tighter">{v.label}</div>
                      <div className="font-mono text-[11px] tracking-widest mt-1">£{v.wave_price.toFixed(2)}</div>
                      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70 mt-0.5 line-through">RRP £{v.retail_price.toFixed(0)}</div>
                      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70 mt-0.5">{out ? "Out of stock" : `${v.available} left`}</div>
                    </button>
                  );
                })}
              </div>

              {/* qty */}
              {variant && (
                <div className="mt-5 border-t-2 border-ink pt-4 flex items-center gap-4" data-testid="qty-row">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">Quantity</div>
                  <div className="inline-flex items-center border-2 border-ink">
                    <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="px-3 py-2 border-r-2 border-ink hover:bg-[#F4F4F4]" data-testid="qty-minus"><Minus weight="bold" size={12} /></button>
                    <span className="px-4 font-display text-xl tabular-nums" data-testid="qty-value">{qty}</span>
                    <button onClick={() => setQty((n) => Math.min(maxQty || 1, n + 1))} className="px-3 py-2 border-l-2 border-ink hover:bg-[#F4F4F4]" data-testid="qty-plus"><Plus weight="bold" size={12} /></button>
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-widest ml-auto">Subtotal £{(variant.wave_price * qty).toFixed(2)}</div>
                </div>
              )}
              {variant && allowance && (
                <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]" data-testid="annual-allowance">
                  Annual allowance · <span className="text-ink font-bold">{allowance.remaining}</span> of {allowance.limit} {w.category} units left in {allowance.year}
                  {allowance.override && <span className="text-[#00C853]"> · custom limit</span>}
                  {allowance.remaining <= 0 && <span className="text-[#FF5400]"> · limit reached for this year</span>}
                </div>
              )}
            </div>

            {/* Step 2: fulfilment */}
            <div className="mt-6 border-2 border-ink bg-white shadow-brut p-5 sm:p-6" data-testid="fulfilment-panel">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400]">Step 2</div>
              <h2 className="font-display text-2xl uppercase mb-4">{w.category === "tyres" ? "Choose your fitting garage" : "Delivery address"}</h2>
              {w.category === "tyres" ? (
                <>
                  <select value={garageId} onChange={(e) => setGarageId(e.target.value)} className="w-full border-2 border-ink px-3 py-3 font-mono text-sm bg-white" data-testid="garage-select">
                    <option value="">Select an approved local garage…</option>
                    {garages.map((g) => <option key={g.garage_id} value={g.garage_id}>{g.business_name || g.name} {g.postcode ? `· ${g.postcode}` : ""}</option>)}
                  </select>
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
                    Not sure of your size? It's printed on your tyre sidewall, e.g. <span className="text-ink font-bold">225/65 R18</span> (width / profile / rim).
                  </p>

                  {/* Fitting slot picker */}
                  {garageId && (
                    <div className="mt-5 border-t-2 border-ink pt-4" data-testid="slot-picker">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-1">Preferred fitting slot</div>
                      <p className="font-mono text-[10px] tracking-widest text-[#3A3A3A] mb-3">
                        Tyres arrive at your garage the next working day. Pick a 30-min slot 1–2 days after.
                      </p>
                      {slotsLoading ? (
                        <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">Loading slots…</div>
                      ) : slotDays.length === 0 ? (
                        <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No slots available — try another garage.</div>
                      ) : (
                        <div className="space-y-3 max-h-72 overflow-auto pr-1">
                          {slotDays.map((d) => (
                            <div key={d.date} data-testid={`slot-day-${d.date}`}>
                              <div className="font-mono text-[10px] font-bold uppercase tracking-widest mb-1.5">
                                {new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {d.slots.map((s) => {
                                  const isSel = selectedSlot?.iso === s.slot_iso;
                                  return (
                                    <button key={s.slot_iso} type="button"
                                      onClick={() => setSelectedSlot({ iso: s.slot_iso, label: `${new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${s.label}`, date: d.date })}
                                      className={`border-2 border-ink px-2.5 py-1.5 font-mono text-[11px] tracking-widest ${isSel ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
                                      data-testid={`slot-${s.slot_iso}`}>
                                      {s.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedSlot && (
                        <div className="mt-3 border-2 border-ink bg-[#00C853] text-ink p-2 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest" data-testid="selected-slot">
                          <CheckCircle weight="fill" size={12} /> {selectedSlot.label}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House / flat, street, town, postcode" rows={3} className="w-full border-2 border-ink px-3 py-3 font-mono text-sm" data-testid="delivery-address" />
              )}
            </div>
          </div>

          {/* RIGHT: progress + join */}
          <div className="lg:sticky lg:top-24 self-start">
            <div className={`border-2 border-ink bg-white shadow-brut p-5 sm:p-6 ${pulse ? "ring-4 ring-[#FF5400]" : ""} transition-all duration-300`}>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Wave Progress</div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-5xl tabular-nums" data-testid="wave-units">{w.units_committed || 0}</span>
                <span className="font-mono text-sm uppercase tracking-widest text-[#3A3A3A]">/ {w.ideal_target} Units</span>
              </div>
              <div className="mt-3 w-full h-3 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
                <div className="h-full bg-[#FF5400] transition-all duration-700" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]" data-testid="wave-state">
                {STATE_LABEL[w.state] || w.state} · activates at {w.min_activation} units
              </div>
              {w.carried_units > 0 && (
                <div className="mt-3 flex items-center gap-2 border-2 border-ink bg-[#FFE600] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest" data-testid="wave-carried">
                  <ArrowsClockwise weight="bold" size={14} /> {w.carried_units} units carried from previous wave
                </div>
              )}

              {variant && (
                <div className="mt-5 border-t-2 border-ink pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-1">Your Collective Price</div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-display text-3xl tracking-tighter">£{(variant.wave_price * qty).toFixed(2)}</span>
                    {saving > 0 && <span className="font-mono text-[11px] uppercase tracking-widest text-[#00C853]">You save £{(saving * qty).toFixed(2)}</span>}
                  </div>
                </div>
              )}

              {accepting ? (
                <>
                  <label className="mt-5 flex items-start gap-2 cursor-pointer" data-testid="accept-terms-label">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 w-4 h-4 accent-[#FF5400]" data-testid="accept-terms-checkbox" />
                    <span className="text-[11px] font-mono leading-relaxed text-[#1A1A1A]">
                      I agree to the <Link to="/terms" className="underline" target="_blank">Terms</Link> and <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>. My inventory is reserved now; payment is captured only when the Wave activates.
                    </span>
                  </label>
                  <button onClick={join} disabled={!variant || joining || !acceptTerms || (allowance && allowance.remaining <= 0) || (w.category === "tyres" && (!garageId || !selectedSlot))} className="mt-3 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-5 py-4 text-sm shadow-brut hover-brut inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" data-testid="join-wave-btn">
                    {joining ? "Reserving…" : (allowance && allowance.remaining <= 0) ? <>Annual limit reached</> : <>Join Wave <ArrowRight weight="bold" /></>}
                  </button>
                </>
              ) : (
                <div className="mt-5 border-2 border-ink bg-[#0021A5] text-white p-3 inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest" data-testid="wave-closed">
                  <CheckCircle weight="fill" /> {atCapacity ? "Fully subscribed — capacity reached" : (STATE_LABEL[w.state] || w.state)}
                </div>
              )}

              <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] flex items-center gap-1.5">
                <ShieldCheck weight="bold" /> Inventory reserved · charged only on activation
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
