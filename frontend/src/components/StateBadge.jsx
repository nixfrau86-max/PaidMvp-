import React from "react";

const MAP = {
  seed:      { label: "SEED",      bg: "#F4F4F4", fg: "#0A0A0A" },
  active:    { label: "ACTIVE WAVE", bg: "#FFFFFF", fg: "#0A0A0A" },
  almost:    { label: "ALMOST POWERED", bg: "#FFD600", fg: "#0A0A0A" },
  powered:   { label: "POWERED",   bg: "#0021A5", fg: "#FFFFFF" },
  locked:    { label: "PRICE LOCKED", bg: "#FF5400", fg: "#FFFFFF" },
  executing: { label: "EXECUTING", bg: "#FF5400", fg: "#FFFFFF" },
  completed: { label: "COMPLETED", bg: "#00C853", fg: "#0A0A0A" },
};

export default function StateBadge({ state, progressPct }) {
  let key = state;
  if (state === "active" && progressPct >= 75) key = "almost";
  const s = MAP[key] || MAP.active;
  return (
    <span
      data-testid={`state-badge-${state}`}
      className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] shadow-brut-sm font-mono"
      style={{ background: s.bg, color: s.fg }}
    >
      {state === "powered" && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {state === "executing" && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {s.label}
    </span>
  );
}
