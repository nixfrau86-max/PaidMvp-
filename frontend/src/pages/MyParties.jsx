import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CurrencyGbp, Lightning, ArrowRight, Confetti, Lock } from "@phosphor-icons/react";

export default function MyParties() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [data, setData] = useState({ parties: [], total_savings: 0 });
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (user) {
      (async () => {
        const { data } = await api.get("/me/parties");
        setData(data);
        setDataLoading(false);
      })();
    }
  }, [user, loading, navigate]);

  if (loading || dataLoading) return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;

  const active = data.parties.filter(p => ["active", "powered", "locked", "executing"].includes(p.vpp.state) && !p.paid);
  const paid = data.parties.filter(p => p.paid);

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Welcome back, {user?.name?.split(" ")[0]}</div>
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">My Parties.</h1>
        </div>
        <div className="border-2 border-ink bg-[#00C853] p-4 shadow-brut" data-testid="total-savings">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Total Savings</div>
          <div className="font-display text-3xl">£{data.total_savings.toFixed(2)}</div>
        </div>
      </div>

      {data.parties.length === 0 ? (
        <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
          <div className="font-display text-3xl uppercase mb-3">No parties yet.</div>
          <p className="text-[#525252] mb-6">Find a party that matches what you need.</p>
          <Link to="/browse" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2">
            Browse Parties <ArrowRight weight="bold" />
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="mb-10">
              <h2 className="font-display text-2xl uppercase mb-4">Active</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {active.map(p => <PartyRow key={p.vpp.vpp_id} party={p} />)}
              </div>
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <h2 className="font-display text-2xl uppercase mb-4">Completed Orders</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paid.map(p => <PartyRow key={p.vpp.vpp_id} party={p} />)}
              </div>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}

function PartyRow({ party }) {
  const v = party.vpp;
  return (
    <Link to={`/vpp/${v.vpp_id}`} className="border-2 border-ink bg-white shadow-brut hover-brut p-4 flex gap-4">
      <img src={v.image_url} alt={v.title} className="w-24 h-24 border-2 border-ink object-cover shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <StateBadge state={v.state} progressPct={v.progress_pct} />
        </div>
        <div className="font-display text-lg uppercase line-clamp-2 leading-tight mb-1">{v.title}</div>
        <div className="font-mono text-xs uppercase tracking-widest text-[#525252]">
          {party.paid ? `Paid via ${party.payment_method}` : `${v.participants_count}/${v.threshold} joined`}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-display text-2xl">£{v.customer_price}</span>
          {party.paid && (
            <span className="bg-[#00C853] text-ink border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
              Saved £{party.savings.toFixed(2)}
            </span>
          )}
          {!party.paid && v.state === "locked" && (
            <span className="inline-flex items-center gap-1 bg-[#FF5400] text-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
              <Lock weight="bold" size={10} /> Checkout
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
