import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  CreditCard, Bank, ArrowsLeftRight, Lock, ShieldCheck, DeviceMobile, Sparkle, Wrench, AppleLogo, GoogleLogo,
} from "@phosphor-icons/react";

// Local UI metadata. Backend owns labels/fees/order/recommended/enabled.
const METHOD_ICON = {
  open_banking: Bank,
  apple_pay: AppleLogo,
  google_pay: GoogleLogo,
  card: CreditCard,
  bank_transfer: ArrowsLeftRight,
};

export default function Checkout() {
  const { vppId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [quote, setQuote] = useState(null);
  const [method, setMethod] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    (async () => {
      try {
        const { data } = await api.get(`/checkout/quote/${vppId}`);
        setQuote(data);
        const recommended = data.payment_methods.find(m => m.recommended) || data.payment_methods[0];
        setMethod(recommended.id);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load checkout");
        navigate("/dashboard");
      }
    })();
  }, [vppId, user, loading, navigate]);

  const selected = useMemo(
    () => quote?.payment_methods.find(m => m.id === method),
    [quote, method]
  );

  const handlePay = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const body = { vpp_id: vppId, payment_method: method, origin_url: window.location.origin };
      const { data } = await api.post("/checkout/init", body);
      // Card / Apple Pay / Google Pay → Stripe Checkout (wallet auto-detected).
      const stripeRails = new Set(["card", "apple_pay", "google_pay"]);
      if (stripeRails.has(method) && data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        const friendly = method === "open_banking" ? "Open Banking" : "Bank Transfer";
        toast(`Authorising via ${friendly}...`);
        await new Promise(r => setTimeout(r, 900));
        await api.post(`/checkout/mock-confirm/${data.session_id}`);
        toast.success("Order confirmed!");
        navigate(`/checkout/success?vpp_id=${vppId}&session_id=${data.session_id}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Checkout error");
      setSubmitting(false);
    }
  };

  if (!quote || !selected) {
    return (
      <div className="min-h-screen bg-[#F4F4F4]">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  const { vpp, service_fee } = quote;
  const cat = (vpp.category || "").toLowerCase();
  const isAutomotive = cat === "tyres" || cat === "automotive";
  const savingsPct = vpp.retail_price > 0 ? Math.round((selected.total_savings / vpp.retail_price) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Confirm Your Order</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">
            Lock your savings.
          </h1>
          <p className="text-[#3A3A3A] mt-2 text-sm">
            Your payment method is reserved now. We only charge when the wave powers up and the price locks.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-5">
            {isAutomotive && (
              <div className="border-2 border-ink bg-white shadow-brut p-5" data-testid="fitter-notice">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 border-2 border-ink bg-[#FFD600] flex items-center justify-center shrink-0">
                    <Wrench weight="duotone" size={20} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#FF5400] mb-1">Fitting included</div>
                    <h3 className="font-display text-lg uppercase leading-tight">Pick your fitter once the Wave locks.</h3>
                    <p className="text-xs text-[#3A3A3A] mt-1 font-mono">
                      For safety + insurance reasons, tyres ship to a verified garage — never to a private address.
                      As soon as this Wave locks, we'll email you a link to choose a local fitter and a slot that suits you.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-2 border-ink bg-white shadow-brut p-6" data-testid="payment-method-list">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Choose payment method</div>
              <div className="space-y-3">
                {quote.payment_methods.map((opt) => {
                  const Icon = METHOD_ICON[opt.id] || DeviceMobile;
                  const active = method === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setMethod(opt.id)}
                      className={`w-full border-2 border-ink p-4 flex items-center gap-4 text-left transition-all ${active ? "bg-white shadow-brut-sm ring-4 ring-[#FFD600] ring-offset-0" : "bg-white hover:bg-[#FAFAFA]"}`}
                      data-testid={`pm-${opt.id}`}
                    >
                      <div className="w-12 h-12 border-2 border-ink bg-white flex items-center justify-center shrink-0">
                        <Icon weight="duotone" size={24} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold uppercase tracking-wider text-sm">{opt.label}</span>
                          {opt.recommended && (
                            <span className="inline-flex items-center gap-1 bg-[#00C853] text-ink border-2 border-ink font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5" data-testid="recommended-badge">
                              <Sparkle weight="fill" size={9} />Recommended — maximise savings
                            </span>
                          )}
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
                <ShieldCheck weight="bold" size={14} className="text-[#FF5400]" />
                Locked price · Pre-authorised · Captured only on power-up.
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="border-2 border-ink bg-white shadow-brut p-6 sticky top-24">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Order summary</div>
              <div className="flex gap-3 mb-5 pb-4 border-b-2 border-ink">
                <img src={vpp.image_url} alt={vpp.title} className="w-16 h-16 border-2 border-ink object-cover" />
                <div className="min-w-0">
                  <div className="font-display text-lg uppercase line-clamp-2 leading-tight">{vpp.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-1">{vpp.supplier_name}</div>
                </div>
              </div>

              <div className="space-y-2" data-testid="order-summary-lines">
                <Row label="Retail Price" value={`£${vpp.retail_price.toFixed(2)}`} strike />
                <Row label="Wave Price" value={`£${vpp.wave_price.toFixed(2)}`} testid="row-wave-price" />
                <Row label="Platform Service Fee" value={`+£${service_fee.toFixed(2)}`} testid="row-service-fee" />
                <Row label="Payment Method Fee" value={selected.fee > 0 ? `+£${selected.fee.toFixed(2)}` : "£0.00"} testid="row-payment-fee" />
              </div>

              <div className="border-t-2 border-ink mt-4 pt-4 flex items-baseline justify-between" data-testid="row-final-total">
                <span className="font-bold uppercase tracking-wider text-sm">Final Total</span>
                <span className="font-display text-3xl">£{selected.final_total.toFixed(2)}</span>
              </div>

              <div className="mt-4 bg-[#00C853] border-2 border-ink p-4 shadow-brut-sm" data-testid="you-save-block">
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">You Save</div>
                <div className="font-display text-4xl leading-none">£{selected.total_savings.toFixed(2)}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest mt-1">
                  {savingsPct}% off retail
                </div>
              </div>

              <button
                onClick={handlePay}
                disabled={submitting}
                className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="pay-now-btn"
              >
                <Lock weight="fill" /> {submitting ? "Processing..." : `Confirm · £${selected.final_total.toFixed(2)}`}
              </button>
              <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A] text-center">
                Bank-grade encryption · Cancel before lock
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strike, testid }) {
  return (
    <div className="flex items-center justify-between py-1" data-testid={testid}>
      <span className="text-sm text-[#3A3A3A]">{label}</span>
      <span className={`font-mono text-sm ${strike ? "line-through text-[#3A3A3A]" : "font-bold text-ink"}`}>{value}</span>
    </div>
  );
}
