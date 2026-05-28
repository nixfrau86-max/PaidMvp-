import React from "react";
import Navbar from "../components/Navbar";
import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link to="/" className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] hover:text-ink inline-flex items-center gap-1 mb-4">
          ← Home
        </Link>
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">
          Privacy Policy · v1.0 · Effective 28 May 2026
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95] mb-6">Privacy Policy.</h1>

        <S title="1. Data controller">
          The Collective Savers™ is the data controller for personal data processed
          via this platform. We are registered in England & Wales.
        </S>

        <S title="2. What we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Identity & contact:</b> name, email, phone (for SMS OTP), optional profile photo.</li>
            <li><b>Account activity:</b> Waves joined, sizes selected, garage bookings, fee preferences.</li>
            <li><b>Payment metadata:</b> last-four card digits, card brand, payment-method tokens via Stripe — <b>never raw card numbers</b>.</li>
            <li><b>Acceptance audit:</b> timestamp, IP address, user-agent, document version when you accept Terms.</li>
            <li><b>Analytics:</b> aggregated page views, event funnels via Firebase Analytics (anonymised by default).</li>
          </ul>
        </S>

        <S title="3. Why we use it">
          To operate Waves, settle payments, dispatch orders, prevent fraud, comply
          with UK tax law, and improve the product. Lawful bases include contract,
          legitimate interest, and legal obligation under UK GDPR.
        </S>

        <S title="4. Sharing">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Suppliers:</b> only your delivery name + address once a Wave locks.</li>
            <li><b>Garages:</b> only the booking-specific info (tyre size, contact phone) when you book a fitter.</li>
            <li><b>Payment processors:</b> Stripe (PCI-DSS), Open Banking aggregator.</li>
            <li><b>Analytics processors:</b> Google (Firebase Analytics) in aggregated/anonymised form.</li>
          </ul>
          We never sell personal data.
        </S>

        <S title="5. Cookies">
          We use a strictly-necessary <code>session_token</code> cookie for
          authentication and Firebase Analytics' first-party cookies for product
          telemetry. You can opt out of analytics from your account settings.
        </S>

        <S title="6. Your rights (UK GDPR)">
          Access, rectification, erasure, restriction, portability, and objection.
          Email <a href="mailto:privacy@thecollectivesavers.co.uk">privacy@thecollectivesavers.co.uk</a> with your request.
        </S>

        <S title="7. Retention">
          Account data is kept while your account is active and for 6 years after
          closure (HMRC requirement). Audit logs and payment records have the same
          retention. Analytics data is retained for 14 months max.
        </S>

        <S title="8. Contact">
          <a href="mailto:privacy@thecollectivesavers.co.uk">privacy@thecollectivesavers.co.uk</a>
        </S>
      </article>
    </div>
  );
}

function S({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-xl uppercase tracking-tight mb-2">{title}</h2>
      <div className="text-[15px] leading-relaxed text-[#1A1A1A]">{children}</div>
    </div>
  );
}
