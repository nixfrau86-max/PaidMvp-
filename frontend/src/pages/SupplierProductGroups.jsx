import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Plus, ArrowLeft, Upload, FileCsv, Trash, Code,
  CheckCircle, X, Lightning, Package, Lock, ShieldCheck,
} from "@phosphor-icons/react";

const AVAIL = [
  { v: "in_stock", l: "In Stock" },
  { v: "limited", l: "Limited" },
  { v: "supplier_confirming", l: "Supplier Confirming" },
  { v: "out_of_stock", l: "Out of Stock" },
];

export default function SupplierProductGroups() {
  const { pgId } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [blocked, setBlocked] = useState(null);   // {message} when 403 (not a tyre supplier)

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/supplier/product-groups");
      setGroups(data);
      setBlocked(null);
    } catch (e) {
      if (e?.response?.status === 403) {
        const msg = e?.response?.data?.detail || "Tyre Product Groups are reserved for suppliers tagged 'Tyres'.";
        // If the error mentions Tyres tagging — show the gated screen instead of redirecting
        if (/tyres/i.test(msg) || /tagged/i.test(msg)) {
          setBlocked({ message: msg });
        } else {
          toast.error(msg);
          navigate("/supplier/onboarding");
        }
      } else {
        toast.error(e?.response?.data?.detail || "Could not load product groups");
      }
    }
    setDataLoading(false);
  }, [navigate]);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    reload();
  }, [user, loading, navigate, reload]);

  if (pgId) {
    return <ProductGroupDetail pgId={pgId} onBack={() => navigate("/supplier/product-groups")} />;
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading…</div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <div className="border-2 border-ink bg-white shadow-brut p-8" data-testid="pg-blocked-card">
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Restricted Section</div>
            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-tighter leading-[0.95] mb-4">
              Tyre Product Groups<br/>
              <span className="text-[#FF5400]">are tyre-only.</span>
            </h1>
            <p className="text-[15px] text-[#1A1A1A] mb-6 leading-relaxed">
              {blocked.message}
            </p>
            <div className="border-2 border-ink bg-[#FAFAFA] p-4 mb-6">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-1">Why?</div>
              <div className="text-sm">
                The auto Wave engine ships dedicated infrastructure for tyres — DOT-coded sizes, ETA-aware availability, garage routing.
                Electronics, home and consumer-goods suppliers use the regular <Link to="/supplier/waves/new" className="underline">Create Wave</Link> flow instead.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/supplier"
                className="border-2 border-ink bg-white px-5 py-3 text-xs font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut"
                data-testid="back-to-supplier"
              >
                ← Back to Console
              </Link>
              <Link
                to="/supplier/onboarding"
                className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-5 py-3 text-xs shadow-brut hover-brut"
                data-testid="update-categories-btn"
              >
                Add Tyres to my categories
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to="/supplier" className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 mb-2">
              ← Supplier Console
            </Link>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Tyre Product Groups</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">Auto Wave Engine</h1>
            <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">
              Upload inventory · platform manages waves · users join automatically
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
            data-testid="new-pg-btn"
          >
            <Plus weight="bold" /> New Product Group
          </button>
        </div>

        {creating && (
          <CreateModal
            onClose={() => setCreating(false)}
            onCreated={() => { setCreating(false); reload(); }}
          />
        )}

        {groups.length === 0 ? (
          <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
            <Package weight="duotone" size={36} className="mx-auto mb-3 text-[#FF5400]" />
            <div className="font-display text-2xl uppercase mb-2">No product groups yet.</div>
            <p className="text-[#3A3A3A] mb-5 text-sm">
              Upload a Product Group — the platform will auto-create a live Wave the moment users start joining.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
            >
              <Plus weight="bold" /> Create First Group
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="pg-grid">
            {groups.map((g) => <PGCard key={g.product_group_id} g={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PGCard({ g }) {
  const pct = g.wave?.progress_pct || 0;
  return (
    <Link
      to={`/supplier/product-groups/${g.product_group_id}`}
      className="block border-2 border-ink bg-white shadow-brut hover-brut overflow-hidden"
      data-testid={`pg-card-${g.product_group_id}`}
    >
      <div className="h-32 border-b-2 border-ink overflow-hidden bg-[#F4F4F4]">
        <img src={g.hero_image_url} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="p-4">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF5400] mb-1">{g.brand}</div>
        <div className="font-display text-xl uppercase tracking-tight">{g.model}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">{g.category}</div>

        <div className="mt-3 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-widest">
          <span>{g.wave?.participants_count}/{g.wave?.target_count} Joined</span>
          <span>{g.stats?.size_count} sizes · {g.stats?.total_inventory} units</span>
        </div>
        <div className="mt-2 w-full h-2 border-2 border-ink bg-[#F4F4F4] overflow-hidden">
          <div className="h-full bg-[#FF5400]" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
          {g.wave?.state === "locked" ? <span className="inline-flex items-center gap-1"><Lock weight="fill" size={10}/> Locked</span>
            : <span className="inline-flex items-center gap-1"><Lightning weight="fill" className="text-[#FF5400]" size={10}/> Live</span>}
        </div>
      </div>
    </Link>
  );
}

function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    brand: "", model: "", category: "Premium All-Season", description: "",
    hero_image_url: "", target_count: 100,
  });
  const [sizes, setSizes] = useState([
    { _key: `s_${Math.random().toString(36).slice(2)}`, tyre_size: "", inventory: 0, supplier_price: 0, retail_price: 0, availability: "in_stock", eta_days: 2 },
  ]);
  const [saving, setSaving] = useState(false);

  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const updSize = (key, k, v) =>
    setSizes((arr) => arr.map((s) => s._key === key ? { ...s, [k]: v } : s));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        target_count: parseInt(form.target_count) || 100,
        sizes: sizes
          .filter((s) => s.tyre_size.trim())
          .map((s) => ({
            tyre_size: s.tyre_size,
            inventory: parseInt(s.inventory) || 0,
            supplier_price: parseFloat(s.supplier_price) || 0,
            retail_price: parseFloat(s.retail_price) || 0,
            availability: s.availability,
            eta_days: parseInt(s.eta_days) || 2,
          })),
      };
      await api.post("/supplier/product-groups", payload);
      toast.success("Product Group created — Wave is live");
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start sm:items-center justify-center p-4 overflow-auto" data-testid="create-pg-modal">
      <form onSubmit={submit} className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between">
          <h2 className="font-display text-2xl uppercase">New Product Group</h2>
          <button type="button" onClick={onClose} className="p-2 border-2 border-ink hover:bg-[#F4F4F4]"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Brand"><input required value={form.brand} onChange={upd("brand")} placeholder="Michelin" className="inp" data-testid="pg-brand" /></Field>
            <Field label="Model"><input required value={form.model} onChange={upd("model")} placeholder="CrossClimate 2" className="inp" data-testid="pg-model" /></Field>
            <Field label="Category"><input required value={form.category} onChange={upd("category")} placeholder="Premium All-Season" className="inp" data-testid="pg-category" /></Field>
            <Field label="Wave target (members)"><input required type="number" min="1" value={form.target_count} onChange={upd("target_count")} className="inp" data-testid="pg-target" /></Field>
            <Field label="Hero image URL (optional)" full><input value={form.hero_image_url} onChange={upd("hero_image_url")} placeholder="https://..." className="inp" /></Field>
            <Field label="Description (optional)" full><textarea rows={2} value={form.description} onChange={upd("description")} className="inp" /></Field>
          </div>

          <div className="border-t-2 border-ink pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg uppercase">Sizes</h3>
              <button type="button" onClick={() => setSizes((arr) => [...arr, { _key: `s_${Math.random().toString(36).slice(2)}`, tyre_size: "", inventory: 0, supplier_price: 0, retail_price: 0, availability: "in_stock", eta_days: 2 }])} className="border-2 border-ink bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut inline-flex items-center gap-1">
                <Plus weight="bold" size={10} /> Add size
              </button>
            </div>
            <div className="space-y-2">
              {sizes.map((s, i) => (
                <div key={s._key} className="grid grid-cols-[1.2fr_0.7fr_0.9fr_0.9fr_1.1fr_0.6fr_auto] gap-2 items-center">
                  <input placeholder="225/65/R18" value={s.tyre_size} onChange={(e) => updSize(s._key, "tyre_size", e.target.value.toUpperCase())} className="inp" data-testid={`pg-size-${i}`} />
                  <input type="number" placeholder="Inv" value={s.inventory} onChange={(e) => updSize(s._key, "inventory", e.target.value)} className="inp" />
                  <input type="number" step="0.01" placeholder="Sup £" value={s.supplier_price} onChange={(e) => updSize(s._key, "supplier_price", e.target.value)} className="inp" />
                  <input type="number" step="0.01" placeholder="Retail £" value={s.retail_price} onChange={(e) => updSize(s._key, "retail_price", e.target.value)} className="inp" />
                  <select value={s.availability} onChange={(e) => updSize(s._key, "availability", e.target.value)} className="inp">
                    {AVAIL.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
                  </select>
                  <input type="number" placeholder="ETA d" value={s.eta_days} onChange={(e) => updSize(s._key, "eta_days", e.target.value)} className="inp" />
                  <button type="button" onClick={() => setSizes((arr) => arr.filter((x) => x._key !== s._key))} className="border-2 border-ink p-2 hover:bg-[#FFCDD2]">
                    <Trash weight="bold" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t-2 border-ink p-4 flex justify-end gap-2 bg-[#FAFAFA]">
          <button type="button" onClick={onClose} className="border-2 border-ink bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut">Cancel</button>
          <button type="submit" disabled={saving} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-5 py-2 text-xs shadow-brut hover-brut disabled:opacity-50" data-testid="pg-create-submit">
            {saving ? "Creating…" : "Create Product Group"}
          </button>
        </div>
        <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.5rem .6rem;font-family:'JetBrains Mono',monospace;font-size:.8125rem;background:#fff;}`}</style>
      </form>
    </div>
  );
}

function ProductGroupDetail({ pgId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/supplier/product-groups/${pgId}`);
      setData(d);
    } catch (err) {
      console.error("Group fetch failed", err);
      toast.error("Group not found");
    }
    setLoading(false);
  }, [pgId]);
  useEffect(() => { reload(); }, [reload]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading…</div>
      </div>
    );
  }
  const pct = data.wave?.progress_pct || 0;

  const exampleCsv = `tyre_size,inventory,supplier_price,retail_price,availability,eta_days
225/65/R18,40,88,138,in_stock,2
225/60/R18,24,86,132,in_stock,2
235/45/R19,4,110,168,limited,4`;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={onBack} className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 mb-4">
          <ArrowLeft weight="bold" size={12} /> Back to Product Groups
        </button>
        <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-start mb-6">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF5400] mb-1">{data.brand}</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter">{data.model}</h1>
            <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">{data.category}</div>
          </div>
          <div className="border-2 border-ink bg-white shadow-brut p-4 min-w-[260px]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">Wave Progress</div>
            <div className="font-display text-3xl tabular-nums">{data.wave?.participants_count}/{data.wave?.target_count}</div>
            <div className="mt-2 w-full h-2 border-2 border-ink bg-[#F4F4F4]">
              <div className="h-full bg-[#FF5400]" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-widest">
              {data.wave?.state === "locked" ? "🔒 Locked" : "⚡ Live"}
            </div>
          </div>
        </div>

        {/* Sizes */}
        <div className="border-2 border-ink bg-white shadow-brut">
          <div className="border-b-2 border-ink p-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-2xl uppercase">Inventory ({data.sizes.length} sizes)</h2>
            <div className="flex gap-2">
              <button onClick={() => setShowImport(true)} className="border-2 border-ink bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut inline-flex items-center gap-1.5" data-testid="csv-import-btn">
                <FileCsv weight="bold" /> Import CSV
              </button>
              <button onClick={() => navigator.clipboard?.writeText(`POST ${window.location.origin}/api/supplier/product-groups/api-sync`)} className="border-2 border-ink bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut inline-flex items-center gap-1.5">
                <Code weight="bold" /> API Endpoint
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-white">
                <tr>
                  <Th>Size</Th><Th>Inventory</Th><Th>Supplier £</Th><Th>Retail £</Th><Th>Availability</Th><Th>ETA</Th>
                </tr>
              </thead>
              <tbody>
                {data.sizes.map((s) => (
                  <tr key={s.size_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`size-row-${s.tyre_size}`}>
                    <Td><span className="font-display text-base">{s.tyre_size}</span></Td>
                    <Td>{s.inventory}</Td>
                    <Td>£{s.supplier_price.toFixed(2)}</Td>
                    <Td>£{s.retail_price.toFixed(2)}</Td>
                    <Td>{(AVAIL.find((a) => a.v === s.availability) || {}).l || s.availability}</Td>
                    <Td>{s.eta_days}d</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {showImport && (
          <ImportModal
            pgId={pgId}
            example={exampleCsv}
            onClose={() => setShowImport(false)}
            onDone={() => { setShowImport(false); reload(); }}
          />
        )}
      </div>
    </div>
  );
}

function ImportModal({ pgId, example, onClose, onDone }) {
  const [csv, setCsv] = useState(example);
  const [mode, setMode] = useState("upsert");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await api.post(`/supplier/product-groups/${pgId}/csv-import`, { csv, mode });
      setResult(data);
      const msg = `${data.inserted} added, ${data.updated} updated${data.errors?.length ? `, ${data.errors.length} errors` : ""}`;
      if (data.errors?.length) toast.error(msg);
      else toast.success(msg);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Import failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="csv-import-modal">
      <div className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between">
          <h3 className="font-display text-2xl uppercase">CSV Inventory Import</h3>
          <button onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="font-mono text-[11px] text-[#3A3A3A]">
            Columns: <b>tyre_size, inventory, supplier_price, retail_price, availability, eta_days</b>.
          </div>
          <div className="flex gap-2 font-mono text-[11px] uppercase tracking-widest">
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} /> Upsert (keep existing)
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} /> Overwrite (replace all)
            </label>
          </div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            className="w-full border-2 border-ink p-3 font-mono text-xs"
            data-testid="csv-input"
          />
          {result && (
            <div className="border-2 border-ink p-3 bg-[#FAFAFA]">
              <div className="font-mono text-[11px] uppercase tracking-widest">
                ✅ Inserted: {result.inserted} · Updated: {result.updated} · Errors: {result.errors?.length || 0}
              </div>
              {result.errors?.length > 0 && (
                <ul className="mt-2 font-mono text-[11px] text-red-700 space-y-1 max-h-40 overflow-auto">
                  {result.errors.map((er, i) => (
                    <li key={`${er.row ?? "x"}-${i}`}>Row {er.row || "?"}: {er.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="border-t-2 border-ink p-4 flex justify-end gap-2 bg-[#FAFAFA]">
          <button onClick={onClose} className="border-2 border-ink bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest font-mono shadow-brut-sm hover-brut">Close</button>
          <button onClick={submit} disabled={busy} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-5 py-2 text-xs shadow-brut hover-brut disabled:opacity-50" data-testid="csv-submit-btn">
            {busy ? "Importing…" : <span className="inline-flex items-center gap-1.5"><Upload weight="bold" /> Import</span>}
          </button>
          {result && result.errors?.length === 0 && (
            <button onClick={onDone} className="bg-[#00C853] text-ink border-2 border-ink font-bold uppercase tracking-widest px-5 py-2 text-xs shadow-brut hover-brut inline-flex items-center gap-1.5">
              <CheckCircle weight="fill" /> Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>
      {children}
    </label>
  );
}
function Th({ children }) { return <th className="text-left text-[10px] uppercase tracking-widest font-bold px-4 py-3">{children}</th>; }
function Td({ children }) { return <td className="px-4 py-3 align-middle">{children}</td>; }
