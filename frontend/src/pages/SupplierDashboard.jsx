import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Truck, Package, CurrencyGbp, Users, CheckCircle, Plus, Storefront, ShieldCheck,
  ArrowRight, Sparkle, Clock, X,
} from "@phosphor-icons/react";

const TIERS = {
  provisional: { label: "Provisional", color: "#FFD600", description: "Sandbox · 1 wave auto-live with caps" },
  pending_review: { label: "Pending Review", color: "#FF5400", description: "Admin is reviewing your application" },
  verified: { label: "Verified", color: "#0021A5", text: "#fff", description: "Self-publish unlimited waves" },
  payout_ready: { label: "Payout Ready", color: "#00C853", description: "Verified + direct payouts enabled" },
  rejected: { label: "Rejected", color: "#525252", text: "#fff", description: "" },
};

export default function SupplierDashboard() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [waves, setWaves] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState("waves");
  const [dataLoading, setDataLoading] = useState(true);

  const reload = async () => {
    try {
      const [s, w, o] = await Promise.all([
        api.get("/suppliers/me"),
        api.get("/suppliers/me/waves"),
        api.get("/supplier/orders"),
      ]);
      setSupplier(s.data);
      setWaves(w.data);
      setOrders(o.data);
    } catch (err) {
      // No supplier profile → onboarding
      navigate("/supplier/onboarding");
      return;
    }
    setDataLoading(false);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    reload();
  }, [user, loading, navigate]);

  if (loading || dataLoading || !supplier) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading…</div>
      </div>
    );
  }

  const tier = TIERS[supplier.status] || TIERS.provisional;
  const isProvisional = supplier.status === "provisional";
  const isVerified = supplier.status === "verified" || supplier.status === "payout_ready";

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Supplier Console</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">
              {supplier.business_name}
            </h1>
            <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">{supplier.category} · {supplier.contact_email}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/supplier/product-groups"
              className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
              data-testid="manage-pgs-btn"
            >
              <Package weight="bold" /> Tyre Product Groups
            </Link>
            <Link
              to="/supplier/waves/new"
              className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
              data-testid="create-wave-btn"
            >
              <Plus weight="bold" /> Create Wave
            </Link>
          </div>
        </div>

        {/* Status banner */}
        <StatusBanner supplier={supplier} tier={tier} onUpgrade={reload} />

        {/* Tabs */}
        <div className="border-2 border-ink bg-white shadow-brut-sm mt-6 flex" data-testid="supplier-tabs">
          {[
            { id: "waves", label: `My Waves (${waves.length})` },
            { id: "orders", label: `Orders (${orders.length})` },
            { id: "profile", label: "Profile" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest font-mono border-r-2 border-ink last:border-r-0 flex-1 sm:flex-none ${tab === t.id ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "waves" && <WavesTab waves={waves} isProvisional={isProvisional} />}
          {tab === "orders" && <OrdersTab orders={orders} reload={reload} />}
          {tab === "profile" && <ProfileTab supplier={supplier} reload={reload} />}
        </div>
      </div>
    </div>
  );
}

function StatusBanner({ supplier, tier, onUpgrade }) {
  const [requesting, setRequesting] = useState(false);
  const requestVerify = async () => {
    setRequesting(true);
    try {
      await api.post("/suppliers/me/request-verification");
      toast.success("Verification request sent. Admin will review.");
      onUpgrade();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Add Standard info first (phone, VAT, address)");
    } finally { setRequesting(false); }
  };

  return (
    <div className="border-2 border-ink bg-white shadow-brut p-5 sm:p-6" data-testid="status-banner">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-12 border-2 border-ink flex items-center justify-center shrink-0 font-display text-xl"
            style={{ background: tier.color, color: tier.text || "#0A0A0A" }}
          >
            <Storefront weight="fill" size={22} />
          </div>
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A]">Current Tier</div>
            <div className="font-display text-2xl uppercase">{tier.label}</div>
            <div className="text-xs text-[#3A3A3A] font-mono">{tier.description}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-md">
          <TierStep label="Provisional" active={true} done={true} />
          <TierStep label="Verified" active={supplier.status !== "provisional"} done={["verified", "payout_ready"].includes(supplier.status)} />
          <TierStep label="Payout Ready" active={supplier.status === "payout_ready"} done={supplier.status === "payout_ready"} />
        </div>
      </div>

      {/* Action / next step */}
      {supplier.status === "provisional" && (
        <div className="mt-5 border-t-2 border-ink pt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-bold uppercase tracking-wider text-xs mb-0.5">Sandbox limits</div>
            <div className="font-mono text-xs text-[#3A3A3A]">
              First Wave auto-live · threshold ≤ 30 · retail ≤ £500 · {supplier.waves_published}/{supplier.provisional_cap} used
            </div>
          </div>
          <button
            onClick={requestVerify}
            disabled={requesting}
            className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-4 py-2 text-xs shadow-brut-sm hover-brut inline-flex items-center gap-2 disabled:opacity-60"
            data-testid="request-verify-btn"
          >
            <Sparkle weight="fill" /> Get Verified
          </button>
        </div>
      )}
      {supplier.status === "pending_review" && (
        <div className="mt-5 border-t-2 border-ink pt-4 font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
          ⏱ Admin reviewing your application — typically within 24h.
        </div>
      )}
      {supplier.status === "verified" && (
        <div className="mt-5 border-t-2 border-ink pt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
            ✅ Self-publish unlimited waves. Add bank details to unlock direct payouts.
          </div>
        </div>
      )}
      {supplier.status === "rejected" && (
        <div className="mt-5 border-t-2 border-ink pt-4 font-mono text-xs text-[#525252]">
          Application rejected: {supplier.rejection_reason || "no reason given"}
        </div>
      )}
    </div>
  );
}

function TierStep({ label, active, done }) {
  return (
    <div className={`border-2 border-ink p-2 text-center ${done ? "bg-[#00C853]" : active ? "bg-[#FFD600]" : "bg-white"}`}>
      <div className="font-mono text-[9px] font-bold uppercase tracking-widest">{done ? "✓" : active ? "•" : "—"}</div>
      <div className="font-bold uppercase text-[10px] tracking-wider mt-1">{label}</div>
    </div>
  );
}

function WavesTab({ waves, isProvisional }) {
  if (waves.length === 0) {
    return (
      <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
        <Package weight="duotone" size={36} className="mx-auto mb-3 text-[#FF5400]" />
        <div className="font-display text-2xl uppercase mb-2">No waves yet.</div>
        <p className="text-[#3A3A3A] mb-5 text-sm">
          Launch your first Wave — {isProvisional ? "it goes live immediately." : "publish unlimited."}
        </p>
        <Link to="/supplier/waves/new" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2">
          Create First Wave <ArrowRight weight="bold" />
        </Link>
      </div>
    );
  }
  return (
    <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
      <table className="w-full font-mono text-sm">
        <thead className="bg-ink text-white">
          <tr>
            <Th>Wave</Th><Th>Status</Th><Th>State</Th><Th>Joined</Th><Th>Paid</Th><Th>Batch Value</Th>
          </tr>
        </thead>
        <tbody>
          {waves.map(w => (
            <tr key={w.vpp_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`wave-row-${w.vpp_id}`}>
              <Td>
                <Link to={`/vpp/${w.vpp_id}`} className="flex gap-2 items-center hover:underline">
                  <img src={w.image_url} alt="" className="w-10 h-10 object-cover border-2 border-ink" />
                  <span className="font-bold uppercase text-xs">{w.title}</span>
                </Link>
              </Td>
              <Td><PublishBadge status={w.publish_status} /></Td>
              <Td><StateBadge state={w.state} progressPct={w.progress_pct} /></Td>
              <Td>{w.participants_count}/{w.threshold}</Td>
              <Td>{w.paid_count || 0}</Td>
              <Td>£{w.total_supplier_value?.toFixed(2) || "0.00"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PublishBadge({ status }) {
  const M = {
    live: { label: "Live", bg: "#00C853", icon: CheckCircle },
    pending_approval: { label: "Pending Approval", bg: "#FFD600", icon: Clock },
    rejected: { label: "Rejected", bg: "#525252", icon: X, text: "#fff" },
  };
  const s = M[status] || M.live;
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono"
      style={{ background: s.bg, color: s.text || "#0A0A0A" }}
    >
      <Icon weight="fill" size={10} /> {s.label}
    </span>
  );
}

function OrdersTab({ orders, reload }) {
  const dispatch = async (vppId) => {
    try {
      await api.post(`/supplier/orders/${vppId}/dispatch`);
      toast.success("Batch dispatched.");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  if (orders.length === 0) {
    return (
      <div className="border-2 border-ink bg-white shadow-brut p-10 text-center font-mono text-sm uppercase tracking-widest text-[#3A3A3A]">
        No batch orders yet. Orders appear once a wave locks.
      </div>
    );
  }
  return (
    <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
      <table className="w-full font-mono text-sm">
        <thead className="bg-ink text-white">
          <tr><Th>Wave</Th><Th>State</Th><Th>Paid / Joined</Th><Th>Unit Cost</Th><Th>Batch Value</Th><Th>Action</Th></tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.vpp_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]">
              <Td><span className="font-bold uppercase text-xs">{o.title}</span></Td>
              <Td><StateBadge state={o.state} progressPct={o.progress_pct} /></Td>
              <Td>{o.paid_count} / {o.participants_count}</Td>
              <Td>£{o.supplier_cost}</Td>
              <Td>£{o.total_supplier_value?.toFixed(2)}</Td>
              <Td>
                {o.state !== "completed" ? (
                  <button onClick={() => dispatch(o.vpp_id)}
                    className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-3 py-1.5 text-[10px] shadow-brut-sm hover-brut">
                    Dispatch
                  </button>
                ) : <span className="text-[#00C853] font-bold uppercase tracking-widest text-[10px]">Done</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileTab({ supplier, reload }) {
  const [form, setForm] = useState({
    business_name: supplier.business_name || "",
    contact_email: supplier.contact_email || "",
    description: supplier.description || "",
    logo_url: supplier.logo_url || "",
    contact_phone: supplier.contact_phone || "",
    vat_number: supplier.vat_number || "",
    company_reg: supplier.company_reg || "",
    address_line1: supplier.address_line1 || "",
    city: supplier.city || "",
    postcode: supplier.postcode || "",
    bank_account_name: supplier.bank_account_name || "",
    bank_sort_code: supplier.bank_sort_code || "",
    bank_account_number: "",
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.bank_account_number) delete payload.bank_account_number;
      await api.patch("/suppliers/me", payload);
      toast.success("Profile updated");
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <Section title="Light info (required)" level="light" current={supplier.info_level}>
        <Grid>
          <PField label="Business name"><input value={form.business_name} onChange={upd("business_name")} className="inp" /></PField>
          <PField label="Contact email"><input type="email" value={form.contact_email} onChange={upd("contact_email")} className="inp" /></PField>
          <PField label="Logo URL"><input value={form.logo_url} onChange={upd("logo_url")} className="inp" /></PField>
          <PField label="Description" full><textarea value={form.description} onChange={upd("description")} rows={2} className="inp" /></PField>
        </Grid>
      </Section>

      <Section title="Standard info (required for Verification)" level="standard" current={supplier.info_level}>
        <Grid>
          <PField label="Contact phone"><input value={form.contact_phone} onChange={upd("contact_phone")} className="inp" placeholder="+44..." /></PField>
          <PField label="VAT number"><input value={form.vat_number} onChange={upd("vat_number")} className="inp" placeholder="GB..." /></PField>
          <PField label="Company reg #"><input value={form.company_reg} onChange={upd("company_reg")} className="inp" /></PField>
          <PField label="Address line 1"><input value={form.address_line1} onChange={upd("address_line1")} className="inp" /></PField>
          <PField label="City"><input value={form.city} onChange={upd("city")} className="inp" /></PField>
          <PField label="Postcode"><input value={form.postcode} onChange={upd("postcode")} className="inp" /></PField>
        </Grid>
      </Section>

      <Section title="Full info (required for direct payouts)" level="full" current={supplier.info_level}>
        <Grid>
          <PField label="Bank account name"><input value={form.bank_account_name} onChange={upd("bank_account_name")} className="inp" /></PField>
          <PField label="Sort code"><input value={form.bank_sort_code} onChange={upd("bank_sort_code")} className="inp" placeholder="00-00-00" /></PField>
          <PField label="Account number (last 4 stored)"><input value={form.bank_account_number} onChange={upd("bank_account_number")} className="inp" placeholder={supplier.bank_account_number_last4 ? `••••${supplier.bank_account_number_last4}` : "12345678"} /></PField>
        </Grid>
      </Section>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut" data-testid="save-profile">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
      <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.55rem .65rem;font-family:'JetBrains Mono',monospace;font-size:.8125rem;}`}</style>
    </form>
  );
}

function Section({ title, level, current, children }) {
  const reached = ({ light: 1, standard: 2, full: 3 }[current] || 1) >= ({ light: 1, standard: 2, full: 3 }[level]);
  return (
    <div className="border-2 border-ink bg-white shadow-brut p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl uppercase">{title}</h3>
        {reached && <span className="inline-flex items-center gap-1 bg-[#00C853] border-2 border-ink font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-1"><CheckCircle weight="fill" size={10}/> Complete</span>}
      </div>
      {children}
    </div>
  );
}

function PField({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Grid({ children }) { return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>; }
function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-4 py-3">{children}</th>; }
function Td({ children }) { return <td className="px-4 py-3 align-middle">{children}</td>; }
