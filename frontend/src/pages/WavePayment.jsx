import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { track } from "../lib/firebase";
import { CreditCard, Bank, ArrowsLeftRight, Lock, ShieldCheck, DeviceMobile, Sparkle, AppleLogo, GoogleLogo, Wrench, Truck } from "@phosphor-icons/react";

const METHOD_ICON = {
  open_banking: Bank, apple_pay: AppleLogo, google_pay: GoogleLogo, card: CreditCard, bank_transfer: ArrowsLeftRight,
};
const STRIPE_RAILS = new Set(["card", "apple_pay", "google_pay"]);

export default function WavePayment() {
  const { participationId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [quote, setQuote] = useState(null);
  const [order, setOrder] = useState(null);
  const [method, setMethod] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    (async () => {
      try {
        const [q, orders] = await Promise.all([
          api.get(`/wave-checkout/${participationId}/quote`),
          api.get("/me/wave-orders"),
        ]);
        setQuote(q.data);
        setOrder(orders.data.find((o) => o.participation_id === participationId) || null);
        const rec = q.data.methods.find((m) => m.recommended) || q.data.methods[0];
        setMethod(rec?.id);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load payment");
        navigate("/dashboard");
      }
    })();
  }, [participationId, user, loading, navigate]);

  const selected = useMemo(() => quote?.methods.find((m) => m.id === method), [quote, method]);

  const pay = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/wave-checkout/${participationId}`, { payment_method: method, origin_url: window.location.origin });
      track("wave_payment_init", { participation_id: participationId, method });
      if (STRIPE_RAILS.has(method) && data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        const friendly = method === "open_banking" ? "Open Banking" : "Bank Transfer";
        toast(`Authorising via ${friendly}…`);
        await new Promise((r) => setTimeout(r, 800));
        await api.post(`/wave-checkout/mock-confirm/${data.session_id}`);
        navigate(`/wave-payment/success?session_id=${data.session_id}&pid=${participationId}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment error");
      setSubmitting(false);
    }
  };

  if (!quote || !selected) {
    return <div className="min-h-screen bg-[#F4F4F4]"><Navbar /><div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest">Loading…</div></div>;
  }

  const isTyre = order?.category === "tyres";

  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Wave Activated · Payment Due</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">Complete your payment.</h1>
          <p className="text-[#3A3A3A] mt-2 text-sm max-w-xl">
            Your Wave hit its threshold — time for your single bundled payment. {isTyre ? "Your tyres ship to your chosen garage and your fitting slot is confirmed on payment." : "Your order ships to your delivery address."}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-5">
            <div className="border-2 border-ink bg-white shadow-brut p-6" data-testid="wave-payment-methods">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Choose payment method</div>
              <div className="space-y-3">
                {quote.methods.map((opt) => {
                  const Icon = METHOD_ICON[opt.id] || DeviceMobile;
                  const active = method === opt.id;
                  return (
                    <button key={opt.id} onClick={() => setMethod(opt.id)}
                      className={`w-full border-2 border-ink p-4 flex items-center gap-4 text-left transition-all ${active ? "bg-white shadow-brut-sm ring-4 ring-[#FFD600]" : "bg-white hover:bg-[#FAFAFA]"}`}
                      data-testid={`wpm-${opt.id}`}>
                      <div className="w-12 h-12 border-2 border-ink bg-white flex items-center justify-center shrink-0"><Icon weight="duotone" size={24} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold uppercase tracking-wider text-sm">{opt.label}</span>
                          {opt.recommended && <span className="inline-flex items-center gap-1 bg-[#00C853] text-ink border-2 border-ink font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5"><Sparkle weight="fill" size={9} />Recommended</span>}
                        </div>
                        <div className="font-mono text-xs text-[#3A3A3A] mt-0.5">{opt.sub}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">{opt.fee > 0 ? "Fee" : "Free"}</div>
                        <div className="font-display text-xl">{opt.fee > 0 ? `+£${opt.fee.toFixed(2)}` : "£0"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#3A3A3A]">
                <ShieldCheck weight="bold" size={14} className="text-[#FF5400]" /> Single bundled payment · Bank-grade encryption
              </div>
            </div>

            {order && (
              <div className="border-2 border-ink bg-white shadow-brut p-5" data-testid="wave-payment-fulfilment">
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-2 inline-flex items-center gap-1">
                  {isTyre ? <><Wrench weight="bold" size={12} /> Fitting</> : <><Truck weight="bold" size={12} /> Delivery</>}
                </div>
                {isTyre ? (
                  <div className="font-mono text-sm">{order.garage_name}{order.fitting_slot_label ? ` · ${order.fitting_slot_label}` : ""}</div>
                ) : (
                  <div className="font-mono text-sm">{order.delivery_address}</div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="border-2 border-ink bg-white shadow-brut p-6 sticky top-24">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Order summary</div>
              <div className="font-display text-lg uppercase leading-tight mb-3">{quote.wave_title}</div>
              <div className="space-y-2 border-b-2 border-ink pb-4" data-testid="wave-order-lines">
                {quote.items.map((it) => (
                  <div key={it.variant_id} className="flex justify-between font-mono text-[13px]">
                    <span>{it.model} · {it.label} × {it.qty}</span>
                    <span className="font-bold">£{(it.wave_price * it.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2 mt-4">
                <Row label="Subtotal" value={`£${quote.subtotal.toFixed(2)}`} testid="wave-row-subtotal" />
                <Row label="Platform Service Fee" value={`+£${quote.service_fee.toFixed(2)}`} testid="wave-row-service-fee" />
                <Row label="Payment Method Fee" value={selected.fee > 0 ? `+£${selected.fee.toFixed(2)}` : "£0.00"} testid="wave-row-payment-fee" />
              </div>
              <div className="border-t-2 border-ink mt-4 pt-4 flex items-baseline justify-between" data-testid="wave-row-total">
                <span className="font-bold uppercase tracking-wider text-sm">Total</span>
                <span className="font-display text-3xl">£{selected.total.toFixed(2)}</span>
              </div>
              <button onClick={pay} disabled={submitting}
                className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="wave-pay-btn">
                <Lock weight="fill" /> {submitting ? "Processing…" : `Pay £${selected.total.toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, testid }) {
  return (
    <div className="flex items-center justify-between py-1" data-testid={testid}>
      <span className="text-sm text-[#3A3A3A]">{label}</span>
      <span className="font-mono text-sm font-bold text-ink">{value}</span>
    </div>
  );
}
