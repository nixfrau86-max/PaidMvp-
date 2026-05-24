import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  CreditCard, Bank, ArrowsLeftRight, Lock, ShieldCheck, DeviceMobile, Sparkle,
} from "@phosphor-icons/react";

const METHODS = [
  {
    id: "apple_pay",
    label: "Apple Pay / Google Pay",
    sub: "One-tap wallet checkout",
    rate: 0,
    icon: DeviceMobile,
    recommended: false,
  },
  {
    id: "card",
    label: "Debit / Credit Card",
    sub: "Visa · Mastercard · Amex",
    rate: 0,
    icon: CreditCard,
    recommended: false,
  },
  {
    id: "open_banking",
    label: "Open Banking",
    sub: "Direct from your bank · Instant settle",
    rate: 0.01,
    icon: Bank,
    recommended: true,
  },
  {
    id: "bank_transfer",
    label: "Bank Transfer",
    sub: "Faster Payments · 1–3 hours",
    rate: 0.005,
    icon: ArrowsLeftRight,
    recommended: false,
  },
];

export default function Checkout() {
  const { vppId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [vpp, setVpp] = useState(null);
  const [method, setMethod] = useState("open_banking"); // default to recommended
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    (async () => {
      const { data } = await api.get(`/vpps/${vppId}`);
      setVpp(data);
      if (data.has_paid) {
        toast.info("You've already confirmed this party.");
        navigate("/dashboard");
      }
    })();
  }, [vppId, user, loading, navigate]);

  const handlePay = async () => {
    setSubmitting(true);
    try {
      // Apple Pay flows through Stripe card rail
      const apiMethod = method === "apple_pay" ? "card" : method;
      const { data } = await api.post("/checkout/init", {
        vpp_id: vppId,
        payment_method: apiMethod,
        origin_url: window.location.origin,
      });
      if (apiMethod === "card" && data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        toast("Authorising via " + (method === "open_banking" ? "Open Banking..." : "Bank Transfer..."));
        await new Promise(r => setTimeout(r, 1200));
        await api.post(`/checkout/mock-confirm/${data.session_id}`);
        toast.success("Order confirmed!");
        navigate(`/checkout/success?vpp_id=${vppId}&session_id=${data.session_id}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Checkout error");
      setSubmitting(false);
    }
  };

  if (!vpp) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 font-mono uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  const collectivePrice = vpp.customer_price;
  const retail = vpp.retail_price;
  const m = METHODS.find(x => x.id === method);
  const additionalSavings = +(collectivePrice * m.rate).toFixed(2);
  const finalPrice = +(collectivePrice - additionalSavings).toFixed(2);
  const totalSavings = +(retail - finalPrice).toFixed(2);

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
            Your payment method is reserved now. We only charge when the party powers up and the price locks.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Payment methods */}
          <div className="lg:col-span-3 space-y-5">
            <div className="border-2 border-ink bg-white shadow-brut p-6">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Choose payment method</div>
              <div className="space-y-3">
                {METHODS.map((opt) => {
                  const Icon = opt.icon;
                  const active = method === opt.id;
                  const methodPrice = +(collectivePrice - collectivePrice * opt.rate).toFixed(2);
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
                            <span className="inline-flex items-center gap-1 bg-[#00C853] text-ink border-2 border-ink font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5">
                              <Sparkle weight="fill" size={9} />Recommended
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-[#3A3A3A] mt-0.5">{opt.sub}</div>
                        {opt.rate > 0 && (
                          <div className="font-mono text-[10px] text-[#00C853] font-bold uppercase tracking-widest mt-1">
                            Unlock additional savings
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Final Price</div>
                        <div className="font-display text-2xl">£{methodPrice.toFixed(2)}</div>
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

          {/* Order summary — no fees, no discounts, only savings */}
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

              <div className="space-y-2.5">
                <Row label="Retail Price" value={`£${retail.toFixed(2)}`} strike />
                <Row label="Today's Collective Price" value={`£${finalPrice.toFixed(2)}`} bold />
              </div>

              <div className="border-t-2 border-ink my-4" />

              <div className="bg-[#00C853] border-2 border-ink p-4 -mx-1 shadow-brut-sm">
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">You Save</div>
                <div className="font-display text-4xl leading-none">£{totalSavings.toFixed(2)}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest mt-1">
                  {Math.round((totalSavings / retail) * 100)}% off retail
                </div>
              </div>

              <button
                onClick={handlePay}
                disabled={submitting}
                className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="pay-now-btn"
              >
                <Lock weight="fill" /> {submitting ? "Processing..." : `Confirm Order · £${finalPrice.toFixed(2)}`}
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

function Row({ label, value, bold, strike }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-sm ${bold ? "font-bold uppercase tracking-wider" : "text-[#3A3A3A]"}`}>{label}</span>
      <span className={`${bold ? "font-display text-2xl" : "font-mono text-sm"} ${strike ? "line-through text-[#3A3A3A]" : ""}`}>{value}</span>
    </div>
  );
}
