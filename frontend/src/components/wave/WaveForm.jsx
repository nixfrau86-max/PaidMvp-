import React, { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash, X, Package } from "@phosphor-icons/react";
import { api } from "../../lib/api";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k_${Math.random().toString(36).slice(2)}`);
const emptyVariant = () => ({ _key: uid(), label: "", supplier_cost: "", retail_price: "", wave_price: "", inventory_qty: "" });
const emptyProduct = () => ({ _key: uid(), model: "", image_url: "", variants: [emptyVariant()] });

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>
      {children}
    </label>
  );
}

export default function WaveForm({ regions, categories, editing, onClose, onSaved, suppliers = null, admin = false }) {
  const isEdit = Boolean(editing);
  const imageEndpoint = admin ? "/admin/wave-image" : "/supplier/wave-image";
  const activeSuppliers = (suppliers || []).filter((s) => !["suspended", "deleted"].includes(s.account_status));
  const [form, setForm] = useState(() => ({
    supplier_id: "",
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
      ? editing.products.map((p) => ({ _key: p.product_id || uid(), product_id: p.product_id, model: p.model, image_url: p.image_url || "", variants: p.variants.map((v) => ({ _key: v.variant_id || uid(), variant_id: v.variant_id, label: v.label, supplier_cost: v.supplier_cost, retail_price: v.retail_price, wave_price: v.wave_price, inventory_qty: v.inventory_qty })) }))
      : [emptyProduct()],
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [productUploading, setProductUploading] = useState({});
  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const uploadImage = async (file) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("Image too large — max 5MB"); return null; }
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post(imageEndpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
    return data.image_url;
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      if (url) { setForm((f) => ({ ...f, image_url: url })); toast.success("Image uploaded"); }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const onPickProductImage = (pi) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProductUploading((u) => ({ ...u, [pi]: true }));
    try {
      const url = await uploadImage(file);
      if (url) { updProduct(pi, "image_url", url); toast.success("Product image uploaded"); }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setProductUploading((u) => ({ ...u, [pi]: false })); }
  };

  const updProduct = (pi, k, val) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], [k]: val }; return { ...f, products }; });
  const updVariant = (pi, vi, k, val) => setForm((f) => { const products = [...f.products]; const variants = [...products[pi].variants]; variants[vi] = { ...variants[vi], [k]: val }; products[pi] = { ...products[pi], variants }; return { ...f, products }; });
  const addProduct = () => setForm((f) => ({ ...f, products: [...f.products, emptyProduct()] }));
  const removeProduct = (pi) => setForm((f) => ({ ...f, products: f.products.filter((_, i) => i !== pi) }));
  const addVariant = (pi) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], variants: [...products[pi].variants, emptyVariant()] }; return { ...f, products }; });
  const removeVariant = (pi, vi) => setForm((f) => { const products = [...f.products]; products[pi] = { ...products[pi], variants: products[pi].variants.filter((_, i) => i !== vi) }; return { ...f, products }; });

  const save = async (e) => {
    e.preventDefault();
    if (admin && !isEdit && !form.supplier_id) { toast.error("Choose a supplier for this wave"); return; }
    if (!form.region_id) { toast.error("Select a region"); return; }
    if (!form.brand.trim()) { toast.error("Enter a brand"); return; }
    if (Number(form.min_activation) > Number(form.ideal_target)) { toast.error("Min activation can't exceed ideal target"); return; }
    const products = form.products
      .filter((p) => p.model.trim())
      .map((p) => ({
        product_id: p.product_id,
        model: p.model.trim(),
        image_url: p.image_url || "",
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
        const body = {
          category: categoryId, category_label: categoryLabel, region_id: form.region_id, brand: form.brand, title: form.title || undefined,
          description: form.description, image_url: form.image_url, eta: form.eta, ideal_target: Number(form.ideal_target),
          min_activation: Number(form.min_activation), deadline_days: Number(form.deadline_days), products,
        };
        if (admin) {
          await api.post("/admin/regional-waves", { ...body, supplier_id: form.supplier_id });
        } else {
          await api.post("/supplier/waves", body);
        }
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
            {admin && !isEdit && (
              <Field label="Supplier" full>
                <select value={form.supplier_id} onChange={upd("supplier_id")} className="inp" data-testid="form-supplier">
                  <option value="">Select a supplier…</option>
                  {activeSuppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.business_name}</option>)}
                </select>
              </Field>
            )}
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
                  <label className={`relative w-12 h-12 shrink-0 border-2 border-ink bg-white overflow-hidden flex items-center justify-center cursor-pointer ${productUploading[pi] ? "opacity-60 pointer-events-none" : ""}`} data-testid={`product-image-label-${pi}`} title="Add product photo">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.model || "product"} className="w-full h-full object-cover" data-testid={`product-image-preview-${pi}`} />
                    ) : (
                      <Plus weight="bold" size={16} className="text-[#3A3A3A]" />
                    )}
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onPickProductImage(pi)} className="hidden" data-testid={`product-image-file-${pi}`} />
                  </label>
                  <input value={p.model} onChange={(e) => updProduct(pi, "model", e.target.value)} className="inp flex-1" placeholder="Model (e.g. EcoContact 6)" data-testid={`product-model-${pi}`} />
                  {p.image_url && <button type="button" onClick={() => updProduct(pi, "image_url", "")} className="p-2 border-2 border-ink" data-testid={`product-image-clear-${pi}`} title="Remove photo"><X weight="bold" size={12} /></button>}
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
