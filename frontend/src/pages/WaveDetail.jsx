import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { track } from "../lib/firebase";
import { logWarn } from "../lib/log";
import { Lightning, ArrowRight, ShieldCheck, MapPin, Minus, Plus, CheckCircle, ArrowsClockwise, ArrowLeft, Info } from "@phosphor-icons/react";

const STATE_LABEL = {
  open: "Open — accepting members",
  almost_full: "Almost full — closing soon",
  activated: "Activated — minimum reached",
  processing: "Processing payments",
  fulfilment: "In fulfilment",
  completed: "Completed",
  expired: "Expired",
};

// Stable motion config (avoids recreating objects each render)
const BAR_INITIAL = { width: 0 };
const BAR_SPRING = { type: "spring", bounce: 0, duration: 1 };
const PULSE_ANIM = { scale: [1, 1.015, 1] };
const PULSE_REST = {};
const PULSE_TRANSITION = { duration: 0.5 };

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

  // Suppliers have no access to the consumer Waves marketplace.
  useEffect(() => {
    if (user?.role === "supplier") navigate("/supplier", { replace: true });
  }, [user, navigate]);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get(`/waves/${id}`);
      setW(data);
      if (data.products?.length) setSelProduct((prev) => prev || data.products[0].product_id);
    } catch {
      toast.error("Wave not found");
      navigate("/waves");
    }
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (w?.category === "tyres") {
      api.get("/garages").then(({ data }) => setGarages(data)).catch(() => setGarages([]));
    }
  }, [w?.category]);

  useEffect(() => {
    if (w?.category !== "tyres" || !garageId) { setSlotDays([]); setSelectedSlot(null); return; }
    setSelectedSlot(null);
    setSlotsLoading(true);
    api.get(`/garages/${garageId}/slots?days=12&min_lead_days=2`)
      .then(({ data }) => setSlotDays((data.days || []).filter((d) => d.slots.length > 0)))
      .catch(() => setSlotDays([]))
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
          setTimeout(() => setPulse(false), 600);
        }
      } catch (err) { logWarn("Ignoring malformed wave WS payload", err); }
    };
    return () => { try { ws.close(); } catch (err) { logWarn("WS close", err); } };
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
      if (data.merged) {
        toast.success(`Added ${qty} unit${qty > 1 ? "s" : ""} to your existing order on this Wave — one combined payment on activation.`);
      } else {
        toast.success(`Reserved ${qty} unit${qty > 1 ? "s" : ""} — secured for ${data.reservation_minutes} min. Card captured only on activation.`);
      }
      reload();
      loadAllowance();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not join wave");
    } finally { setJoining(false); }
  };

  if (loading || !w) {
    return (
      <div className="min-h-screen bg-slate-50 font-manrope"><Navbar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 text-sm font-medium text-slate-400">Loading wave…</div>
      </div>
    );
  }

  const pct = Math.min(100, w.progress_pct || 0);
  const atCapacity = (w.units_committed || 0) >= (w.ideal_target || 0);
  const accepting = ["open", "almost_full", "activated"].includes(w.state) && !atCapacity;
  const saving = variant ? Math.max(0, variant.retail_price - variant.wave_price) : 0;

  return (
    <div className="min-h-screen bg-slate-50 font-manrope text-slate-900">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <Link to="/waves" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-900 mb-5" data-testid="back-to-waves">
          <ArrowLeft weight="bold" size={15} /> Back to Waves
        </Link>

        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 items-start">
          {/* LEFT */}
          <div className="space-y-6">
            {/* Hero card */}
            <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.04)]">
              <div className="relative h-48 sm:h-56 isolate flex items-end p-6" style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 55%,#FF5400 190%)" }}>
                {w.image_url && <img src={w.image_url} alt={w.title} className="absolute inset-0 h-full w-full object-cover" />}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-transparent to-transparent" />
                <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 backdrop-blur">
                    <MapPin weight="fill" className="text-[#FF5400]" size={12} /> {w.region_name}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 backdrop-blur">
                    <Lightning weight="fill" className="text-[#FF5400]" size={12} /> {w.category_label}
                  </span>
                </div>
                <span className="relative font-outfit text-3xl sm:text-4xl font-bold uppercase tracking-tight text-white leading-none">{w.brand}</span>
              </div>
              <div className="p-6 sm:p-8">
                <h1 className="font-outfit text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-slate-900">{w.title}</h1>
                {w.description && <p className="mt-4 text-[15px] text-slate-600 leading-relaxed max-w-prose">{w.description}</p>}
                {w.eta && <div className="mt-4 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">ETA · {w.eta}</div>}
              </div>
            </div>

            {/* Step 1 */}
            <div className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8 shadow-[0_4px_20px_rgb(0,0,0,0.04)]" data-testid="select-panel">
              <div className="text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-1">Step 1</div>
              <h2 className="font-outfit text-2xl font-semibold tracking-tight mb-5">Choose your product</h2>

              {(w.products || []).length > 1 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {w.products.map((p) => (
                    <button key={p.product_id} onClick={() => { setSelProduct(p.product_id); setSelVariant(""); }}
                      className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors ${selProduct === p.product_id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      data-testid={`product-tab-${p.product_id}`}>
                      {p.image_url
                        ? <img src={p.image_url} alt={p.model} className="h-7 w-7 rounded-full object-cover ring-1 ring-black/10" />
                        : <span className="h-7 w-7 rounded-full bg-slate-200" />}
                      {p.model}
                    </button>
                  ))}
                </div>
              )}

              {product?.image_url && (
                <div className="mb-5 overflow-hidden rounded-2xl border border-slate-100" data-testid="product-hero-image">
                  <img src={product.image_url} alt={product.model} className="h-44 w-full object-cover" />
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {(product?.variants || []).map((v) => {
                  const isSel = selVariant === v.variant_id;
                  const out = v.available <= 0;
                  return (
                    <button key={v.variant_id} disabled={out} onClick={() => setSelVariant(v.variant_id)}
                      className={`text-left rounded-2xl border p-4 transition-all ${isSel ? "border-[#FF5400] bg-[#FFF8F4] ring-2 ring-[#FF5400]/20" : "border-slate-200 bg-white hover:border-slate-300"} ${out ? "opacity-40 cursor-not-allowed" : ""}`}
                      data-testid={`variant-tile-${v.variant_id}`}>
                      <div className="font-outfit text-lg font-semibold tracking-tight text-slate-900">{v.label}</div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-base font-bold tabular-nums text-slate-900">£{v.wave_price.toFixed(2)}</span>
                        <span className="text-xs text-slate-400 line-through tabular-nums">£{v.retail_price.toFixed(0)}</span>
                      </div>
                      <div className={`mt-1 text-[11px] font-semibold ${out ? "text-slate-400" : "text-emerald-600"}`}>{out ? "Out of stock" : `${v.available} left`}</div>
                    </button>
                  );
                })}
              </div>

              {variant && (
                <div className="mt-6 border-t border-slate-100 pt-5 flex items-center gap-4 flex-wrap" data-testid="qty-row">
                  <div className="text-sm font-semibold text-slate-500">Quantity</div>
                  <div className="inline-flex items-center rounded-xl border border-slate-200 overflow-hidden">
                    <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="px-3.5 py-2.5 text-slate-600 transition-colors hover:bg-slate-50" data-testid="qty-minus"><Minus weight="bold" size={13} /></button>
                    <span className="px-5 font-outfit text-lg font-semibold tabular-nums" data-testid="qty-value">{qty}</span>
                    <button onClick={() => setQty((n) => Math.min(maxQty || 1, n + 1))} className="px-3.5 py-2.5 text-slate-600 transition-colors hover:bg-slate-50" data-testid="qty-plus"><Plus weight="bold" size={13} /></button>
                  </div>
                  <div className="ml-auto text-sm font-semibold text-slate-500">Subtotal <span className="text-slate-900 tabular-nums">£{(variant.wave_price * qty).toFixed(2)}</span></div>
                </div>
              )}
              {variant && allowance && (
                <div className="mt-4 inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-500" data-testid="annual-allowance">
                  Annual allowance · <span className="font-bold text-slate-900 tabular-nums">{allowance.remaining}</span> of {allowance.limit} {w.category} units left in {allowance.year}
                  {allowance.override && <span className="text-emerald-600">· custom limit</span>}
                  {allowance.remaining <= 0 && <span className="text-[#FF5400]">· limit reached for {allowance.year}</span>}
                </div>
              )}
            </div>

            {/* Step 2 */}
            <div className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8 shadow-[0_4px_20px_rgb(0,0,0,0.04)]" data-testid="fulfilment-panel">
              <div className="text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-1">Step 2</div>
              <h2 className="font-outfit text-2xl font-semibold tracking-tight mb-5">{w.category === "tyres" ? "Choose your fitting garage" : "Delivery address"}</h2>
              {w.category === "tyres" ? (
                <>
                  <select value={garageId} onChange={(e) => setGarageId(e.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-[#FF5400] focus:ring-2 focus:ring-[#FF5400]/15" data-testid="garage-select">
                    <option value="">Select an approved local garage…</option>
                    {garages.map((g) => <option key={g.garage_id} value={g.garage_id}>{g.business_name || g.name} {g.postcode ? `· ${g.postcode}` : ""}</option>)}
                  </select>
                  <p className="mt-3 text-xs text-slate-400">
                    Not sure of your size? It's printed on your tyre sidewall, e.g. <span className="font-semibold text-slate-600">225/65 R18</span> (width / profile / rim).
                  </p>
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-xs font-medium text-amber-800" data-testid="fitting-charge-notice">
                    <Info weight="fill" size={15} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>Your wave price covers the <span className="font-semibold">tyres only</span>. The fitting service is arranged with and <span className="font-semibold">charged separately by the garage</span> on the day.</span>
                  </div>

                  {garageId && (
                    <div className="mt-5 border-t border-slate-100 pt-5" data-testid="slot-picker">
                      <div className="text-sm font-semibold text-slate-700 mb-1">Preferred fitting slot</div>
                      <p className="text-xs text-slate-400 mb-4">Tyres arrive at your garage the next working day. Pick a 30-min slot 1–2 days after.</p>
                      {slotsLoading ? (
                        <div className="text-sm font-medium text-slate-400">Loading slots…</div>
                      ) : slotDays.length === 0 ? (
                        <div className="text-sm font-medium text-slate-400">No slots available — try another garage.</div>
                      ) : (
                        <div className="space-y-4 max-h-72 overflow-auto pr-1">
                          {slotDays.map((d) => (
                            <div key={d.date} data-testid={`slot-day-${d.date}`}>
                              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                {new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {d.slots.map((s) => {
                                  const isSel = selectedSlot?.iso === s.slot_iso;
                                  const showLeft = (s.capacity || 1) > 1 && s.remaining != null;
                                  return (
                                    <button key={s.slot_iso} type="button"
                                      onClick={() => setSelectedSlot({ iso: s.slot_iso, label: `${new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${s.label}`, date: d.date })}
                                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${isSel ? "border-[#FF5400] bg-[#FF5400] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                                      data-testid={`slot-${s.slot_iso}`}>
                                      {s.label}{showLeft && <span className={`ml-1 text-[10px] font-medium ${isSel ? "text-white/80" : "text-emerald-600"}`}>· {s.remaining} left</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedSlot && (
                        <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700" data-testid="selected-slot">
                          <CheckCircle weight="fill" size={14} /> {selectedSlot.label}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House / flat, street, town, postcode" rows={3} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-[#FF5400] focus:ring-2 focus:ring-[#FF5400]/15" data-testid="delivery-address" />
              )}
            </div>
          </div>

          {/* RIGHT: sticky rail */}
          <div className="lg:sticky lg:top-24 self-start">
            <motion.div animate={pulse ? PULSE_ANIM : PULSE_REST} transition={PULSE_TRANSITION}
              className={`rounded-3xl border bg-white p-6 sm:p-8 shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-colors ${pulse ? "border-[#FF5400]" : "border-slate-100"}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-3">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#FF5400] opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FF5400]" />
                </span>
                Live Wave Progress
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-outfit text-5xl font-bold tabular-nums text-slate-900" data-testid="wave-units">{w.units_committed || 0}</span>
                <span className="text-sm font-semibold text-slate-400">/ {w.ideal_target} units</span>
                <span className="ml-auto font-outfit text-2xl font-bold tabular-nums text-[#FF5400]">{pct.toFixed(0)}%</span>
              </div>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div className="h-full rounded-full bg-[#FF5400]" initial={BAR_INITIAL} animate={{ width: `${pct}%` }} transition={BAR_SPRING} />
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500" data-testid="wave-state">
                {STATE_LABEL[w.state] || w.state} · activates at {w.min_activation} units
              </div>
              {w.carried_units > 0 && (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-700" data-testid="wave-carried">
                  <ArrowsClockwise weight="bold" size={14} /> {w.carried_units} units carried from previous wave
                </div>
              )}

              {variant && (
                <div className="mt-6 border-t border-slate-100 pt-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Your Collective Price</div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-outfit text-4xl font-bold tracking-tight tabular-nums text-slate-900">£{(variant.wave_price * qty).toFixed(2)}</span>
                    {saving > 0 && <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600 tabular-nums">You save £{(saving * qty).toFixed(2)}</span>}
                  </div>
                </div>
              )}

              {accepting ? (
                <>
                  <label className="mt-6 flex items-start gap-2.5 cursor-pointer" data-testid="accept-terms-label">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-[#FF5400]" data-testid="accept-terms-checkbox" />
                    <span className="text-xs leading-relaxed text-slate-500">
                      I agree to the <Link to="/terms" className="font-semibold text-slate-700 underline" target="_blank">Terms</Link> and <Link to="/privacy" className="font-semibold text-slate-700 underline" target="_blank">Privacy Policy</Link>. My inventory is reserved now; payment is captured only when the Wave activates.
                    </span>
                  </label>
                  <button onClick={join} disabled={!variant || joining || !acceptTerms || (allowance && allowance.remaining <= 0) || (w.category === "tyres" && (!garageId || !selectedSlot))} className="mt-4 w-full rounded-xl bg-[#FF5400] px-6 py-4 text-sm font-bold text-white shadow-sm shadow-[#FF5400]/25 transition-colors hover:bg-[#E64A00] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2" data-testid="join-wave-btn">
                    {joining ? "Reserving…" : (allowance && allowance.remaining <= 0) ? <>Annual limit reached</> : <>Join Wave <ArrowRight weight="bold" /></>}
                  </button>
                </>
              ) : (
                <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white" data-testid="wave-closed">
                  <CheckCircle weight="fill" /> {atCapacity ? "Fully subscribed — capacity reached" : (STATE_LABEL[w.state] || w.state)}
                </div>
              )}

              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <ShieldCheck weight="bold" size={14} /> Inventory reserved · charged only on activation
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
