import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X, DownloadSimple, Printer, PaperPlaneTilt, CheckCircle, Trash, MapPin, Wrench } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

const PO_STATUS = {
  draft: { bg: "#FF5400", fg: "#fff", label: "Draft" },
  sent: { bg: "#2979FF", fg: "#fff", label: "Sent" },
  fulfilled: { bg: "#00C853", fg: "#0A0A0A", label: "Fulfilled" },
};
const money = (n) => `£${Number(n || 0).toFixed(2)}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function StatusBadge({ status }) {
  const s = PO_STATUS[status] || PO_STATUS.draft;
  return <span className="inline-flex items-center border-2 border-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function PODetail({ poId, onClose, onChanged }) {
  const [po, setPo] = useState(null);
  useEffect(() => {
    api.get(`/admin/purchase-orders/${poId}`).then(({ data }) => setPo(data)).catch(() => toast.error("Failed to load PO"));
  }, [poId]);

  const setStatus = async (status) => {
    try { const { data } = await api.patch(`/admin/purchase-orders/${poId}/status`, { status }); setPo(data); onChanged(); toast.success(`Marked ${status}`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const exportCsv = () => {
    const rows = [["Model", "Option/Size", "Qty", "Unit cost", "Line total"]];
    po.line_items.forEach((li) => rows.push([li.model, li.label, li.qty, li.unit_cost, li.line_total]));
    rows.push([], ["TOTAL UNITS", po.totals.units, "", "SUPPLIER COST", po.totals.supplier_cost]);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `${po.po_number}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!po) return null;
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="po-detail-modal" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6" onClick={(e) => e.stopPropagation()} id="po-print-area">
        <div className="border-b-2 border-ink p-4 flex items-start justify-between sticky top-0 bg-white z-10">
          <div>
            <div className="font-display text-2xl uppercase">{po.po_number}</div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">{po.wave_title} · {po.region_name}</div>
            <div className="font-mono text-[11px] text-[#3A3A3A] mt-0.5">Supplier: <span className="font-bold text-ink">{po.supplier_name}</span>{po.supplier_email ? ` · ${po.supplier_email}` : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={po.status} />
            <button onClick={onClose} className="p-2 border-2 border-ink no-print" data-testid="po-detail-close"><X weight="bold" /></button>
          </div>
        </div>

        <div className="p-5 space-y-6 font-mono text-sm">
          <div className="flex flex-wrap gap-3 text-[11px] uppercase tracking-widest text-[#3A3A3A]">
            <span>Created {fmtDate(po.created_at)}</span>
            {po.sent_at && <span>· Sent {fmtDate(po.sent_at)}</span>}
            {po.fulfilled_at && <span>· Fulfilled {fmtDate(po.fulfilled_at)}</span>}
            <span>· Bundles {po.totals.orders} paid orders</span>
          </div>

          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Order lines (paid units only)</div>
            <div className="border-2 border-ink overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#FAFAFA] border-b-2 border-ink"><tr>
                  <th className="text-left px-3 py-2 uppercase tracking-widest text-[9px]">Model</th>
                  <th className="text-left px-3 py-2 uppercase tracking-widest text-[9px]">Option / size</th>
                  <th className="text-right px-3 py-2 uppercase tracking-widest text-[9px]">Qty</th>
                  <th className="text-right px-3 py-2 uppercase tracking-widest text-[9px]">Unit cost</th>
                  <th className="text-right px-3 py-2 uppercase tracking-widest text-[9px]">Line total</th>
                </tr></thead>
                <tbody>
                  {po.line_items.map((li) => (
                    <tr key={li.variant_id} className="border-b border-ink/20">
                      <td className="px-3 py-2 font-bold">{li.model}</td>
                      <td className="px-3 py-2">{li.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{li.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(li.unit_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{money(li.line_total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-ink text-white">
                    <td className="px-3 py-2 font-bold uppercase" colSpan={2}>Grand total</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{po.totals.units}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{money(po.totals.supplier_cost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Destinations ({po.destinations.length})</div>
            <div className="space-y-2">
              {po.destinations.map((d, i) => (
                <div key={i} className="border-2 border-ink p-3">
                  <div className="flex items-center gap-1.5 font-bold uppercase text-xs mb-1">
                    {d.type === "garage" ? <Wrench weight="bold" size={13} /> : <MapPin weight="bold" size={13} />} {d.destination} <span className="text-[#3A3A3A] font-normal">· {d.units} units</span>
                  </div>
                  <div className="text-[11px] text-[#3A3A3A]">{d.items.map((it) => `${it.label} ×${it.qty}`).join("  ·  ")}</div>
                  {d.fittings?.length > 0 && <div className="text-[11px] mt-1">Fittings: {d.fittings.map((f) => `${f.slot} (${f.customer})`).join(" · ")}</div>}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Customer contacts ({po.customers.length})</div>
            <div className="border-2 border-ink divide-y divide-ink/20">
              {po.customers.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]">
                  <span className="font-bold">{c.name}</span>
                  <span className="text-[#3A3A3A]">{c.email} · {c.phone}</span>
                  <span>{c.units}u → {c.destination}{c.fitting_slot ? ` · ${c.fitting_slot}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t-2 border-ink p-4 flex flex-wrap justify-end gap-2 sticky bottom-0 bg-white no-print">
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover-brut" data-testid="po-export-csv"><DownloadSimple weight="bold" size={13} /> CSV</button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover-brut" data-testid="po-print"><Printer weight="bold" size={13} /> Print / PDF</button>
          {po.status === "draft" && <button onClick={() => setStatus("sent")} className="inline-flex items-center gap-1.5 bg-[#2979FF] text-white border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover-brut" data-testid="po-mark-sent"><PaperPlaneTilt weight="bold" size={13} /> Mark sent</button>}
          {po.status === "sent" && <button onClick={() => setStatus("fulfilled")} className="inline-flex items-center gap-1.5 bg-[#00C853] border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover-brut" data-testid="po-mark-fulfilled"><CheckCircle weight="bold" size={13} /> Mark fulfilled</button>}
        </div>
      </div>
      <style>{`@media print{.no-print{display:none!important}body *{visibility:hidden}#po-print-area,#po-print-area *{visibility:visible}#po-print-area{position:absolute;left:0;top:0;width:100%;border:none;box-shadow:none;margin:0}}`}</style>
    </div>
  );
}

export default function BundledOrdersTab() {
  const [pos, setPos] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.get("/admin/purchase-orders"), api.get("/admin/purchase-orders/candidates")]);
      setPos(p.data); setCandidates(c.data);
    } catch (e) { toast.error("Failed to load purchase orders"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!sel) { toast.error("Pick a wave to bundle"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/purchase-orders", { wave_id: sel });
      toast.success(`${data.po_number} created`);
      setSel(""); await load(); setOpenId(data.po_id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to create PO"); }
    finally { setBusy(false); }
  };

  const remove = async (po) => {
    if (!window.confirm(`Delete ${po.po_number}? This does not affect customer orders.`)) return;
    try { await api.delete(`/admin/purchase-orders/${po.po_id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const available = candidates.filter((c) => !c.has_po);

  return (
    <div className="space-y-6" data-testid="bundled-orders-tab">
      <div className="border-2 border-ink bg-white shadow-brut p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-2">Generate a bundled purchase order</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="flex-1 border-2 border-ink px-3 py-2 font-mono text-xs" data-testid="po-wave-select">
            <option value="">Select a wave with paid orders…</option>
            {available.map((c) => <option key={c.wave_id} value={c.wave_id}>{c.title} · {c.region_name} · {c.paid_units} paid units · {c.supplier_name}</option>)}
          </select>
          <button onClick={generate} disabled={busy || !sel} className="inline-flex items-center justify-center gap-2 bg-[#FF5400] text-white border-2 border-ink px-5 py-2 text-xs font-bold uppercase tracking-widest shadow-brut hover-brut disabled:opacity-50" data-testid="po-generate-btn">
            <Plus weight="bold" size={12} /> {busy ? "Bundling…" : "Generate PO"}
          </button>
        </div>
        <div className="text-[9px] font-mono uppercase tracking-widest text-[#3A3A3A] mt-2">
          Bundles all PAID (captured) orders in a wave into one supplier PO. {available.length} wave{available.length === 1 ? "" : "s"} ready · {candidates.length - available.length} already have a PO.
        </div>
      </div>

      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white"><tr>
            <Th>PO #</Th><Th>Wave</Th><Th>Supplier</Th><Th>Units</Th><Th>Supplier cost</Th><Th>Created</Th><Th>Status</Th><Th>Actions</Th>
          </tr></thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.po_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`po-row-${po.po_id}`}>
                <Td><button onClick={() => setOpenId(po.po_id)} className="font-bold underline" data-testid={`po-view-${po.po_id}`}>{po.po_number}</button></Td>
                <Td><div className="text-[11px] font-bold uppercase">{po.wave_title}</div><div className="text-[10px] text-[#3A3A3A]">{po.region_name}</div></Td>
                <Td className="text-[11px]">{po.supplier_name}</Td>
                <Td className="tabular-nums">{po.totals?.units}</Td>
                <Td className="tabular-nums font-bold">{money(po.totals?.supplier_cost)}</Td>
                <Td className="text-[11px] whitespace-nowrap">{fmtDate(po.created_at)}</Td>
                <Td><StatusBadge status={po.status} /></Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setOpenId(po.po_id)} className="border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest hover-brut">View</button>
                    <button onClick={() => remove(po)} className="p-1.5 border-2 border-ink hover-brut" data-testid={`po-delete-${po.po_id}`}><Trash weight="bold" size={11} /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {!loading && pos.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No purchase orders yet — generate one above.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {openId && <PODetail poId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
