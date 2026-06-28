import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Plus, Trash, PencilSimple, X, Package, ClipboardText } from "@phosphor-icons/react";
import { logError } from "../lib/log";
import WaveForm from "../components/wave/WaveForm";

const STATE_BADGE = {
  open: { label: "Open", bg: "#00C853" },
  almost_full: { label: "Almost Full", bg: "#FFD600" },
  activated: { label: "Activated", bg: "#0021A5", text: "#fff" },
  processing: { label: "Processing", bg: "#FF5400", text: "#fff" },
  fulfilment: { label: "Fulfilment", bg: "#0021A5", text: "#fff" },
  completed: { label: "Completed", bg: "#525252", text: "#fff" },
  expired: { label: "Expired", bg: "#525252", text: "#fff" },
};

export default function SupplierWaves() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [summary, setSummary] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [w, r, c] = await Promise.all([
        api.get("/supplier/waves"),
        api.get("/regions"),
        api.get("/wave-categories"),
      ]);
      setWaves(w.data);
      setRegions(r.data);
      setCategories(c.data);
    } catch (err) {
      if (err?.response?.status === 403) { navigate("/supplier/onboarding"); return; }
      logError("load failed", err);
    }
    setDataLoading(false);
  }, [navigate]);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    reload();
  }, [user, loading, navigate, reload]);

  const remove = async (w) => {
    if (!window.confirm(`Remove "${w.title}"? Active reservations will be released.`)) return;
    try {
      await api.delete(`/supplier/waves/${w.wave_id}`);
      toast.success("Wave removed");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const openSummary = async (w) => {
    try {
      const { data } = await api.get(`/supplier/waves/${w.wave_id}/order-summary`);
      setSummary(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Supplier Console</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">Regional Waves<sup className="text-xl">©</sup></h1>
            <p className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">One region · one category · one unit target</p>
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2" data-testid="create-wave-btn">
            <Plus weight="bold" /> Create Wave
          </button>
        </div>

        {waves.length === 0 ? (
          <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
            <Package weight="duotone" size={36} className="mx-auto mb-3 text-[#FF5400]" />
            <div className="font-display text-2xl uppercase mb-2">No waves yet.</div>
            <p className="text-[#3A3A3A] mb-5 text-sm">Create your first Regional Wave — pick a region, category and unit target.</p>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2">Create First Wave</button>
          </div>
        ) : (
          <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto" data-testid="supplier-waves-table">
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-white">
                <tr><Th>Wave</Th><Th>Region</Th><Th>Category</Th><Th>State</Th><Th>Units</Th><Th>Stock</Th><Th>Activates</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {waves.map((w) => {
                  const sb = STATE_BADGE[w.state] || STATE_BADGE.open;
                  const editable = !["processing", "fulfilment", "completed"].includes(w.state);
                  return (
                    <tr key={w.wave_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`supplier-wave-row-${w.wave_id}`}>
                      <Td><span className="font-bold uppercase text-xs">{w.title}</span><div className="text-[10px] text-[#3A3A3A]">{w.brand}</div></Td>
                      <Td>{w.region_name}</Td>
                      <Td className="capitalize">{w.category_label}</Td>
                      <Td><span className="inline-flex border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest" style={{ background: sb.bg, color: sb.text || "#0A0A0A" }}>{sb.label}</span></Td>
                      <Td>{w.units_committed}/{w.ideal_target}</Td>
                      <Td><StockCell s={w.stock_summary} testid={`supplier-wave-stock-${w.wave_id}`} /></Td>
                      <Td>{w.min_activation}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {editable && (
                            <button onClick={() => { setEditing(w); setShowForm(true); }} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`edit-wave-${w.wave_id}`} title="Edit"><PencilSimple weight="bold" size={12} /></button>
                          )}
                          <button onClick={() => openSummary(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`summary-wave-${w.wave_id}`} title="Order summary"><ClipboardText weight="bold" size={12} /></button>
                          <button onClick={() => remove(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`remove-wave-${w.wave_id}`} title="Remove"><Trash weight="bold" size={12} /></button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <WaveForm
          regions={regions}
          categories={categories}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}
      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

function SummaryModal({ summary, onClose }) {
  const pay = summary.payment_summary || {};
  const orders = summary.orders || [];
  const PAY_BADGE = {
    paid: { label: "Paid", cls: "bg-[#00C853] text-ink" },
    authorized: { label: "Authorized", cls: "bg-[#FFD600] text-ink" },
    unpaid: { label: "Unpaid", cls: "bg-[#F4F4F4] text-ink" },
  };
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="order-summary-modal">
      <div className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-display text-xl uppercase">Order summary</h3>
          <button onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">{summary.title} · {summary.state} · {summary.total_units} units</div>

          {/* Payment status breakdown */}
          <div data-testid="summary-payment-breakdown">
            <div className="font-display text-lg uppercase mb-2">Payment status</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="border-2 border-ink p-2 bg-[#00C853]/15" data-testid="summary-paid">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Paid</div>
                <div className="font-display text-2xl tabular-nums">{pay.paid_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.paid_orders || 0} orders</div>
              </div>
              <div className="border-2 border-ink p-2 bg-[#FFD600]/20" data-testid="summary-authorized">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Authorized</div>
                <div className="font-display text-2xl tabular-nums">{pay.authorized_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.authorized_orders || 0} orders</div>
              </div>
              <div className="border-2 border-ink p-2 bg-[#F4F4F4]" data-testid="summary-unpaid">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Reserved / Unpaid</div>
                <div className="font-display text-2xl tabular-nums">{pay.reserved_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.reserved_orders || 0} orders</div>
              </div>
            </div>
          </div>

          {/* By option */}
          <div>
            <div className="font-display text-lg uppercase mb-1">By option</div>
            {(summary.variant_breakdown || []).length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">No committed units yet.</div> :
              (summary.variant_breakdown || []).map((b) => (
                <div key={`${b.model}-${b.label}`} className="flex justify-between border-b border-[#eee] py-1 font-mono text-sm">
                  <span>{b.model} · {b.label}</span>
                  <span className="font-bold">{b.units} units <span className="text-[#00C853] text-[11px]">({b.paid_units || 0} paid)</span></span>
                </div>
              ))}
          </div>

          {/* Per-destination items */}
          <div>
            <div className="font-display text-lg uppercase mb-1">Ship to (per destination)</div>
            {(summary.destinations || []).length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">—</div> :
              (summary.destinations || []).map((d) => (
                <div key={d.destination} className="border-2 border-ink mb-2 p-2" data-testid="summary-destination">
                  <div className="flex justify-between font-mono text-sm"><span className="font-bold">{d.destination}</span><span className="font-bold">{d.units} units</span></div>
                  <div className="mt-1 pl-2 space-y-0.5">
                    {(d.items || []).map((it, i) => (
                      <div key={`${it.label}-${i}`} className="flex justify-between font-mono text-[11px] text-[#3A3A3A]"><span>↳ {it.label}</span><span>{it.qty} units</span></div>
                    ))}
                    {(d.fittings || []).map((f, i) => (
                      <div key={`${f.slot}-${i}`} className="flex justify-between font-mono text-[11px] text-[#0021A5] uppercase tracking-widest"><span>🕑 {f.slot}</span><span>{f.units} units</span></div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {/* Orders with customer details */}
          <div>
            <div className="font-display text-lg uppercase mb-2">Orders &amp; customers</div>
            {orders.length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">No orders yet.</div> : (
              <div className="overflow-x-auto border-2 border-ink" data-testid="summary-orders-table">
                <table className="w-full font-mono text-[11px]">
                  <thead className="bg-ink text-white">
                    <tr>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Customer</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Items</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">{summary.category === "tyres" ? "Garage / Fitting" : "Delivery"}</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const pb = PAY_BADGE[o.payment_status] || PAY_BADGE.unpaid;
                      return (
                        <tr key={o.order_id} className="border-t-2 border-ink align-top" data-testid={`summary-order-${o.order_id}`}>
                          <td className="px-2 py-2">
                            <div className="font-bold">{o.customer?.name || "—"}</div>
                            {o.customer?.email && <div className="text-[#3A3A3A] break-all">{o.customer.email}</div>}
                            {o.customer?.phone && <div className="text-[#3A3A3A]">{o.customer.phone}</div>}
                          </td>
                          <td className="px-2 py-2">
                            {(o.items || []).map((it, i) => (
                              <div key={`${it.label}-${i}`}>{it.qty}× {it.model} · {it.label}</div>
                            ))}
                          </td>
                          <td className="px-2 py-2">
                            <div>{o.destination}</div>
                            {o.fitting_slot && <div className="text-[#0021A5] uppercase tracking-widest text-[10px]">🕑 {o.fitting_slot}</div>}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`inline-block border-2 border-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${pb.cls}`}>{pb.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-4 py-3">{children}</th>; }
function Td({ children, className = "" }) { return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>; }

function StockCell({ s, testid }) {
  if (!s) return <span className="text-[#3A3A3A]">—</span>;
  return (
    <div className="flex items-center gap-1.5 tabular-nums text-[10px]" data-testid={testid}>
      <span className="border-2 border-ink bg-[#FFD600] px-1.5 py-0.5 font-bold" title="Allocated — reserved but not yet paid">A {s.allocated}</span>
      <span className="border-2 border-ink bg-[#00C853] text-white px-1.5 py-0.5 font-bold" title="Sold — paid">S {s.sold}</span>
      <span className="border-2 border-ink bg-white px-1.5 py-0.5 font-bold" title="Left — available inventory">L {s.left}</span>
    </div>
  );
}
