import React from "react";
import { CheckCircle, X } from "@phosphor-icons/react";
import { Th, Td } from "./_shared";

export default function PendingWavesTab({ pendingWaves, onApprove, onReject }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto" data-testid="pending-waves-tab">
      {pendingWaves.length === 0 ? (
        <div className="p-10 text-center font-mono uppercase text-sm tracking-widest text-[#3A3A3A]">
          No waves pending approval.
        </div>
      ) : (
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <Th>Wave</Th>
              <Th>Supplier</Th>
              <Th>Category</Th>
              <Th>Threshold</Th>
              <Th>Retail / Collective</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {pendingWaves.map((w) => (
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
                    <button
                      onClick={() => onApprove(w.vpp_id)}
                      className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1"
                      data-testid={`approve-wave-${w.vpp_id}`}
                    >
                      <CheckCircle weight="fill" size={10}/> Approve
                    </button>
                    <button
                      onClick={() => onReject(w.vpp_id)}
                      className="bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-2 py-1 text-[10px] shadow-brut-sm hover-brut inline-flex items-center gap-1"
                      data-testid={`reject-wave-${w.vpp_id}`}
                    >
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
  );
}
