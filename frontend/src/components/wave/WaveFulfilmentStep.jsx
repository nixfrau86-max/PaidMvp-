import React from "react";
import { CheckCircle, Info } from "@phosphor-icons/react";

export const WaveFulfilmentStep = ({ w, garages, garageId, setGarageId, slotDays, slotsLoading, selectedSlot, setSelectedSlot, address, setAddress }) => (
  <div className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8 shadow-[0_4px_20px_rgb(0,0,0,0.04)]" data-testid="fulfilment-panel">
    <div className="text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-1">Step 2</div>
    <h2 className="font-outfit text-2xl font-semibold tracking-tight mb-5">{w.category === "tyres" ? "Choose your fitting garage" : "Delivery address"}</h2>
    {w.category === "tyres" ? (
      <>
        <select value={garageId} onChange={(e) => setGarageId(e.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-[#FF5400] focus:ring-2 focus:ring-[#FF5400]/15" data-testid="garage-select">
          <option value="">Select an approved local garage…</option>
          {garages.map((g) => <option key={g.garage_id} value={g.garage_id}>{g.business_name || g.name} {g.postcode ? `· ${g.postcode}` : ""}</option>)}
        </select>
        <p className="mt-3 text-xs text-slate-400">
          Not sure of your size? It's printed on your tyre sidewall, e.g. <span className="font-semibold text-slate-600">225/65 R18</span> (width / profile / rim).
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-xs font-medium text-amber-800" data-testid="fitting-charge-notice">
          <Info weight="fill" size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <span>Your wave price covers the <span className="font-semibold">tyres only</span>. The fitting service is arranged with and <span className="font-semibold">charged separately by the garage</span> on the day.</span>
        </div>

        {garageId && (
          <div className="mt-5 border-t border-slate-100 pt-5" data-testid="slot-picker">
            <div className="text-sm font-semibold text-slate-700 mb-1">Preferred fitting slot</div>
            <p className="text-xs text-slate-400 mb-4">Tyres arrive at your garage the next working day. Pick a 30-min slot 1–2 days after.</p>
            {slotsLoading ? (
              <div className="text-sm font-medium text-slate-400">Loading slots…</div>
            ) : slotDays.length === 0 ? (
              <div className="text-sm font-medium text-slate-400">No slots available — try another garage.</div>
            ) : (
              <div className="space-y-4 max-h-72 overflow-auto pr-1">
                {slotDays.map((d) => (
                  <div key={d.date} data-testid={`slot-day-${d.date}`}>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      {new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {d.slots.map((s) => {
                        const isSel = selectedSlot?.iso === s.slot_iso;
                        const showLeft = (s.capacity || 1) > 1 && s.remaining != null;
                        return (
                          <button key={s.slot_iso} type="button"
                            onClick={() => setSelectedSlot({ iso: s.slot_iso, label: `${new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${s.label}`, date: d.date })}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${isSel ? "border-[#FF5400] bg-[#FF5400] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                            data-testid={`slot-${s.slot_iso}`}>
                            {s.label}{showLeft && <span className={`ml-1 text-[10px] font-medium ${isSel ? "text-white/80" : "text-emerald-600"}`}>· {s.remaining} left</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedSlot && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700" data-testid="selected-slot">
                <CheckCircle weight="fill" size={14} /> {selectedSlot.label}
              </div>
            )}
          </div>
        )}
      </>
    ) : (
      <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House / flat, street, town, postcode" rows={3} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-[#FF5400] focus:ring-2 focus:ring-[#FF5400]/15" data-testid="delivery-address" />
    )}
  </div>
);
