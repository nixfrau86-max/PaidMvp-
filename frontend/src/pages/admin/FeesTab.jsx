import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sliders, Star } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Field } from "./_shared";

export default function FeesTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await api.get("/admin/fees");
    setConfig(data);
  };

  useEffect(() => { load(); }, []);

  const sortedMethods = useMemo(
    () => (config?.payment_methods ? [...config.payment_methods].sort((a, b) => a.order - b.order) : []),
    [config?.payment_methods],
  );

  if (!config) {
    return <div className="border-2 border-ink bg-white shadow-brut p-6 font-mono uppercase tracking-widest text-sm">Loading fees…</div>;
  }

  const updateMethod = (id, patch) => {
    setConfig((c) => ({
      ...c,
      payment_methods: c.payment_methods.map((m) => m.id === id ? { ...m, ...patch } : m),
    }));
  };

  const setRecommended = (id) => {
    setConfig((c) => ({
      ...c,
      payment_methods: c.payment_methods.map((m) => ({ ...m, recommended: m.id === id })),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        commission_pct: Number(config.commission_pct),
        service_fee_mode: config.service_fee_mode,
        service_fee_value: Number(config.service_fee_value),
        payment_methods: config.payment_methods.map((m) => ({
          id: m.id, label: m.label, sub: m.sub || "", fee: Number(m.fee),
          recommended: !!m.recommended, enabled: !!m.enabled, order: Number(m.order),
        })),
      };
      const { data } = await api.put("/admin/fees", payload);
      setConfig(data);
      toast.success("Fee configuration saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="fees-tab">
      <div className="border-2 border-ink bg-white shadow-brut p-6">
        <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#FF5400] mb-2">Fee Engine</div>
        <h2 className="font-display text-3xl uppercase tracking-tighter leading-none">Commission & Service Fee</h2>
        <p className="font-mono text-xs text-[#3A3A3A] mt-2">
          Commission is hidden from consumers. Only Platform Service Fee and Payment Method Fee appear on checkout.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <Field label="Commission (%) — supplier-side, hidden">
            <div className="flex items-center border-2 border-ink">
              <input
                type="number" step="0.001" min="0" max="1"
                value={config.commission_pct}
                onChange={(e) => setConfig((c) => ({ ...c, commission_pct: e.target.value }))}
                className="w-full p-2 font-mono text-sm outline-none"
                data-testid="fees-commission-input"
              />
              <span className="px-3 font-mono text-xs text-[#3A3A3A] border-l-2 border-ink">decimal</span>
            </div>
            <div className="font-mono text-[10px] text-[#3A3A3A] mt-1">e.g. 0.02 = 2%</div>
          </Field>

          <Field label="Service Fee Mode">
            <div className="flex border-2 border-ink" data-testid="fees-mode-toggle">
              {[
                { id: "flat", label: "Flat £" },
                { id: "percent", label: "Percent %" },
              ].map((opt, i) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, service_fee_mode: opt.id }))}
                  className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-widest font-mono ${i === 0 ? "border-r-2 border-ink" : ""} ${config.service_fee_mode === opt.id ? "bg-ink text-white" : "bg-white"}`}
                  data-testid={`fees-mode-${opt.id}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Service Fee Value ${config.service_fee_mode === "percent" ? "(decimal, 0.01 = 1%)" : "(£ flat)"}`}>
            <input
              type="number" step="0.01" min="0"
              value={config.service_fee_value}
              onChange={(e) => setConfig((c) => ({ ...c, service_fee_value: e.target.value }))}
              className="w-full border-2 border-ink p-2 font-mono text-sm"
              data-testid="fees-service-value-input"
            />
          </Field>
        </div>
      </div>

      <div className="border-2 border-ink bg-white shadow-brut p-6">
        <h2 className="font-display text-3xl uppercase tracking-tighter leading-none">Payment Methods</h2>
        <p className="font-mono text-xs text-[#3A3A3A] mt-2 mb-5">
          Set per-method fees, toggle availability, and mark one as Recommended.
        </p>

        <div className="space-y-3">
          {sortedMethods.map((m) => (
            <div key={m.id} className="border-2 border-ink bg-[#FAFAFA] p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center" data-testid={`fees-method-${m.id}`}>
              <div className="sm:col-span-3 min-w-0">
                <div className="font-bold uppercase tracking-wider text-sm">{m.label}</div>
                <div className="font-mono text-[10px] text-[#3A3A3A] mt-0.5 truncate">{m.sub}</div>
              </div>
              <div className="sm:col-span-3">
                <div className="text-[9px] font-bold uppercase tracking-widest font-mono mb-1">Fee (£)</div>
                <input
                  type="number" step="0.05" min="0"
                  value={m.fee}
                  onChange={(e) => updateMethod(m.id, { fee: e.target.value })}
                  className="w-full border-2 border-ink p-2 font-mono text-sm bg-white"
                  data-testid={`fees-method-fee-${m.id}`}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="text-[9px] font-bold uppercase tracking-widest font-mono mb-1">Order</div>
                <input
                  type="number" min="1"
                  value={m.order}
                  onChange={(e) => updateMethod(m.id, { order: e.target.value })}
                  className="w-full border-2 border-ink p-2 font-mono text-sm bg-white"
                />
              </div>
              <div className="sm:col-span-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => updateMethod(m.id, { enabled: !m.enabled })}
                  className={`flex-1 border-2 border-ink px-2 py-2 text-[10px] font-bold uppercase tracking-widest font-mono ${m.enabled ? "bg-[#00C853] text-ink" : "bg-white text-[#3A3A3A]"}`}
                  data-testid={`fees-method-toggle-${m.id}`}
                >
                  {m.enabled ? "On" : "Off"}
                </button>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setRecommended(m.id)}
                  className={`w-full border-2 border-ink px-2 py-2 text-[10px] font-bold uppercase tracking-widest font-mono inline-flex items-center justify-center gap-1 ${m.recommended ? "bg-[#FFD600]" : "bg-white"}`}
                  data-testid={`fees-method-rec-${m.id}`}
                >
                  <Star weight={m.recommended ? "fill" : "regular"} size={11} />
                  {m.recommended ? "Recommended" : "Set Recommended"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2 disabled:opacity-60"
            data-testid="fees-save-btn"
          >
            <Sliders weight="bold" /> {saving ? "Saving…" : "Save Configuration"}
          </button>
        </div>
      </div>

      <UnitLimitsCard />
    </div>
  );
}

const UL_CATEGORIES = ["tyres", "electronics", "footwear"];

function UnitLimitsCard() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/admin/unit-limits").then(({ data }) => {
      const cl = data.category_limits || {};
      setCfg({
        category_limits: UL_CATEGORIES.reduce((a, c) => ({ ...a, [c]: String(cl[c] ?? "") }), {}),
        default_limit: String(data.default_limit ?? ""),
      });
    }).catch(() => toast.error("Failed to load unit limits"));
  }, []);

  const save = async () => {
    const category_limits = {};
    for (const c of UL_CATEGORIES) {
      const n = parseInt(cfg.category_limits[c], 10);
      if (Number.isNaN(n) || n < 0) { toast.error(`Invalid ${c} limit`); return; }
      category_limits[c] = n;
    }
    const def = parseInt(cfg.default_limit, 10);
    if (Number.isNaN(def) || def < 0) { toast.error("Invalid default limit"); return; }
    setSaving(true);
    try {
      await api.put("/admin/unit-limits", { category_limits, default_limit: def });
      toast.success("Annual unit limits saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save limits");
    } finally { setSaving(false); }
  };

  if (!cfg) return null;
  return (
    <div className="border-2 border-ink bg-white shadow-brut p-6" data-testid="unit-limits-card">
      <h2 className="font-display text-3xl uppercase tracking-tighter leading-none">Annual Unit Limits</h2>
      <p className="font-mono text-[11px] text-[#3A3A3A] mt-2 mb-4 max-w-2xl">
        Max units a single user can buy per category each calendar year. Per-user overrides
        (set in the Users tab) take precedence. Counts reserved + paid commitments.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {UL_CATEGORIES.map((c) => (
          <Field key={c} label={c}>
            <input type="number" min="0" value={cfg.category_limits[c]}
              onChange={(e) => setCfg((p) => ({ ...p, category_limits: { ...p.category_limits, [c]: e.target.value } }))}
              className="w-full border-2 border-ink p-2.5 font-mono text-sm" data-testid={`unit-limit-${c}`} />
          </Field>
        ))}
        <Field label="Other (default)">
          <input type="number" min="0" value={cfg.default_limit}
            onChange={(e) => setCfg((p) => ({ ...p, default_limit: e.target.value }))}
            className="w-full border-2 border-ink p-2.5 font-mono text-sm" data-testid="unit-limit-default" />
        </Field>
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={save} disabled={saving}
          className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2 disabled:opacity-60"
          data-testid="unit-limits-save-btn">
          <Sliders weight="bold" /> {saving ? "Saving…" : "Save Unit Limits"}
        </button>
      </div>
    </div>
  );
}
