import React from "react";
import { Link } from "react-router-dom";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t-2 border-ink bg-white mt-16" data-testid="site-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid sm:grid-cols-[1fr_auto] gap-4 items-center">
        <div className="font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">
          © {year} The Collective Savers™ · Real-time demand aggregation infrastructure
        </div>
        <nav className="flex flex-wrap gap-4 font-mono text-[11px] uppercase tracking-widest" data-testid="footer-nav">
          <Link to="/terms" className="hover:text-[#FF5400]" data-testid="footer-terms">Terms</Link>
          <Link to="/privacy" className="hover:text-[#FF5400]" data-testid="footer-privacy">Privacy</Link>
          <a href="mailto:hello@thecollectivesavers.co.uk" className="hover:text-[#FF5400]">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
