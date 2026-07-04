import React from "react";
import { Plus, X, Package } from "@phosphor-icons/react";

export function WaveImageField({ imageUrl, uploading, onPickImage, onUrlChange, onClear }) {
  return (
    <label className="block sm:col-span-2">
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Product image (shown on the live wave card)</div>
      <div className="flex flex-col sm:flex-row gap-3 items-start" data-testid="wave-image-section">
        <div className="w-28 h-28 shrink-0 border-2 border-ink bg-[#FAFAFA] overflow-hidden flex items-center justify-center" data-testid="wave-image-preview">
          {imageUrl ? (
            <img src={imageUrl} alt="Wave preview" className="w-full h-full object-cover" />
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
          <input value={imageUrl} onChange={onUrlChange} className="inp" placeholder="https://…/product.jpg" data-testid="wave-image-url" />
          {imageUrl && (
            <button type="button" onClick={onClear} className="text-[10px] font-bold uppercase tracking-widest text-[#FF5400] inline-flex items-center gap-1" data-testid="wave-image-clear"><X weight="bold" size={10} /> Remove image</button>
          )}
        </div>
      </div>
    </label>
  );
}
