import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Marquee from "react-fast-marquee";
import { api } from "../lib/api";
import { useAuth, loginRedirect } from "../lib/auth";
import VPPCard from "../components/VPPCard";
import Navbar from "../components/Navbar";
import {
  Lightning, Users, ShieldCheck, CurrencyGbp, TrendUp, Lock,
  ArrowRight, CheckCircle, Pulse, Receipt, Storefront,
} from "@phosphor-icons/react";

export default function Landing() {
  const { user } = useAuth();
  const [vpps, setVpps] = useState([]);
  const [stats, setStats] = useState({ active: 0, members: 0, savings: 0 });

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/vpps");
      setVpps(data.slice(0, 4));
      const totalMembers = data.reduce((a, v) => a + (v.participants_count || 0), 0);
      const active = data.filter(v => v.state === "active" || v.state === "locked").length;
      const savings = data.reduce((a, v) => a + (v.participants_count || 0) * Math.max(0, v.retail_price - v.customer_price), 0);
      setStats({ active, members: totalMembers, savings: Math.round(savings) });
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden border-b-2 border-ink">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute inset-0 bg-noise opacity-50 pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 border-2 border-ink bg-white px-3 py-1 mb-6 shadow-brut-sm">
              <span className="w-2 h-2 rounded-full bg-[#00C853] animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono">
                {stats.active} parties live • {stats.members} members
              </span>
            </div>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl uppercase leading-[0.9] tracking-tighter mb-6">
              Buy together.<br />
              <span className="bg-[#FFD600] inline-block px-2 -mx-2 border-2 border-ink shadow-brut my-2">Save together.</span><br />
              Power the price.
            </h1>

            <p className="text-base sm:text-lg text-[#3A3A3A] max-w-xl mb-8 leading-relaxed">
              The Collective Savers turns fragmented consumer demand into coordinated purchasing power.
              Join a <strong className="text-ink">Party</strong>, watch it fill, and the moment we hit the threshold, the price locks
              and the order ships.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <Link
                to="/browse"
                className="inline-flex items-center gap-2 bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut"
                data-testid="hero-browse-cta"
              >
                Browse Live Parties <ArrowRight weight="bold" />
              </Link>
              {!user && (
                <button
                  onClick={loginRedirect}
                  className="inline-flex items-center gap-2 bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut"
                  data-testid="hero-login-cta"
                >
                  Sign in to Join
                </button>
              )}
            </div>

            {/* Trust strip */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 max-w-md">
              {[
                { icon: ShieldCheck, label: "Locked pricing" },
                { icon: Lock, label: "Bank-grade payments" },
                { icon: CheckCircle, label: "Verified suppliers" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs font-mono uppercase tracking-tight">
                  <Icon weight="bold" size={16} className="text-[#FF5400] shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero Live Party Card — the signature MVP graphic */}
          <div className="lg:col-span-5 flex items-center">
            <LivePartyHero vpp={vpps[0]} />
          </div>
        </div>

        {/* Kinetic marquee */}
        <div className="border-t-2 border-ink bg-ink text-white py-3 overflow-hidden">
          <Marquee gradient={false} speed={40}>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="font-display text-xl sm:text-2xl uppercase tracking-tight mx-8 inline-flex items-center gap-3">
                Power the party · Lock the price · Save together
                <Lightning weight="fill" size={20} className="text-[#FF5400]" />
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="mb-10 sm:mb-14 max-w-2xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">How it works</div>
          <h2 className="font-display text-4xl sm:text-5xl uppercase leading-[0.95] tracking-tighter mb-4">
            Four steps. One locked price.
          </h2>
          <p className="text-[#3A3A3A]">
            No haggling. No coupons. Just collective demand meeting supplier capacity at the right moment.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { step: "01", icon: Users, title: "Join a Party", body: "Pick a product and commit. Free to join, no payment yet." },
            { step: "02", icon: Pulse, title: "Watch the Party Power Up", body: "More people = more buying power. Live progress, real-time." },
            { step: "03", icon: Lock, title: "Price Gets Locked", body: "Hit threshold, supplier confirms batch, price freezes." },
            { step: "04", icon: Receipt, title: "Pay & Ship", body: "Choose Card, Open Banking or Transfer. Lower fees = bigger savings." },
          ].map(({ step, icon: Icon, title, body }) => (
            <div
              key={step}
              className="bg-white border-2 border-ink p-6 shadow-brut hover-brut"
              data-testid={`how-step-${step}`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-xs font-bold tracking-widest text-[#3A3A3A]">STEP {step}</span>
                <Icon weight="duotone" size={28} className="text-[#FF5400]" />
              </div>
              <h3 className="font-display text-xl uppercase mb-2 leading-tight">{title}</h3>
              <p className="text-sm text-[#3A3A3A] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE PARTIES */}
      <section className="bg-[#F4F4F4] border-y-2 border-ink py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Live now</div>
              <h2 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">
                Parties in motion.
              </h2>
            </div>
            <Link
              to="/browse"
              className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut inline-flex items-center gap-2"
              data-testid="see-all-parties"
            >
              See all parties <ArrowRight weight="bold" size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {vpps.map(v => <VPPCard key={v.vpp_id} vpp={v} />)}
            {vpps.length === 0 && (
              <div className="col-span-full text-center text-[#3A3A3A] font-mono text-sm py-10">
                Loading parties...
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SAVINGS SNAPSHOT */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Unlock additional savings</div>
          <h2 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95] mb-5">
            Smarter rails.<br />Bigger savings.
          </h2>
          <p className="text-[#3A3A3A] mb-6 leading-relaxed">
            Some payment methods settle faster and unlock additional savings. Pick the rail that suits you — you'll see the final price up front, no surprises at checkout.
          </p>
          <div className="space-y-3">
            {[
              { method: "Apple Pay / Google Pay", note: "One-tap wallet", final: "£384", color: "#F4F4F4" },
              { method: "Debit / Credit Card", note: "Visa · Mastercard · Amex", final: "£384", color: "#F4F4F4" },
              { method: "Bank Transfer", note: "Faster Payments", final: "£382", color: "#FFD600" },
              { method: "Open Banking", note: "Recommended — instant settle", final: "£381", color: "#00C853" },
            ].map((row) => (
              <div
                key={row.method}
                className="border-2 border-ink bg-white shadow-brut-sm flex items-stretch"
              >
                <div className="px-4 py-3 flex-1">
                  <div className="font-bold uppercase text-sm">{row.method}</div>
                  <div className="font-mono text-xs text-[#3A3A3A] mt-1">{row.note}</div>
                </div>
                <div
                  className="px-5 py-3 border-l-2 border-ink font-display text-2xl flex items-center justify-center min-w-[110px]"
                  style={{ background: row.color }}
                >
                  {row.final}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 text-[10px] font-mono uppercase tracking-widest text-[#3A3A3A]">
            Example based on a £420 retail item. Actual savings vary by party.
          </div>
        </div>

        <div className="bg-ink text-white border-2 border-ink p-8 shadow-brut-lg">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Snapshot</div>
          <div className="font-display text-3xl uppercase leading-tight mb-6">
            Tonight, somewhere in the UK:
          </div>
          <div className="space-y-4 font-mono text-sm">
            <Row label="MEMBERS JOINED" val={`${stats.members}`} />
            <Row label="PARTIES LIVE" val={`${stats.active}`} />
            <Row label="COLLECTIVE SAVINGS" val={`£${stats.savings.toLocaleString()}`} />
          </div>
          <div className="border-t-2 border-white/40 mt-6 pt-6">
            <div className="text-xs uppercase tracking-widest opacity-90 mb-2">Average member saves</div>
            <div className="font-display text-5xl text-[#FFD600]">£61</div>
          </div>
        </div>
      </section>

      {/* MANIFESTO / POSITIONING */}
      <section className="border-t-2 border-ink bg-[#F4F4F4]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-4">Our principle</div>
          <blockquote className="font-display text-3xl sm:text-5xl uppercase leading-[1.05] tracking-tighter">
            <span className="text-[#3A3A3A]">"Most platforms monetise your attention.</span><br />
            The Collective Savers monetises <span className="bg-[#FFD600] px-2 -mx-2 border-2 border-ink shadow-brut inline-block my-1">collective purchasing power</span> — when members save together,
            <span className="text-[#FF5400]"> everyone wins.</span>"
          </blockquote>
        </div>
      </section>

      {/* WAITLIST / EARLY ACCESS */}
      <Waitlist />

      {/* CTA */}
      <section className="border-t-2 border-ink bg-[#FF5400] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="font-display text-5xl sm:text-7xl uppercase tracking-tighter leading-[0.9] mb-6">
            Coordinated economic<br />power. Yours.
          </h2>
          <p className="max-w-xl mx-auto mb-8 opacity-90">
            Stop overpaying for fragmented retail. Join the next party and unlock supplier-level pricing.
          </p>
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-8 py-4 text-base shadow-brut hover-brut"
            data-testid="cta-browse-bottom"
          >
            Join a party <ArrowRight weight="bold" />
          </Link>
        </div>
      </section>

      <footer className="bg-ink text-white border-t-2 border-ink">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 bg-white border-2 border-white overflow-hidden">
              <img src="https://customer-assets.emergentagent.com/job_party-power-1/artifacts/yz1zsziz_Collectivesaverslogo.png.png" alt="" className="w-full h-full object-contain p-0.5" />
            </span>
            <span className="font-display uppercase tracking-tighter">The Collective Savers™</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-widest opacity-90 flex flex-col sm:items-end gap-1">
            <span>Real-time collective purchasing infrastructure.</span>
            <a href="mailto:founder@thecollectivesavers.com" className="text-[#FFD600] hover:text-[#FF5400] underline-offset-4 hover:underline">
              founder@thecollectivesavers.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Waitlist() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {}
    setSubmitted(true);
  };
  return (
    <section className="border-t-2 border-ink bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="border-2 border-ink shadow-brut-lg p-8 sm:p-10 bg-[#FFD600]">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono mb-3">Early access</div>
          <h2 className="font-display text-3xl sm:text-5xl uppercase tracking-tighter leading-[0.95] mb-4">
            Get first dibs on the<br />next party.
          </h2>
          <p className="text-ink mb-6 max-w-xl">
            Be the first to know when a new collective unlocks in your category. No spam — just power-ups.
          </p>
          {submitted ? (
            <div className="border-2 border-ink bg-white shadow-brut-sm p-4 inline-flex items-center gap-2 font-bold uppercase tracking-wider text-sm" data-testid="waitlist-success">
              <CheckCircle weight="fill" size={20} className="text-[#00C853]" /> You're on the list — see you at the next party.
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 max-w-lg" data-testid="waitlist-form">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="flex-1 border-2 border-ink bg-white p-3 font-mono text-sm placeholder-[#3A3A3A]/50 outline-none"
                data-testid="waitlist-email-input"
              />
              <button
                type="submit"
                className="bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut whitespace-nowrap"
                data-testid="waitlist-submit"
              >
                Get Early Access
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, val }) {
  return (
    <div className="flex items-center justify-between border-b border-white/40 pb-3">
      <span className="opacity-90 text-xs tracking-widest">{label}</span>
      <span className="font-display text-2xl">{val}</span>
    </div>
  );
}

function LivePartyHero({ vpp }) {
  if (!vpp) {
    return (
      <div className="w-full bg-white border-2 border-ink shadow-brut-lg p-6">
        <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">Loading live party…</div>
      </div>
    );
  }
  const progress = Math.min(100, vpp.progress_pct ?? 0);
  return (
    <Link to={`/vpp/${vpp.vpp_id}`} className="w-full block group" data-testid="hero-live-party-card">
      <div className="bg-white border-2 border-ink shadow-brut-lg p-5 sm:p-6 relative">
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] font-mono">
            <span className="w-2 h-2 rounded-full bg-[#FF5400] animate-pulse" />
            Live · {vpp.category}
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest">PARTY</span>
        </div>
        <div className="flex gap-4 mb-4">
          <img src={vpp.image_url} alt={vpp.title} className="w-24 h-24 sm:w-28 sm:h-28 object-cover border-2 border-ink shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-xl sm:text-2xl uppercase leading-tight line-clamp-2 mb-2">{vpp.title}</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl">£{vpp.customer_price}</span>
              <span className="line-through text-[#3A3A3A] text-sm">£{vpp.retail_price}</span>
              <span className="bg-[#00C853] text-ink border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 ml-1">−{vpp.savings_pct}%</span>
            </div>
          </div>
        </div>
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] font-mono">
          <span>{vpp.participants_count}/{vpp.threshold} joined</span>
          <span>{Math.round(progress)}% power</span>
        </div>
        <div className="h-4 border-2 border-ink bg-white relative overflow-hidden mb-4">
          <div
            className="h-full"
            style={{
              width: `${progress}%`,
              background: progress >= 100 ? "#0021A5" : progress >= 75 ? "#FFD600" : "#FF5400",
              transition: "width 600ms ease",
            }}
          />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">
          Party closes soon. {Math.max(0, vpp.threshold - vpp.participants_count)} more to power.
        </div>
      </div>
    </Link>
  );
}
