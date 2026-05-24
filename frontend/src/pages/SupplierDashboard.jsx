import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Truck, Package, CurrencyGbp, Users, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function SupplierDashboard() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  const load = async () => {
    const { data } = await api.get("/supplier/orders");
    setOrders(data);
    setLoadingData(false);
  };

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (!loading && user && user.role !== "supplier" && user.role !== "admin") {
      toast.error("Switch to Supplier role from the navbar.");
      navigate("/dashboard");
      return;
    }
    if (user) load();
  }, [user, loading, navigate]);

  const dispatch = async (vppId) => {
    try {
      await api.post(`/supplier/orders/${vppId}/dispatch`);
      toast.success("Batch dispatched.");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  if (loading || loadingData) return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;

  const totals = {
    batches: orders.length,
    units: orders.reduce((a, o) => a + (o.paid_count || 0), 0),
    revenue: orders.reduce((a, o) => a + (o.total_supplier_value || 0), 0),
    pending: orders.filter(o => o.state !== "completed").length,
  };

  return (
    <Shell>
      <div className="mb-8">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Supplier Console</div>
        <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">Batch Orders.</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Active Batches" value={totals.batches} icon={Package} />
        <Stat label="Total Units" value={totals.units} icon={Users} />
        <Stat label="Pending Dispatch" value={totals.pending} icon={Truck} accent="#FFD600" />
        <Stat label="Supplier Revenue" value={`£${totals.revenue.toFixed(0)}`} icon={CurrencyGbp} accent="#00C853" />
      </div>

      <div className="border-2 border-ink bg-white shadow-brut overflow-hidden">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <Th>Product</Th>
              <Th>State</Th>
              <Th>Paid / Joined</Th>
              <Th>Unit Cost</Th>
              <Th>Batch Value</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 uppercase tracking-widest text-[#525252]">No batch orders yet.</td></tr>
            ) : orders.map(o => (
              <tr key={o.vpp_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`supplier-row-${o.vpp_id}`}>
                <Td>
                  <div className="flex gap-2 items-center">
                    <img src={o.image_url} alt="" className="w-10 h-10 object-cover border-2 border-ink" />
                    <span className="font-bold uppercase text-xs">{o.title}</span>
                  </div>
                </Td>
                <Td><StateBadge state={o.state} progressPct={o.progress_pct} /></Td>
                <Td>{o.paid_count} / {o.participants_count}</Td>
                <Td>£{o.supplier_cost}</Td>
                <Td>£{o.total_supplier_value?.toFixed(2)}</Td>
                <Td>
                  {o.state !== "completed" ? (
                    <button
                      onClick={() => dispatch(o.vpp_id)}
                      className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-3 py-1.5 text-[10px] shadow-brut-sm hover-brut"
                      data-testid={`dispatch-${o.vpp_id}`}
                    >
                      Dispatch
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#00C853] font-bold uppercase tracking-widest text-[10px]">
                      <CheckCircle weight="fill" size={14} /> Done
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function Stat({ label, value, icon: Icon, accent }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#525252]">{label}</span>
        <Icon weight="duotone" size={20} className="text-[#FF5400]" />
      </div>
      <div className="font-display text-3xl" style={accent ? { color: accent } : {}}>{value}</div>
    </div>
  );
}
function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-4 py-3">{children}</th>; }
function Td({ children }) { return <td className="px-4 py-3 align-middle">{children}</td>; }

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}
