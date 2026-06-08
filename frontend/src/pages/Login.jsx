import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth, loginRedirect } from "../lib/auth";
import {
  Storefront, User, GoogleLogo, Envelope, DeviceMobile, ArrowRight, ArrowLeft,
  ShieldCheck, Lock, Wrench,
} from "@phosphor-icons/react";

export default function Login() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialIntent = searchParams.get("as") || ""; // "supplier" or "consumer" or empty
  const initialMode = searchParams.get("mode") || "signin"; // signin | signup
  const [intent, setIntent] = useState(initialIntent);
  const [tab, setTab] = useState("google"); // google | email | sms
  const [mode, setMode] = useState(initialMode);

  // If already logged in, route based on intent
  useEffect(() => {
    if (!user) return;
    if (user.role === "admin") navigate("/admin");
    else if (intent === "supplier") navigate("/supplier");
    else if (intent === "garage") navigate("/garage");
    else navigate("/dashboard");
  }, [user, intent, navigate]);

  const goAfterLogin = () => {
    if (intent === "supplier") navigate("/supplier/onboarding");
    else if (intent === "garage") navigate("/garage/onboarding");
    else navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {!intent ? (
          <ChooseIntent onPick={setIntent} />
        ) : (
          <>
            <button
              onClick={() => setIntent("")}
              className="text-xs font-mono uppercase tracking-widest text-[#3A3A3A] hover:text-ink mb-4 inline-flex items-center gap-1"
              data-testid="back-to-chooser"
            >
              <ArrowLeft size={12} weight="bold" /> Change account type
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
              <div className="lg:col-span-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">
                  {intent === "supplier" ? "Supplier Login" : intent === "garage" ? "Garage Login" : "Member Login"}
                </div>
                <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.9] mb-4">
                  {intent === "supplier" ? "List into demand." : intent === "garage" ? "Local fitting,\nnetwork-booked." : "Power the price."}
                </h1>
                <p className="text-[#3A3A3A] mb-6">
                  {intent === "supplier"
                    ? "Sign in, then complete a 60-second application to launch your first Wave."
                    : intent === "garage"
                    ? "Sign in to register your bay. Connect your calendar once."
                    : "Sign in to join Waves, track savings, and confirm orders."}
                </p>
                <div className="space-y-2">
                  <Bullet icon={ShieldCheck} text="Bank-grade encryption" />
                  <Bullet icon={Lock} text="One identity across all devices" />
                </div>
                <div className="mt-8 text-xs font-mono uppercase tracking-widest text-[#3A3A3A]">
                  {mode === "signin" ? "No account yet?" : "Have an account?"}{" "}
                  <button
                    onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                    className="text-[#FF5400] underline-offset-4 hover:underline font-bold"
                    data-testid="toggle-mode"
                  >
                    {mode === "signin" ? "Create one" : "Sign in instead"}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-3">
                <div className="border-2 border-ink bg-white shadow-brut-lg p-6 sm:p-8">
                  {/* Method tabs */}
                  <div className="border-2 border-ink mb-6 flex" data-testid="auth-method-tabs">
                    {[
                      { id: "google", label: "Google", icon: GoogleLogo },
                      { id: "email", label: "Email", icon: Envelope },
                      { id: "sms", label: "SMS", icon: DeviceMobile },
                    ].map((t) => {
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTab(t.id)}
                          className={`flex-1 px-4 py-3 text-[11px] font-bold uppercase tracking-widest font-mono border-r-2 border-ink last:border-r-0 inline-flex items-center justify-center gap-1.5 ${tab === t.id ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
                          data-testid={`tab-${t.id}`}
                        >
                          <Icon weight="bold" size={14} /> {t.label}
                        </button>
                      );
                    })}
                  </div>

                  {tab === "google" && <GoogleTab />}
                  {tab === "email" && <EmailTab mode={mode} onSuccess={goAfterLogin} />}
                  {tab === "sms" && <SmsTab onSuccess={goAfterLogin} />}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChooseIntent({ onPick }) {
  return (
    <div>
      <div className="text-center mb-10">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Welcome</div>
        <h1 className="font-display text-5xl sm:text-7xl uppercase tracking-tighter leading-[0.9] mb-4">
          Who are you<br />signing in as?
        </h1>
        <p className="text-[#3A3A3A] max-w-xl mx-auto">
          We tailor the experience to consumers joining Waves and suppliers running batches.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        <button
          onClick={() => onPick("consumer")}
          className="border-2 border-ink bg-white shadow-brut-lg hover-brut p-7 text-left group"
          data-testid="intent-consumer"
        >
          <div className="w-12 h-12 bg-[#FFD600] border-2 border-ink flex items-center justify-center mb-5">
            <User weight="duotone" size={24} />
          </div>
          <div className="font-display text-2xl uppercase mb-2">I&apos;m a Member</div>
          <p className="text-sm text-[#3A3A3A] mb-4">
            Browse and join Waves to unlock collective pricing.
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#FF5400]">
            Continue <ArrowRight weight="bold" size={14} />
          </span>
        </button>

        <button
          onClick={() => onPick("supplier")}
          className="border-2 border-ink bg-ink text-white shadow-brut-lg hover-brut p-7 text-left group"
          data-testid="intent-supplier"
        >
          <div className="w-12 h-12 bg-[#FF5400] border-2 border-white flex items-center justify-center mb-5">
            <Storefront weight="duotone" size={24} />
          </div>
          <div className="font-display text-2xl uppercase mb-2">I&apos;m a Supplier</div>
          <p className="text-sm text-white/85 mb-4">
            Sell into pre-confirmed batch demand. Your first Wave goes live instantly.
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#FFD600]">
            Continue <ArrowRight weight="bold" size={14} />
          </span>
        </button>

        <button
          onClick={() => onPick("garage")}
          className="border-2 border-ink bg-[#FF5400] text-white shadow-brut-lg hover-brut p-7 text-left group"
          data-testid="intent-garage"
        >
          <div className="w-12 h-12 bg-white border-2 border-ink flex items-center justify-center mb-5">
            <Wrench weight="duotone" size={24} />
          </div>
          <div className="font-display text-2xl uppercase mb-2">I&apos;m a Garage</div>
          <p className="text-sm text-white/95 mb-4">
            Register your bay. Receive fitting bookings from Wave members.
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#FFD600]">
            Continue <ArrowRight weight="bold" size={14} />
          </span>
        </button>
      </div>
    </div>
  );
}

function GoogleTab() {
  return (
    <div className="text-center py-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mb-5">
        Continue with your Google account
      </p>
      <button
        onClick={loginRedirect}
        className="w-full bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-sm shadow-brut hover-brut inline-flex items-center justify-center gap-2"
        data-testid="google-signin-btn"
      >
        <GoogleLogo weight="bold" size={18} /> Continue with Google
      </button>
      <div className="mt-5 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A]">
        Apple Sign In coming soon
      </div>
    </div>
  );
}

function EmailTab({ mode, onSuccess }) {
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const endpoint = mode === "signup" ? "/auth/register" : "/auth/login";
      const payload = mode === "signup" ? { email, password, name } : { email, password };
      const { data } = await api.post(endpoint, payload);
      setUser(data.user);
      toast.success(mode === "signup" ? "Welcome aboard ⚡" : "Welcome back");
      onSuccess();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="email-auth-form">
      {mode === "signup" && (
        <Field label="Full name">
          <input
            required type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="inp" placeholder="Alex Smith"
            data-testid="email-name"
          />
        </Field>
      )}
      <Field label="Email">
        <input
          required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="inp" placeholder="you@example.com" autoComplete="email"
          data-testid="email-email"
        />
      </Field>
      <Field label="Password">
        <input
          required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="inp" minLength={8} placeholder="At least 8 characters"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          data-testid="email-password"
        />
      </Field>
      <button type="submit" disabled={submitting} className="w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut disabled:opacity-60" data-testid="email-submit">
        {submitting ? "..." : mode === "signup" ? "Create Account" : "Sign In"}
      </button>
      <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.65rem .75rem;font-family:'JetBrains Mono',monospace;font-size:.85rem;background:#fff}`}</style>
    </form>
  );
}

function SmsTab({ onSuccess }) {
  const { setUser } = useAuth();
  const [phone, setPhone] = useState("+44");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [devHint, setDevHint] = useState("");

  const requestOtp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/sms/request-otp", { phone });
      setStep(2);
      if (data.dev_mode) setDevHint("DEV mode: check backend logs for code (Twilio not configured)");
      toast.success("Code sent — check your messages.");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not send code");
    } finally { setSubmitting(false); }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/sms/verify-otp", { phone, code, name: name || undefined });
      setUser(data.user);
      toast.success("Signed in ⚡");
      onSuccess();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not verify");
    } finally { setSubmitting(false); }
  };

  return (
    <div data-testid="sms-auth-form">
      {step === 1 ? (
        <form onSubmit={requestOtp} className="space-y-4">
          <Field label="Mobile number (with country code)">
            <input
              required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+447900123456" className="inp" pattern="^\+[1-9]\d{6,14}$"
              data-testid="sms-phone"
            />
          </Field>
          <Field label="Display name (optional, first sign-up only)">
            <input value={name} onChange={(e) => setName(e.target.value)} className="inp" placeholder="Alex Smith" data-testid="sms-name" />
          </Field>
          <button type="submit" disabled={submitting} className="w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut disabled:opacity-60" data-testid="sms-request">
            {submitting ? "..." : "Send Code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mb-1">
            Code sent to {phone}
          </div>
          <Field label="6-digit code">
            <input
              required type="text" value={code} onChange={(e) => setCode(e.target.value)}
              maxLength={6} minLength={4} className="inp font-display text-2xl text-center tracking-[0.5em]"
              placeholder="••••••" data-testid="sms-code"
            />
          </Field>
          {devHint && <div className="font-mono text-[10px] uppercase tracking-widest bg-[#FFD600] border-2 border-ink p-2">{devHint}</div>}
          <button type="submit" disabled={submitting} className="w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut disabled:opacity-60" data-testid="sms-verify">
            {submitting ? "..." : "Verify & Sign In"}
          </button>
          <button type="button" onClick={() => setStep(1)} className="w-full text-xs font-mono uppercase tracking-widest text-[#3A3A3A] hover:text-ink">
            ← Change number
          </button>
        </form>
      )}
      <style>{`.inp{width:100%;border:2px solid #0A0A0A;padding:.65rem .75rem;font-family:'JetBrains Mono',monospace;font-size:.85rem;background:#fff}`}</style>
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

function Bullet({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-tight">
      <Icon weight="bold" size={14} className="text-[#FF5400]" /> {text}
    </div>
  );
}
