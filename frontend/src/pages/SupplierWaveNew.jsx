import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Lightning, ArrowLeft, Info } from "@phosphor-icons/react";

export default function SupplierWaveNew() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Tyres",
    image_url: "",
    supplier_cost: 100,
    retail_price: 200,
    customer_price: 150,
    threshold: 20,
    max_participants: 200,
    deadline_hours: 72,
  });

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    (async () => {
      try {
        const { data } = await api.get("/suppliers/me");
        setSupplier(data);
        setForm(f => ({ ...f, category: data.category || "Tyres" }));
      } catch {
        navigate("/supplier/onboarding");
      }
    })();
  }, [user, loading, navigate]);

  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === "number" ? +e.target.value : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post("/suppliers/me/waves", form);
      if (data.publish_status === "live") {
        toast.success("Wave is live!");
      } else {
        toast.success("Wave submitted — awaiting admin approval.");
      }
      navigate("/supplier");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create wave");
    } finally { setSubmitting(false); }
  };

  if (!supplier) return <div className="min-h-screen bg-white"><Navbar /></div>;

  const isProvisional = supplier.status === "provisional";
  const margin = (form.customer_price - form.supplier_cost).toFixed(2);
  const customerSaves = (form.retail_price - form.customer_price).toFixed(2);
  const marginPct = form.customer_price > 0 ? ((margin / form.customer_price) * 100).toFixed(1) : 0;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate("/supplier")} className="text-xs font-mono uppercase tracking-widest text-[#3A3A3A] hover:text-ink mb-4 inline-flex items-center gap-1">
          <ArrowLeft weight="bold" size={12}/> Back to console
        </button>
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">New Wave</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">Launch a Wave.</h1>
          {isProvisional && (
            <div className="mt-3 border-2 border-ink bg-[#FFD600] p-3 shadow-brut-sm inline-flex items-start gap-2 max-w-xl">
              <Info weight="fill" size={18} className="shrink-0 mt-0.5" />
              <div className="text-xs">
                <strong className="uppercase tracking-wider">Sandbox limits:</strong> threshold ≤ 30 · retail ≤ £500.
                {supplier.waves_published >= supplier.provisional_cap
                  ? " Your first wave is used — this one will need admin approval."
                  : " This wave goes live immediately."}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="wave-new-form">
          <div className="lg:col-span-2 border-2 border-ink bg-white shadow-brut p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PField label="Title *" full><input required value={form.title} onChange={upd("title")} className="inp" placeholder="e.g. Michelin Pilot Sport 4 — Set of 4" data-testid="wave-title" /></PField>
            <PField label="Category *"><input value={form.category} onChange={upd("category")} className="inp" /></PField>
            <PField label="Image URL *"><input required value={form.image_url} onChange={upd("image_url")} className="inp" placeholder="https://..." /></PField>
            <PField label="Description *" full><textarea required value={form.description} onChange={upd("description")} className="inp" rows={2} /></PField>
            <PField label="Supplier cost (£/unit) *"><input required type="number" step="0.01" value={form.supplier_cost} onChange={upd("supplier_cost")} className="inp" /></PField>
            <PField label="Retail price (£) *"><input required type="number" step="0.01" value={form.retail_price} onChange={upd("retail_price")} className="inp" max={isProvisional ? 500 : undefined} /></PField>
            <PField label="Collective price (£) *"><input required type="number" step="0.01" value={form.customer_price} onChange={upd("customer_price")} className="inp" /></PField>
            <PField label="Threshold (min joiners) *"><input required type="number" value={form.threshold} onChange={upd("threshold")} className="inp" max={isProvisional ? 30 : undefined} /></PField>
            <PField label="Max participants"><input type="number" value={form.max_participants} onChange={upd("max_participants")} className="inp" /></PField>
            <PField label="Deadline (hours)"><input type="number" value={form.deadline_hours} onChange={upd("deadline_hours")} className="inp" /></PField>
          </div>

          {/* Live preview */}
          <aside className="border-2 border-ink bg-ink text-white shadow-brut p-5 h-fit sticky top-24">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#FFD600] mb-3">Live Preview</div>
            <div className="space-y-3">
              <Row label="Retail" v={`£${form.retail_price.toFixed(2)}`} strike />
              <Row label="Collective Price" v={`£${form.customer_price.toFixed(2)}`} bold />
              <div className="bg-[#00C853] text-ink border-2 border-white p-3 -mx-1">
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono">Customer Saves</div>
                <div className="font-display text-3xl">£{customerSaves}</div>
              </div>
              <div className="border-t-2 border-white/40 pt-3">
                <Row label="Your margin / unit" v={`£${margin} · ${marginPct}%`} />
                <Row label="Threshold" v={`${form.threshold} buyers`} />
                <Row label="Goes live in" v={form.deadline_hours + "h window"} />
              </div>
            </div>

            <button type="submit" disabled={submitting} className="mt-5 w-full bg-[#FF5400] text-white border-2 border-white font-bold uppercase tracking-wider px-5 py-3 text-sm shadow-brut hover-brut disabled:opacity-60 inline-flex items-center justify-center gap-2" data-testid="wave-submit">
              <Lightning weight="fill" /> {submitting ? "Launching..." : "Launch Wave"}
            </button>
          </aside>
        </form>
        <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.55rem .65rem;font-family:'JetBrains Mono',monospace;font-size:.8125rem;background:#fff}`}</style>
      </div>
    </div>
  );
}

function PField({ label, full, children }) {
  return <label className={`block ${full ? "sm:col-span-2" : ""}`}>
    <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>
    {children}
  </label>;
}

function Row({ label, v, strike, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-widest opacity-90">{label}</span>
      <span className={`${bold ? "font-display text-2xl" : "font-mono text-sm font-bold"} ${strike ? "line-through opacity-70" : ""}`}>{v}</span>
    </div>
  );
}
