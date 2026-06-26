import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Tire, DeviceMobile, Sneaker, TShirt, Package, Users, Lightning } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

const ICONS = {
  tyres: Tire,
  electronics: DeviceMobile,
  footwear: Sneaker,
  clothing: TShirt,
};
const ACCENTS = ["#FF5400", "#0021A5", "#FFD600"];
const ROTATES = [-3, 2.5, -1.5];

// illustrative fallback shown only if no live waves exist yet
const FALLBACK = [
  { wave_id: null, category: "tyres", category_label: "Tyres", region_name: "Warwickshire", pct: 82, joined: 41, save: 23 },
  { wave_id: null, category: "electronics", category_label: "Electronics", region_name: "Coventry", pct: 64, joined: 28, save: 19 },
  { wave_id: null, category: "footwear", category_label: "Footwear", region_name: "Leamington", pct: 47, joined: 17, save: 31 },
];

const FLOAT = { animate: { y: [0, -10, 0] } };

function bestSavings(products = []) {
  let best = 0;
  for (const p of products) {
    for (const v of p.variants || []) {
      if (v.retail_price > 0) {
        const pct = ((v.retail_price - v.wave_price) / v.retail_price) * 100;
        if (pct > best) best = pct;
      }
    }
  }
  return Math.round(best);
}

export default function HeroWaves() {
  const { user } = useAuth();
  const [waves, setWaves] = useState(null);
  // Suppliers & garages must not deep-link into the consumer marketplace from the front page.
  const canOpen = !user || user.role === "consumer" || user.role === "admin";

  useEffect(() => {
    let alive = true;
    api.get("/waves")
      .then(({ data }) => {
        if (!alive) return;
        const mapped = (data || []).slice(0, 3).map((w) => ({
          wave_id: w.wave_id,
          category: w.category,
          category_label: w.category_label || w.category,
          region_name: w.region_name,
          pct: Math.round(w.progress_pct ?? 0),
          joined: w.participants_count ?? 0,
          save: bestSavings(w.products),
        }));
        setWaves(mapped);
      })
      .catch(() => alive && setWaves([]));
    return () => { alive = false; };
  }, []);

  const cards = useMemo(() => {
    if (waves === null) return FALLBACK;          // loading → keep visual filled
    return waves.length ? waves : FALLBACK;        // empty → illustrative
  }, [waves]);

  return (
    <div className="relative w-full max-w-md mx-auto lg:mx-0" data-testid="hero-waves-visual">
      <motion.span
        className="absolute -top-6 -left-5 w-16 h-16 bg-[#FFD600] border-2 border-ink shadow-brut hidden sm:block"
        animate={{ rotate: [0, 8, 0], y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />
      <motion.span
        className="absolute -bottom-7 -right-3 w-12 h-12 rounded-full bg-[#FF5400] border-2 border-ink shadow-brut hidden sm:block"
        animate={{ scale: [1, 1.12, 1], y: [0, 10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />

      <div className="relative space-y-4">
        {cards.map((c, i) => {
          const Icon = ICONS[c.category] || Package;
          const accent = ACCENTS[i % ACCENTS.length];
          const rotate = ROTATES[i % ROTATES.length];
          const clickable = c.wave_id && canOpen;
          const Wrapper = clickable ? Link : "div";
          const wrapperProps = clickable
            ? { to: `/wave/${c.wave_id}`, "data-testid": `hero-wave-card-${c.wave_id}` }
            : { "aria-hidden": true };
          return (
            <motion.div
              key={c.wave_id || `fallback-${i}`}
              initial={{ opacity: 0, y: 24, rotate }}
              animate={{ opacity: 1, y: 0, rotate }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.15, ease: [0.22, 1, 0.36, 1] }}
              style={{ zIndex: cards.length - i }}
              className="relative"
            >
              <motion.div
                variants={FLOAT}
                animate="animate"
                transition={{ duration: 4.5 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
              >
                <Wrapper
                  {...wrapperProps}
                  className={`block bg-white border-2 border-ink shadow-brut p-4 ${clickable ? "hover-brut" : ""}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center w-9 h-9 border-2 border-ink" style={{ background: accent }}>
                        <Icon weight="fill" size={18} className={accent === "#FFD600" ? "text-ink" : "text-white"} />
                      </span>
                      <div>
                        <div className="font-display text-base uppercase tracking-tight leading-none capitalize">{c.category_label}</div>
                        <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] mt-1">{c.region_name}</div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1.5 border-2 border-ink bg-ink text-white px-2 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00C853] animate-pulse" />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-widest">Live</span>
                    </div>
                  </div>

                  <div className="h-3 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
                    <motion.div
                      className="h-full"
                      style={{ background: accent }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, c.pct)}%` }}
                      transition={{ duration: 1.1, delay: 0.5 + i * 0.15, ease: "easeOut" }}
                    />
                  </div>

                  <div className="flex items-center justify-between mt-2.5">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
                      <Users weight="bold" size={12} /> {c.joined} joined
                    </span>
                    {c.save > 0 && (
                      <span className="inline-flex items-center gap-1 border-2 border-ink bg-[#FFD600] px-2 py-0.5 font-display text-xs uppercase tracking-tight">
                        <Lightning weight="fill" size={11} /> Save {c.save}%
                      </span>
                    )}
                  </div>
                </Wrapper>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
