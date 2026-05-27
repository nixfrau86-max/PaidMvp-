import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Wrench, CheckCircle, Calendar, MapPin, ShieldCheck, ArrowRight, Clock,
} from "@phosphor-icons/react";

const TYPES = [
  { id: "auth_repair_shop", label: "Authorised Automotive Repair Shop" },
  { id: "mobile_fitter", label: "Mobile Fitter" },
  { id: "local_garage", label: "Local Garage" },
  { id: "dealership", label: "Preferred Car Dealership" },
];

const SERVICES = [
  { id: "tyre_fitting", label: "Tyre Fitting" },
  { id: "wheel_alignment", label: "Wheel Alignment" },
  { id: "balancing", label: "Wheel Balancing" },
  { id: "tpms", label: "TPMS Reset" },
  { id: "valve_replacement", label: "Valve Replacement" },
  { id: "puncture_repair", label: "Puncture Repair" },
];

export default function GarageOnboarding() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    business_name: "",
    contact_email: "",
    contact_phone: "",
    garage_type: "local_garage",
    services: ["tyre_fitting"],
    address_line1: "",
    address_line2: "",
    city: "",
    postcode: "",
    calendar_url: "",
  });

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    (async () => {
      try {
        await api.get("/garages/me");
        navigate("/garage");
      } catch {
        setForm((f) => ({ ...f, contact_email: user.email || "" }));
      }
    })();
  }, [user, loading, navigate]);

  const toggleService = (id) => {
    setForm((f) => ({
      ...f,
      services: f.services.includes(id) ? f.services.filter((x) => x !== id) : [...f.services, id],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/garages/apply", form);
      try {
        const me = await api.get("/auth/me");
        setUser(me.data);
      } catch {}
      toast.success("Garage registered. Welcome aboard.");
      navigate("/garage");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Application failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-white"><Navbar /></div>;
  if (!user) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9] mb-4">
            Power local fitting.<br />Connect once.
          </h1>
          <p className="text-[#3A3A3A] mb-6">Sign in to register your garage on the network.</p>
          <Link to="/login?as=garage" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2">
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
        <div className="lg:col-span-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Register your Garage</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.9] mb-5">
            Local fitting,<br />nationally booked.
          </h1>
          <p className="text-[#3A3A3A] mb-8 leading-relaxed">
            Connect your calendar once. When members buy tyres through Waves, they pick your garage and book a slot directly. You collect fitting & extras at the bay.
          </p>
          <div className="space-y-3">
            <Bullet icon={Calendar} title="Calendar-led bookings" body="Paste your iCal feed — slots stay in sync." />
            <Bullet icon={Wrench} title="You collect fitting fees" body="Direct from the member. We never take a cut on labour." />
            <Bullet icon={ShieldCheck} title="Verified-business only" body="Mobile fitters, garages, repair shops, dealerships. No private addresses." />
            <Bullet icon={Clock} title="Members ready to book" body="Tyres arrive batch-confirmed — no haggling, no chasing." />
          </div>
        </div>

        <form onSubmit={submit} className="lg:col-span-3 border-2 border-ink bg-white shadow-brut-lg p-6 sm:p-8" data-testid="garage-apply-form">
          <div className="mb-6">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Garage profile</div>
            <h2 className="font-display text-3xl uppercase tracking-tighter">Tell us about your bay.</h2>
            <p className="text-xs text-[#3A3A3A] mt-1 font-mono">Calendar URL is optional now — you can add it later.</p>
          </div>

          <div className="space-y-4">
            <Field label="Business name *">
              <input required value={form.business_name} onChange={(e)=>setForm(f=>({...f,business_name:e.target.value}))} className="inp" data-testid="garage-name" placeholder="e.g. Acme Tyres Manchester" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Contact email *">
                <input required type="email" value={form.contact_email} onChange={(e)=>setForm(f=>({...f,contact_email:e.target.value}))} className="inp" />
              </Field>
              <Field label="Contact phone">
                <input value={form.contact_phone} onChange={(e)=>setForm(f=>({...f,contact_phone:e.target.value}))} className="inp" placeholder="+44..." />
              </Field>
            </div>
            <Field label="Type of business *">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TYPES.map(t => (
                  <button type="button" key={t.id} onClick={()=>setForm(f=>({...f,garage_type:t.id}))}
                    className={`border-2 border-ink p-2.5 text-left text-xs font-bold uppercase tracking-wider ${form.garage_type===t.id?"bg-[#FFD600] shadow-brut-sm":"bg-white hover:bg-[#F4F4F4]"}`}
                    data-testid={`type-${t.id}`}
                  >{t.label}</button>
                ))}
              </div>
            </Field>
            <Field label="Services offered">
              <div className="flex flex-wrap gap-2">
                {SERVICES.map(s => (
                  <button type="button" key={s.id} onClick={()=>toggleService(s.id)}
                    className={`border-2 border-ink px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono ${form.services.includes(s.id)?"bg-ink text-white":"bg-white hover:bg-[#F4F4F4]"}`}
                  >{s.label}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Address line 1 *"><input required value={form.address_line1} onChange={(e)=>setForm(f=>({...f,address_line1:e.target.value}))} className="inp" /></Field>
              <Field label="Address line 2"><input value={form.address_line2} onChange={(e)=>setForm(f=>({...f,address_line2:e.target.value}))} className="inp" /></Field>
              <Field label="City *"><input required value={form.city} onChange={(e)=>setForm(f=>({...f,city:e.target.value}))} className="inp" /></Field>
              <Field label="Postcode *"><input required value={form.postcode} onChange={(e)=>setForm(f=>({...f,postcode:e.target.value.toUpperCase()}))} className="inp" placeholder="M1 1AA" /></Field>
            </div>
            <Field label="Calendar feed URL (iCal/ICS)">
              <input value={form.calendar_url} onChange={(e)=>setForm(f=>({...f,calendar_url:e.target.value}))} className="inp" placeholder="https://calendar.google.com/calendar/ical/..." />
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-1">Paste your Google/Apple/Outlook iCal feed. Google Calendar OAuth coming soon.</div>
            </Field>
          </div>

          <button type="submit" disabled={submitting} className="mt-6 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-base shadow-brut hover-brut disabled:opacity-60 inline-flex items-center justify-center gap-2" data-testid="garage-submit">
            <Wrench weight="fill" /> {submitting ? "Submitting..." : "Register Garage"}
          </button>
          <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A] text-center">Admin verification opens fitting bookings — usually within 24h.</div>
          <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.6rem .7rem;font-family:'JetBrains Mono',monospace;font-size:.8125rem;background:#fff}`}</style>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">{label}</div>{children}</label>;
}
function Bullet({ icon: Icon, title, body }) {
  return (
    <div className="flex gap-3 border-2 border-ink bg-white shadow-brut-sm p-3">
      <div className="w-9 h-9 bg-[#FFD600] border-2 border-ink flex items-center justify-center shrink-0"><Icon weight="duotone" size={18} /></div>
      <div><div className="font-bold uppercase text-xs tracking-wider">{title}</div><div className="font-mono text-xs text-[#3A3A3A] mt-0.5">{body}</div></div>
    </div>
  );
}
