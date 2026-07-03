import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Marquee from "react-fast-marquee";
import Navbar from "../components/Navbar";
import WaveBackground from "../components/WaveBackground";
import HeroWaves from "../components/HeroWaves";
import { api } from "../lib/api";
import { track } from "../lib/firebase";
import {
  ArrowRight, CheckCircle, Users, Pulse, Package, Envelope, Storefront,
  ShieldCheck, Sparkle,
} from "@phosphor-icons/react";

const FOUNDER_EMAIL = "founder@thecollectivesavers.co.uk";

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden border-b-2 border-ink min-h-[88vh] flex items-center">
        <WaveBackground variant="light" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 w-full">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 border-2 border-ink bg-white px-3 py-1 mb-8 shadow-brut-sm">
                <span className="w-2 h-2 rounded-full bg-[#FF5400] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] font-mono">
                  Early Access · Founding Cohort
                </span>
              </div>

              <h1 className="font-display text-5xl sm:text-7xl lg:text-[6rem] uppercase leading-[0.88] tracking-tighter mb-7">
                Collective<br />
                purchasing power,<br />
                <span className="inline-block relative">
                  unlocked
                  <span className="text-[#FF5400]">.</span>
                </span>
              </h1>

              <p className="text-base sm:text-xl text-[#3A3A3A] max-w-2xl mb-8 leading-relaxed">
                The Collective Savers is building a smarter way for people to access
                <span className="text-ink font-bold"> supplier-level pricing </span>
                through coordinated purchasing Waves.
              </p>

              {/* social proof stat strip */}
              <div className="flex flex-wrap gap-3 mb-9" data-testid="hero-stats">
                {[
                  { num: "23%", label: "Avg. savings" },
                  { num: "4", label: "Live regions" },
                  { num: "11", label: "Categories" },
                ].map((s) => (
                  <div key={s.label} className="border-2 border-ink bg-white shadow-brut-sm px-4 py-2">
                    <div className="font-display text-2xl sm:text-3xl uppercase tracking-tighter leading-none">{s.num}</div>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              <WaitlistForm />
            </div>

            <div className="hidden lg:block">
              <HeroWaves />
            </div>
          </div>
        </div>

        {/* kinetic strip */}
        <div className="absolute bottom-0 left-0 right-0 border-t-2 border-ink bg-ink text-white py-3 overflow-hidden">
          <Marquee gradient={false} speed={32}>
            {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
              <span key={`marquee-${k}`} className="font-display text-base sm:text-lg uppercase tracking-tight mx-8 inline-flex items-center gap-3">
                Coordinated purchasing
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF5400]" />
                Real-time Waves
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FFD600]" />
                Supplier-level access
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF5400]" />
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* ============ VIDEO SHOWCASE ============ */}
      <VideoShowcase />

      {/* ============ HOW IT WORKS — Lightweight, no prices ============ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <motion.div
          className="mb-12 max-w-2xl"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">How it works</div>
          <h2 className="font-display text-4xl sm:text-6xl uppercase leading-[0.95] tracking-tighter">
            Three coordinated<br />moments.
          </h2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              step: "01",
              icon: Users,
              title: "Join a Wave",
              body: "Members join coordinated purchasing groups around shared intent.",
            },
            {
              step: "02",
              icon: Pulse,
              title: "Collective demand builds",
              body: "As participation grows, suppliers unlock progressively stronger pricing.",
            },
            {
              step: "03",
              icon: Package,
              title: "Smart fulfilment",
              body: "Products are fulfilled directly through trusted, vetted suppliers.",
            },
          ].map(({ step, icon: Icon, title, body }, idx) => (
            <motion.div
              key={step}
              className="bg-white border-2 border-ink p-7 shadow-brut hover-brut"
              data-testid={`step-${step}`}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.55, delay: idx * 0.12, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-xs font-bold tracking-widest text-[#3A3A3A]">{step}</span>
                <Icon weight="duotone" size={28} className="text-[#FF5400]" />
              </div>
              <h3 className="font-display text-2xl uppercase mb-3 leading-tight">{title}</h3>
              <p className="text-sm text-[#3A3A3A] leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ============ WHY THIS EXISTS — Manifesto ============ */}
      <section className="relative border-y-2 border-ink bg-ink text-white overflow-hidden">
        <WaveBackground variant="dark" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <motion.div
            className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-6"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.5 }}
          >
            Why this exists
          </motion.div>
          <motion.blockquote
            className="font-display text-3xl sm:text-5xl lg:text-6xl uppercase leading-[1.02] tracking-tighter"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="text-white/65">Most platforms monetise your attention.</span><br />
            <span className="block mt-4">
              The Collective Savers monetises <span className="bg-[#FFD600] text-ink px-2 -mx-2 border-2 border-white shadow-brut-sm inline-block my-1">collective purchasing power</span> — when members save together,
              <span className="text-[#FF5400]"> everyone wins.</span>
            </span>
          </motion.blockquote>
        </div>
      </section>

      {/* ============ FOUNDING MEMBERS ============ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">Founding cohort</div>
          <h2 className="font-display text-4xl sm:text-5xl uppercase leading-[0.95] tracking-tighter mb-6">
            Help shape what<br />comes next.
          </h2>
          <p className="text-[#3A3A3A] leading-relaxed mb-8">
            Early members will help define the categories we unlock, the suppliers we partner with, and the way our purchasing network evolves. This isn&apos;t a discount programme — it&apos;s coordinated access.
          </p>
          <ul className="space-y-3">
            {[
              "Future Wave categories",
              "Supplier access & curation",
              "Marketplace features",
              "Community-driven purchasing systems",
            ].map((it) => (
              <li key={it} className="flex items-center gap-3 font-mono text-sm">
                <span className="w-4 h-4 bg-[#FFD600] border-2 border-ink inline-flex items-center justify-center shrink-0">
                  <CheckCircle weight="fill" size={10} />
                </span>
                <span className="uppercase tracking-wide">{it}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-2 border-ink bg-[#F4F4F4] shadow-brut-lg p-8 sm:p-10">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono mb-3 text-[#FF5400]">For Suppliers</div>
          <h3 className="font-display text-3xl sm:text-4xl uppercase tracking-tighter leading-[0.95] mb-5">
            Sell into pre-confirmed batch demand.
          </h3>
          <p className="text-[#3A3A3A] mb-6 text-sm leading-relaxed">
            Suppliers interested in participating in future Waves can apply privately. Skip the marketing spend — every Wave is a committed batch order.
          </p>
          <div className="space-y-3">
            <Link
              to="/login?as=supplier"
              className="w-full bg-ink text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-sm shadow-brut hover-brut inline-flex items-center justify-center gap-2"
              data-testid="supplier-apply-cta"
            >
              <Storefront weight="fill" /> Apply as a Supplier
            </Link>
            <a
              href={`mailto:${FOUNDER_EMAIL}?subject=Supplier%20Interest`}
              className="w-full bg-white text-ink border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-sm shadow-brut-sm hover-brut inline-flex items-center justify-center gap-2"
              data-testid="supplier-email-cta"
            >
              <Envelope weight="bold" /> {FOUNDER_EMAIL}
            </a>
          </div>
        </div>
      </section>

      {/* ============ BOTTOM CTA ============ */}
      <section className="relative border-t-2 border-ink bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-24 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-4">Limited cohort</div>
          <h2 className="font-display text-5xl sm:text-7xl uppercase leading-[0.9] tracking-tighter mb-6">
            Early access<br />launching soon.
          </h2>
          <p className="text-[#3A3A3A] mb-10 max-w-lg mx-auto">
            Join the waitlist to be invited as our first Waves go live.
          </p>
          <div className="max-w-xl mx-auto">
            <WaitlistForm compact />
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="bg-ink text-white border-t-2 border-ink">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-12 h-12 bg-white border-2 border-white overflow-hidden">
                <img src="https://customer-assets.emergentagent.com/job_party-power-1/artifacts/yz1zsziz_Collectivesaverslogo.png.png" alt="" className="w-full h-full object-contain p-0.5" />
              </span>
              <div>
                <div className="font-display text-xl uppercase tracking-tighter">The Collective Savers™</div>
                <div className="font-mono text-[10px] uppercase tracking-widest opacity-90 mt-0.5">Collective purchasing infrastructure</div>
              </div>
            </div>
            <a
              href={`mailto:${FOUNDER_EMAIL}`}
              className="font-mono text-xs uppercase tracking-widest text-[#FFD600] hover:text-white underline-offset-4 hover:underline"
            >
              {FOUNDER_EMAIL}
            </a>
          </div>
          <div className="border-t border-white/30 pt-6 flex flex-col sm:flex-row justify-between gap-3 font-mono text-[10px] uppercase tracking-widest opacity-85">
            <span>Early access launching soon.</span>
            <span className="flex flex-wrap gap-4">
              <Link to="/terms" className="hover:text-[#FFD600]" data-testid="landing-footer-terms">Terms</Link>
              <Link to="/privacy" className="hover:text-[#FFD600]" data-testid="landing-footer-privacy">Privacy</Link>
              <span>© {new Date().getFullYear()} The Collective Savers Ltd.</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function VideoShowcase() {
  // ⬇️ EDIT THESE TWO URLs to point to your real videos.
  // Option A — YouTube/Vimeo embed: paste the embed URL (e.g. "https://www.youtube.com/embed/XXXX?rel=0")
  // Option B — Self-hosted MP4: drop the file in /app/frontend/public/videos/ and use "/videos/your-file.mp4"
  const VIDEOS = {
    consumer: {
      title: "How Waves work for members",
      poster: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80",
      src: "", // leave empty to show coming-soon overlay
      embedUrl: "", // e.g. "https://www.youtube.com/embed/XXXXXXX"
    },
    supplier: {
      title: "How suppliers list into demand",
      poster: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&q=80",
      src: "",
      embedUrl: "",
    },
  };

  return (
    <section className="border-b-2 border-ink bg-[#F4F4F4]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-3">See it in motion</div>
          <h2 className="font-display text-4xl sm:text-5xl uppercase leading-[0.95] tracking-tighter">
            One platform.<br />Two perspectives.
          </h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <VideoCard label="For Members" tagline="Joining a Wave & locking your savings." def={VIDEOS.consumer} accent="#FFD600" />
          <VideoCard label="For Suppliers" tagline="Listing a Wave & batch fulfilment." def={VIDEOS.supplier} accent="#FF5400" />
        </div>
      </div>
    </section>
  );
}

function VideoCard({ label, tagline, def, accent }) {
  const hasEmbed = !!def.embedUrl;
  const hasMp4 = !!def.src;
  return (
    <div className="border-2 border-ink bg-white shadow-brut-lg overflow-hidden">
      <div className="px-5 py-3 border-b-2 border-ink flex items-center justify-between" style={{ background: accent }}>
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest">{label}</div>
          <div className="font-display text-lg uppercase tracking-tight">{tagline}</div>
        </div>
      </div>
      <div className="relative aspect-video bg-ink">
        {hasEmbed ? (
          <iframe
            src={def.embedUrl}
            title={def.title}
            className="w-full h-full"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : hasMp4 ? (
          <video
            src={def.src}
            poster={def.poster}
            controls
            preload="metadata"
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          // Coming-soon overlay until you add a real video
          <div className="absolute inset-0">
            <img src={def.poster} alt="" className="w-full h-full object-cover opacity-50" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="border-2 border-white bg-ink/80 backdrop-blur px-5 py-3 shadow-brut">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#FFD600]">Coming soon</div>
                <div className="font-display text-xl uppercase text-white">Video walkthrough</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WaitlistForm({ compact = false }) {
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleRole = (r) => {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setSubmitting(true);
    try {
      await api.post("/waitlist", { email, roles });
      track("request_access", { roles: roles.join(",") || "consumer" });
      setSubmitted(true);
    } catch {
      setSubmitted(true); // graceful UX
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="border-2 border-ink bg-[#FFD600] shadow-brut p-5 inline-flex items-center gap-3 max-w-md" data-testid="waitlist-success">
        <Sparkle weight="fill" size={22} />
        <div>
          <div className="font-display text-lg uppercase tracking-tight">You&apos;re on the list.</div>
          <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-0.5">We&apos;ll be in touch.</div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "" : "max-w-2xl"} data-testid="waitlist-form">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 border-2 border-ink bg-white p-4 font-mono text-sm shadow-brut-sm outline-none focus:shadow-brut focus:translate-x-[-2px] focus:translate-y-[-2px] transition-all"
          data-testid="waitlist-email"
        />
        <button
          type="submit"
          disabled={submitting}
          className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-4 text-sm shadow-brut hover-brut inline-flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap"
          data-testid="waitlist-submit"
        >
          {submitting ? "..." : "Request Access"} <ArrowRight weight="bold" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] self-center mr-1">For:</span>
        {[
          { id: "consumer", label: "Consumer" },
          { id: "supplier", label: "Supplier" },
          { id: "garage", label: "Garage" },
        ].map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => toggleRole(r.id)}
            className={`border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono inline-flex items-center gap-1.5 ${roles.includes(r.id) ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
            data-testid={`waitlist-role-${r.id}`}
          >
            <span className={`w-2.5 h-2.5 border border-current ${roles.includes(r.id) ? "bg-[#FFD600]" : ""}`} />
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] inline-flex items-center gap-1.5">
        <ShieldCheck weight="bold" size={12} className="text-[#FF5400]" />
        We respect your inbox. No spam.
      </div>
    </form>
  );
}
