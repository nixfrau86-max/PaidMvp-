import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Storefront, CurrencyGbp } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

import { Shell, Stat } from "./admin/_shared";
import CreateVPPForm from "./admin/CreateVPPForm";
import WavesTab from "./admin/WavesTab";
import PendingWavesTab from "./admin/PendingWavesTab";
import SuppliersTab from "./admin/SuppliersTab";
import UsersTab from "./admin/UsersTab";
import TermsAuditTab from "./admin/TermsTab";
import FeesTab from "./admin/FeesTab";
import RegionalWavesTab from "./admin/RegionalWavesTab";
import GaragesTab from "./admin/GaragesTab";

export default function AdminPanel() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);
  const [vpps, setVpps] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [pendingWaves, setPendingWaves] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState("waves");

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (!loading && user && user.role !== "admin") {
      toast.error("Switch to Admin role from the navbar.");
      navigate("/dashboard");
      return;
    }
    if (user?.role === "admin") load();
  }, [user, loading, navigate, load]);

  const setState = async (vppId, state) => {
    await api.patch(`/admin/vpps/${vppId}/state`, { state });
    toast.success(`State set to ${state}`);
    load();
  };
  const remove = async (vppId) => {
    if (!window.confirm("Delete this VPP?")) return;
    await api.delete(`/admin/vpps/${vppId}`);
    load();
  };
  const verifySupplier = async (id) => {
    await api.post(`/admin/suppliers/${id}/verify`, {});
    toast.success("Supplier verified");
    load();
  };
  const rejectSupplier = async (id) => {
    const reason = window.prompt("Reason for rejection:") || "Did not meet criteria";
    await api.post(`/admin/suppliers/${id}/reject`, { reason });
    load();
  };
  const suspendSupplier = async (s) => {
    const reason = window.prompt(`Suspend ${s.business_name}? The owner will be signed out and locked. Reason:`, "Policy violation");
    if (reason === null) return;
    try {
      await api.patch(`/admin/suppliers/${s.supplier_id}/account`, { status: "suspended", reason });
      toast.success("Supplier suspended");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const unsuspendSupplier = async (s) => {
    try {
      await api.patch(`/admin/suppliers/${s.supplier_id}/account`, { status: "active" });
      toast.success("Supplier reactivated");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const deleteSupplier = async (s) => {
    if (!window.confirm(`Soft-delete ${s.business_name}? The owner is demoted to consumer and signed out.`)) return;
    try {
      await api.delete(`/admin/suppliers/${s.supplier_id}`);
      toast.success("Supplier deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const hardDeleteSupplier = async (s) => {
    if (!window.confirm(`HARD DELETE ${s.business_name}? This permanently removes the supplier record.`)) return;
    const conf = window.prompt("Type the business name to confirm hard delete:");
    if (conf !== s.business_name) { toast.error("Name mismatch — aborted"); return; }
    try {
      await api.delete(`/admin/suppliers/${s.supplier_id}?hard=true`);
      toast.success("Supplier permanently deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const approveWave = async (id) => {
    await api.post(`/admin/waves/${id}/approve`, {});
    toast.success("Wave approved & live");
    load();
  };
  const rejectWave = async (id) => {
    const reason = window.prompt("Reason for rejection:") || "Did not meet criteria";
    await api.post(`/admin/waves/${id}/reject`, { reason });
    load();
  };

  if (loading || !stats) {
    return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;
  }

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Admin Console</div>
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">Control Room.</h1>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
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
          { id: "regional", label: "Regional Waves" },
          { id: "pending_waves", label: `Pending Waves (${pendingWaves.length})`, badge: pendingWaves.length },
          { id: "suppliers", label: `Suppliers (${suppliers.length})`, badge: stats.pending_suppliers },
          { id: "garages", label: "Garages" },
          { id: "users", label: "Users" },
          { id: "fees", label: "Fees & Payments" },
          { id: "terms", label: "T&Cs Audit" },
        ].map((t) => (
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

      {tab === "waves" && <WavesTab vpps={vpps} onSetState={setState} onRemove={remove} />}
      {tab === "regional" && <RegionalWavesTab />}
      {tab === "pending_waves" && <PendingWavesTab pendingWaves={pendingWaves} onApprove={approveWave} onReject={rejectWave} />}
      {tab === "suppliers" && <SuppliersTab suppliers={suppliers} onVerify={verifySupplier} onReject={rejectSupplier} onSuspend={suspendSupplier} onUnsuspend={unsuspendSupplier} onDelete={deleteSupplier} onHardDelete={hardDeleteSupplier} />}
      {tab === "garages" && <GaragesTab />}
      {tab === "fees" && <FeesTab />}
      {tab === "users" && <UsersTab />}
      {tab === "terms" && <TermsAuditTab />}
    </Shell>
  );
}
