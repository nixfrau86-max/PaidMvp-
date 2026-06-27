import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { track } from "../lib/firebase";
import { logWarn } from "../lib/log";
import { Lightning, MapPin, ArrowLeft } from "@phosphor-icons/react";
import { WaveProductStep } from "../components/wave/WaveProductStep";
import { WaveFulfilmentStep } from "../components/wave/WaveFulfilmentStep";
import { WaveProgressRail } from "../components/wave/WaveProgressRail";

export default function WaveDetail() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
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

  const authorised = !!user && (user.role === "consumer" || user.role === "admin");

  // Waves are members-only: anonymous → login; suppliers/garages → their console.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    if (user.role === "supplier") { navigate("/supplier", { replace: true }); return; }
    if (user.role === "garage") { navigate("/garage", { replace: true }); return; }
  }, [user, authLoading, navigate]);

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

  useEffect(() => { if (authorised) reload(); }, [reload, authorised]);

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

  if (authLoading || !authorised) {
    return (
      <div className="min-h-screen bg-slate-50 font-manrope" data-testid="wave-auth-gate"><Navbar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 text-sm font-medium text-slate-400">Loading…</div>
      </div>
    );
  }

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
            <WaveProductStep w={w} product={product} variant={variant} selProduct={selProduct} setSelProduct={setSelProduct} setSelVariant={setSelVariant} selVariant={selVariant} qty={qty} setQty={setQty} maxQty={maxQty} allowance={allowance} />

            {/* Step 2 */}
            <WaveFulfilmentStep w={w} garages={garages} garageId={garageId} setGarageId={setGarageId} slotDays={slotDays} slotsLoading={slotsLoading} selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot} address={address} setAddress={setAddress} />
          </div>

          {/* RIGHT: sticky rail */}
          <WaveProgressRail w={w} pct={pct} variant={variant} qty={qty} saving={saving} pulse={pulse} accepting={accepting} atCapacity={atCapacity} acceptTerms={acceptTerms} setAcceptTerms={setAcceptTerms} joining={joining} join={join} allowance={allowance} garageId={garageId} selectedSlot={selectedSlot} />
        </div>
      </div>
    </div>
  );
}
