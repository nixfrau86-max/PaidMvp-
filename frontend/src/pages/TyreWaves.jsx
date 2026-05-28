import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api, wsUrl } from "../lib/api";
import { MagnifyingGlass, ArrowRight, Lightning, Lock, Users, CheckCircle } from "@phosphor-icons/react";

export default function TyreWaves() {
  const [waves, setWaves] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sizeFilter, setSizeFilter] = useState("");
  const [q, setQ] = useState("");

  const reload = useCallback(async (params = {}) => {
    const search = new URLSearchParams();
    if (params.size) search.set("size", params.size);
    if (params.q) search.set("q", params.q);
    const url = "/tyre/waves" + (search.toString() ? `?${search}` : "");
    try {
      const [w, s] = await Promise.all([api.get(url), api.get("/tyre/sizes")]);
      setWaves(w.data);
      setSizes(s.data);
    } catch (err) {
      console.error("Failed to load tyre waves", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => reload({ size: sizeFilter, q }), 250);
    return () => clearTimeout(t);
  }, [sizeFilter, q, reload]);

  // Live broadcast: update counters in-place
  useEffect(() => {
    const ws = new WebSocket(wsUrl("/api/ws/tyrewaves"));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.wave) {
          setWaves((prev) =>
            prev.map((p) =>
              p.wave?.wave_id === msg.wave.wave_id ? { ...p, wave: msg.wave } : p
            )
          );
        }
      } catch (err) {
        console.warn("Bad tyrewaves WS payload", err);
      }
    };
    return () => {
      try { ws.close(); } catch (err) { console.warn("WS close error", err); }
    };
  }, []);

  const heroStats = useMemo(() => {
    const totalParticipants = waves.reduce((a, w) => a + (w.wave?.participants_count || 0), 0);
    const totalSizes = waves.reduce((a, w) => a + (w.stats?.size_count || 0), 0);
    return { totalParticipants, totalSizes, totalGroups: waves.length };
  }, [waves]);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* Hero */}
        <div className="mb-10">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">
            Tyre Product Group Waves<sup className="ml-0.5">©</sup>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl uppercase tracking-tighter leading-[0.9] max-w-3xl">
            Skip the catalogue.<br/>
            <span className="text-[#FF5400]">Join the wave.</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-[#3A3A3A] max-w-2xl">
            Each Wave is one product, one supplier, one collective price. Pre-authorise today — your card is only
            captured when the Wave fills.
          </p>

          {/* live stats strip */}
          <div className="mt-6 inline-flex flex-wrap gap-3 items-center font-mono text-[11px] uppercase tracking-widest">
            <div className="border-2 border-ink bg-white px-3 py-2 shadow-brut-sm flex items-center gap-2" data-testid="stat-live-waves">
              <Lightning weight="fill" className="text-[#FF5400]" /> {heroStats.totalGroups} Live Waves
            </div>
            <div className="border-2 border-ink bg-white px-3 py-2 shadow-brut-sm flex items-center gap-2" data-testid="stat-members">
              <Users weight="fill" /> {heroStats.totalParticipants.toLocaleString()} Members Joined
            </div>
            <div className="border-2 border-ink bg-white px-3 py-2 shadow-brut-sm flex items-center gap-2" data-testid="stat-sizes">
              <CheckCircle weight="fill" className="text-[#00C853]" /> {heroStats.totalSizes} Fitments Tracked
            </div>
          </div>
        </div>

        {/* Search panel */}
        <div className="border-2 border-ink bg-white shadow-brut p-5 sm:p-6 grid sm:grid-cols-[1.2fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5 flex items-center gap-2">
              <MagnifyingGlass weight="bold" size={12} /> Enter your tyre size
            </div>
            <input
              list="tyre-sizes"
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value.toUpperCase())}
              placeholder="e.g. 225/65/R18"
              className="w-full border-2 border-ink px-3 py-3 font-mono text-base tracking-wider"
              data-testid="tyre-size-input"
            />
            <datalist id="tyre-sizes">
              {sizes.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Brand or model</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Michelin, P Zero..."
              className="w-full border-2 border-ink px-3 py-3 font-mono text-base"
              data-testid="tyre-search-input"
            />
          </label>
          <button
            onClick={() => { setSizeFilter(""); setQ(""); }}
            className="border-2 border-ink bg-white px-4 py-3 font-bold uppercase tracking-widest text-[11px] font-mono shadow-brut-sm hover-brut"
            data-testid="tyre-reset-btn"
          >
            Reset
          </button>
        </div>

        {/* Results */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="tyre-wave-grid">
          {loading && (
            <div className="font-mono uppercase tracking-widest text-sm col-span-full">Loading waves…</div>
          )}
          {!loading && waves.length === 0 && (
            <div className="col-span-full border-2 border-ink bg-white shadow-brut p-10 text-center">
              <div className="font-display text-2xl uppercase mb-2">No waves match.</div>
              <p className="text-sm text-[#3A3A3A] font-mono">Try a different size, brand or reset filters.</p>
            </div>
          )}
          {waves.map((w) => <WaveCard key={w.product_group_id} pg={w} />)}
        </div>
      </div>
    </div>
  );
}

function WaveCard({ pg }) {
  const wave = pg.wave || {};
  const stats = pg.stats || {};
  const pct = wave.progress_pct || 0;
  const locked = wave.state === "locked";
  const [lo, hi] = stats.savings_band_pct || [15, 25];

  return (
    <Link
      to={`/tyre-wave/${pg.product_group_id}`}
      className="group block border-2 border-ink bg-white shadow-brut hover-brut overflow-hidden"
      data-testid={`tyre-wave-card-${pg.product_group_id}`}
    >
      <div className="relative h-44 border-b-2 border-ink overflow-hidden bg-[#F4F4F4]">
        <img src={pg.hero_image_url} alt={`${pg.brand} ${pg.model}`}
             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-2">
          <span className="bg-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
            <Lightning weight="fill" className="text-[#FF5400]" size={10} /> Live Wave
          </span>
          {locked && (
            <span className="bg-[#00C853] border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
              <Lock weight="fill" size={10}/> Locked
            </span>
          )}
        </div>
        <div className="absolute bottom-2 right-2 bg-ink text-white font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
          Save {lo}–{hi}%
        </div>
      </div>
      <div className="p-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF5400] mb-1">{pg.brand}</div>
        <div className="font-display text-xl sm:text-2xl uppercase leading-tight tracking-tight">{pg.model}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-1">{pg.category}</div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-widest mb-1.5">
            <span>{wave.participants_count || 0}/{wave.target_count} Joined</span>
            <span className="text-[#3A3A3A]">{pct.toFixed(0)}%</span>
          </div>
          <div className="w-full h-2 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
            <div
              className="h-full bg-[#FF5400] transition-all duration-700"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-widest">
          <span>{stats.size_count} Sizes · {stats.total_inventory} In Stock</span>
          <span className="inline-flex items-center gap-1 text-[#FF5400]">View Wave <ArrowRight weight="bold" size={12} /></span>
        </div>
      </div>
    </Link>
  );
}
