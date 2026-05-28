import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { Plus, Trash, Lightning, CurrencyGbp, Users, ChartLineUp, CheckCircle, X, Storefront, Clock, Sliders, Star } from "@phosphor-icons/react";

const STATES = ["seed", "active", "powered", "locked", "executing", "completed"];

export default function AdminPanel() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);
  const [vpps, setVpps] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [pendingWaves, setPendingWaves] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState("waves");

  const load = async () => {
    const [s, v, sup, pw] = await Promise.all([
      api.get("/admin/stats"),
      api.get("/admin/vpps"),
      api.get("/admin/suppliers"),
      api.get("/admin/waves/pending"),
    ]);
    setStats(s.data);
    setVpps(v.data);
    setSuppliers(sup.data);
    setPendingWaves(pw.data);
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

  const verifySupplier = async (id) => {
    await api.post(`/admin/suppliers/${id}/verify`, {});
    toast.success("Supplier verified");
    load();
  };
  const rejectSupplier = async (id) => {
    const reason = prompt("Reason for rejection:") || "Did not meet criteria";
    await api.post(`/admin/suppliers/${id}/reject`, { reason });
    load();
  };
  const approveWave = async (id) => {
    await api.post(`/admin/waves/${id}/approve`, {});
    toast.success("Wave approved & live");
    load();
  };
  const rejectWave = async (id) => {
    const reason = prompt("Reason for rejection:") || "Did not meet criteria";
    await api.post(`/admin/waves/${id}/reject`, { reason });
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

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <Stat label="Total Waves" v={stats.total_vpps} />
        <Stat label="Active" v={stats.active_vpps} c="#FF5400" />
        <Stat label="Locked" v={stats.locked_vpps} c="#0021A5" />
        <Stat label="Suppliers" v={stats.total_suppliers || 0} icon={Storefront} />
        <Stat label="Pending Sup." v={stats.pending_suppliers || 0} c={stats.pending_suppliers ? "#FF5400" : undefined} />
        <Stat label="GMV" v={`£${stats.gmv.toFixed(0)}`} icon={CurrencyGbp} c="#00C853" />
      </div>

      {/* Tabs */}
      <div className="border-2 border-ink bg-white shadow-brut-sm flex mb-6 overflow-x-auto" data-testid="admin-tabs">
        {[
          { id: "waves", label: `All Waves (${vpps.length})` },
          { id: "pending_waves", label: `Pending Waves (${pendingWaves.length})`, badge: pendingWaves.length },
          { id: "suppliers", label: `Suppliers (${suppliers.length})`, badge: stats.pending_suppliers },
          { id: "users", label: "Users" },
          { id: "fees", label: "Fees & Payments" },
          { id: "terms", label: "T&Cs Audit" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest font-mono border-r-2 border-ink last:border-r-0 whitespace-nowrap relative ${tab === t.id ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
            data-testid={`admin-tab-${t.id}`}
          >
            {t.label}
            {t.badge > 0 && tab !== t.id && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FF5400] animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {tab === "waves" && (
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
      )}

      {tab === "pending_waves" && (
        <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
          {pendingWaves.length === 0 ? (
            <div className="p-10 text-center font-mono uppercase text-sm tracking-widest text-[#3A3A3A]">No waves pending approval.</div>
          ) : (
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-white">
                <tr><Th>Wave</Th><Th>Supplier</Th><Th>Category</Th><Th>Threshold</Th><Th>Retail / Collective</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {pendingWaves.map(w => (
                  <tr key={w.vpp_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`pending-wave-${w.vpp_id}`}>
                    <Td>
                      <div className="flex gap-2 items-center">
                        <img src={w.image_url} alt="" className="w-10 h-10 border-2 border-ink object-cover" />
                        <span className="font-bold uppercase text-xs">{w.title}</span>
                      </div>
                    </Td>
                    <Td>{w.supplier_name}</Td>
                    <Td>{w.category}</Td>
                    <Td>{w.threshold}</Td>
                    <Td>£{w.retail_price} / £{w.customer_price}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <button onClick={() => approveWave(w.vpp_id)} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid={`approve-wave-${w.vpp_id}`}>
                          <CheckCircle weight="fill" size={10}/> Approve
                        </button>
                        <button onClick={() => rejectWave(w.vpp_id)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid={`reject-wave-${w.vpp_id}`}>
                          <X weight="bold" size={10}/> Reject
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "suppliers" && (
        <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
          {suppliers.length === 0 ? (
            <div className="p-10 text-center font-mono uppercase text-sm tracking-widest text-[#3A3A3A]">No supplier applications yet.</div>
          ) : (
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-white">
                <tr><Th>Business</Th><Th>Category</Th><Th>Tier</Th><Th>Info Level</Th><Th>Waves</Th><Th>Contact</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {suppliers.map(s => (
                  <tr key={s.supplier_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`supplier-row-${s.supplier_id}`}>
                    <Td><div className="font-bold uppercase text-xs">{s.business_name}</div></Td>
                    <Td>{s.category}</Td>
                    <Td><SupplierStatusBadge status={s.status} /></Td>
                    <Td className="capitalize">{s.info_level}</Td>
                    <Td>{s.waves_published}</Td>
                    <Td><a href={`mailto:${s.contact_email}`} className="underline">{s.contact_email}</a></Td>
                    <Td>
                      {s.status !== "verified" && s.status !== "payout_ready" && s.status !== "rejected" && (
                        <div className="flex gap-1">
                          <button onClick={() => verifySupplier(s.supplier_id)} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid={`verify-supplier-${s.supplier_id}`}>
                            <CheckCircle weight="fill" size={10}/> Verify
                          </button>
                          <button onClick={() => rejectSupplier(s.supplier_id)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut">
                            <X weight="bold" size={10}/>
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === "fees" && <FeesTab />}
      {tab === "users" && <UsersTab />}
      {tab === "terms" && <TermsAuditTab />}
    </Shell>
  );
}

function SupplierStatusBadge({ status }) {
  const M = {
    provisional: { label: "Provisional", bg: "#FFD600" },
    pending_review: { label: "Pending Review", bg: "#FF5400", text: "#fff" },
    verified: { label: "Verified", bg: "#0021A5", text: "#fff" },
    payout_ready: { label: "Payout Ready", bg: "#00C853" },
    rejected: { label: "Rejected", bg: "#525252", text: "#fff" },
  };
  const s = M[status] || M.provisional;
  return <span className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono"
    style={{ background: s.bg, color: s.text || "#0A0A0A" }}>{s.label}</span>;
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
      <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">{label}</div>
      <div className="font-display text-2xl" style={c ? { color: c } : {}}>{v}</div>
    </div>
  );
}
function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-3 py-3">{children}</th>; }
function Td({ children }) { return <td className="px-3 py-3 align-middle">{children}</td>; }

function FeesTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await api.get("/admin/fees");
    setConfig(data);
  };

  useEffect(() => { load(); }, []);

  if (!config) {
    return <div className="border-2 border-ink bg-white shadow-brut p-6 font-mono uppercase tracking-widest text-sm">Loading fees…</div>;
  }

  const updateMethod = (id, patch) => {
    setConfig(c => ({
      ...c,
      payment_methods: c.payment_methods.map(m => m.id === id ? { ...m, ...patch } : m),
    }));
  };

  const setRecommended = (id) => {
    setConfig(c => ({
      ...c,
      payment_methods: c.payment_methods.map(m => ({ ...m, recommended: m.id === id })),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        commission_pct: Number(config.commission_pct),
        service_fee_mode: config.service_fee_mode,
        service_fee_value: Number(config.service_fee_value),
        payment_methods: config.payment_methods.map(m => ({
          id: m.id, label: m.label, sub: m.sub || "", fee: Number(m.fee),
          recommended: !!m.recommended, enabled: !!m.enabled, order: Number(m.order),
        })),
      };
      const { data } = await api.put("/admin/fees", payload);
      setConfig(data);
      toast.success("Fee configuration saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="fees-tab">
      <div className="border-2 border-ink bg-white shadow-brut p-6">
        <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#FF5400] mb-2">Fee Engine</div>
        <h2 className="font-display text-3xl uppercase tracking-tighter leading-none">Commission & Service Fee</h2>
        <p className="font-mono text-xs text-[#3A3A3A] mt-2">
          Commission is hidden from consumers. Only Platform Service Fee and Payment Method Fee appear on checkout.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <Field label="Commission (%) — supplier-side, hidden">
            <div className="flex items-center border-2 border-ink">
              <input
                type="number" step="0.001" min="0" max="1"
                value={config.commission_pct}
                onChange={(e) => setConfig(c => ({ ...c, commission_pct: e.target.value }))}
                className="w-full p-2 font-mono text-sm outline-none"
                data-testid="fees-commission-input"
              />
              <span className="px-3 font-mono text-xs text-[#3A3A3A] border-l-2 border-ink">decimal</span>
            </div>
            <div className="font-mono text-[10px] text-[#3A3A3A] mt-1">e.g. 0.02 = 2%</div>
          </Field>

          <Field label="Service Fee Mode">
            <div className="flex border-2 border-ink" data-testid="fees-mode-toggle">
              {[
                { id: "flat", label: "Flat £" },
                { id: "percent", label: "Percent %" },
              ].map((opt, i) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setConfig(c => ({ ...c, service_fee_mode: opt.id }))}
                  className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-widest font-mono ${i === 0 ? "border-r-2 border-ink" : ""} ${config.service_fee_mode === opt.id ? "bg-ink text-white" : "bg-white"}`}
                  data-testid={`fees-mode-${opt.id}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Service Fee Value ${config.service_fee_mode === "percent" ? "(decimal, 0.01 = 1%)" : "(£ flat)"}`}>
            <input
              type="number" step="0.01" min="0"
              value={config.service_fee_value}
              onChange={(e) => setConfig(c => ({ ...c, service_fee_value: e.target.value }))}
              className="w-full border-2 border-ink p-2 font-mono text-sm"
              data-testid="fees-service-value-input"
            />
          </Field>
        </div>
      </div>

      <div className="border-2 border-ink bg-white shadow-brut p-6">
        <h2 className="font-display text-3xl uppercase tracking-tighter leading-none">Payment Methods</h2>
        <p className="font-mono text-xs text-[#3A3A3A] mt-2 mb-5">
          Set per-method fees, toggle availability, and mark one as Recommended.
        </p>

        <div className="space-y-3">
          {[...config.payment_methods].sort((a, b) => a.order - b.order).map(m => (
            <div key={m.id} className="border-2 border-ink bg-[#FAFAFA] p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center" data-testid={`fees-method-${m.id}`}>
              <div className="sm:col-span-3 min-w-0">
                <div className="font-bold uppercase tracking-wider text-sm">{m.label}</div>
                <div className="font-mono text-[10px] text-[#3A3A3A] mt-0.5 truncate">{m.sub}</div>
              </div>
              <div className="sm:col-span-3">
                <div className="text-[9px] font-bold uppercase tracking-widest font-mono mb-1">Fee (£)</div>
                <input
                  type="number" step="0.05" min="0"
                  value={m.fee}
                  onChange={(e) => updateMethod(m.id, { fee: e.target.value })}
                  className="w-full border-2 border-ink p-2 font-mono text-sm bg-white"
                  data-testid={`fees-method-fee-${m.id}`}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="text-[9px] font-bold uppercase tracking-widest font-mono mb-1">Order</div>
                <input
                  type="number" min="1"
                  value={m.order}
                  onChange={(e) => updateMethod(m.id, { order: e.target.value })}
                  className="w-full border-2 border-ink p-2 font-mono text-sm bg-white"
                />
              </div>
              <div className="sm:col-span-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => updateMethod(m.id, { enabled: !m.enabled })}
                  className={`flex-1 border-2 border-ink px-2 py-2 text-[10px] font-bold uppercase tracking-widest font-mono ${m.enabled ? "bg-[#00C853] text-ink" : "bg-white text-[#3A3A3A]"}`}
                  data-testid={`fees-method-toggle-${m.id}`}
                >
                  {m.enabled ? "On" : "Off"}
                </button>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setRecommended(m.id)}
                  className={`w-full border-2 border-ink px-2 py-2 text-[10px] font-bold uppercase tracking-widest font-mono inline-flex items-center justify-center gap-1 ${m.recommended ? "bg-[#FFD600]" : "bg-white"}`}
                  data-testid={`fees-method-rec-${m.id}`}
                >
                  <Star weight={m.recommended ? "fill" : "regular"} size={11} />
                  {m.recommended ? "Recommended" : "Set Recommended"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2 disabled:opacity-60"
            data-testid="fees-save-btn"
          >
            <Sliders weight="bold" /> {saving ? "Saving…" : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}

// ============== USERS TAB ==============
const ROLE_OPTIONS = ["all", "consumer", "supplier", "garage", "admin"];
const STATUS_OPTIONS = ["all", "active", "suspended", "deleted"];

function UsersTab() {
  const { user: me } = useAuth();
  const [data, setData] = useState({ users: [], total: 0 });
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [userStatus, setUserStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (role !== "all") params.set("role", role);
      if (userStatus !== "all") params.set("user_status", userStatus);
      const { data: d } = await api.get(`/admin/users?${params}`);
      setData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load users");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, role, userStatus]);

  const suspend = async (u) => {
    const reason = window.prompt(`Suspend ${u.email}? Reason (visible internally):`, "Policy violation");
    if (reason === null) return;
    try {
      await api.patch(`/admin/users/${u.user_id}`, { status: "suspended", suspended_reason: reason });
      toast.success("User suspended");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };
  const unsuspend = async (u) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, { status: "active" });
      toast.success("User reactivated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };
  const setUserRole = async (u, newRole) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, { role: newRole });
      toast.success(`Role set to ${newRole}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };
  const softDelete = async (u) => {
    if (!window.confirm(`Soft-delete ${u.email}? They will be signed out and cannot log in. Email is freed for re-use.`)) return;
    try {
      await api.delete(`/admin/users/${u.user_id}`);
      toast.success("User soft-deleted");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };
  const hardDelete = async (u) => {
    if (!window.confirm(`HARD DELETE ${u.email}? This permanently removes the user record. Type the email to confirm.`)) return;
    const conf = window.prompt("Type the email to confirm hard delete:");
    if (conf !== u.email) { toast.error("Email mismatch — aborted"); return; }
    try {
      await api.delete(`/admin/users/${u.user_id}?hard=true`);
      toast.success("User permanently deleted");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="border-2 border-ink bg-white shadow-brut" data-testid="users-tab">
      <div className="border-b-2 border-ink p-4 grid sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto] gap-2 items-end">
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Search</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="email, name or user_id"
            className="w-full border-2 border-ink p-2 font-mono text-sm"
            data-testid="users-search"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Role</div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border-2 border-ink p-2 font-mono text-sm bg-white" data-testid="users-filter-role">
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Status</div>
          <select value={userStatus} onChange={(e) => setUserStatus(e.target.value)} className="w-full border-2 border-ink p-2 font-mono text-sm bg-white" data-testid="users-filter-status">
            {STATUS_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
          {busy ? "Loading…" : `${data.total} total`}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <Th>Name / Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Auth</Th>
              <Th>Joined</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => {
              const isMe = u.user_id === me?.user_id;
              const isAdmin = u.role === "admin";
              const isSuspended = u.status === "suspended";
              const isDeleted = u.status === "deleted";
              return (
                <tr key={u.user_id} className={`border-t-2 border-ink hover:bg-[#FAFAFA] ${isDeleted ? "opacity-50" : ""}`} data-testid={`user-row-${u.user_id}`}>
                  <Td>
                    <div className="font-bold uppercase text-xs">{u.name}</div>
                    <div className="text-[11px] text-[#3A3A3A]">{u.email}</div>
                    <div className="text-[10px] text-[#3A3A3A]">{u.user_id}</div>
                  </Td>
                  <Td>
                    <select
                      value={u.role}
                      disabled={isMe || isAdmin}
                      onChange={(e) => setUserRole(u, e.target.value)}
                      className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold disabled:opacity-50"
                      data-testid={`user-role-${u.user_id}`}
                    >
                      {["consumer", "supplier", "garage", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Td>
                  <Td><UserStatusBadge u={u} /></Td>
                  <Td><span className="text-[10px] uppercase tracking-widest">{(u.auth_methods || []).join(" · ") || "—"}</span></Td>
                  <Td><span className="text-[10px]">{u.created_at?.slice(0, 10)}</span></Td>
                  <Td>
                    {isMe ? (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">It's you</span>
                    ) : isAdmin ? (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[#0021A5]">Admin · protected</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {isSuspended ? (
                          <button onClick={() => unsuspend(u)} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-unsuspend-${u.user_id}`}>
                            Unsuspend
                          </button>
                        ) : !isDeleted && (
                          <button onClick={() => suspend(u)} className="bg-[#FFD600] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-suspend-${u.user_id}`}>
                            Suspend
                          </button>
                        )}
                        {!isDeleted && (
                          <button onClick={() => softDelete(u)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-soft-delete-${u.user_id}`}>
                            <Trash weight="bold" size={10} />
                          </button>
                        )}
                        <button onClick={() => hardDelete(u)} className="bg-[#525252] text-white border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-hard-delete-${u.user_id}`} title="Hard delete">
                          ×
                        </button>
                        <button onClick={() => setEditing(u)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" title="Details">
                          Details
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
            {data.users.length === 0 && !busy && (
              <tr><td colSpan={6} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <UserDetailModal userId={editing.user_id} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserStatusBadge({ u }) {
  const s = u.status || "active";
  const M = {
    active: { label: "Active", bg: "#00C853" },
    suspended: { label: u.suspended_reason ? `Suspended · ${u.suspended_reason.slice(0, 24)}` : "Suspended", bg: "#FFD600" },
    deleted: { label: "Deleted", bg: "#525252", text: "#fff" },
  };
  const cfg = M[s] || M.active;
  return (
    <span className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono"
      style={{ background: cfg.bg, color: cfg.text || "#0A0A0A" }}>{cfg.label}</span>
  );
}

function UserDetailModal({ userId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: d } = await api.get(`/admin/users/${userId}`);
        setData(d);
      } catch (e) {
        toast.error("Could not load user");
        onClose();
      }
    })();
  }, [userId]);
  if (!data) return null;
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start sm:items-center justify-center p-4 overflow-auto" data-testid="user-detail-modal">
      <div className="w-full max-w-xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between">
          <h3 className="font-display text-xl uppercase">User · {data.name}</h3>
          <button onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <Row k="user_id" v={data.user_id} />
          <Row k="email" v={data.email} />
          <Row k="role" v={data.role} />
          <Row k="status" v={data.status || "active"} />
          {data.suspended_reason && <Row k="suspended_reason" v={data.suspended_reason} />}
          <Row k="auth methods" v={(data.auth_methods || []).join(", ") || "—"} />
          <Row k="phone" v={data.phone || "—"} />
          <Row k="created" v={data.created_at} />
          <div className="border-t-2 border-ink pt-3 mt-3">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest mb-1">Activity</div>
            <Row k="VPP participations" v={data.stats?.participations ?? 0} />
            <Row k="Tyre wave joins" v={data.stats?.tyre_participations ?? 0} />
            <Row k="Payment transactions" v={data.stats?.payment_transactions ?? 0} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex gap-3 items-baseline">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] min-w-[160px]">{k}</div>
      <div className="font-mono text-[13px] break-all">{String(v)}</div>
    </div>
  );
}

// ============== T&Cs AUDIT TAB ==============
function TermsAuditTab() {
  const [docs, setDocs] = useState([]);
  const [items, setItems] = useState([]);
  const [docFilter, setDocFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [d, audit] = await Promise.all([
        api.get("/terms/docs"),
        api.get(`/admin/terms/audit${docFilter ? `?doc_id=${docFilter}` : ""}`),
      ]);
      setDocs(d.data);
      setItems(audit.data.acceptances);
    } catch (e) {
      toast.error("Could not load T&Cs audit");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, [docFilter]);

  return (
    <div className="space-y-4" data-testid="terms-tab">
      <div className="grid sm:grid-cols-2 gap-3">
        {docs.map((d) => (
          <div key={d.id} className="border-2 border-ink bg-white shadow-brut-sm p-4">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF5400]">{d.id}</div>
            <div className="font-display text-xl uppercase tracking-tight">{d.title}</div>
            <div className="font-mono text-[11px] uppercase tracking-widest mt-1">v{d.version} · effective {d.effective_date}</div>
            <div className="text-xs text-[#3A3A3A] mt-2">{d.summary}</div>
          </div>
        ))}
      </div>

      <div className="border-2 border-ink bg-white shadow-brut">
        <div className="border-b-2 border-ink p-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Filter by document</div>
            <select value={docFilter} onChange={(e) => setDocFilter(e.target.value)} className="border-2 border-ink p-2 font-mono text-sm bg-white" data-testid="terms-filter">
              <option value="">All</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">{busy ? "Loading…" : `${items.length} acceptances shown`}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead className="bg-ink text-white">
              <tr>
                <Th>When</Th><Th>User</Th><Th>Doc · Version</Th><Th>Context</Th><Th>IP / UA</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.acceptance_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`terms-row-${a.acceptance_id}`}>
                  <Td><span className="text-[11px]">{a.accepted_at?.slice(0, 19).replace("T", " ")}</span></Td>
                  <Td>
                    <div className="text-[11px]">{a.user_email}</div>
                    <div className="text-[10px] text-[#3A3A3A]">{a.user_id}</div>
                  </Td>
                  <Td>
                    <span className="font-bold uppercase text-xs">{a.doc_id}</span>
                    <span className={`ml-2 inline-block border-2 border-ink px-1.5 py-0.5 text-[9px] font-bold uppercase ${a.is_current ? "bg-[#00C853]" : "bg-[#FFD600]"}`}>v{a.version}</span>
                  </Td>
                  <Td><span className="text-[11px]">{a.context}</span></Td>
                  <Td>
                    <div className="text-[11px]">{a.ip}</div>
                    <div className="text-[10px] text-[#3A3A3A] truncate max-w-[260px]">{a.user_agent}</div>
                  </Td>
                </tr>
              ))}
              {items.length === 0 && !busy && (
                <tr><td colSpan={5} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No acceptances yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
