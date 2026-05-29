import React from "react";
import Navbar from "../components/Navbar";
import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 prose prose-neutral">
        <Link to="/" className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 no-underline mb-4">
          ← Home
        </Link>
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">
          Terms of Service · v1.0 · Effective 28 May 2026
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95] mb-6">Terms of Service.</h1>

        <Section title="1. Who we are">
          The Collective Savers™ ("we", "us", "the platform") operates a real-time demand
          aggregation marketplace ("Waves") that lets consumers group-buy goods at
          supplier-level pricing. This site is operated from the United Kingdom and
          governed by the laws of England & Wales.
        </Section>

        <Section title="2. How Waves work">
          Joining a Wave is a binding offer to purchase the goods at the unlocked price,
          subject to the Wave reaching its target participation threshold ("Wave Lock").
          Until the Wave locks, your card is <strong>pre-authorised, not charged</strong>.
          When a Wave locks we capture the agreed amount and the supplier dispatches.
          If a Wave does not lock within the published window, the pre-authorisation is
          released in full and you are not charged.
        </Section>

        <Section title="3. Fees & pricing">
          The platform displays a transparent fee breakdown at checkout: collective
          item price, Platform Service Fee, and the fee for your selected payment
          method. There are no hidden fees. The fee schedule is published in the Admin
          configuration and updates take effect for future Wave joins only.
        </Section>

        <Section title="4. Supplier obligations">
          Verified suppliers warrant that they hold sufficient stock, will fulfil locked
          Waves within the advertised ETA, and provide accurate retail comparison
          pricing. We may suspend or remove suppliers who repeatedly miss fulfilment
          windows or supply misleading information.
        </Section>

        <Section title="5. Tyre Product Group Waves©">
          For tyre suppliers, Waves are auto-managed by our Product Group engine.
          Supplier identity and exact unit cost are hidden from consumers until Wave
          lock. By participating you accept that the final fitted price may include a
          fitter charge billed separately by your chosen authorised garage.
        </Section>

        <Section title="6. Refunds & cancellations">
          You may withdraw from a Wave any time <em>before</em> Wave Lock — the
          pre-authorisation is released. After Wave Lock, statutory consumer rights
          apply (UK 14-day cooling-off for distance sales), with the usual exceptions
          for fitted/installed goods.
        </Section>

        <Section title="7. Account suspension & deletion">
          We may suspend or remove accounts that breach these Terms, abuse the
          pre-authorisation flow, or facilitate fraud. You may request deletion of your
          account at any time via support; we retain financial records for the period
          required by HMRC.
        </Section>

        <Section title="8. Acceptance">
          By joining a Wave or applying as a Supplier or Garage you accept these Terms
          and our <Link to="/privacy">Privacy Policy</Link>. We log a timestamped record
          of your acceptance against your account for audit purposes.
        </Section>

        <Section title="9. Contact">
          Questions? Reach us at <a href="mailto:founder@thecollectivesavers.co.uk">founder@thecollectivesavers.co.uk</a>.
        </Section>
      </article>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-xl uppercase tracking-tight mb-2">{title}</h2>
      <div className="text-[15px] leading-relaxed text-[#1A1A1A]">{children}</div>
    </div>
  );
}
