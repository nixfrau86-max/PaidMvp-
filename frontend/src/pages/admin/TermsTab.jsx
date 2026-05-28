import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { Th, Td } from "./_shared";

export default function TermsAuditTab() {
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docFilter]);

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
