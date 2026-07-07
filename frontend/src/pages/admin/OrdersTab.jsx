import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MagnifyingGlass, DownloadSimple, X, Package, MapPin, Wrench } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

const PAY_STYLE = {
  paid: { bg: "#00C853", fg: "#0A0A0A", label: "Paid" },
  authorized: { bg: "#2979FF", fg: "#fff", label: "Authorized" },
  reserved: { bg: "#FF5400", fg: "#fff", label: "Reserved" },
  cancelled: { bg: "#525252", fg: "#fff", label: "Cancelled" },
};

const fmt = (n) => (n == null ? "—" : `£${Number(n).toFixed(2)}`);
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function StatCard({ label, value, color, testid }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut-sm p-3" data-testid={testid}>
      <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">{label}</div>
      <div className="font-display text-2xl" style={{ color: color || "#0A0A0A" }}>{value}</div>
    </div>
  );
}

function PayBadge({ state }) {
  const s = PAY_STYLE[state] || PAY_STYLE.reserved;
  return <span className="inline-flex items-center border-2 border-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function OrderDetail({ order, onClose }) {
  const f = order.fulfilment;
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="order-detail-modal" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white border-2 border-ink shadow-brut-lg my-6" onClick={(e) => e.stopPropagation()}>
        <div className="border-b-2 border-ink p-4 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <div className="font-display text-xl uppercase">Order {order.order_id}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">{fmtDate(order.created_at)}</div>
          </div>
          <div className="flex items-center gap-2">
            <PayBadge state={order.payment_status} />
            <button onClick={onClose} className="p-2 border-2 border-ink" data-testid="order-detail-close"><X weight="bold" /></button>
          </div>
        </div>
        <div className="p-5 space-y-5 font-mono text-sm">
          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Customer</div>
            <div className="font-bold">{order.customer.name}</div>
            <div>{order.customer.email}</div>
            <div>{order.customer.phone}</div>
          </section>
          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Wave</div>
            <div className="font-bold uppercase text-xs">{order.wave.title}</div>
            <div className="text-[#3A3A3A]">{order.wave.region_name} · {order.wave.supplier_name} · {order.category_label}</div>
          </section>
          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Items ({order.units} units)</div>
            <div className="border-2 border-ink">
              {order.items.map((it, i) => (
                <div key={`${it.model}-${it.label}-${i}`} className="flex items-center justify-between px-3 py-2 border-b border-ink/20 last:border-0">
                  <span>{it.model} · {it.label} × {it.qty}</span>
                  <span className="font-bold">{fmt(it.wave_price)}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Fulfilment</div>
            {f.type === "garage" ? (
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1"><Wrench weight="bold" size={13} /> {f.garage_name || "—"}</span>
                {f.fitting_slot && <span className="text-[#3A3A3A]">Fitting: {f.fitting_slot}</span>}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1"><MapPin weight="bold" size={13} /> {f.delivery_address || "—"}</span>
            )}
          </section>
          <section className="border-t-2 border-ink pt-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">Payment {order.payment_method ? `· ${order.payment_method}` : ""}</div>
            <div className="space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
              <div className="flex justify-between"><span>Service fee</span><span>{fmt(order.service_fee)}</span></div>
              <div className="flex justify-between"><span>Payment fee</span><span>{fmt(order.payment_fee)}</span></div>
              <div className="flex justify-between font-bold text-base border-t-2 border-ink pt-1 mt-1"><span>Total</span><span>{fmt(order.total ?? order.subtotal)}</span></div>
              {order.paid_at && <div className="text-[#3A3A3A] text-[11px] pt-1">Paid {fmtDate(order.paid_at)}</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/orders");
      setOrders(data.orders);
      setStats(data.stats);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load orders");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== "all" && o.payment_status !== filter) return false;
      if (!term) return true;
      return [o.order_id, o.customer.name, o.customer.email, o.wave.title, o.wave.supplier_name].join(" ").toLowerCase().includes(term);
    });
  }, [orders, filter, q]);

  const exportCsv = () => {
    const rows = [["Order ID", "Date", "Customer", "Email", "Wave", "Region", "Supplier", "Units", "Subtotal", "Total", "Payment", "Method", "Fulfilment"]];
    filtered.forEach((o) => rows.push([
      o.order_id, fmtDate(o.created_at), o.customer.name, o.customer.email, o.wave.title, o.wave.region_name, o.wave.supplier_name,
      o.units, o.subtotal ?? "", o.total ?? "", o.payment_status, o.payment_method || "", o.fulfilment.garage_name || o.fulfilment.delivery_address || "",
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} orders`);
  };

  const filters = [
    { id: "all", label: `All (${stats.total || 0})` },
    { id: "paid", label: `Paid (${stats.paid || 0})` },
    { id: "reserved", label: `Reserved (${stats.reserved || 0})` },
    { id: "authorized", label: `Authorized (${stats.authorized || 0})` },
    { id: "cancelled", label: `Cancelled (${stats.cancelled || 0})` },
  ];

  return (
    <div className="space-y-6" data-testid="orders-tab">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total orders" value={stats.total ?? "—"} testid="orders-stat-total" />
        <StatCard label="Paid orders" value={stats.paid ?? "—"} color="#00C853" testid="orders-stat-paid" />
        <StatCard label="Paid units" value={stats.paid_units ?? "—"} testid="orders-stat-units" />
        <StatCard label="Revenue (paid)" value={fmt(stats.revenue)} color="#FF5400" testid="orders-stat-revenue" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${filter === f.id ? "bg-ink text-white" : "bg-white hover-brut"}`}
              data-testid={`orders-filter-${f.id}`}>{f.label}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass weight="bold" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3A3A3A]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, wave, supplier, order id…"
            className="w-full border-2 border-ink pl-9 pr-3 py-2 font-mono text-xs" data-testid="orders-search" />
        </div>
        <button onClick={exportCsv} disabled={!filtered.length} className="inline-flex items-center gap-2 bg-white border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest shadow-brut-sm hover-brut disabled:opacity-50" data-testid="orders-export-csv">
          <DownloadSimple weight="bold" size={13} /> Export CSV
        </button>
      </div>

      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr><Th>Order</Th><Th>Date</Th><Th>Customer</Th><Th>Wave</Th><Th>Units</Th><Th>Total</Th><Th>Fulfilment</Th><Th>Payment</Th></tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.order_id} className="border-t-2 border-ink hover:bg-[#FAFAFA] cursor-pointer" onClick={() => setSelected(o)} data-testid={`order-row-${o.order_id}`}>
                <Td><span className="font-bold text-[11px]">{o.order_id}</span></Td>
                <Td className="text-[11px] whitespace-nowrap">{fmtDate(o.created_at)}</Td>
                <Td>
                  <div className="text-[11px] font-bold">{o.customer.name}</div>
                  <div className="text-[10px] text-[#3A3A3A]">{o.customer.email}</div>
                </Td>
                <Td>
                  <div className="text-[11px] font-bold uppercase">{o.wave.title}</div>
                  <div className="text-[10px] text-[#3A3A3A]">{o.wave.region_name} · {o.wave.supplier_name}</div>
                </Td>
                <Td className="tabular-nums">{o.units}</Td>
                <Td className="tabular-nums font-bold">{fmt(o.total ?? o.subtotal)}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    {o.fulfilment.type === "garage" ? <Wrench weight="bold" size={11} /> : <Package weight="bold" size={11} />}
                    {o.fulfilment.type === "garage" ? (o.fulfilment.garage_name || "Garage") : "Delivery"}
                  </span>
                </Td>
                <Td><PayBadge state={o.payment_status} /></Td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No orders match.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
