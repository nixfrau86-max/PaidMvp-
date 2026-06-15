import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Plus, Trash, PencilSimple, X, Package, ClipboardText } from "@phosphor-icons/react";

const STATE_BADGE = {
  open: { label: "Open", bg: "#00C853" },
  almost_full: { label: "Almost Full", bg: "#FFD600" },
  activated: { label: "Activated", bg: "#0021A5", text: "#fff" },
  processing: { label: "Processing", bg: "#FF5400", text: "#fff" },
  fulfilment: { label: "Fulfilment", bg: "#0021A5", text: "#fff" },
  completed: { label: "Completed", bg: "#525252", text: "#fff" },
  expired: { label: "Expired", bg: "#525252", text: "#fff" },
};

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k_${Math.random().toString(36).slice(2)}`);
const emptyVariant = () => ({ _key: uid(), label: "", supplier_cost: "", retail_price: "", wave_price: "", inventory_qty: "" });
const emptyProduct = () => ({ _key: uid(), model: "", variants: [emptyVariant()] });

export default function SupplierWaves() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [waves, setWaves] = useState([]);
  const [regions, setRegions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [summary, setSummary] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [w, r, c] = await Promise.all([
        api.get("/supplier/waves"),
        api.get("/regions"),
        api.get("/wave-categories"),
      ]);
      setWaves(w.data);
      setRegions(r.data);
      setCategories(c.data);
    } catch (err) {
      if (err?.response?.status === 403) { navigate("/supplier/onboarding"); return; }
      console.error("load failed", err);
    }
    setDataLoading(false);
  }, [navigate]);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    reload();
  }, [user, loading, navigate, reload]);

  const remove = async (w) => {
    if (!window.confirm(`Remove "${w.title}"? Active reservations will be released.`)) return;
    try {
      await api.delete(`/supplier/waves/${w.wave_id}`);
      toast.success("Wave removed");
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const openSummary = async (w) => {
    try {
      const { data } = await api.get(`/supplier/waves/${w.wave_id}/order-summary`);
      setSummary(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]"><Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Supplier Console</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">Regional Waves<sup className="text-xl">©</sup></h1>
            <p className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">One region · one category · one unit target</p>
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2" data-testid="create-wave-btn">
            <Plus weight="bold" /> Create Wave
          </button>
        </div>

        {waves.length === 0 ? (
          <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
            <Package weight="duotone" size={36} className="mx-auto mb-3 text-[#FF5400]" />
            <div className="font-display text-2xl uppercase mb-2">No waves yet.</div>
            <p className="text-[#3A3A3A] mb-5 text-sm">Create your first Regional Wave — pick a region, category and unit target.</p>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2">Create First Wave</button>
          </div>
        ) : (
          <div className="border-2 border-ink bg-white shadow-brut overflow-x-auto" data-testid="supplier-waves-table">
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-white">
                <tr><Th>Wave</Th><Th>Region</Th><Th>Category</Th><Th>State</Th><Th>Units</Th><Th>Activates</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {waves.map((w) => {
                  const sb = STATE_BADGE[w.state] || STATE_BADGE.open;
                  const editable = !["processing", "fulfilment", "completed"].includes(w.state);
                  return (
                    <tr key={w.wave_id} className="border-t-2 border-ink hover:bg-[#FAFAFA]" data-testid={`supplier-wave-row-${w.wave_id}`}>
                      <Td><span className="font-bold uppercase text-xs">{w.title}</span><div className="text-[10px] text-[#3A3A3A]">{w.brand}</div></Td>
                      <Td>{w.region_name}</Td>
                      <Td className="capitalize">{w.category_label}</Td>
                      <Td><span className="inline-flex border-2 border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-widest" style={{ background: sb.bg, color: sb.text || "#0A0A0A" }}>{sb.label}</span></Td>
                      <Td>{w.units_committed}/{w.ideal_target}</Td>
                      <Td>{w.min_activation}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {editable && (
                            <button onClick={() => { setEditing(w); setShowForm(true); }} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`edit-wave-${w.wave_id}`} title="Edit"><PencilSimple weight="bold" size={12} /></button>
                          )}
                          <button onClick={() => openSummary(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`summary-wave-${w.wave_id}`} title="Order summary"><ClipboardText weight="bold" size={12} /></button>
                          <button onClick={() => remove(w)} className="bg-white border-2 border-ink px-2 py-1 text-[10px] shadow-brut-sm hover-brut" data-testid={`remove-wave-${w.wave_id}`} title="Remove"><Trash weight="bold" size={12} /></button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <WaveForm
          regions={regions}
          categories={categories}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}
      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

function WaveForm({ regions, categories, editing, onClose, onSaved }) {
  const isEdit = Boolean(editing);
  const [form, setForm] = useState(() => ({
    category: editing?.category || "tyres",
    customCategory: "",
    region_id: editing?.region_id || "",
    brand: editing?.brand || "",
    title: editing?.title || "",
    description: editing?.description || "",
    image_url: editing?.image_url || "",
    eta: editing?.eta || "",
    ideal_target: editing?.ideal_target ?? 50,
    min_activation: editing?.min_activation ?? 40,
    deadline_days: 30,
    products: editing?.products?.length
      ? editing.products.map((p) => ({ _key: p.product_id || uid(), product_id: p.product_id, model: p.model, variants: p.variants.map((v) => ({ _key: v.variant_id || uid(), variant_id: v.variant_id, label: v.label, supplier_cost: v.supplier_cost, retail_price: v.retail_price, wave_price: v.wave_price, inventory_qty: v.inventory_qty })) }))
      : [emptyProduct()],
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image too large — max 5MB"); return; }
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const { data } = await api.post("/supplier/wave-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, image_url: data.image_url }));
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const updProduct = (pi, k, val) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], [k]: val }; return { ...f, products }; });
  const updVariant = (pi, vi, k, val) => setForm((f) => { const products = [...f.products]; const variants = [...products[pi].variants]; variants[vi] = { ...variants[vi], [k]: val }; products[pi] = { ...products[pi], variants }; return { ...f, products }; });
  const addProduct = () => setForm((f) => ({ ...f, products: [...f.products, emptyProduct()] }));
  const removeProduct = (pi) => setForm((f) => ({ ...f, products: f.products.filter((_, i) => i !== pi) }));
  const addVariant = (pi) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], variants: [...products[pi].variants, emptyVariant()] }; return { ...f, products }; });
  const removeVariant = (pi, vi) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], variants: products[pi].variants.filter((_, i) => i !== vi) }; return { ...f, products }; });

  const save = async (e) => {
    e.preventDefault();
    if (!form.region_id) { toast.error("Select a region"); return; }
    if (!form.brand.trim()) { toast.error("Enter a brand"); return; }
    if (Number(form.min_activation) > Number(form.ideal_target)) { toast.error("Min activation can't exceed ideal target"); return; }
    const products = form.products
      .filter((p) => p.model.trim())
      .map((p) => ({
        product_id: p.product_id,
        model: p.model.trim(),
        variants: p.variants.filter((v) => v.label.trim()).map((v) => ({
          variant_id: v.variant_id,
          label: v.label.trim(),
          supplier_cost: Number(v.supplier_cost) || 0,
          retail_price: Number(v.retail_price) || 0,
          wave_price: Number(v.wave_price) || 0,
          inventory_qty: Number(v.inventory_qty) || 0,
        })),
      }));
    if (!products.length || !products.some((p) => p.variants.length)) { toast.error("Add at least one product with one option"); return; }

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/supplier/waves/${editing.wave_id}`, {
          brand: form.brand, title: form.title, description: form.description, image_url: form.image_url, eta: form.eta,
          ideal_target: Number(form.ideal_target), min_activation: Number(form.min_activation), products,
        });
        toast.success("Wave updated");
      } else {
        let categoryId = form.category;
        let categoryLabel;
        if (form.category === "__other__") {
          const lbl = (form.customCategory || "").trim();
          if (!lbl) { toast.error("Type your product category"); setSaving(false); return; }
          categoryId = lbl.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          categoryLabel = lbl;
        }
        await api.post("/supplier/waves", {
          category: categoryId, category_label: categoryLabel, region_id: form.region_id, brand: form.brand, title: form.title || undefined,
          description: form.description, image_url: form.image_url, eta: form.eta, ideal_target: Number(form.ideal_target),
          min_activation: Number(form.min_activation), deadline_days: Number(form.deadline_days), products,
        });
        toast.success("Wave created");
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="wave-form-modal">
      <form onSubmit={save} className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-display text-2xl uppercase">{isEdit ? "Edit Wave" : "Create Regional Wave"}</h3>
          <button type="button" onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Category">
              <select disabled={isEdit} value={form.category} onChange={upd("category")} className="inp" data-testid="form-category">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                <option value="__other__">Other (specify)…</option>
              </select>
              {!isEdit && form.category === "__other__" && (
                <input
                  value={form.customCategory}
                  onChange={upd("customCategory")}
                  className="inp mt-2"
                  placeholder="e.g. Home Appliances, Pet Supplies…"
                  data-testid="form-category-custom"
                />
              )}
            </Field>
            <Field label="Region">
              <select disabled={isEdit} value={form.region_id} onChange={upd("region_id")} className="inp" data-testid="form-region">
                <option value="">Select region…</option>
                {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Brand"><input value={form.brand} onChange={upd("brand")} className="inp" placeholder="Continental" data-testid="form-brand" /></Field>
            <Field label="Title (optional — auto-generated)"><input value={form.title} onChange={upd("title")} className="inp" placeholder="auto: Region Brand Category Wave" data-testid="form-title" /></Field>
            <Field label="Ideal target (units)"><input type="number" min="1" value={form.ideal_target} onChange={upd("ideal_target")} className="inp" data-testid="form-ideal" /></Field>
            <Field label="Min activation (units)"><input type="number" min="1" value={form.min_activation} onChange={upd("min_activation")} className="inp" data-testid="form-minact" /></Field>
            <Field label="Fulfilment ETA"><input value={form.eta} onChange={upd("eta")} className="inp" placeholder="Dispatched within 7 days of activation" data-testid="form-eta" /></Field>
            {!isEdit && <Field label="Open for (days)"><input type="number" min="1" value={form.deadline_days} onChange={upd("deadline_days")} className="inp" /></Field>}
            <Field label="Description" full><textarea value={form.description} onChange={upd("description")} rows={2} className="inp" /></Field>
            <Field label="Product image (shown on the live wave card)" full>
              <div className="flex flex-col sm:flex-row gap-3 items-start" data-testid="wave-image-section">
                <div className="w-28 h-28 shrink-0 border-2 border-ink bg-[#FAFAFA] overflow-hidden flex items-center justify-center" data-testid="wave-image-preview">
                  {form.image_url ? (
                    <img src={form.image_url} alt="Wave preview" className="w-full h-full object-cover" />
                  ) : (
                    <Package weight="duotone" size={28} className="text-[#3A3A3A]" />
                  )}
                </div>
                <div className="flex-1 w-full space-y-2">
                  <label className={`inline-flex items-center gap-2 bg-white border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest shadow-brut-sm hover-brut cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`} data-testid="wave-image-upload-label">
                    <Plus weight="bold" size={10} /> {uploading ? "Uploading…" : "Upload image"}
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onPickImage} className="hidden" data-testid="wave-image-file" />
                  </label>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-[#3A3A3A]">JPG / PNG / GIF / WEBP · max 5MB · or paste a URL below</div>
                  <input value={form.image_url} onChange={upd("image_url")} className="inp" placeholder="https://…/product.jpg" data-testid="wave-image-url" />
                  {form.image_url && (
                    <button type="button" onClick={() => setForm((f) => ({ ...f, image_url: "" }))} className="text-[10px] font-bold uppercase tracking-widest text-[#FF5400] inline-flex items-center gap-1" data-testid="wave-image-clear"><X weight="bold" size={10} /> Remove image</button>
                  )}
                </div>
              </div>
            </Field>
          </div>

          <div className="border-t-2 border-ink pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-lg uppercase">Products & options</div>
              <button type="button" onClick={addProduct} className="bg-white border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid="add-product-btn"><Plus weight="bold" size={10} /> Add product</button>
            </div>
            {form.products.map((p, pi) => (
              <div key={p._key} className="border-2 border-ink mb-3" data-testid={`product-block-${pi}`}>
                <div className="flex items-center gap-2 p-2 border-b-2 border-ink bg-[#FAFAFA]">
                  <input value={p.model} onChange={(e) => updProduct(pi, "model", e.target.value)} className="inp flex-1" placeholder="Model (e.g. EcoContact 6)" data-testid={`product-model-${pi}`} />
                  {form.products.length > 1 && <button type="button" onClick={() => removeProduct(pi)} className="p-2 border-2 border-ink"><Trash weight="bold" size={12} /></button>}
                </div>
                <div className="p-2 space-y-2">
                  <div className="hidden sm:grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-2 font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] px-1">
                    <span>Option / size</span><span>Cost £</span><span>RRP £</span><span>Wave £</span><span>Stock</span><span></span>
                  </div>
                  {p.variants.map((v, vi) => (
                    <div key={v._key} className="grid grid-cols-2 sm:grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-2" data-testid={`variant-row-${pi}-${vi}`}>
                      <input value={v.label} onChange={(e) => updVariant(pi, vi, "label", e.target.value)} className="inp" placeholder="225/65 R18" />
                      <input type="number" step="0.01" value={v.supplier_cost} onChange={(e) => updVariant(pi, vi, "supplier_cost", e.target.value)} className="inp" placeholder="0" />
                      <input type="number" step="0.01" value={v.retail_price} onChange={(e) => updVariant(pi, vi, "retail_price", e.target.value)} className="inp" placeholder="0" />
                      <input type="number" step="0.01" value={v.wave_price} onChange={(e) => updVariant(pi, vi, "wave_price", e.target.value)} className="inp" placeholder="0" />
                      <input type="number" value={v.inventory_qty} onChange={(e) => updVariant(pi, vi, "inventory_qty", e.target.value)} className="inp" placeholder="0" />
                      {p.variants.length > 1 ? <button type="button" onClick={() => removeVariant(pi, vi)} className="p-2 border-2 border-ink"><X weight="bold" size={12} /></button> : <span />}
                    </div>
                  ))}
                  <button type="button" onClick={() => addVariant(pi)} className="text-[10px] font-bold uppercase tracking-widest text-[#FF5400] inline-flex items-center gap-1" data-testid={`add-variant-${pi}`}><Plus weight="bold" size={10} /> Add option</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t-2 border-ink p-4 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="border-2 border-ink px-4 py-2 text-xs font-bold uppercase tracking-widest">Cancel</button>
          <button type="submit" disabled={saving} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-2 text-xs shadow-brut hover-brut disabled:opacity-60" data-testid="save-wave-btn">{saving ? "Saving…" : isEdit ? "Save Changes" : "Create Wave"}</button>
        </div>
        <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.5rem .6rem;font-family:'JetBrains Mono',monospace;font-size:.8125rem;background:#fff;}`}</style>
      </form>
    </div>
  );
}

function SummaryModal({ summary, onClose }) {
  const pay = summary.payment_summary || {};
  const orders = summary.orders || [];
  const PAY_BADGE = {
    paid: { label: "Paid", cls: "bg-[#00C853] text-ink" },
    authorized: { label: "Authorized", cls: "bg-[#FFD600] text-ink" },
    unpaid: { label: "Unpaid", cls: "bg-[#F4F4F4] text-ink" },
  };
  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-start justify-center p-4 overflow-auto" data-testid="order-summary-modal">
      <div className="w-full max-w-3xl bg-white border-2 border-ink shadow-brut-lg my-6">
        <div className="border-b-2 border-ink p-4 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-display text-xl uppercase">Order summary</h3>
          <button onClick={onClose} className="p-2 border-2 border-ink"><X weight="bold" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">{summary.title} · {summary.state} · {summary.total_units} units</div>

          {/* Payment status breakdown */}
          <div data-testid="summary-payment-breakdown">
            <div className="font-display text-lg uppercase mb-2">Payment status</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="border-2 border-ink p-2 bg-[#00C853]/15" data-testid="summary-paid">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Paid</div>
                <div className="font-display text-2xl tabular-nums">{pay.paid_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.paid_orders || 0} orders</div>
              </div>
              <div className="border-2 border-ink p-2 bg-[#FFD600]/20" data-testid="summary-authorized">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Authorized</div>
                <div className="font-display text-2xl tabular-nums">{pay.authorized_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.authorized_orders || 0} orders</div>
              </div>
              <div className="border-2 border-ink p-2 bg-[#F4F4F4]" data-testid="summary-unpaid">
                <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Reserved / Unpaid</div>
                <div className="font-display text-2xl tabular-nums">{pay.reserved_units || 0}<span className="text-xs ml-1">units</span></div>
                <div className="font-mono text-[10px] text-[#3A3A3A]">{pay.reserved_orders || 0} orders</div>
              </div>
            </div>
          </div>

          {/* By option */}
          <div>
            <div className="font-display text-lg uppercase mb-1">By option</div>
            {(summary.variant_breakdown || []).length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">No committed units yet.</div> :
              (summary.variant_breakdown || []).map((b) => (
                <div key={`${b.model}-${b.label}`} className="flex justify-between border-b border-[#eee] py-1 font-mono text-sm">
                  <span>{b.model} · {b.label}</span>
                  <span className="font-bold">{b.units} units <span className="text-[#00C853] text-[11px]">({b.paid_units || 0} paid)</span></span>
                </div>
              ))}
          </div>

          {/* Per-destination items */}
          <div>
            <div className="font-display text-lg uppercase mb-1">Ship to (per destination)</div>
            {(summary.destinations || []).length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">—</div> :
              (summary.destinations || []).map((d) => (
                <div key={d.destination} className="border-2 border-ink mb-2 p-2" data-testid="summary-destination">
                  <div className="flex justify-between font-mono text-sm"><span className="font-bold">{d.destination}</span><span className="font-bold">{d.units} units</span></div>
                  <div className="mt-1 pl-2 space-y-0.5">
                    {(d.items || []).map((it, i) => (
                      <div key={`${it.label}-${i}`} className="flex justify-between font-mono text-[11px] text-[#3A3A3A]"><span>↳ {it.label}</span><span>{it.qty} units</span></div>
                    ))}
                    {(d.fittings || []).map((f, i) => (
                      <div key={`${f.slot}-${i}`} className="flex justify-between font-mono text-[11px] text-[#0021A5] uppercase tracking-widest"><span>🕑 {f.slot}</span><span>{f.units} units</span></div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {/* Orders with customer details */}
          <div>
            <div className="font-display text-lg uppercase mb-2">Orders &amp; customers</div>
            {orders.length === 0 ? <div className="font-mono text-xs text-[#3A3A3A]">No orders yet.</div> : (
              <div className="overflow-x-auto border-2 border-ink" data-testid="summary-orders-table">
                <table className="w-full font-mono text-[11px]">
                  <thead className="bg-ink text-white">
                    <tr>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Customer</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Items</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">{summary.category === "tyres" ? "Garage / Fitting" : "Delivery"}</th>
                      <th className="text-left px-2 py-2 uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const pb = PAY_BADGE[o.payment_status] || PAY_BADGE.unpaid;
                      return (
                        <tr key={o.order_id} className="border-t-2 border-ink align-top" data-testid={`summary-order-${o.order_id}`}>
                          <td className="px-2 py-2">
                            <div className="font-bold">{o.customer?.name || "—"}</div>
                            {o.customer?.email && <div className="text-[#3A3A3A] break-all">{o.customer.email}</div>}
                            {o.customer?.phone && <div className="text-[#3A3A3A]">{o.customer.phone}</div>}
                          </td>
                          <td className="px-2 py-2">
                            {(o.items || []).map((it, i) => (
                              <div key={`${it.label}-${i}`}>{it.qty}× {it.model} · {it.label}</div>
                            ))}
                          </td>
                          <td className="px-2 py-2">
                            <div>{o.destination}</div>
                            {o.fitting_slot && <div className="text-[#0021A5] uppercase tracking-widest text-[10px]">🕑 {o.fitting_slot}</div>}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`inline-block border-2 border-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${pb.cls}`}>{pb.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
function Td({ children, className = "" }) { return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>; }
