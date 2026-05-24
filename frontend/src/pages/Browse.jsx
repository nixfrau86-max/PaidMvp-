import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import VPPCard from "../components/VPPCard";
import { api, wsUrl } from "../lib/api";
import { Funnel, MagnifyingGlass } from "@phosphor-icons/react";

const STATES = ["all", "active", "locked", "executing", "completed"];

export default function Browse() {
  const [vpps, setVpps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await api.get("/vpps");
      setVpps(data);
      setLoading(false);
    })();
  }, []);

  // Live updates via WebSocket
  useEffect(() => {
    const ws = new WebSocket(wsUrl("/api/ws/feed"));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.vpp) {
          setVpps((prev) => {
            const idx = prev.findIndex((v) => v.vpp_id === msg.vpp.vpp_id);
            if (idx === -1) return [msg.vpp, ...prev];
            const out = [...prev];
            out[idx] = msg.vpp;
            return out;
          });
        }
      } catch {}
    };
    return () => { try { ws.close(); } catch {} };
  }, []);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(vpps.map(v => v.category)))],
    [vpps]
  );

  const filtered = vpps.filter(v => {
    if (stateFilter !== "all" && v.state !== stateFilter) return false;
    if (categoryFilter !== "all" && v.category !== categoryFilter) return false;
    if (query && !v.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Browse Parties</div>
          <h1 className="font-display text-5xl sm:text-6xl uppercase tracking-tighter leading-[0.9]">
            Find your party.
          </h1>
        </div>

        {/* Filters */}
        <div className="border-2 border-ink bg-white shadow-brut-sm p-3 sm:p-4 mb-8 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <MagnifyingGlass weight="bold" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parties..."
              className="flex-1 border-0 outline-none bg-transparent font-mono text-sm"
              data-testid="search-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <Funnel weight="bold" size={14} />
            <span className="text-[10px] font-bold uppercase tracking-widest font-mono mr-2">State:</span>
            <div className="flex border-2 border-ink">
              {STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStateFilter(s)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono border-r-2 border-ink last:border-r-0 ${stateFilter === s ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
                  data-testid={`filter-state-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest font-mono">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono bg-white"
              data-testid="filter-category"
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="font-mono text-sm uppercase tracking-widest text-[#525252]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="border-2 border-ink p-10 text-center font-mono uppercase text-sm tracking-widest">
            No parties match your filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(v => <VPPCard key={v.vpp_id} vpp={v} />)}
          </div>
        )}
      </div>
    </div>
  );
}
