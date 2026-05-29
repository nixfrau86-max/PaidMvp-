import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { MagnifyingGlass, ArrowRight, Lightning, Users, MapPin } from "@phosphor-icons/react";

const CATEGORY_GRADIENT = {
  tyres: "linear-gradient(135deg,#0A0A0A 0%,#2b2b2b 60%,#FF5400 140%)",
  electronics: "linear-gradient(135deg,#0021A5 0%,#101a4d 60%,#00C853 160%)",
  footwear: "linear-gradient(135deg,#3A0A4A 0%,#1b1b1b 60%,#FFD600 170%)",
};

const STATE_BADGE = {
  open: { label: "Open", bg: "#00C853" },
  almost_full: { label: "Almost Full", bg: "#FFD600" },
  activated: { label: "Activated", bg: "#0021A5", text: "#fff" },
  processing: { label: "Processing", bg: "#FF5400", text: "#fff" },
  fulfilment: { label: "Fulfilment", bg: "#0021A5", text: "#fff" },
  completed: { label: "Completed", bg: "#525252", text: "#fff" },
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

export default function WaveBrowse() {
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [regionId, setRegionId] = useState("");
  const [q, setQ] = useState("");

  const reload = useCallback(async () => {
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    if (regionId) search.set("region_id", regionId);
    if (q) search.set("q", q);
    try {
      const { data } = await api.get("/waves" + (search.toString() ? `?${search}` : ""));
      setWaves(data);
    } catch (err) {
      console.error("Failed to load waves", err);
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
      } catch (err) { console.warn("filters load failed", err); }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  // Live feed: patch counters/state in place
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
      } catch (err) { console.warn("Bad waves WS payload", err); }
    };
    return () => { try { ws.close(); } catch (err) { console.warn("WS close", err); } };
  }, []);

  const totalMembers = waves.reduce((a, w) => a + (w.participants_count || 0), 0);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-10">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">
            Regional Product Waves<sup className="ml-0.5">©</sup>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl uppercase tracking-tighter leading-[0.9] max-w-3xl">
            One region. One product.<br /><span className="text-[#FF5400]">One collective price.</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-[#3A3A3A] max-w-2xl">
            Join an active Wave near you — momentum unlocks supplier pricing the high street can't match.
          </p>
          <div className="mt-6 inline-flex flex-wrap gap-3 items-center font-mono text-[11px] uppercase tracking-widest">
            <div className="border-2 border-ink bg-white px-3 py-2 shadow-brut-sm flex items-center gap-2" data-testid="stat-live-waves">
              <Lightning weight="fill" className="text-[#FF5400]" /> {waves.length} Live Waves
            </div>
            <div className="border-2 border-ink bg-white px-3 py-2 shadow-brut-sm flex items-center gap-2" data-testid="stat-members">
              <Users weight="fill" /> {totalMembers.toLocaleString()} Members Joined
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="border-2 border-ink bg-white shadow-brut p-5 sm:p-6 grid sm:grid-cols-[1fr_1fr_1.2fr_auto] gap-3 items-end" data-testid="wave-filters">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border-2 border-ink px-3 py-3 font-mono text-sm bg-white" data-testid="filter-category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Region</div>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="w-full border-2 border-ink px-3 py-3 font-mono text-sm bg-white" data-testid="filter-region">
              <option value="">All regions</option>
              {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5 flex items-center gap-2">
              <MagnifyingGlass weight="bold" size={12} /> Search product or size
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Continental, OLED, 225/65 R18…" className="w-full border-2 border-ink px-3 py-3 font-mono text-base" data-testid="wave-search-input" />
          </label>
          <button onClick={() => { setCategory(""); setRegionId(""); setQ(""); }} className="border-2 border-ink bg-white px-4 py-3 font-bold uppercase tracking-widest text-[11px] font-mono shadow-brut-sm hover-brut" data-testid="wave-reset-btn">
            Reset
          </button>
        </div>

        {/* Grid */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="wave-grid">
          {loading && <div className="font-mono uppercase tracking-widest text-sm col-span-full">Loading waves…</div>}
          {!loading && waves.length === 0 && (
            <div className="col-span-full border-2 border-ink bg-white shadow-brut p-10 text-center">
              <div className="font-display text-2xl uppercase mb-2">No waves match.</div>
              <p className="text-sm text-[#3A3A3A] font-mono">Try a different region, category or reset filters.</p>
            </div>
          )}
          {waves.map((w) => <WaveCard key={w.wave_id} w={w} />)}
        </div>
      </div>
    </div>
  );
}

function WaveCard({ w }) {
  const pct = w.progress_pct || 0;
  const band = savingsBand(w);
  const state = STATE_BADGE[w.state] || STATE_BADGE.open;
  const variantCount = (w.products || []).reduce((a, p) => a + (p.variants || []).length, 0);
  return (
    <Link to={`/wave/${w.wave_id}`} className="group block border-2 border-ink bg-white shadow-brut hover-brut overflow-hidden" data-testid={`wave-card-${w.wave_id}`}>
      <div className="relative h-44 border-b-2 border-ink overflow-hidden" style={{ background: CATEGORY_GRADIENT[w.category] || CATEGORY_GRADIENT.tyres }}>
        {w.image_url ? (
          <img src={w.image_url} alt={w.title} className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="absolute inset-0 flex items-end p-4">
            <span className="font-display text-white/90 text-3xl uppercase tracking-tighter leading-none">{w.brand}</span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-wrap gap-2">
          <span className="bg-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
            <MapPin weight="fill" className="text-[#FF5400]" size={10} /> {w.region_name}
          </span>
          <span className="border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1" style={{ background: state.bg, color: state.text || "#0A0A0A" }}>{state.label}</span>
        </div>
        {band && (
          <div className="absolute bottom-2 right-2 bg-ink text-white font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">Save {band}</div>
        )}
      </div>
      <div className="p-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF5400] mb-1">{w.category_label} · {w.brand}</div>
        <div className="font-display text-xl sm:text-2xl uppercase leading-tight tracking-tight">{w.title}</div>
        <div className="mt-4">
          <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-widest mb-1.5">
            <span>{w.units_committed || 0}/{w.ideal_target} Units</span>
            <span className="text-[#3A3A3A]">{pct.toFixed(0)}%</span>
          </div>
          <div className="w-full h-2 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
            <div className="h-full bg-[#FF5400] transition-all duration-700" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-widest">
          <span>{variantCount} Options</span>
          <span className="inline-flex items-center gap-1 text-[#FF5400]">View Wave <ArrowRight weight="bold" size={12} /></span>
        </div>
      </div>
    </Link>
  );
}
