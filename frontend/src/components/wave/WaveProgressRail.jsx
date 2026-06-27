import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";

const STATE_LABEL = {
  open: "Open — accepting members",
  almost_full: "Almost full — closing soon",
  activated: "Activated — minimum reached",
  processing: "Processing payments",
  fulfilment: "In fulfilment",
  completed: "Completed",
  expired: "Expired",
};

const BAR_INITIAL = { width: 0 };
const BAR_SPRING = { type: "spring", bounce: 0, duration: 1 };
const PULSE_ANIM = { scale: [1, 1.015, 1] };
const PULSE_REST = {};
const PULSE_TRANSITION = { duration: 0.5 };

export const WaveProgressRail = ({ w, pct, variant, qty, saving, pulse, accepting, atCapacity, acceptTerms, setAcceptTerms, joining, join, allowance, garageId, selectedSlot }) => (
  <div className="lg:sticky lg:top-24 self-start">
    <motion.div animate={pulse ? PULSE_ANIM : PULSE_REST} transition={PULSE_TRANSITION}
      className={`rounded-3xl border bg-white p-6 sm:p-8 shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-colors ${pulse ? "border-[#FF5400]" : "border-slate-100"}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#FF5400] opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FF5400]" />
        </span>
        Live Wave Progress
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-outfit text-5xl font-bold tabular-nums text-slate-900" data-testid="wave-units">{w.units_committed || 0}</span>
        <span className="text-sm font-semibold text-slate-400">/ {w.ideal_target} units</span>
        <span className="ml-auto font-outfit text-2xl font-bold tabular-nums text-[#FF5400]">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div className="h-full rounded-full bg-[#FF5400]" initial={BAR_INITIAL} animate={{ width: `${pct}%` }} transition={BAR_SPRING} />
      </div>
      <div className="mt-3 text-xs font-medium text-slate-500" data-testid="wave-state">
        {STATE_LABEL[w.state] || w.state} · activates at {w.min_activation} units
      </div>
      {w.carried_units > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-700" data-testid="wave-carried">
          <ArrowsClockwise weight="bold" size={14} /> {w.carried_units} units carried from previous wave
        </div>
      )}

      {variant && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Your Collective Price</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-outfit text-4xl font-bold tracking-tight tabular-nums text-slate-900">£{(variant.wave_price * qty).toFixed(2)}</span>
            {saving > 0 && <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600 tabular-nums">You save £{(saving * qty).toFixed(2)}</span>}
          </div>
        </div>
      )}

      {accepting ? (
        <>
          <label className="mt-6 flex items-start gap-2.5 cursor-pointer" data-testid="accept-terms-label">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-[#FF5400]" data-testid="accept-terms-checkbox" />
            <span className="text-xs leading-relaxed text-slate-500">
              I agree to the <Link to="/terms" className="font-semibold text-slate-700 underline" target="_blank">Terms</Link> and <Link to="/privacy" className="font-semibold text-slate-700 underline" target="_blank">Privacy Policy</Link>. My inventory is reserved now; payment is captured only when the Wave activates.
            </span>
          </label>
          <button onClick={join} disabled={!variant || joining || !acceptTerms || (allowance && allowance.remaining <= 0) || (w.category === "tyres" && (!garageId || !selectedSlot))} className="mt-4 w-full rounded-xl bg-[#FF5400] px-6 py-4 text-sm font-bold text-white shadow-sm shadow-[#FF5400]/25 transition-colors hover:bg-[#E64A00] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2" data-testid="join-wave-btn">
            {joining ? "Reserving…" : (allowance && allowance.remaining <= 0) ? <>Annual limit reached</> : <>Join Wave <ArrowRight weight="bold" /></>}
          </button>
        </>
      ) : (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white" data-testid="wave-closed">
          <CheckCircle weight="fill" /> {atCapacity ? "Fully subscribed — capacity reached" : (STATE_LABEL[w.state] || w.state)}
        </div>
      )}

      <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <ShieldCheck weight="bold" size={14} /> Inventory reserved · charged only on activation
      </div>
    </motion.div>
  </div>
);
