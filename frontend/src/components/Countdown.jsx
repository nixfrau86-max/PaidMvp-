import React, { useEffect, useState } from "react";

function fmt(ms) {
  if (ms <= 0) return { d: "00", h: "00", m: "00", s: "00", expired: true };
  const s = Math.floor(ms / 1000);
  return {
    d: String(Math.floor(s / 86400)).padStart(2, "0"),
    h: String(Math.floor((s % 86400) / 3600)).padStart(2, "0"),
    m: String(Math.floor((s % 3600) / 60)).padStart(2, "0"),
    s: String(s % 60).padStart(2, "0"),
    expired: false,
  };
}

export default function Countdown({ deadline, compact = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(deadline).getTime() - now;
  const t = fmt(ms);
  if (t.expired) return <span className="font-mono text-xs font-bold uppercase">CLOSED</span>;
  if (compact)
    return (
      <span className="font-mono text-xs font-bold">{t.d}d:{t.h}h:{t.m}m:{t.s}s</span>
    );
  return (
    <div className="flex gap-2" data-testid="countdown">
      {[
        ["DAYS", t.d],
        ["HRS", t.h],
        ["MIN", t.m],
        ["SEC", t.s],
      ].map(([label, val]) => (
        <div key={label} className="border-2 border-ink bg-white text-ink px-3 py-2 shadow-brut-sm min-w-[64px] text-center">
          <div className="font-display text-2xl leading-none text-ink">{val}</div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-widest mt-1 text-ink">{label}</div>
        </div>
      ))}
    </div>
  );
}
