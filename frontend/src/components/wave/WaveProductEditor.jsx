import React from "react";
import { Plus, Trash, X } from "@phosphor-icons/react";

function VariantRow({ pi, vi, v, canRemove, updVariant, removeVariant }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-2" data-testid={`variant-row-${pi}-${vi}`}>
      <input value={v.label} onChange={(e) => updVariant(pi, vi, "label", e.target.value)} className="inp" placeholder="225/65 R18" />
      <input type="number" step="0.01" value={v.supplier_cost} onChange={(e) => updVariant(pi, vi, "supplier_cost", e.target.value)} className="inp" placeholder="0" />
      <input type="number" step="0.01" value={v.retail_price} onChange={(e) => updVariant(pi, vi, "retail_price", e.target.value)} className="inp" placeholder="0" />
      <input type="number" step="0.01" value={v.wave_price} onChange={(e) => updVariant(pi, vi, "wave_price", e.target.value)} className="inp" placeholder="0" />
      <input type="number" value={v.inventory_qty} onChange={(e) => updVariant(pi, vi, "inventory_qty", e.target.value)} className="inp" placeholder="0" />
      {canRemove ? <button type="button" onClick={() => removeVariant(pi, vi)} className="p-2 border-2 border-ink"><X weight="bold" size={12} /></button> : <span />}
    </div>
  );
}

function ProductBlock({ pi, p, canRemove, uploading, updProduct, updVariant, addVariant, removeProduct, removeVariant, onPickProductImage }) {
  return (
    <div className="border-2 border-ink mb-3" data-testid={`product-block-${pi}`}>
      <div className="flex items-center gap-2 p-2 border-b-2 border-ink bg-[#FAFAFA]">
        <label className={`relative w-12 h-12 shrink-0 border-2 border-ink bg-white overflow-hidden flex items-center justify-center cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`} data-testid={`product-image-label-${pi}`} title="Add product photo">
          {p.image_url ? (
            <img src={p.image_url} alt={p.model || "product"} className="w-full h-full object-cover" data-testid={`product-image-preview-${pi}`} />
          ) : (
            <Plus weight="bold" size={16} className="text-[#3A3A3A]" />
          )}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onPickProductImage(pi)} className="hidden" data-testid={`product-image-file-${pi}`} />
        </label>
        <input value={p.model} onChange={(e) => updProduct(pi, "model", e.target.value)} className="inp flex-1" placeholder="Model (e.g. EcoContact 6)" data-testid={`product-model-${pi}`} />
        {p.image_url && <button type="button" onClick={() => updProduct(pi, "image_url", "")} className="p-2 border-2 border-ink" data-testid={`product-image-clear-${pi}`} title="Remove photo"><X weight="bold" size={12} /></button>}
        {canRemove && <button type="button" onClick={() => removeProduct(pi)} className="p-2 border-2 border-ink"><Trash weight="bold" size={12} /></button>}
      </div>
      <div className="p-2 space-y-2">
        <div className="hidden sm:grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-2 font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] px-1">
          <span>Option / size</span><span>Cost £</span><span>RRP £</span><span>Wave £</span><span>Stock</span><span></span>
        </div>
        {p.variants.map((v, vi) => (
          <VariantRow key={v._key} pi={pi} vi={vi} v={v} canRemove={p.variants.length > 1} updVariant={updVariant} removeVariant={removeVariant} />
        ))}
        <button type="button" onClick={() => addVariant(pi)} className="text-[10px] font-bold uppercase tracking-widest text-[#FF5400] inline-flex items-center gap-1" data-testid={`add-variant-${pi}`}><Plus weight="bold" size={10} /> Add option</button>
      </div>
    </div>
  );
}

export function WaveProductEditor({ products, productUploading, updProduct, updVariant, addProduct, removeProduct, addVariant, removeVariant, onPickProductImage }) {
  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-display text-lg uppercase">Products & options</div>
        <button type="button" onClick={addProduct} className="bg-white border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest shadow-brut-sm hover-brut inline-flex items-center gap-1" data-testid="add-product-btn"><Plus weight="bold" size={10} /> Add product</button>
      </div>
      {products.map((p, pi) => (
        <ProductBlock
          key={p._key} pi={pi} p={p}
          canRemove={products.length > 1}
          uploading={productUploading[pi]}
          updProduct={updProduct} updVariant={updVariant} addVariant={addVariant}
          removeProduct={removeProduct} removeVariant={removeVariant} onPickProductImage={onPickProductImage}
        />
      ))}
    </div>
  );
}
