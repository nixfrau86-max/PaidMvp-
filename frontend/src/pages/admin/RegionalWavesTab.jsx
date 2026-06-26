import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash, CurrencyGbp, X, ArrowsClockwise } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

const STATES = ["open", "almost_full", "activated", "processing", "fulfilment", "completed", "expired"];

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  } catch { return iso; }
}

export default function RegionalWavesTab() {
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [newRegion, setNewRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [financials, setFinancials] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [w, r, s] = await Promise.all([
        api.get("/admin/regional-waves"),
        api.get("/regions?all_regions=true"),
        api.get("/admin/scheduled-waves"),
      ]);
      setWaves(w.data);
      setRegions(r.data);
      setScheduled(s.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setState = async (w, state) => {
    try { await api.patch(`/admin/regional-waves/${w.wave_id}/state`, { state }); toast.success(`State → ${state}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const remove = async (w) => {
    if (!window.confirm(`Delete "${w.title}"?`)) return;
    try { await api.delete(`/admin/regional-waves/${w.wave_id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const addRegion = async () => {
    if (!newRegion.trim()) return;
    try { await api.post("/admin/regions", { name: newRegion.trim() }); setNewRegion(""); toast.success("Region added"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const toggleRegion = async (r) => {
    try { await api.patch(`/admin/regions/${r.region_id}`, { active: !r.active }); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const deleteRegion = async (r) => {
    if (!window.confirm(`Delete region "${r.name}"?`)) return;
    try { await api.delete(`/admin/regions/${r.region_id}`); toast.success("Region deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Region has waves — deactivate instead"); }
  };
  const openFinancials = async (w) => {
    try {
      const { data } = await api.get(`/admin/regional-waves/${w.wave_id}/financials`);
      setFinancials(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load financials"); }
  };

  return (
    <div className="space-y-6" data-testid="regional-waves-tab">
      {/* Regions manager */}
      <div className="border-2 border-ink bg-white shadow-brut p-5">
        <div className="font-display text-xl uppercase mb-3">Regions</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {regions.map((r) => (
            <div key={r.region_id} className={`inline-flex items-center gap-2 border-2 border-ink px-2 py-1 font-mono text-[11px] uppercase tracking-widest ${r.active ? "bg-white" : "bg-[#F4F4F4] opacity-60"}`} data-testid={`region-chip-${r.region_id}`}>
              {r.name}
              <button onClick={() => toggleRegion(r)} className="underline text-[9px]">{r.active ? "disable" : "enable"}</button>
              <button onClick={() => deleteRegion(r)} title="Delete"><Trash weight="bold" size={11} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 max-w-md">
          <input value={newRegion} onChange={(e) => setNewRegion(e.target.value)} placeholder="New region name" className="flex-1 border-2 border-ink px-3 py-2 font-mono text-sm" data-testid="new-region-input" />
          <button onClick={addRegion} className="bg-[#FF5400] text-white border-2 border-ink px-3 py-2 font-bold uppercase tracking-widest text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid="add-region-btn"><Plus weight="bold" size={10} /> Add</button>
        </div>
      </div>

      {/* Scheduled regenerations (auto-engine monitor) */}
      <div className="border-2 border-ink bg-white shadow-brut p-5" data-testid="scheduled-regenerations">
        <div className="flex items-center gap-2 mb-3">
          <ArrowsClockwise weight="bold" size={18} className="text-[#FF5400]" />
          <div className="font-display text-xl uppercase">Scheduled regenerations</div>
          <span className="ml-auto border-2 border-ink bg-[#FFD600] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest">{scheduled.length} queued</span>
        </div>
        {scheduled.length === 0 ? (
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No pending regenerations. Completed waves with leftover stock will queue here.</div>
        ) : (
          <div className="overflow-x-auto border-2 border-ink">
            <table className="w-full font-mono text-[12px]">
              <thead className="bg-ink text-white">
                <tr><Th>Wave (next round)</Th><Th>Supplier</Th><Th>Region</Th><Th>Units</Th><Th>Carried</Th><Th>Goes live</Th></tr>
              </thead>
              <tbody>
                {scheduled.map((s) => (
                  <tr key={s.scheduled_id} className="border-t-2 border-ink" data-testid={`scheduled-row-${s.scheduled_id}`}>
                    <Td><span className="font-bold uppercase text-xs">{s.title}</span></Td>
                    <Td>{s.supplier_name}</Td>
                    <Td>{s.region_name}</Td>
                    <Td className="tabular-nums">{s.units}</Td>
                    <Td className="tabular-nums">{s.carried_units || 0}</Td>
                    <Td className="text-[#0021A5] font-bold">{fmtWhen(s.create_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Waves table */}
      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr><Th>Wave</Th><Th>Supplier</Th><Th>Region</Th><Th>Category</Th><Th>Units</Th><Th>Stock (alloc · sold · left)</Th><Th>State</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.wave_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`admin-wave-row-${w.wave_id}`}>
                <Td><span className="font-bold uppercase text-xs">{w.title}</span></Td>
                <Td>{w.supplier_name}</Td>
                <Td>{w.region_name}</Td>
                <Td className="capitalize">{w.category_label}</Td>
                <Td>{w.units_committed}/{w.ideal_target}</Td>
                <Td><StockCell s={w.stock_summary} testid={`admin-wave-stock-${w.wave_id}`} /></Td>
                <Td>
                  <select value={w.state} onChange={(e) => setState(w, e.target.value)} className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold" data-testid={`admin-wave-state-${w.wave_id}`}>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
                <Td><div className="flex gap-1">
                  <button onClick={() => openFinancials(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid={`admin-wave-financials-${w.wave_id}`} title="Financials"><CurrencyGbp weight="bold" size={12} /></button>
                  <button onClick={() => remove(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`admin-wave-delete-${w.wave_id}`}><Trash weight="bold" size={12} /></button>
                </div></Td>
              </tr>
            ))}
            {waves.length === 0 && !busy && (
              <tr><td colSpan={8} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No regional waves yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {financials && <FinancialsModal data={financials} onClose={() => setFinancials(null)} />}
    </div>
  );
}

function Money({ v }) {
  return <span className="tabular-nums">£{(Number(v) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

function StockCell({ s, testid }) {
  if (!s) return <span className="text-[#3A3A3A]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums text-[11px]" data-testid={testid}>
      <span className="border-2 border-ink bg-[#FFD600] px-1.5 py-0.5 font-bold" title="Allocated (reserved, unpaid)">{s.allocated}</span>
      <span className="border-2 border-ink bg-[#00C853] text-white px-1.5 py-0.5 font-bold" title="Sold (paid)">{s.sold}</span>
      <span className="border-2 border-ink bg-white px-1.5 py-0.5 font-bold" title="Left (available)">{s.left}</span>
    </span>
  );
}

function FinStat({ label, value, accent }) {
  return (
    <div className="flex justify-between border-b border-[#eee] py-1 font-mono text-sm">
      <span className="text-[#3A3A3A] uppercase tracking-widest text-[11px]">{label}</span>
      <span className={`font-bold ${accent || ""}`}><Money v={value} /></span>
    </div>
  );
}

function FinCard({ title, b, testid }) {
  return (
    <div className="border-2 border-ink p-3" data-testid={testid}>
      <div className="font-display text-lg uppercase mb-2">{title} <span className="text-[#3A3A3A] text-sm">· {b.units} units</span></div>
      <FinStat label="Revenue (wave price)" value={b.revenue} />
      <FinStat label="Supplier cost" value={b.cost} />
      <FinStat label="Gross margin" value={b.margin} accent="text-[#00C853]" />
      <FinStat label="RRP value" value={b.retail_value} />
      <FinStat label="Savings to customers" value={b.savings} accent="text-[#0021A5]" />
    </div>
  );
}

function FinancialsModal({ data, onClose }) {
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="wave-financials-modal">
      <div className="w-full max-w-2xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-display text-xl uppercase">Financials</h3>
          <button onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">{data.title} · {data.supplier_name} · {data.state}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <FinCard title="Committed" b={data.committed} testid="financials-committed" />
            <FinCard title="Paid" b={data.paid} testid="financials-paid" />
          </div>
          <div>
            <div className="font-display text-lg uppercase mb-1">By option</div>
            <div className="overflow-x-auto border-2 border-ink">
              <table className="w-full font-mono text-[11px]">
                <thead className="bg-ink text-white">
                  <tr>
                    <th className="text-left px-2 py-2 uppercase tracking-widest">Option</th>
                    <th className="text-right px-2 py-2 uppercase tracking-widest">Units</th>
                    <th className="text-right px-2 py-2 uppercase tracking-widest">Revenue</th>
                    <th className="text-right px-2 py-2 uppercase tracking-widest">Cost</th>
                    <th className="text-right px-2 py-2 uppercase tracking-widest">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_variant || []).length === 0 ? (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-[#3A3A3A]">No committed units yet.</td></tr>
                  ) : (data.by_variant || []).map((v) => (
                    <tr key={`${v.model}-${v.label}`} className="border-t-2 border-ink">
                      <td className="px-2 py-2">{v.model} · {v.label}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v.units} <span className="text-[#00C853]">({v.paid_units} paid)</span></td>
                      <td className="px-2 py-2 text-right"><Money v={v.revenue} /></td>
                      <td className="px-2 py-2 text-right"><Money v={v.cost} /></td>
                      <td className="px-2 py-2 text-right font-bold text-[#00C853]"><Money v={v.margin} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
