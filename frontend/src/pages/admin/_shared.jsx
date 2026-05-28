// Shared atoms reused across all admin tabs.
import React from "react";
import Navbar from "../../components/Navbar";

export function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}

export function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">{label}</div>
      {children}
    </label>
  );
}

export function Stat({ label, v, c }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut-sm p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">{label}</div>
      <div className="font-display text-2xl" style={c ? { color: c } : {}}>{v}</div>
    </div>
  );
}

export function Th({ children }) {
  return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-3 py-3">{children}</th>;
}

export function Td({ children, className = "" }) {
  return <td className={`px-3 py-3 align-middle ${className}`}>{children}</td>;
}

export function SupplierStatusBadge({ status }) {
  const M = {
    provisional: { label: "Provisional", bg: "#FFD600" },
    pending_review: { label: "Pending Review", bg: "#FF5400", text: "#fff" },
    verified: { label: "Verified", bg: "#0021A5", text: "#fff" },
    payout_ready: { label: "Payout Ready", bg: "#00C853" },
    rejected: { label: "Rejected", bg: "#525252", text: "#fff" },
  };
  const s = M[status] || M.provisional;
  return (
    <span
      className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono"
      style={{ background: s.bg, color: s.text || "#0A0A0A" }}
    >
      {s.label}
    </span>
  );
}
