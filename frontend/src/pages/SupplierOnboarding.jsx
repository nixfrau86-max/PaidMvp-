import React, { useEffect, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Storefront, CheckCircle, ArrowRight, Lightning, ShieldCheck, Package, ChartLineUp,
} from "@phosphor-icons/react";

const CATEGORY_OPTIONS = [
  { id: "Tyres",          label: "Tyres",            sub: "Unlocks Auto Wave Engine + Product Groups" },
  { id: "Automotive",     label: "Automotive Parts", sub: "Brake pads, oils, filters, accessories" },
  { id: "Electronics",    label: "Electronics",      sub: "Consumer electronics, peripherals, audio" },
  { id: "Home",           label: "Home & Garden",    sub: "Appliances, furniture, garden goods" },
  { id: "Consumer Goods", label: "Consumer Goods",   sub: "FMCG, personal care, household" },
  { id: "Services",       label: "Services",         sub: "Installation, warranty, maintenance" },
  { id: "Other",          label: "Other",            sub: "Anything else — tell us in description" },
];

export default function SupplierOnboarding() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    business_name: "",
    contact_email: "",
    categories: [],           // multi-select tick-box (drives feature gating)
    description: "",
    logo_url: "",
  });

  const toggleCategory = (id) =>
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(id)
        ? f.categories.filter((c) => c !== id)
        : [...f.categories, id],
    }));

  useEffect(() => {
    if (loading) return;
    if (!user) return; // will show login CTA
    (async () => {
      try {
        const { data } = await api.get("/suppliers/me");
        setSupplier(data);
        // Existing supplier — pre-fill so they can edit categories (and other fields)
        setForm({
          business_name: data.business_name || "",
          contact_email: data.contact_email || user.email || "",
          categories: data.categories && data.categories.length
            ? data.categories
            : (data.category ? [data.category] : []),
          description: data.description || "",
          logo_url: data.logo_url || "",
        });
      } catch {
        // Pre-fill email
        setForm((f) => ({ ...f, contact_email: user.email || "" }));
      }
    })();
  }, [user, loading, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.categories.length === 0) {
      toast.error("Please tick at least one product category");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        business_name: form.business_name,
        contact_email: form.contact_email,
        description: form.description,
        logo_url: form.logo_url,
        category: form.categories[0],   // back-compat primary
        categories: form.categories,
      };
      let data;
      if (supplier) {
        // Existing supplier — PATCH /suppliers/me to update categories etc.
        ({ data } = await api.patch("/suppliers/me", payload));
        toast.success("Profile updated");
      } else {
        ({ data } = await api.post("/suppliers/apply", payload));
        toast.success("You're in! Your sandbox is live.");
      }
      setSupplier(data);
      // Refresh user role
      try {
        const me = await api.get("/auth/me");
        setUser(me.data);
      } catch (err) {
        console.warn("Refresh /auth/me failed", err);
      }
      navigate("/supplier");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Application failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-white"><Navbar /></div>;
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9] mb-4">
            Sell into collective demand.
          </h1>
          <p className="text-[#3A3A3A] mb-6">Sign in first to start your supplier application.</p>
          <Link
            to="/login?as=supplier"
            className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2"
            data-testid="supplier-login-cta"
          >
            Sign in to Apply <ArrowRight weight="bold" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: pitch / why */}
        <div className="lg:col-span-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Become a Supplier</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.9] mb-5">
            Aggregated demand.<br />Guaranteed batches.
          </h1>
          <p className="text-[#3A3A3A] mb-8 leading-relaxed">
            We turn fragmented consumer interest into committed batch orders. Less marketing spend, faster inventory movement, better forecasting.
          </p>
          <div className="space-y-3">
            <Bullet icon={Package} title="Batch orders, not 1-by-1" body="Every Wave is a single batch order from confirmed buyers." />
            <Bullet icon={ShieldCheck} title="Pre-validated demand" body="Wave only completes if threshold is hit. No demand risk." />
            <Bullet icon={Lightning} title="Sandbox first" body="Your first Wave goes live immediately. Get verified to unlock more." />
            <Bullet icon={ChartLineUp} title="Direct settlement (coming)" body="Stripe Connect support — funds split automatically once live." />
          </div>
        </div>

        {/* Right: application form */}
        <form onSubmit={submit} className="lg:col-span-3 border-2 border-ink bg-white shadow-brut-lg p-6 sm:p-8" data-testid="supplier-apply-form">
          <div className="mb-6">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Step 1 of 3 · Light info</div>
            <h2 className="font-display text-3xl uppercase tracking-tighter">Tell us about your business.</h2>
            <p className="text-xs text-[#3A3A3A] mt-1 font-mono">You can add VAT & bank details later to upgrade your tier.</p>
          </div>
          <div className="space-y-4">
            <Field label="Business name *">
              <input
                required value={form.business_name}
                onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                className="w-full border-2 border-ink p-3 font-mono text-sm"
                placeholder="e.g. TyreDirect UK"
                data-testid="apply-business-name"
              />
            </Field>
            <Field label="Contact email *">
              <input
                required type="email" value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                className="w-full border-2 border-ink p-3 font-mono text-sm"
                data-testid="apply-contact-email"
              />
            </Field>
            <Field label="What do you sell? * (tick all that apply)">
              <div className="grid sm:grid-cols-2 gap-2" data-testid="apply-categories">
                {CATEGORY_OPTIONS.map((c) => {
                  const checked = form.categories.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-start gap-3 border-2 border-ink p-3 cursor-pointer transition-all ${checked ? "bg-ink text-white shadow-brut-sm" : "bg-white hover-brut shadow-brut-sm"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(c.id)}
                        className="mt-0.5 w-4 h-4 accent-[#FF5400]"
                        data-testid={`apply-cat-${c.id.toLowerCase().replace(/[^a-z]/g, "")}`}
                      />
                      <div className="flex-1">
                        <div className="font-bold uppercase text-xs tracking-widest font-mono flex items-center gap-2">
                          {c.label}
                          {c.id === "Tyres" && (
                            <span className={`px-1.5 py-0.5 text-[9px] tracking-wider ${checked ? "bg-[#FF5400] text-white" : "bg-[#FF5400] text-white"}`}>
                              Auto Engine
                            </span>
                          )}
                        </div>
                        <div className={`text-[10px] font-mono mt-0.5 ${checked ? "text-white/70" : "text-[#3A3A3A]"}`}>{c.sub}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A]">
                Non-tyre suppliers won't see the Tyre Product Groups section.
              </div>
            </Field>
            <Field label="Short description *">
              <textarea
                required value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full border-2 border-ink p-3 font-mono text-sm" rows={3}
                placeholder="What you sell, where you deliver, why buyers should trust you."
                data-testid="apply-description"
              />
            </Field>
            <Field label="Logo URL (optional)">
              <input
                value={form.logo_url}
                onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
                className="w-full border-2 border-ink p-3 font-mono text-sm"
                placeholder="https://..."
                data-testid="apply-logo"
              />
            </Field>
          </div>
          <button
            type="submit" disabled={submitting}
            className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut disabled:opacity-60 inline-flex items-center justify-center gap-2"
            data-testid="apply-submit"
          >
            <Storefront weight="fill" /> {submitting ? "Saving..." : (supplier ? "Save Profile" : "Open My Sandbox")}
          </button>
          <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A] text-center">
            By applying you accept the supplier terms · No fees to list
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Bullet({ icon: Icon, title, body }) {
  return (
    <div className="flex gap-3 border-2 border-ink bg-white shadow-brut-sm p-3">
      <div className="w-9 h-9 bg-[#FFD600] border-2 border-ink flex items-center justify-center shrink-0">
        <Icon weight="duotone" size={18} />
      </div>
      <div>
        <div className="font-bold uppercase text-xs tracking-wider">{title}</div>
        <div className="font-mono text-xs text-[#3A3A3A] mt-0.5">{body}</div>
      </div>
    </div>
  );
}
