import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MapPin, Calendar, ArrowLeft, CheckCircle, Wrench } from "@phosphor-icons/react";

export default function BookFitter() {
  const { vppId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [postcode, setPostcode] = useState("");
  const [garages, setGarages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [slotsByDate, setSlotsByDate] = useState([]);
  const [pickedSlot, setPickedSlot] = useState(null);
  const [booking, setBooking] = useState(false);
  const [vpp, setVpp] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login"); return; }
    (async () => {
      const [vppRes, garagesRes] = await Promise.all([
        api.get(`/vpps/${vppId}`),
        api.get(`/garages`),
      ]);
      setVpp(vppRes.data);
      setGarages(garagesRes.data);
    })();
  }, [vppId, user, loading, navigate]);

  const reloadGarages = async () => {
    const { data } = await api.get(`/garages`, { params: postcode ? { postcode } : {} });
    setGarages(data);
  };

  const selectGarage = async (g) => {
    setSelected(g);
    setPickedSlot(null);
    try {
      const { data } = await api.get(`/garages/${g.garage_id}/slots`, { params: { days: 14 } });
      setSlotsByDate(data.days || []);
    } catch (e) {
      toast.error("Could not load slots for this garage");
    }
  };

  const confirm = async () => {
    if (!selected || !pickedSlot) { toast.error("Pick a garage and a slot to continue."); return; }
    setBooking(true);
    try {
      await api.post(`/me/bookings`, {
        vpp_id: vppId,
        garage_id: selected.garage_id,
        slot_iso: pickedSlot,
      });
      toast.success("Fitting booked! See you soon.");
      navigate("/dashboard");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not book this slot");
    } finally {
      setBooking(false);
    }
  };

  const grouped = useMemo(() => slotsByDate.filter(d => d.slots.length > 0), [slotsByDate]);

  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Link to="/dashboard" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mb-3 hover:text-ink">
          <ArrowLeft size={12} weight="bold" /> Back to My Waves
        </Link>
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] font-mono text-[#FF5400] mb-2">Book your fitting</div>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tighter leading-[0.95]">
            {vpp ? vpp.title : "Pick your fitter."}
          </h1>
          <p className="text-[#3A3A3A] mt-2 text-sm font-mono uppercase tracking-widest">
            Your Wave is locked. Pick a verified garage near you and a slot that works.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Garages */}
          <div className="lg:col-span-2 border-2 border-ink bg-white shadow-brut p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-3 flex items-center gap-1">
              <MapPin weight="bold" size={12} /> Local garages
            </div>
            <div className="flex gap-2 mb-3">
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                placeholder="Postcode (e.g. M1, SW1)"
                className="flex-1 border-2 border-ink p-2 font-mono text-xs"
                data-testid="book-postcode-filter"
              />
              <button onClick={reloadGarages} className="border-2 border-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest font-mono bg-white hover:bg-[#F4F4F4]" data-testid="book-postcode-search">Search</button>
            </div>
            {garages.length === 0 ? (
              <div className="border-2 border-dashed border-ink p-5 text-center font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
                No garages registered yet in your area.<br />Try again — our network is growing fast.
              </div>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto">
                {garages.map((g) => (
                  <button
                    key={g.garage_id}
                    onClick={() => selectGarage(g)}
                    className={`w-full border-2 border-ink p-3 text-left transition-all ${selected?.garage_id === g.garage_id ? "bg-[#FFD600] shadow-brut-sm" : "bg-white hover:bg-[#FAFAFA]"}`}
                    data-testid={`book-garage-${g.garage_id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-bold uppercase text-sm truncate">{g.business_name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-[#3A3A3A] mt-0.5 truncate">
                          {g.garage_type_label} · {g.city} {g.postcode}
                        </div>
                      </div>
                      {g.is_verified && (
                        <span className="bg-[#00C853] border-2 border-ink font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 shrink-0 inline-flex items-center gap-0.5">
                          <CheckCircle weight="fill" size={9}/> Verified
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Slots */}
          <div className="lg:col-span-3 border-2 border-ink bg-white shadow-brut p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest font-mono mb-3 flex items-center gap-1">
              <Calendar weight="bold" size={12} /> {selected ? `${selected.business_name} — next 14 days` : "Pick a garage to see open slots"}
            </div>
            {!selected ? (
              <div className="border-2 border-dashed border-ink p-10 text-center font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
                <Wrench weight="duotone" size={28} className="inline-block mb-2 text-[#FF5400]" /><br />
                Slots will appear here once you pick a garage.
              </div>
            ) : grouped.length === 0 ? (
              <div className="border-2 border-dashed border-ink p-10 text-center font-mono text-xs uppercase tracking-widest text-[#3A3A3A]">
                No open slots in the next 14 days — try another garage.
              </div>
            ) : (
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {grouped.map((d) => (
                  <div key={d.date}>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#3A3A3A] mb-2">
                      {new Date(d.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {d.slots.map((s) => (
                        <button
                          key={s.slot_iso}
                          onClick={() => setPickedSlot(s.slot_iso)}
                          className={`border-2 border-ink px-3 py-2 text-[11px] font-bold uppercase tracking-widest font-mono ${pickedSlot === s.slot_iso ? "bg-ink text-white" : "bg-white hover:bg-[#F4F4F4]"}`}
                          data-testid={`slot-${s.slot_iso}`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selected && pickedSlot && (
              <button
                onClick={confirm}
                disabled={booking}
                className="mt-5 w-full bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-5 py-3 text-sm shadow-brut hover-brut disabled:opacity-60"
                data-testid="confirm-booking-btn"
              >
                {booking ? "Booking…" : `Confirm fitting — ${new Date(pickedSlot).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
