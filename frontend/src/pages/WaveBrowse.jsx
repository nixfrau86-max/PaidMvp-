import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { logError, logWarn } from "../lib/log";
import { MagnifyingGlass, ArrowRight, Lightning, Users, MapPin, ArrowsClockwise } from "@phosphor-icons/react";

const CATEGORY_GRADIENT = {
  tyres: "linear-gradient(135deg,#1e293b 0%,#0f172a 55%,#FF5400 180%)",
  electronics: "linear-gradient(135deg,#1e3a8a 0%,#0f172a 55%,#0ea5e9 190%)",
  footwear: "linear-gradient(135deg,#4c1d95 0%,#1e1b4b 55%,#FF5400 200%)",
  default: "linear-gradient(135deg,#334155 0%,#0f172a 55%,#FF5400 200%)",
};

const STATE_STYLE = {
  open: { label: "Open", cls: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  almost_full: { label: "Almost Full", cls: "bg-amber-50 text-amber-600 border-amber-100" },
  activated: { label: "Activated", cls: "bg-[#FFF2EC] text-[#FF5400] border-[#FF5400]/20" },
  processing: { label: "Processing", cls: "bg-sky-50 text-sky-600 border-sky-100" },
  fulfilment: { label: "Fulfilment", cls: "bg-indigo-50 text-indigo-600 border-indigo-100" },
  completed: { label: "Completed", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function savingsBand(wave) {
  const pcts = [];
  (wave.products || []).forEach((p) =>
    (p.variants || []).forEach((v) => {
      if (v.retail_price > 0) pcts.push(((v.retail_price - v.wave_price) / v.retail_price) * 100);
    })
  );
  if (!pcts.length) return null;
  const lo = Math.floor(Math.min(...pcts));
  const hi = Math.ceil(Math.max(...pcts));
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

const selectCls =
  "w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-[#FF5400] focus:ring-2 focus:ring-[#FF5400]/15";

// Stable motion config (avoids recreating objects on every render)
const CARD_HOVER = { y: -4 };
const CARD_SPRING = { type: "spring", stiffness: 300, damping: 24 };
const BAR_INITIAL = { width: 0 };
const BAR_SPRING = { type: "spring", bounce: 0, duration: 1 };

export default function WaveBrowse() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [regionId, setRegionId] = useState("");
  const [q, setQ] = useState("");

  // Suppliers have no access to the consumer Waves marketplace — send them to their console.
  useEffect(() => {
    if (user?.role === "supplier") navigate("/supplier", { replace: true });
  }, [user, navigate]);

  const reload = useCallback(async () => {
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    if (regionId) search.set("region_id", regionId);
    if (q) search.set("q", q);
    try {
      const { data } = await api.get("/waves" + (search.toString() ? `?${search}` : ""));
      setWaves(data);
    } catch (err) {
      logError("Failed to refresh waves", err);
    } finally {
      setLoading(false);
    }
  }, [category, regionId, q]);

  useEffect(() => {
    (async () => {
      try {
        const [r, c] = await Promise.all([api.get("/regions"), api.get("/wave-categories")]);
        setRegions(r.data);
        setCategories(c.data);
      } catch (err) { logWarn("Filters failed to load", err); }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl("/api/ws/waves"));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.wave_id) {
          setWaves((prev) => prev.map((w) =>
            w.wave_id === msg.wave_id
              ? { ...w, units_committed: msg.units_committed ?? w.units_committed, participants_count: msg.participants_count ?? w.participants_count, state: msg.state ?? w.state, progress_pct: msg.progress_pct ?? w.progress_pct }
              : w
          ));
        }
      } catch (err) { logWarn("Ignoring malformed waves WS payload", err); }
    };
    return () => { try { ws.close(); } catch (err) { logWarn("WS close", err); } };
  }, []);

  const totalMembers = waves.reduce((a, w) => a + (w.participants_count || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 font-manrope text-slate-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        {/* Hero */}
        <div className="mb-10">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#FF5400] mb-4 font-manrope">
            Regional Product Waves<sup className="ml-0.5">©</sup>
          </div>
          <h1 className="font-outfit font-bold text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.02] max-w-3xl text-slate-900">
            One region. One product.<br />
            <span className="text-[#FF5400]">One collective price.</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-500 max-w-2xl leading-relaxed">
            Join an active Wave near you — momentum unlocks supplier pricing the high street can&apos;t match.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 items-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_4px_20px_rgb(0,0,0,0.03)]" data-testid="stat-live-waves">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#FF5400] opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FF5400]" />
              </span>
              <Lightning weight="fill" className="text-[#FF5400]" size={15} />
              <span className="tabular-nums">{waves.length}</span> Live Waves
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_4px_20px_rgb(0,0,0,0.03)]" data-testid="stat-members">
              <Users weight="fill" className="text-slate-400" size={15} />
              <span className="tabular-nums">{totalMembers.toLocaleString()}</span> Members Joined
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_rgb(0,0,0,0.04)] grid sm:grid-cols-[1fr_1fr_1.3fr_auto] gap-4 items-end" data-testid="wave-filters">
          <label className="block">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} data-testid="filter-category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Region</div>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className={selectCls} data-testid="filter-region">
              <option value="">All regions</option>
              {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Search</div>
            <div className="relative">
              <MagnifyingGlass weight="bold" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Continental, OLED, 225/65 R18…" className={`${selectCls} pl-10`} data-testid="wave-search-input" />
            </div>
          </label>
          <button onClick={() => { setCategory(""); setRegionId(""); setQ(""); }} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50" data-testid="wave-reset-btn">
            Reset
          </button>
        </div>

        {/* Grid */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6" data-testid="wave-grid">
          {loading && <div className="text-sm font-medium text-slate-400 col-span-full">Loading waves…</div>}
          {!loading && waves.length === 0 && (
            <div className="col-span-full rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
              <div className="font-outfit font-semibold text-2xl mb-2 text-slate-900">No waves match.</div>
              <p className="text-sm text-slate-500">Try a different region, category or reset your filters.</p>
            </div>
          )}
          {waves.map((w) => <WaveCard key={w.wave_id} w={w} />)}
        </div>
      </div>
    </div>
  );
}

function WaveCard({ w }) {
  const pct = Math.min(100, w.progress_pct || 0);
  const band = savingsBand(w);
  const state = STATE_STYLE[w.state] || STATE_STYLE.open;
  const variantCount = (w.products || []).reduce((a, p) => a + (p.variants || []).length, 0);
  return (
    <motion.div whileHover={CARD_HOVER} transition={CARD_SPRING}>
      <Link
        to={`/wave/${w.wave_id}`}
        className="group flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_4px_20px_rgb(0,0,0,0.03)] transition-shadow duration-300 hover:shadow-[0_16px_44px_rgb(0,0,0,0.10)]"
        data-testid={`wave-card-${w.wave_id}`}
      >
        {/* Image / gradient header */}
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl isolate" style={{ background: CATEGORY_GRADIENT[w.category] || CATEGORY_GRADIENT.default }}>
          {w.image_url && (
            <img src={w.image_url} alt={w.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-between p-3.5">
            <div className="flex flex-wrap items-start gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur">
                <MapPin weight="fill" className="text-[#FF5400]" size={11} /> {w.region_name}
              </span>
              {w.carried_units > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-900" data-testid={`wave-carried-${w.wave_id}`}>
                  <ArrowsClockwise weight="bold" size={11} /> +{w.carried_units}
                </span>
              )}
            </div>
            <div className="font-outfit text-2xl font-bold uppercase tracking-tight text-white/95 leading-none">{w.brand}</div>
          </div>
          {band && (
            <div className="absolute bottom-3.5 right-3.5 rounded-full bg-[#FF5400] px-3 py-1 text-[11px] font-bold text-white shadow-sm">Save {band}</div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">{w.category_label} · {w.brand}</div>
            <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${state.cls}`}>{state.label}</span>
          </div>
          <div className="font-outfit text-xl font-semibold tracking-tight text-slate-900 leading-snug mt-1.5">{w.title}</div>

          {/* Progress */}
          <div className="mt-auto pt-5">
            <div className="flex items-baseline justify-between text-xs font-semibold mb-2">
              <span className="text-slate-700 tabular-nums">{w.units_committed || 0}<span className="text-slate-400">/{w.ideal_target}</span> units</span>
              <span className="text-[#FF5400] tabular-nums">{pct.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <motion.div className="h-full rounded-full bg-[#FF5400]" initial={BAR_INITIAL} animate={{ width: `${pct}%` }} transition={BAR_SPRING} />
            </div>
            <div className="mt-3.5 flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-400">{variantCount} option{variantCount === 1 ? "" : "s"}</span>
              <span className="inline-flex items-center gap-1 text-[#FF5400] transition-transform group-hover:translate-x-0.5">View Wave <ArrowRight weight="bold" size={13} /></span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
