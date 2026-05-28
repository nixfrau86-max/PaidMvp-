import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash, X } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Th, Td } from "./_shared";

const ROLE_OPTIONS = ["all", "consumer", "supplier", "garage", "admin"];
const STATUS_OPTIONS = ["all", "active", "suspended", "deleted"];

export default function UsersTab() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const setUserRoleFn = async (u, newRole) => {
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email, name or user_id" className="w-full border-2 border-ink p-2 font-mono text-sm" data-testid="users-search" />
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
              <Th>Name / Email</Th><Th>Role</Th><Th>Status</Th><Th>Auth</Th><Th>Joined</Th><Th>Actions</Th>
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
                    <select value={u.role} disabled={isMe || isAdmin} onChange={(e) => setUserRoleFn(u, e.target.value)} className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold disabled:opacity-50" data-testid={`user-role-${u.user_id}`}>
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
                          <button onClick={() => unsuspend(u)} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-unsuspend-${u.user_id}`}>Unsuspend</button>
                        ) : !isDeleted && (
                          <button onClick={() => suspend(u)} className="bg-[#FFD600] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-suspend-${u.user_id}`}>Suspend</button>
                        )}
                        {!isDeleted && (
                          <button onClick={() => softDelete(u)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-soft-delete-${u.user_id}`}><Trash weight="bold" size={10} /></button>
                        )}
                        <button onClick={() => hardDelete(u)} className="bg-[#525252] text-white border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`user-hard-delete-${u.user_id}`} title="Hard delete">×</button>
                        <button onClick={() => setEditing(u)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" title="Details">Details</button>
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
    <span className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: cfg.bg, color: cfg.text || "#0A0A0A" }}>{cfg.label}</span>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
