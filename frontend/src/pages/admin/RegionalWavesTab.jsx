import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

const STATES = ["open", "almost_full", "activated", "processing", "fulfilment", "completed", "expired"];

export default function RegionalWavesTab() {
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [newRegion, setNewRegion] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [w, r] = await Promise.all([
        api.get("/admin/regional-waves"),
        api.get("/regions?all_regions=true"),
      ]);
      setWaves(w.data);
      setRegions(r.data);
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

      {/* Waves table */}
      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr><Th>Wave</Th><Th>Supplier</Th><Th>Region</Th><Th>Category</Th><Th>Units</Th><Th>State</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.wave_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`admin-wave-row-${w.wave_id}`}>
                <Td><span className="font-bold uppercase text-xs">{w.title}</span></Td>
                <Td>{w.supplier_name}</Td>
                <Td>{w.region_name}</Td>
                <Td className="capitalize">{w.category_label}</Td>
                <Td>{w.units_committed}/{w.ideal_target}</Td>
                <Td>
                  <select value={w.state} onChange={(e) => setState(w, e.target.value)} className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold" data-testid={`admin-wave-state-${w.wave_id}`}>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
                <Td><button onClick={() => remove(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`admin-wave-delete-${w.wave_id}`}><Trash weight="bold" size={12} /></button></Td>
              </tr>
            ))}
            {waves.length === 0 && !busy && (
              <tr><td colSpan={7} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No regional waves yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
