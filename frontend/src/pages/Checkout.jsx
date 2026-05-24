import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CreditCard, Bank, ArrowsLeftRight, Lock, ShieldCheck, CheckCircle } from "@phosphor-icons/react";

const METHODS = [
  { id: "card", label: "Card", sub: "Visa · Mastercard · Apple Pay", discount: 0, icon: CreditCard },
  { id: "open_banking", label: "Open Banking", sub: "Direct from your bank · Instant", discount: 3, icon: Bank },
  { id: "bank_transfer", label: "Bank Transfer", sub: "Faster Payments · 1-3 hours", discount: 2, icon: ArrowsLeftRight },
];

export default function Checkout() {
  const { vppId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [vpp, setVpp] = useState(null);
  const [method, setMethod] = useState("card");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    (async () => {
      const { data } = await api.get(`/vpps/${vppId}`);
      setVpp(data);
      if (data.has_paid) {
        toast.info("You've already paid for this party.");
        navigate("/dashboard");
      }
    })();
  }, [vppId, user, navigate]);

  const handlePay = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.post("/checkout/init", {
        vpp_id: vppId,
        payment_method: method,
        origin_url: window.location.origin,
      });
      if (method === "card" && data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        // Mock confirm for Open Banking / Bank Transfer
        toast("Authorising via " + (method === "open_banking" ? "Open Banking..." : "Bank Transfer..."));
        await new Promise(r => setTimeout(r, 1200));
        await api.post(`/checkout/mock-confirm/${data.session_id}`);
        toast.success("Payment confirmed!");
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

  const m = METHODS.find(x => x.id === method);
  const basePrice = vpp.customer_price;
  const discountPct = m.discount;
  const discountAmt = +(basePrice * (discountPct / 100)).toFixed(2);
  const finalPrice = +(basePrice - discountAmt).toFixed(2);

  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Secure Checkout</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">
            Lock your savings.
          </h1>
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
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setMethod(opt.id)}
                      className={`w-full border-2 border-ink p-4 flex items-center gap-4 text-left ${active ? "bg-[#FFD600] shadow-brut-sm" : "bg-white hover:bg-[#FAFAFA]"}`}
                      data-testid={`pm-${opt.id}`}
                    >
                      <div className="w-12 h-12 border-2 border-ink bg-white flex items-center justify-center shrink-0">
                        <Icon weight="duotone" size={24} />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold uppercase tracking-wider text-sm">{opt.label}</div>
                        <div className="font-mono text-xs text-[#525252] mt-0.5">{opt.sub}</div>
                      </div>
                      {opt.discount > 0 ? (
                        <div className="bg-[#00C853] text-ink border-2 border-ink font-mono text-xs font-bold uppercase tracking-widest px-2 py-1">
                          −{opt.discount}%
                        </div>
                      ) : (
                        <div className="bg-[#F4F4F4] border-2 border-ink font-mono text-xs uppercase tracking-widest px-2 py-1">Baseline</div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#525252]">
                <ShieldCheck weight="bold" size={14} className="text-[#FF5400]" />
                Payment-method discounts pass our savings on processing fees directly to you.
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="lg:col-span-2">
            <div className="border-2 border-ink bg-white shadow-brut p-6 sticky top-24">
              <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-4">Order summary</div>
              <div className="flex gap-3 mb-4 pb-4 border-b-2 border-ink">
                <img src={vpp.image_url} alt={vpp.title} className="w-16 h-16 border-2 border-ink object-cover" />
                <div className="min-w-0">
                  <div className="font-display text-lg uppercase line-clamp-2 leading-tight">{vpp.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[#525252] mt-1">{vpp.supplier_name}</div>
                </div>
              </div>
              <Row label="Party Price" value={`£${basePrice.toFixed(2)}`} />
              <Row label={`${m.label} discount`} value={discountAmt > 0 ? `− £${discountAmt.toFixed(2)}` : "£0.00"} highlight={discountAmt > 0} />
              <div className="border-t-2 border-ink my-3" />
              <Row label="Total" value={`£${finalPrice.toFixed(2)}`} bold />
              <button
                onClick={handlePay}
                disabled={submitting}
                className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="pay-now-btn"
              >
                <Lock weight="fill" /> {submitting ? "Processing..." : `Pay £${finalPrice.toFixed(2)}`}
              </button>
              <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[#525252] text-center">
                Encrypted · Locked Price · No Surprise Fees
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, highlight }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${bold ? "font-bold uppercase tracking-wider" : "text-[#525252]"}`}>{label}</span>
      <span className={`${bold ? "font-display text-2xl" : "font-mono text-sm font-bold"} ${highlight ? "text-[#00C853]" : ""}`}>{value}</span>
    </div>
  );
}
