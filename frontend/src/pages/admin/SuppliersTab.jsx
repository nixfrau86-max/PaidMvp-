import React from "react";
import { CheckCircle, X } from "@phosphor-icons/react";
import { Th, Td, SupplierStatusBadge } from "./_shared";

export default function SuppliersTab({ suppliers, onVerify, onReject }) {
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
              <Th>Tier</Th>
              <Th>Info Level</Th>
              <Th>Waves</Th>
              <Th>Contact</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
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
                      >
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
  );
}
