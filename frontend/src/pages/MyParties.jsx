import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ArrowRight, Lock, Wrench, Calendar, CheckCircle } from "@phosphor-icons/react";

export default function MyParties() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [data, setData] = useState({ waves: [], total_savings: 0 });
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (user) {
      (async () => {
        const { data } = await api.get("/me/waves");
        setData(data);
        setDataLoading(false);
      })();
    }
  }, [user, loading, navigate]);

  if (loading || dataLoading) return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;

  const needsBooking = data.waves.filter(p => p.needs_booking);
  const active = data.waves.filter(p => ["active", "powered", "locked", "executing"].includes(p.vpp.state) && !p.paid);
  const paid = data.waves.filter(p => p.paid);

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Welcome back, {user?.name?.split(" ")[0]}</div>
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">My Waves.</h1>
        </div>
        <div className="border-2 border-ink bg-[#00C853] p-4 shadow-brut" data-testid="total-savings">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Total Savings</div>
          <div className="font-display text-3xl">£{data.total_savings.toFixed(2)}</div>
        </div>
      </div>

      {needsBooking.length > 0 && (
        <section className="mb-8" data-testid="needs-booking-section">
          <div className="border-2 border-ink bg-[#FFD600] shadow-brut p-5 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 border-2 border-ink bg-white flex items-center justify-center shrink-0">
                <Wrench weight="duotone" size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Action required</div>
                <h3 className="font-display text-2xl uppercase leading-tight">Book your fitting.</h3>
                <p className="text-sm mt-1">
                  Your Wave has locked. Pick a verified garage + time slot — we'll dispatch your order to them directly.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {needsBooking.map(p => (
              <Link
                key={p.vpp.vpp_id}
                to={`/book/${p.vpp.vpp_id}`}
                className="border-2 border-ink bg-white shadow-brut hover-brut p-4 flex gap-4"
                data-testid={`book-cta-${p.vpp.vpp_id}`}
              >
                <img src={p.vpp.image_url} alt="" className="w-20 h-20 border-2 border-ink object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg uppercase line-clamp-2 leading-tight">{p.vpp.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-1">Order locked · Awaiting fitting slot</div>
                  <div className="mt-3 inline-flex items-center gap-1 bg-[#FF5400] text-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
                    Pick fitter <ArrowRight weight="bold" size={10} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.waves.length === 0 ? (
        <div className="border-2 border-ink bg-white shadow-brut p-10 text-center">
          <div className="font-display text-3xl uppercase mb-3">No waves yet.</div>
          <p className="text-[#3A3A3A] mb-6">Find a wave that matches what you need.</p>
          <Link to="/browse" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2">
            Browse Waves <ArrowRight weight="bold" />
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="mb-10">
              <h2 className="font-display text-2xl uppercase mb-4">Active</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {active.map(p => <PartyRow key={p.vpp.vpp_id} wave={p} />)}
              </div>
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <h2 className="font-display text-2xl uppercase mb-4">Completed Orders</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paid.map(p => <PartyRow key={p.vpp.vpp_id} wave={p} />)}
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

function PartyRow({ wave }) {
  const v = wave.vpp;
  const cat = (v.category || "").toLowerCase();
  const isAuto = cat === "tyres" || cat === "automotive";
  return (
    <Link to={`/vpp/${v.vpp_id}`} className="border-2 border-ink bg-white shadow-brut hover-brut p-4 flex gap-4">
      <img src={v.image_url} alt={v.title} className="w-24 h-24 border-2 border-ink object-cover shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <StateBadge state={v.state} progressPct={v.progress_pct} />
        </div>
        <div className="font-display text-lg uppercase line-clamp-2 leading-tight mb-1">{v.title}</div>
        <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
          {wave.paid ? `Paid via ${wave.payment_method}` : `${v.participants_count}/${v.threshold} joined`}
        </div>
        {wave.booking && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[#00C853] flex items-center gap-1">
            <Calendar weight="bold" size={10}/>
            Fitting · {new Date(wave.booking.slot_iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {wave.booking.garage?.business_name ? ` · ${wave.booking.garage.business_name}` : ""}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="font-display text-2xl">£{v.customer_price}</span>
          {wave.paid && (
            <span className="bg-[#00C853] text-ink border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1 inline-flex items-center gap-1">
              <CheckCircle weight="fill" size={10}/> Saved £{wave.savings.toFixed(2)}
            </span>
          )}
          {!wave.paid && v.state === "locked" && (
            <span className="inline-flex items-center gap-1 bg-[#FF5400] text-white border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
              <Lock weight="bold" size={10} /> Checkout
            </span>
          )}
          {wave.paid && isAuto && !wave.booking && (
            <span className="inline-flex items-center gap-1 bg-[#FFD600] text-ink border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">
              <Wrench weight="bold" size={10}/> Book fitting
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
