import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import StateBadge from "../components/StateBadge";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ArrowRight, Lock, Wrench, Calendar, CheckCircle, MapPin, Truck, UserCircle, FloppyDisk } from "@phosphor-icons/react";

const ORDER_STATE = {
  reserved: { label: "Reserved", bg: "#FFD600" },
  authorized: { label: "Authorised", bg: "#0021A5", text: "#fff" },
  captured: { label: "Confirmed", bg: "#00C853" },
  released: { label: "Released", bg: "#525252", text: "#fff" },
  cancelled: { label: "Cancelled", bg: "#525252", text: "#fff" },
};

const WAVE_STATE = {
  open: "Open", almost_full: "Almost Full", activated: "Activated",
  processing: "Processing", fulfilment: "Fulfilment", completed: "Completed", expired: "Expired",
};

export default function MyParties() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [data, setData] = useState({ waves: [], total_savings: 0 });
  const [orders, setOrders] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) { navigate("/"); return; }
    if (user) {
      (async () => {
        try {
          const [w, o] = await Promise.all([api.get("/me/waves"), api.get("/me/wave-orders")]);
          setData(w.data);
          setOrders(o.data);
        } catch (err) {
          console.error("Dashboard load failed", err);
        } finally {
          setDataLoading(false);
        }
      })();
    }
  }, [user, loading, navigate]);

  if (loading || dataLoading) return <Shell><div className="font-mono uppercase tracking-widest text-sm">Loading...</div></Shell>;

  const needsBooking = data.waves.filter(p => p.needs_booking);
  const active = data.waves.filter(p => ["active", "powered", "locked", "executing"].includes(p.vpp.state) && !p.paid);
  const paid = data.waves.filter(p => p.paid);
  const hasNothing = orders.length === 0 && data.waves.length === 0;

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Welcome back, {user?.name?.split(" ")[0]}</div>
          <h1 className="font-display text-5xl uppercase tracking-tighter leading-[0.9]">My Waves.</h1>
        </div>
        <div className="border-2 border-ink bg-[#00C853] p-4 shadow-brut" data-testid="total-savings">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">Total Savings</div>
          <div className="font-display text-3xl">£{(data.total_savings || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Regional Waves (new engine) */}
      {orders.length > 0 && (
        <section className="mb-10" data-testid="my-wave-orders">
          <h2 className="font-display text-2xl uppercase mb-4">Regional Waves</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orders.map((o) => <WaveOrderCard key={o.participation_id} order={o} />)}
          </div>
        </section>
      )}

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
                  Your Wave has locked. Pick a verified garage + time slot — we&apos;ll dispatch your order to them directly.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {needsBooking.map(p => (
              <Link key={p.vpp.vpp_id} to={`/book/${p.vpp.vpp_id}`} className="border-2 border-ink bg-white shadow-brut hover-brut p-4 flex gap-4" data-testid={`book-cta-${p.vpp.vpp_id}`}>
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

      {active.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-2xl uppercase mb-4">Active</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {active.map(p => <PartyRow key={p.vpp.vpp_id} wave={p} />)}
          </div>
        </section>
      )}
      {paid.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-2xl uppercase mb-4">Completed Orders</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paid.map(p => <PartyRow key={p.vpp.vpp_id} wave={p} />)}
          </div>
        </section>
      )}

      {hasNothing && (
        <div className="border-2 border-ink bg-white shadow-brut p-10 text-center mb-10">
          <div className="font-display text-3xl uppercase mb-3">No waves yet.</div>
          <p className="text-[#3A3A3A] mb-6">Find a wave that matches what you need.</p>
          <Link to="/waves" className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-6 py-3 text-sm shadow-brut hover-brut inline-flex items-center gap-2">
            Browse Waves <ArrowRight weight="bold" />
          </Link>
        </div>
      )}

      {/* Account settings */}
      <AccountPanel />
    </Shell>
  );
}

function WaveOrderCard({ order }) {
  const w = order.wave || {};
  const os = ORDER_STATE[order.status] || ORDER_STATE.reserved;
  const isTyre = order.category === "tyres";
  return (
    <div className="border-2 border-ink bg-white shadow-brut p-4" data-testid={`wave-order-${order.participation_id}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF5400] inline-flex items-center gap-1">
          <MapPin weight="fill" size={10} /> {w.region_name} · {w.category_label}
        </div>
        <span className="border-2 border-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest font-mono" style={{ background: os.bg, color: os.text || "#0A0A0A" }}>{os.label}</span>
      </div>
      <Link to={`/wave/${w.wave_id}`} className="font-display text-lg uppercase leading-tight hover:underline block">{w.title}</Link>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A]">
        Wave · {WAVE_STATE[w.state] || w.state} · {w.units_committed}/{w.ideal_target} units
      </div>

      {/* items */}
      <div className="mt-3 border-t-2 border-ink pt-3 space-y-1">
        {(order.items || []).map((it) => (
          <div key={it.variant_id} className="flex justify-between font-mono text-[12px]">
            <span>{it.model} · {it.label} × {it.qty}</span>
            <span className="font-bold">£{(it.wave_price * it.qty).toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-widest text-[#3A3A3A] pt-1">
          <span>Subtotal</span><span className="font-bold text-ink">£{(order.subtotal || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* fulfilment / fitting */}
      <div className="mt-3 border-2 border-ink bg-[#FAFAFA] p-3" data-testid={`fitting-${order.participation_id}`}>
        {isTyre ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-1 inline-flex items-center gap-1">
              <Wrench weight="bold" size={11} /> Fitting garage
            </div>
            <div className="font-display text-base uppercase leading-tight">{order.garage_name || "—"}</div>
            {order.fitting_slot_label && (
              <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-[#00C853] inline-flex items-center gap-1">
                <Calendar weight="bold" size={11} /> {order.fitting_slot_label}
              </div>
            )}
            <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A]">Tyres ship to your garage — never a private address.</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-1 inline-flex items-center gap-1">
              <Truck weight="bold" size={11} /> Delivery address
            </div>
            <div className="font-mono text-[12px]">{order.delivery_address || "—"}</div>
          </>
        )}
      </div>
      {/* payment CTA / status */}
      {(() => {
        const payable = ["activated", "processing", "fulfilment"].includes(w.state) && order.payment_status !== "paid" && ["reserved", "authorized"].includes(order.status);
        if (order.payment_status === "paid") {
          return (
            <div className="mt-3 border-2 border-ink bg-[#00C853] p-2 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest" data-testid={`order-paid-${order.participation_id}`}>
              <CheckCircle weight="fill" size={12} /> Paid · {order.payment_method}
            </div>
          );
        }
        if (payable) {
          return (
            <Link to={`/wave-pay/${order.participation_id}`} className="mt-3 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-widest px-4 py-3 text-xs shadow-brut hover-brut inline-flex items-center justify-center gap-2" data-testid={`pay-now-${order.participation_id}`}>
              <Lock weight="fill" size={12} /> Pay now · Wave activated
            </Link>
          );
        }
        return (
          <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]" data-testid={`order-await-${order.participation_id}`}>
            Reserved · payment opens when the Wave activates
          </div>
        );
      })()}
    </div>
  );
}

function AccountPanel() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== (user?.name || "") || (phone.trim() || "") !== (user?.phone || "");

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Name cannot be empty"); return; }
    setSaving(true);
    try {
      const { data } = await api.patch("/me/profile", { name: name.trim(), phone: phone.trim() });
      setUser(data);
      toast.success("Account details updated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Update failed");
    } finally { setSaving(false); }
  };

  return (
    <section className="mt-4" data-testid="account-panel">
      <h2 className="font-display text-2xl uppercase mb-4">Account</h2>
      <form onSubmit={save} className="border-2 border-ink bg-white shadow-brut p-5 sm:p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-5">
          {user?.picture ? (
            <img src={user.picture} alt={user.name} className="w-12 h-12 border-2 border-ink" />
          ) : (
            <div className="w-12 h-12 border-2 border-ink bg-[#FFD600] flex items-center justify-center"><UserCircle weight="duotone" size={26} /></div>
          )}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">Signed in as</div>
            <div className="font-display text-lg uppercase leading-tight">{user?.email}</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Full name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border-2 border-ink px-3 py-2.5 font-mono text-sm" data-testid="account-name-input" />
          </label>
          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Phone</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44…" className="w-full border-2 border-ink px-3 py-2.5 font-mono text-sm" data-testid="account-phone-input" />
          </label>
          <label className="block sm:col-span-2">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1.5">Email (sign-in)</div>
            <input value={user?.email || ""} disabled className="w-full border-2 border-ink px-3 py-2.5 font-mono text-sm bg-[#F4F4F4] text-[#3A3A3A]" data-testid="account-email-input" />
            <div className="font-mono text-[9px] uppercase tracking-widest text-[#3A3A3A] mt-1">Email is your sign-in ID — contact founder@thecollectivesavers.co.uk to change it.</div>
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={saving || !dirty} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-2.5 text-xs shadow-brut hover-brut inline-flex items-center gap-2 disabled:opacity-50" data-testid="account-save-btn">
            <FloppyDisk weight="bold" size={14} /> {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </section>
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
