import React from "react";
import { motion } from "framer-motion";
import { Tire, DeviceMobile, Sneaker, Users, Lightning } from "@phosphor-icons/react";

const CARDS = [
  {
    icon: Tire,
    category: "Tyres",
    region: "Warwickshire",
    pct: 82,
    joined: 41,
    save: "23%",
    accent: "#FF5400",
    rotate: -3,
    delay: 0,
  },
  {
    icon: DeviceMobile,
    category: "Electronics",
    region: "Coventry",
    pct: 64,
    joined: 28,
    save: "19%",
    accent: "#0021A5",
    rotate: 2.5,
    delay: 0.15,
  },
  {
    icon: Sneaker,
    category: "Footwear",
    region: "Leamington",
    pct: 47,
    joined: 17,
    save: "31%",
    accent: "#FFD600",
    rotate: -1.5,
    delay: 0.3,
  },
];

const FLOAT = {
  animate: { y: [0, -10, 0] },
};

export default function HeroWaves() {
  return (
    <div className="relative w-full max-w-md mx-auto lg:mx-0" aria-hidden data-testid="hero-waves-visual">
      {/* floating decorative blocks */}
      <motion.span
        className="absolute -top-6 -left-5 w-16 h-16 bg-[#FFD600] border-2 border-ink shadow-brut hidden sm:block"
        animate={{ rotate: [0, 8, 0], y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="absolute -bottom-7 -right-3 w-12 h-12 rounded-full bg-[#FF5400] border-2 border-ink shadow-brut hidden sm:block"
        animate={{ scale: [1, 1.12, 1], y: [0, 10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative space-y-4">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.category}
              initial={{ opacity: 0, y: 24, rotate: c.rotate }}
              animate={{ opacity: 1, y: 0, rotate: c.rotate }}
              transition={{ duration: 0.6, delay: 0.2 + c.delay, ease: [0.22, 1, 0.36, 1] }}
              style={{ zIndex: CARDS.length - i }}
              className="relative"
            >
              <motion.div
                variants={FLOAT}
                animate="animate"
                transition={{ duration: 4.5 + i, repeat: Infinity, ease: "easeInOut", delay: c.delay }}
                className="bg-white border-2 border-ink shadow-brut p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-flex items-center justify-center w-9 h-9 border-2 border-ink"
                      style={{ background: c.accent }}
                    >
                      <Icon weight="fill" size={18} className={c.accent === "#FFD600" ? "text-ink" : "text-white"} />
                    </span>
                    <div>
                      <div className="font-display text-base uppercase tracking-tight leading-none">{c.category}</div>
                      <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] mt-1">{c.region}</div>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 border-2 border-ink bg-ink text-white px-2 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00C853] animate-pulse" />
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest">Live</span>
                  </div>
                </div>

                {/* progress */}
                <div className="h-3 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
                  <motion.div
                    className="h-full"
                    style={{ background: c.accent }}
                    initial={{ width: 0 }}
                    animate={{ width: `${c.pct}%` }}
                    transition={{ duration: 1.1, delay: 0.5 + c.delay, ease: "easeOut" }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2.5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
                    <Users weight="bold" size={12} /> {c.joined} joined
                  </span>
                  <span className="inline-flex items-center gap-1 border-2 border-ink bg-[#FFD600] px-2 py-0.5 font-display text-xs uppercase tracking-tight">
                    <Lightning weight="fill" size={11} /> Save {c.save}
                  </span>
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
