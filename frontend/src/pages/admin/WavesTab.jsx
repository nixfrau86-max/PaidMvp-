import React from "react";
import { Trash } from "@phosphor-icons/react";
import StateBadge from "../../components/StateBadge";
import { Th, Td } from "./_shared";

const STATES = ["seed", "active", "powered", "locked", "executing", "completed"];

export default function WavesTab({ vpps, onSetState, onRemove }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto" data-testid="waves-tab">
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
          {vpps.map((v) => (
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
                  onChange={(e) => onSetState(v.vpp_id, e.target.value)}
                  className="border-2 border-ink px-2 py-1 text-[10px] uppercase font-bold"
                  data-testid={`state-select-${v.vpp_id}`}
                >
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Td>
              <Td>
                <button
                  onClick={() => onRemove(v.vpp_id)}
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
  );
}
