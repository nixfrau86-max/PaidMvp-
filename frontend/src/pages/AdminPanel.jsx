import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { Plus, Trash, Lightning, CurrencyGbp, Users, ChartLineUp } from "@phosphor-icons/react";

const STATES = ["seed", "active", "powered", "locked", "executing", "completed"];

export default function AdminPanel() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);
  const [vpps, setVpps] = useState([]);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    const [s, v] = await Promise.all([
      api.get("/admin/stats"),
      api.get("/admin/vpps"),
    ]);
    setStats(s.data);
    setVpps(v.data);
  };

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (!loading && user && user.role !== "admin") {
      toast.error("Switch to Admin role from the navbar.");
      navigate("/dashboard");
      return;
    }
    if (user?.role === "admin") load();
  }, [user, loading, navigate]);

  const setState = async (vppId, state) => {
    await api.patch(`/admin/vpps/${vppId}/state`, { state });
    toast.success(`State set to ${state}`);
    load();
  };

  const remove = async (vppId) => {
    if (!confirm("Delete this VPP?")) return;
    await api.delete(`/admin/vpps/${vppId}`);
    load();
  };

  if (loading || !stats) return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Admin Console</div>
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">Control Room.</h1>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
          data-testid="new-vpp-btn"
        >
          <Plus weight="bold" /> {showForm ? "Cancel" : "Create VPP"}
        </button>
      </div>

      {showForm && <CreateVPPForm onCreated={() => { setShowForm(false); load(); }} />}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-8">
        <Stat label="Total VPPs" v={stats.total_vpps} />
        <Stat label="Active" v={stats.active_vpps} c="#FF5400" />
        <Stat label="Locked" v={stats.locked_vpps} c="#0021A5" />
        <Stat label="Completed" v={stats.completed_vpps} c="#00C853" />
        <Stat label="Users" v={stats.total_users} icon={Users} />
        <Stat label="GMV" v={`£${stats.gmv.toFixed(0)}`} icon={CurrencyGbp} c="#00C853" />
      </div>

      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>State</Th>
              <Th>Joined</Th>
              <Th>Paid</Th>
              <Th>Price</Th>
              <Th>Force State</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {vpps.map(v => (
              <tr key={v.vpp_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`admin-row-${v.vpp_id}`}>
                <Td><span className="font-bold uppercase text-xs">{v.title}</span></Td>
                <Td>{v.category}</Td>
                <Td><StateBadge state={v.state} progressPct={v.progress_pct} /></Td>
                <Td>{v.participants_count}/{v.threshold}</Td>
                <Td>{v.paid_count || 0}</Td>
                <Td>£{v.customer_price}</Td>
                <Td>
                  <select
                    value={v.state}
                    onChange={(e) => setState(v.vpp_id, e.target.value)}
                    className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold"
                    data-testid={`state-select-${v.vpp_id}`}
                  >
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
                <Td>
                  <button
                    onClick={() => remove(v.vpp_id)}
                    className="border-2 border-ink p-1.5 hover:bg-[#F4F4F4]"
                    data-testid={`delete-${v.vpp_id}`}
                  >
                    <Trash size={14} weight="bold" />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function CreateVPPForm({ onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Tyres",
    image_url: "https://images.unsplash.com/photo-1601411101851-ea0e07766235?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxjYXIlMjB0aXJlJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzc5NjE1NzkzfDA&ixlib=rb-4.1.0&q=85",
    supplier_name: "",
    supplier_cost: 100,
    retail_price: 200,
    customer_price: 150,
    threshold: 20,
    max_participants: 200,
    deadline_hours: 72,
  });
  const [submitting, setSubmitting] = useState(false);

  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === "number" ? +e.target.value : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/admin/vpps", form);
      toast.success("VPP created");
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="border-2 border-ink bg-white shadow-brut p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="create-vpp-form">
      <Field label="Title"><input required value={form.title} onChange={upd("title")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-title" /></Field>
      <Field label="Category"><input value={form.category} onChange={upd("category")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-category" /></Field>
      <Field label="Description" full><textarea value={form.description} onChange={upd("description")} className="w-full border-2 border-ink p-2 font-mono text-sm" rows={2} data-testid="form-description" /></Field>
      <Field label="Image URL" full><input value={form.image_url} onChange={upd("image_url")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-image" /></Field>
      <Field label="Supplier"><input value={form.supplier_name} onChange={upd("supplier_name")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-supplier" /></Field>
      <Field label="Supplier Cost (£)"><input type="number" value={form.supplier_cost} onChange={upd("supplier_cost")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-cost" /></Field>
      <Field label="Retail Price (£)"><input type="number" value={form.retail_price} onChange={upd("retail_price")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-retail" /></Field>
      <Field label="VPP Price (£)"><input type="number" value={form.customer_price} onChange={upd("customer_price")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-price" /></Field>
      <Field label="Threshold"><input type="number" value={form.threshold} onChange={upd("threshold")} className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="form-threshold" /></Field>
      <Field label="Max Participants"><input type="number" value={form.max_participants} onChange={upd("max_participants")} className="w-full border-2 border-ink p-2 font-mono text-sm" /></Field>
      <Field label="Deadline (hours)"><input type="number" value={form.deadline_hours} onChange={upd("deadline_hours")} className="w-full border-2 border-ink p-2 font-mono text-sm" /></Field>
      <div className="sm:col-span-2 flex justify-end">
        <button type="submit" disabled={submitting} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut" data-testid="form-submit">
          {submitting ? "Creating..." : "Create VPP"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">{label}</div>
      {children}
    </label>
  );
}

function Stat({ label, v, c, icon: Icon }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut-sm p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#525252] mb-1">{label}</div>
      <div className="font-display text-2xl" style={c ? { color: c } : {}}>{v}</div>
    </div>
  );
}
function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-3 py-3">{children}</th>; }
function Td({ children }) { return <td className="px-3 py-3 align-middle">{children}</td>; }

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}
