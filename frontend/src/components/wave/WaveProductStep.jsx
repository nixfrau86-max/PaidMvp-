import React from "react";
import { Minus, Plus } from "@phosphor-icons/react";

export const WaveProductStep = ({ w, product, variant, selProduct, setSelProduct, setSelVariant, selVariant, qty, setQty, maxQty, allowance }) => (
  <div className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8 shadow-[0_4px_20px_rgb(0,0,0,0.04)]" data-testid="select-panel">
    <div className="text-xs font-bold uppercase tracking-wider text-[#FF5400] mb-1">Step 1</div>
    <h2 className="font-outfit text-2xl font-semibold tracking-tight mb-5">Choose your product</h2>

    {(w.products || []).length > 1 && (
      <div className="flex flex-wrap gap-2 mb-5">
        {w.products.map((p) => (
          <button key={p.product_id} onClick={() => { setSelProduct(p.product_id); setSelVariant(""); }}
            className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors ${selProduct === p.product_id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            data-testid={`product-tab-${p.product_id}`}>
            {p.image_url
              ? <img src={p.image_url} alt={p.model} className="h-7 w-7 rounded-full object-cover ring-1 ring-black/10" />
              : <span className="h-7 w-7 rounded-full bg-slate-200" />}
            {p.model}
          </button>
        ))}
      </div>
    )}

    {product?.image_url && (
      <div className="mb-5 overflow-hidden rounded-2xl border border-slate-100" data-testid="product-hero-image">
        <img src={product.image_url} alt={product.model} className="h-44 w-full object-cover" />
      </div>
    )}

    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {(product?.variants || []).map((v) => {
        const isSel = selVariant === v.variant_id;
        const out = v.available <= 0;
        return (
          <button key={v.variant_id} disabled={out} onClick={() => setSelVariant(v.variant_id)}
            className={`text-left rounded-2xl border p-4 transition-all ${isSel ? "border-[#FF5400] bg-[#FFF8F4] ring-2 ring-[#FF5400]/20" : "border-slate-200 bg-white hover:border-slate-300"} ${out ? "opacity-40 cursor-not-allowed" : ""}`}
            data-testid={`variant-tile-${v.variant_id}`}>
            <div className="font-outfit text-lg font-semibold tracking-tight text-slate-900">{v.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-base font-bold tabular-nums text-slate-900">£{v.wave_price.toFixed(2)}</span>
              <span className="text-xs text-slate-400 line-through tabular-nums">£{v.retail_price.toFixed(0)}</span>
            </div>
            <div className={`mt-1 text-[11px] font-semibold ${out ? "text-slate-400" : "text-emerald-600"}`}>{out ? "Out of stock" : `${v.available} left`}</div>
          </button>
        );
      })}
    </div>

    {variant && (
      <div className="mt-6 border-t border-slate-100 pt-5 flex items-center gap-4 flex-wrap" data-testid="qty-row">
        <div className="text-sm font-semibold text-slate-500">Quantity</div>
        <div className="inline-flex items-center rounded-xl border border-slate-200 overflow-hidden">
          <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="px-3.5 py-2.5 text-slate-600 transition-colors hover:bg-slate-50" data-testid="qty-minus"><Minus weight="bold" size={13} /></button>
          <span className="px-5 font-outfit text-lg font-semibold tabular-nums" data-testid="qty-value">{qty}</span>
          <button onClick={() => setQty((n) => Math.min(maxQty || 1, n + 1))} className="px-3.5 py-2.5 text-slate-600 transition-colors hover:bg-slate-50" data-testid="qty-plus"><Plus weight="bold" size={13} /></button>
        </div>
        <div className="ml-auto text-sm font-semibold text-slate-500">Subtotal <span className="text-slate-900 tabular-nums">£{(variant.wave_price * qty).toFixed(2)}</span></div>
      </div>
    )}
    {variant && allowance && (
      <div className="mt-4 inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-500" data-testid="annual-allowance">
        Annual allowance · <span className="font-bold text-slate-900 tabular-nums">{allowance.remaining}</span> of {allowance.limit} {w.category} units left in {allowance.year}
        {allowance.override && <span className="text-emerald-600">· custom limit</span>}
        {allowance.remaining <= 0 && <span className="text-[#FF5400]">· limit reached for {allowance.year}</span>}
      </div>
    )}
  </div>
);
