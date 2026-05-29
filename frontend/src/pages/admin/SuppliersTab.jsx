import React from "react";
import { CheckCircle, X, Trash } from "@phosphor-icons/react";
import { Th, Td, SupplierStatusBadge } from "./_shared";

function AccountBadge({ status }) {
  const s = status || "active";
  const M = {
    active: { label: "Active", bg: "#00C853" },
    suspended: { label: "Suspended", bg: "#FFD600" },
    deleted: { label: "Deleted", bg: "#525252", text: "#fff" },
  };
  const cfg = M[s] || M.active;
  return (
    <span className="inline-flex items-center gap-1 border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: cfg.bg, color: cfg.text || "#0A0A0A" }}>{cfg.label}</span>
  );
}

export default function SuppliersTab({ suppliers, onVerify, onReject, onSuspend, onUnsuspend, onDelete, onHardDelete }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto" data-testid="suppliers-tab">
      {suppliers.length === 0 ? (
        <div className="p-10 text-center font-mono uppercase text-sm tracking-widest text-[#3A3A3A]">
          No supplier applications yet.
        </div>
      ) : (
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <Th>Business</Th>
              <Th>Category</Th>
              <Th>Verification</Th>
              <Th>Account</Th>
              <Th>Waves</Th>
              <Th>Contact</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const acct = s.account_status || "active";
              const isSuspended = acct === "suspended";
              const isDeleted = acct === "deleted";
              const canVerify = s.status !== "verified" && s.status !== "payout_ready" && s.status !== "rejected";
              return (
                <tr key={s.supplier_id} className={`border-t-2 border-ink hover:bg-[#FAFAFA] ${isDeleted ? "opacity-50" : ""}`} data-testid={`supplier-row-${s.supplier_id}`}>
                  <Td><div className="font-bold uppercase text-xs">{s.business_name}</div></Td>
                  <Td>{s.category}</Td>
                  <Td><SupplierStatusBadge status={s.status} /></Td>
                  <Td><AccountBadge status={acct} /></Td>
                  <Td>{s.waves_published}</Td>
                  <Td><a href={`mailto:${s.contact_email}`} className="underline">{s.contact_email}</a></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {canVerify && !isDeleted && (
                        <>
                          <button
                            onClick={() => onVerify(s.supplier_id)}
                            className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1"
                            data-testid={`verify-supplier-${s.supplier_id}`}
                          >
                            <CheckCircle weight="fill" size={10}/> Verify
                          </button>
                          <button
                            onClick={() => onReject(s.supplier_id)}
                            className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut"
                            title="Reject application"
                          >
                            <X weight="bold" size={10}/>
                          </button>
                        </>
                      )}
                      {!isDeleted && (
                        isSuspended ? (
                          <button onClick={() => onUnsuspend(s)} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`supplier-unsuspend-${s.supplier_id}`}>Unsuspend</button>
                        ) : (
                          <button onClick={() => onSuspend(s)} className="bg-[#FFD600] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`supplier-suspend-${s.supplier_id}`}>Suspend</button>
                        )
                      )}
                      {!isDeleted && (
                        <button onClick={() => onDelete(s)} className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`supplier-soft-delete-${s.supplier_id}`} title="Soft delete"><Trash weight="bold" size={10} /></button>
                      )}
                      <button onClick={() => onHardDelete(s)} className="bg-[#525252] text-white border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`supplier-hard-delete-${s.supplier_id}`} title="Hard delete">×</button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
