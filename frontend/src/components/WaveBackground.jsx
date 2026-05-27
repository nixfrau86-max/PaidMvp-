import React from "react";

/**
 * Invisible-infrastructure aesthetic.
 * - Flowing horizontal wave lines
 * - Floating pulse nodes (like a coordination network)
 * - No product imagery
 * - Subtle, premium
 */
export default function WaveBackground({ variant = "light" }) {
  const stroke = variant === "dark" ? "rgba(255,255,255,0.18)" : "rgba(10,10,10,0.10)";
  const accent = variant === "dark" ? "#FF5400" : "#FF5400";
  const dot = variant === "dark" ? "#FFD600" : "#0A0A0A";

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        <defs>
          <linearGradient id="wave-fade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={stroke} stopOpacity="0" />
            <stop offset="40%" stopColor={stroke} stopOpacity="1" />
            <stop offset="60%" stopColor={stroke} stopOpacity="1" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="accent-fade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={accent} stopOpacity="0" />
            <stop offset="50%" stopColor={accent} stopOpacity="0.55" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Flowing wave lines */}
        {[
          { d: "M0,160 C200,120 400,200 600,160 C800,120 1000,180 1200,140", delay: 0 },
          { d: "M0,260 C220,220 420,300 600,250 C780,200 980,280 1200,240", delay: 0.6 },
          { d: "M0,380 C200,340 400,420 600,380 C800,340 1000,420 1200,380", delay: 1.2, accent: true },
          { d: "M0,500 C220,460 420,540 600,500 C780,460 980,540 1200,500", delay: 1.8 },
          { d: "M0,620 C200,580 400,660 600,620 C800,580 1000,660 1200,620", delay: 2.4 },
          { d: "M0,720 C220,680 420,760 600,720 C780,680 980,760 1200,720", delay: 3.0 },
        ].map((w, i) => (
          <path
            key={i}
            d={w.d}
            fill="none"
            stroke={w.accent ? "url(#accent-fade)" : "url(#wave-fade)"}
            strokeWidth={w.accent ? "1.5" : "1"}
            strokeLinecap="round"
            style={{
              animation: `wave-drift ${10 + i * 1.5}s ease-in-out ${w.delay}s infinite alternate`,
              transformOrigin: "center",
            }}
          />
        ))}

        {/* Pulse nodes — coordination points */}
        {[
          { cx: 180, cy: 200, r: 3, delay: 0 },
          { cx: 420, cy: 340, r: 4, delay: 0.8, accent: true },
          { cx: 720, cy: 220, r: 3, delay: 1.6 },
          { cx: 940, cy: 460, r: 4, delay: 2.4, accent: true },
          { cx: 290, cy: 560, r: 3, delay: 3.2 },
          { cx: 800, cy: 640, r: 3, delay: 4.0 },
          { cx: 1080, cy: 300, r: 3, delay: 4.8 },
        ].map((p, i) => (
          <g key={i}>
            <circle
              cx={p.cx} cy={p.cy} r={p.r}
              fill={p.accent ? accent : dot}
              style={{ animation: `pulse-node 2.6s ease-in-out ${p.delay}s infinite` }}
            />
            <circle
              cx={p.cx} cy={p.cy} r={p.r}
              fill="none"
              stroke={p.accent ? accent : dot}
              strokeWidth="1"
              opacity="0.4"
              style={{ animation: `pulse-ring 2.6s ease-out ${p.delay}s infinite` }}
            />
          </g>
        ))}
      </svg>

      <style>{`
        @keyframes wave-drift {
          0%   { transform: translateX(-20px) translateY(0); }
          100% { transform: translateX(20px)  translateY(-8px); }
        }
        @keyframes pulse-node {
          0%, 100% { opacity: 0.4; transform: scale(1); transform-origin: center; }
          50%      { opacity: 1;   transform: scale(1.4); }
        }
        @keyframes pulse-ring {
          0%   { r: 4;  opacity: 0.5; }
          100% { r: 30; opacity: 0;   }
        }
      `}</style>
    </div>
  );
}
