import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Wrench, Calendar, CheckCircle, Pencil, Plus, X, Clock } from "@phosphor-icons/react";

const DAYS = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
];

export default function GarageDashboard() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [garage, setGarage] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("availability");

  const reload = async () => {
    try {
      const [g, av, bk] = await Promise.all([
        api.get("/garages/me"),
        api.get("/garages/me/availability"),
        api.get("/garages/me/bookings"),
      ]);
      setGarage(g.data);
      setAvailability(av.data);
      setBookings(bk.data);
    } catch {
      navigate("/garage/onboarding");
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/"); return; }
    reload();
  }, [user, loading, navigate]);

  if (loading || !garage || !availability) {
    return <div className="min-h-screen bg-[#FAFAFA]"><Navbar /><div className="max-w-7xl mx-auto px-4 py-10 font-mono uppercase text-sm tracking-widest">Loading…</div></div>;
  }

  const upcoming = bookings.filter(b => b.status === "confirmed" && new Date(b.slot_iso) > new Date());

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Garage Console</div>
            <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">{garage.business_name}</h1>
            <div className="font-mono text-xs uppercase tracking-widest text-[#3A3A3A] mt-1">{garage.garage_type_label}</div>
          </div>
          <div className="flex items-center gap-2">
            {garage.is_verified ? (
              <span className="inline-flex items-center gap-1 bg-[#00C853] border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1"><CheckCircle weight="fill" size={12}/> Verified</span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-[#FFD600] border-2 border-ink font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1">Pending Verification</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Stat label="Status" v={garage.is_active ? "Active" : "Paused"} icon={Wrench} />
          <Stat label="Open days/wk" v={DAYS.filter(d => (availability.weekly?.[d.id] || []).length > 0).length} icon={Calendar} />
          <Stat label="Slot length" v={`${availability.slot_minutes} min`} icon={Clock} />
          <Stat label="Upcoming bookings" v={upcoming.length} icon={Calendar} c={upcoming.length ? "#00C853" : undefined} />
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 mb-5 border-2 border-ink bg-white">
          {[
            { id: "availability", label: "Availability" },
            { id: "bookings", label: `Bookings (${upcoming.length})` },
            { id: "profile", label: "Profile" },
          ].map((t) => (
            <button
              key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest font-mono border-r-2 border-ink last:border-r-0 ${tab === t.id ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
              data-testid={`garage-tab-${t.id}`}
            >{t.label}</button>
          ))}
        </div>

        {tab === "availability" && (
          <AvailabilityEditor av={availability} onSaved={(d) => { setAvailability(d); toast.success("Availability saved"); }} />
        )}

        {tab === "bookings" && (
          <BookingsList bookings={bookings} />
        )}

        {tab === "profile" && (
          <ProfilePanel garage={garage} editing={editing} setEditing={setEditing} onSaved={() => { setEditing(false); reload(); }} />
        )}
      </div>
    </div>
  );
}

function AvailabilityEditor({ av, onSaved }) {
  const [weekly, setWeekly] = useState(av.weekly || {});
  const [overrides, setOverrides] = useState(av.overrides || {});
  const [slot, setSlot] = useState(av.slot_minutes || 30);
  const [newDate, setNewDate] = useState("");
  const [saving, setSaving] = useState(false);

  const addRange = (d) => setWeekly(w => ({ ...w, [d]: [...(w[d] || []), { start: "09:00", end: "17:00" }] }));
  const updateRange = (d, idx, field, val) => setWeekly(w => ({ ...w, [d]: w[d].map((r, i) => i === idx ? { ...r, [field]: val } : r) }));
  const removeRange = (d, idx) => setWeekly(w => ({ ...w, [d]: w[d].filter((_, i) => i !== idx) }));

  const addOverride = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { toast.error("Use date format YYYY-MM-DD"); return; }
    setOverrides(o => ({ ...o, [newDate]: { closed: true, ranges: [] } }));
    setNewDate("");
  };
  const setClosed = (d, closed) => setOverrides(o => ({ ...o, [d]: { ...(o[d] || { ranges: [] }), closed } }));
  const addOverrideRange = (d) => setOverrides(o => ({ ...o, [d]: { closed: false, ranges: [...((o[d]?.ranges) || []), { start: "09:00", end: "13:00" }] } }));
  const removeOverride = (d) => setOverrides(o => { const n = { ...o }; delete n[d]; return n; });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/garages/me/availability", {
        weekly, overrides, slot_minutes: Number(slot),
      });
      onSaved(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save availability");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-2 border-ink bg-white shadow-brut p-6 space-y-6" data-testid="availability-editor">
      <div>
        <h2 className="font-display text-2xl uppercase mb-1">Weekly hours</h2>
        <p className="text-xs text-[#3A3A3A] mb-4 font-mono">Set your default opening hours. Each range generates {slot}-min booking slots.</p>
        <div className="space-y-3">
          {DAYS.map((d) => (
            <div key={d.id} className="border-2 border-ink p-3" data-testid={`day-${d.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-xs font-bold uppercase tracking-widest w-12">{d.label}</div>
                <button onClick={() => addRange(d.id)} className="text-[10px] font-bold uppercase tracking-widest font-mono border-2 border-ink px-2 py-1 bg-white hover:bg-[#F4F4F4] inline-flex items-center gap-1">
                  <Plus weight="bold" size={10}/> Add range
                </button>
              </div>
              {(weekly[d.id] || []).length === 0 ? (
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] italic">Closed</div>
              ) : (
                <div className="space-y-2">
                  {(weekly[d.id] || []).map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={r.start} onChange={(e) => updateRange(d.id, i, "start", e.target.value)} className="border-2 border-ink p-1.5 font-mono text-xs" data-testid={`d-${d.id}-${i}-start`} />
                      <span className="font-mono text-xs">–</span>
                      <input type="time" value={r.end} onChange={(e) => updateRange(d.id, i, "end", e.target.value)} className="border-2 border-ink p-1.5 font-mono text-xs" data-testid={`d-${d.id}-${i}-end`} />
                      <button onClick={() => removeRange(d.id, i)} className="border-2 border-ink p-1.5 bg-white hover:bg-[#F4F4F4]" aria-label="Remove range">
                        <X weight="bold" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label className="font-mono text-[10px] font-bold uppercase tracking-widest">Slot length</label>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} className="border-2 border-ink p-2 font-mono text-xs" data-testid="slot-length">
            {[15, 20, 30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{n} min</option>)}
          </select>
        </div>
      </div>

      <div>
        <h2 className="font-display text-2xl uppercase mb-1">Date overrides</h2>
        <p className="text-xs text-[#3A3A3A] mb-3 font-mono">Holidays, special hours, or extra openings.</p>
        <div className="flex gap-2 mb-3">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="border-2 border-ink p-2 font-mono text-xs" data-testid="override-date" />
          <button onClick={addOverride} className="border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest font-mono bg-white hover:bg-[#F4F4F4] inline-flex items-center gap-1">
            <Plus weight="bold" size={10}/> Add override
          </button>
        </div>
        {Object.keys(overrides).length === 0 ? (
          <div className="border-2 border-dashed border-ink p-4 text-center font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A]">No overrides</div>
        ) : (
          <div className="space-y-2">
            {Object.entries(overrides).sort().map(([d, ov]) => (
              <div key={d} className="border-2 border-ink p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-xs font-bold">{d}</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setClosed(d, !ov.closed)} className={`border-2 border-ink px-2 py-1 text-[10px] font-bold uppercase tracking-widest font-mono ${ov.closed ? "bg-[#FF5400] text-white" : "bg-white"}`}>
                      {ov.closed ? "Closed" : "Open"}
                    </button>
                    {!ov.closed && (
                      <button onClick={() => addOverrideRange(d)} className="border-2 border-ink px-2 py-1 text-[10px] font-bold uppercase tracking-widest font-mono bg-white hover:bg-[#F4F4F4] inline-flex items-center gap-1">
                        <Plus weight="bold" size={10}/> Range
                      </button>
                    )}
                    <button onClick={() => removeOverride(d)} className="border-2 border-ink p-1.5 bg-white hover:bg-[#F4F4F4]" aria-label="Delete override">
                      <X weight="bold" size={12} />
                    </button>
                  </div>
                </div>
                {!ov.closed && (ov.ranges || []).length > 0 && (
                  <div className="space-y-2">
                    {ov.ranges.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="time" value={r.start} onChange={(e) => setOverrides(o => ({ ...o, [d]: { ...o[d], ranges: o[d].ranges.map((rr, j) => j === i ? { ...rr, start: e.target.value } : rr) } }))} className="border-2 border-ink p-1.5 font-mono text-xs" />
                        <span className="font-mono text-xs">–</span>
                        <input type="time" value={r.end} onChange={(e) => setOverrides(o => ({ ...o, [d]: { ...o[d], ranges: o[d].ranges.map((rr, j) => j === i ? { ...rr, end: e.target.value } : rr) } }))} className="border-2 border-ink p-1.5 font-mono text-xs" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut disabled:opacity-60" data-testid="save-availability-btn">
          {saving ? "Saving..." : "Save availability"}
        </button>
      </div>
    </div>
  );
}

function BookingsList({ bookings }) {
  const upcoming = bookings.filter(b => b.status === "confirmed" && new Date(b.slot_iso) > new Date());
  const past = bookings.filter(b => b.status !== "confirmed" || new Date(b.slot_iso) <= new Date());
  return (
    <div className="space-y-6">
      <Section title="Upcoming">
        {upcoming.length === 0 ? (
          <Empty>No upcoming bookings.</Empty>
        ) : (
          <div className="space-y-2">{upcoming.map(b => <BookingRow key={b.booking_id} b={b} />)}</div>
        )}
      </Section>
      <Section title="History">
        {past.length === 0 ? (
          <Empty>No past bookings yet.</Empty>
        ) : (
          <div className="space-y-2">{past.map(b => <BookingRow key={b.booking_id} b={b} />)}</div>
        )}
      </Section>
    </div>
  );
}

function BookingRow({ b }) {
  const dt = new Date(b.slot_iso);
  return (
    <div className="border-2 border-ink bg-white shadow-brut-sm p-3 flex items-center justify-between gap-3" data-testid={`booking-row-${b.booking_id}`}>
      <div>
        <div className="font-display text-lg uppercase leading-tight">{b.user_name}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-0.5">
          {b.vpp_title || "Wave"} · {b.vpp_category}
        </div>
      </div>
      <div className="text-right">
        <div className="font-display text-xl">{dt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        <div className="font-mono text-xs">{dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {b.slot_minutes}m</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="font-display text-xl uppercase mb-3">{title}</h2>
      {children}
    </div>
  );
}
function Empty({ children }) {
  return <div className="border-2 border-dashed border-ink p-6 text-center font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">{children}</div>;
}

function ProfilePanel({ garage, editing, setEditing, onSaved }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-2xl uppercase">Garage profile</h2>
        <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1 border-2 border-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-[#F4F4F4]" data-testid="profile-edit-btn">
          <Pencil weight="bold" size={10}/> {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {!editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-sm">
          <Row label="Contact email" v={garage.contact_email} />
          <Row label="Phone" v={garage.contact_phone || "—"} />
          <Row label="Type" v={garage.garage_type_label} />
          <Row label="Services" v={(garage.services||[]).join(", ") || "—"} />
          <Row label="Address" v={`${garage.address_line1}${garage.address_line2 ? ", " + garage.address_line2 : ""}, ${garage.city}, ${garage.postcode}`} full />
        </div>
      ) : <EditForm garage={garage} onSaved={onSaved} />}
    </div>
  );
}

function EditForm({ garage, onSaved }) {
  const [f, setF] = useState({
    business_name: garage.business_name, contact_email: garage.contact_email,
    contact_phone: garage.contact_phone || "",
    address_line1: garage.address_line1, address_line2: garage.address_line2 || "",
    city: garage.city, postcode: garage.postcode,
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api.patch("/garages/me", f); toast.success("Saved"); onSaved(); }
    catch(e){ toast.error(e?.response?.data?.detail || "Error"); }
    finally { setSaving(false); }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Object.entries(f).map(([k,v]) => (
        <label key={k} className="block">
          <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-1">{k.replace(/_/g," ")}</div>
          <input value={v} onChange={(e)=>setF(p=>({...p,[k]:e.target.value}))} className="w-full border-2 border-ink p-2 font-mono text-sm bg-white" />
        </label>
      ))}
      <div className="sm:col-span-2 flex justify-end">
        <button onClick={save} disabled={saving} className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-xs shadow-brut hover-brut" data-testid="profile-save-btn">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, v, icon: Icon, c }) {
  return (
    <div className="border-2 border-ink bg-white shadow-brut-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A]">{label}</span>
        <Icon weight="duotone" size={18} className="text-[#FF5400]" />
      </div>
      <div className="font-display text-2xl" style={c?{color:c}:{}}>{v}</div>
    </div>
  );
}
function Row({ label, v, full }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="text-[10px] font-bold uppercase tracking-widest font-mono text-[#3A3A3A] mb-1">{label}</div>
      <div className="text-sm">{v}</div>
    </div>
  );
}
