import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, MapPin } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

function StatusBadge({ verified, active }) {
  let label = "Pending approval", bg = "#FF5400", text = "#fff";
  if (!active) { label = "Inactive"; bg = "#525252"; text = "#fff"; }
  else if (verified) { label = "Approved"; bg = "#00C853"; text = "#0A0A0A"; }
  return (
    <span className="inline-flex items-center border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: bg, color: text }}>
      {label}
    </span>
  );
}

export default function GaragesTab() {
  const [garages, setGarages] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/admin/garages");
      setGarages(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load garages");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const verify = async (g) => {
    try { await api.post(`/admin/garages/${g.garage_id}/verify`); toast.success(`${g.business_name} approved`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to approve"); }
  };
  const unverify = async (g) => {
    if (!window.confirm(`Revoke approval for "${g.business_name}"? It will stop showing as a fitting option.`)) return;
    try { await api.post(`/admin/garages/${g.garage_id}/unverify`); toast.success(`${g.business_name} approval revoked`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const pending = garages.filter((g) => g.is_active && !g.is_verified).length;
  const approved = garages.filter((g) => g.is_active && g.is_verified).length;

  return (
    <div className="space-y-6" data-testid="garages-tab">
      <div className="flex flex-wrap gap-3">
        <div className="border-2 border-ink bg-white shadow-brut-sm p-3" data-testid="garages-stat-pending">
          <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">Pending approval</div>
          <div className="font-display text-2xl" style={{ color: "#FF5400" }}>{pending}</div>
        </div>
        <div className="border-2 border-ink bg-white shadow-brut-sm p-3" data-testid="garages-stat-approved">
          <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">Approved (live)</div>
          <div className="font-display text-2xl" style={{ color: "#00C853" }}>{approved}</div>
        </div>
        <div className="border-2 border-ink bg-white shadow-brut-sm p-3" data-testid="garages-stat-total">
          <div className="text-[9px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">Total</div>
          <div className="font-display text-2xl">{garages.length}</div>
        </div>
      </div>

      <div className="border-2 border-ink bg-[#FFF8E1] shadow-brut-sm p-3 font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">
        Only <span className="font-bold text-[#00C853]">Approved</span> garages appear in the consumer fitting picker. Approve newly applied garages here to make them selectable.
      </div>

      <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr><Th>Garage</Th><Th>Location</Th><Th>Type</Th><Th>Contact</Th><Th>Status</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {garages.map((g) => (
              <tr key={g.garage_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`admin-garage-row-${g.garage_id}`}>
                <Td><span className="font-bold uppercase text-xs">{g.business_name}</span></Td>
                <Td>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <MapPin weight="bold" size={11} /> {g.city || "—"} {g.postcode ? `· ${g.postcode}` : ""}
                  </span>
                </Td>
                <Td className="capitalize text-[11px]">{g.garage_type_label || g.garage_type || "—"}</Td>
                <Td className="text-[11px]">
                  <div>{g.contact_email || "—"}</div>
                  <div className="text-[#3A3A3A]">{g.contact_phone || ""}</div>
                </Td>
                <Td><StatusBadge verified={g.is_verified} active={g.is_active} /></Td>
                <Td>
                  {g.is_verified ? (
                    <button onClick={() => unverify(g)} disabled={busy} className="inline-flex items-center gap-1 border-2 border-ink bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover-brut disabled:opacity-50" data-testid={`unverify-garage-${g.garage_id}`}>
                      <XCircle weight="bold" size={12} /> Revoke
                    </button>
                  ) : (
                    <button onClick={() => verify(g)} disabled={busy} className="inline-flex items-center gap-1 border-2 border-ink bg-[#00C853] px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover-brut disabled:opacity-50" data-testid={`verify-garage-${g.garage_id}`}>
                      <CheckCircle weight="bold" size={12} /> Approve
                    </button>
                  )}
                </Td>
              </tr>
            ))}
            {garages.length === 0 && !busy && (
              <tr><td colSpan={6} className="px-3 py-8 text-center font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">No garages yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
