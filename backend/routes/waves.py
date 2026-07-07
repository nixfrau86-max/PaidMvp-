"""Regional Product Waves© engine — The Collective Savers™.

ONE WAVE = ONE REGION + ONE PRODUCT CATEGORY + ONE UNIT TARGET.

Suppliers create a single category Wave per region (e.g. "Warwickshire Conti Eco
Wave"), uploading product models + variants + inventory + cost + ETA. The platform
owns participation, inventory reservation, activation thresholds, lifecycle and
fulfilment batching. Consumers join by picking a variant + quantity (+ garage for
tyres / delivery address for electronics).

Wave states: open -> almost_full -> activated -> processing -> fulfilment -> completed
              (or expired if the deadline passes below min_activation).

Mounted via build_router(deps) DI pattern (see routes/admin_users.py).
"""
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response
from pydantic import BaseModel, Field

import storage
from email_service import send_join_confirmation, send_wave_activation


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
CATEGORIES = ["tyres", "electronics", "footwear", "clothing", "home_appliances",
              "home_garden", "automotive", "beauty", "sports", "toys", "consumer_goods"]
CATEGORY_LABELS = {
    "tyres": "Tyres", "electronics": "Electronics", "footwear": "Footwear",
    "clothing": "Clothing", "home_appliances": "Home Appliances",
    "home_garden": "Home & Garden", "automotive": "Automotive",
    "beauty": "Beauty & Personal Care", "sports": "Sports & Outdoors",
    "toys": "Toys & Games", "consumer_goods": "Consumer Goods", "other": "Other",
}

ACTIVE_PART_STATUSES = ["reserved", "authorized", "captured"]
ALMOST_FULL_RATIO = 0.8
RESERVATION_MINUTES = 25

# Respawn / order placement schedule (Europe/London).
# Working days: Monday–Saturday, EXCLUDING Sundays and UK (England & Wales) bank holidays.
# Waves launch at 08:30 on a working day and run until MIDNIGHT (no 16:30 cut-off).
# When a wave completes, the order/leftover-respawn is placed on the FOLLOWING
# working day at 08:30.
import holidays as _holidays_lib

WORK_START_H, WORK_START_M = 8, 30        # daily launch time
WORK_END_H, WORK_END_M = 16, 30           # Mon–Fri order cut-off / deadline
_UK_HOLIDAYS = _holidays_lib.country_holidays("GB", subdiv="ENG")

# States the supplier/admin manage manually (never auto-overwritten by recompute)
TERMINAL_OR_MANUAL = {"processing", "fulfilment", "completed", "expired"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt) -> Optional[str]:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt


# --------------------------------------------------------------------------
# Request schemas
# --------------------------------------------------------------------------
class VariantInput(BaseModel):
    variant_id: Optional[str] = None
    label: str                       # "225/65 R18" or "55-inch OLED"
    supplier_cost: float
    retail_price: float
    wave_price: float
    inventory_qty: int = 0


class ProductInput(BaseModel):
    product_id: Optional[str] = None
    model: str                       # "Eco Contact 6"
    image_url: Optional[str] = None  # per-product photo shown to members
    variants: List[VariantInput] = Field(default_factory=list)


class WaveCreateRequest(BaseModel):
    category: str                    # canonical id (see CATEGORIES) or a custom slug for "Other"
    category_label: Optional[str] = None  # human label (required for custom categories)
    region_id: str
    brand: str
    title: Optional[str] = None      # auto-generated if omitted
    description: str = ""
    image_url: Optional[str] = None
    ideal_target: int                # capacity (units)
    min_activation: int              # minimum units to activate
    eta: str = ""                    # supplier fulfilment ETA text
    deadline_days: int = 30
    products: List[ProductInput] = Field(default_factory=list)


class AdminWaveCreateRequest(WaveCreateRequest):
    supplier_id: str                 # admin chooses which supplier the wave belongs to


class WaveUpdateRequest(BaseModel):
    brand: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    ideal_target: Optional[int] = None
    min_activation: Optional[int] = None
    eta: Optional[str] = None
    products: Optional[List[ProductInput]] = None


class RegionCreateRequest(BaseModel):
    name: str


class RegionUpdateRequest(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


class JoinItem(BaseModel):
    product_id: str
    variant_id: str
    qty: int = 1


class WaveJoinRequest(BaseModel):
    items: List[JoinItem]
    garage_id: Optional[str] = None              # required for tyres
    fitting_slot_iso: Optional[str] = None       # preferred 30-min fitting slot (tyres)
    fitting_slot_label: Optional[str] = None
    delivery_address: Optional[str] = None       # required for electronics/footwear
    accept_terms: bool = False


class StateUpdateRequest(BaseModel):
    state: str



# --------------------------------------------------------------------------
# Pure helpers (stateless — no db/manager needed). Kept at module level to keep
# build_router() lean and to make them unit-testable in isolation.
# --------------------------------------------------------------------------
def _variant_available(v: dict) -> int:
    return int(v.get("inventory_qty", 0)) - int(v.get("reserved_qty", 0)) - int(v.get("sold_qty", 0))


def _wave_units(w: dict) -> int:
    return int(w.get("units_committed", 0))


def _public_wave(w: dict, full: bool = False) -> dict:
    """Strip supplier identity + supplier_cost for consumer views."""
    d = dict(w)
    d.pop("_id", None)
    for k in ("created_at", "activated_at", "deadline"):
        d[k] = _iso(d.get(k))
    products = []
    for p in d.get("products", []):
        variants = []
        for v in p.get("variants", []):
            vv = {
                "variant_id": v["variant_id"],
                "label": v["label"],
                "retail_price": v["retail_price"],
                "wave_price": v["wave_price"],
                "available": _variant_available(v),
            }
            if full:
                vv["inventory_qty"] = v.get("inventory_qty", 0)
                vv["reserved_qty"] = v.get("reserved_qty", 0)
                vv["sold_qty"] = v.get("sold_qty", 0)
                vv["supplier_cost"] = v.get("supplier_cost")
            variants.append(vv)
        products.append({"product_id": p["product_id"], "model": p["model"], "image_url": p.get("image_url", ""), "variants": variants})
    d["products"] = products
    if not full:
        d.pop("supplier_id", None)
    ideal = max(1, int(d.get("ideal_target", 1)))
    d["progress_pct"] = round(min(100.0, _wave_units(w) / ideal * 100), 1)
    d["category_label"] = d.get("category_label") or CATEGORY_LABELS.get(d.get("category"), d.get("category"))
    if full:
        # Stock monitoring (supplier console + admin): allocated = reserved-but-unpaid,
        # sold = captured/paid, left = remaining available inventory.
        allocated = sold = total = 0
        for p in w.get("products", []):
            for v in p.get("variants", []):
                total += int(v.get("inventory_qty", 0))
                allocated += int(v.get("reserved_qty", 0))
                sold += int(v.get("sold_qty", 0))
        d["stock_summary"] = {
            "total": total,
            "allocated": allocated,
            "sold": sold,
            "left": max(0, total - allocated - sold),
        }
    return d


def _normalize_products(products: List[ProductInput]) -> List[dict]:
    out = []
    for p in products:
        variants = []
        for v in p.variants:
            variants.append({
                "variant_id": v.variant_id or f"var_{uuid.uuid4().hex[:8]}",
                "label": v.label.strip(),
                "supplier_cost": float(v.supplier_cost),
                "retail_price": float(v.retail_price),
                "wave_price": float(v.wave_price),
                "inventory_qty": int(v.inventory_qty),
                "reserved_qty": 0,
                "sold_qty": 0,
            })
        out.append({
            "product_id": p.product_id or f"prd_{uuid.uuid4().hex[:8]}",
            "model": p.model.strip(),
            "image_url": (p.image_url or "").strip(),
            "variants": variants,
        })
    return out


def _derive_fitting_label(category: str, iso: Optional[str], label: Optional[str]) -> Optional[str]:
    """Derive a human fitting-slot label if only the ISO was supplied (tyres)."""
    if label or category != "tyres" or not iso:
        return label
    try:
        return datetime.fromisoformat(iso).strftime("%a %-d %b %H:%M")
    except (ValueError, TypeError):
        return iso


def _validate_join_items(wave: dict, join_items: List[JoinItem]):
    """Validate stock + build participation items.

    Returns (items, subtotal, units, inc_ops, array_filters). Raises HTTPException
    on any invalid quantity / variant / insufficient stock."""
    variant_index = {v["variant_id"]: (p, v) for p in wave["products"] for v in p["variants"]}
    items, subtotal, units = [], 0.0, 0
    inc_ops, array_filters = {}, []
    for idx, it in enumerate(join_items):
        if it.qty < 1:
            raise HTTPException(status_code=400, detail="Quantity must be at least 1")
        if it.variant_id not in variant_index:
            raise HTTPException(status_code=400, detail="Invalid product variant")
        p, v = variant_index[it.variant_id]
        avail = _variant_available(v)
        if it.qty > avail:
            raise HTTPException(status_code=400, detail=f"Only {avail} units left for {v['label']}")
        items.append({
            "product_id": p["product_id"], "variant_id": v["variant_id"],
            "model": p["model"], "label": v["label"], "qty": it.qty,
            "wave_price": v["wave_price"], "retail_price": v["retail_price"],
        })
        subtotal += v["wave_price"] * it.qty
        units += it.qty
        inc_ops[f"products.$[p{idx}].variants.$[v{idx}].reserved_qty"] = it.qty
        array_filters.append({f"p{idx}.product_id": p["product_id"]})
        array_filters.append({f"v{idx}.variant_id": v["variant_id"]})
    return items, subtotal, units, inc_ops, array_filters


async def _validate_fulfilment(db, wave: dict, payload) -> Optional[str]:
    """Validate garage (tyres) or delivery address (other). Returns garage_name or None."""
    if wave["category"] == "tyres":
        if not payload.garage_id:
            raise HTTPException(status_code=400, detail="Please select an approved fitting garage")
        g = await db.garages.find_one({"garage_id": payload.garage_id}, {"_id": 0})
        if not g or not g.get("is_verified") or not g.get("is_active", True):
            raise HTTPException(status_code=400, detail="Selected garage is not available")
        return g.get("business_name") or g.get("name")
    if not (payload.delivery_address and payload.delivery_address.strip()):
        raise HTTPException(status_code=400, detail="Please enter a delivery address")
    return None


async def _enforce_unit_limit(db, wave: dict, user: dict, units: int,
                              get_unit_limits_config, resolve_unit_limit):
    """Block a join that would exceed the user's per-category calendar-year cap."""
    if not (get_unit_limits_config and resolve_unit_limit):
        return
    cfg = await get_unit_limits_config()
    limit = resolve_unit_limit(cfg, user, wave["category"])
    used = await _units_used_this_year(db, user["user_id"], wave["category"])
    if used + units > limit:
        cat = CATEGORY_LABELS.get(wave["category"], wave["category"])
        remaining = max(0, limit - used)
        raise HTTPException(
            status_code=400,
            detail=(f"Annual {cat} limit reached — up to {limit} units per calendar year. "
                    f"You've committed {used} so far ({remaining} left). "
                    f"Contact us if you need a higher limit."),
        )


async def _atomic_reserve(db, wave_id: str, inc_ops: dict, array_filters: list):
    """Increment reserved_qty, verify no variant oversold, roll back + raise on a race."""
    await db.waves.update_one({"wave_id": wave_id}, {"$inc": inc_ops}, array_filters=array_filters)
    post = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
    if any(_variant_available(v) < 0 for p in post["products"] for v in p["variants"]):
        neg_inc = {k: -val for k, val in inc_ops.items()}
        await db.waves.update_one({"wave_id": wave_id}, {"$inc": neg_inc}, array_filters=array_filters)
        raise HTTPException(status_code=409, detail="That stock was just reserved by someone else — please try again")


async def _record_terms_acceptance(db, user: dict):
    await db.terms_acceptances.insert_one({
        "acceptance_id": f"acc_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"], "doc_id": "terms", "version": "1.0",
        "is_current": True, "context": "wave_join", "accepted_at": _iso(_now()),
    })


def _merge_items(existing_items: List[dict], new_items: List[dict]):
    """Combine line items by variant_id (summing qty). Returns (items, subtotal, units)."""
    by_variant: Dict[str, dict] = {}
    order: List[str] = []
    for it in list(existing_items) + list(new_items):
        vid = it["variant_id"]
        if vid in by_variant:
            by_variant[vid]["qty"] += it["qty"]
        else:
            by_variant[vid] = dict(it)
            order.append(vid)
    items = [by_variant[vid] for vid in order]
    subtotal = sum(it["wave_price"] * it["qty"] for it in items)
    units = sum(it["qty"] for it in items)
    return items, round(subtotal, 2), units


def _build_participation(wave: dict, user: dict, payload, items, subtotal, units,
                         garage_name, fitting_label) -> dict:
    return {
        "participation_id": f"wp_{uuid.uuid4().hex[:10]}",
        "wave_id": wave["wave_id"],
        "user_id": user["user_id"],
        "category": wave["category"],
        "items": items,
        "units": units,
        "subtotal": round(subtotal, 2),
        "garage_id": payload.garage_id,
        "garage_name": garage_name,
        "fitting_slot_iso": payload.fitting_slot_iso,
        "fitting_slot_label": fitting_label,
        "delivery_address": payload.delivery_address,
        "status": "reserved",
        "reservation_expires_at": _iso(_now() + timedelta(minutes=RESERVATION_MINUTES)),
        "payment_status": "pending",
        "created_at": _iso(_now()),
    }


# --------------------------------------------------------------------------
# Recompute + lifecycle (module level so background workers can reuse them).
# `activated` is a NON-BLOCKING LATCH: once a wave hits min_activation it stays
# activated (payment opens) but keeps accepting joins until ideal_target/capacity
# or its deadline. activated_at is stamped once and never cleared by cancellations.
# --------------------------------------------------------------------------
PAYMENT_WINDOW_HOURS = 48


async def _broadcast(manager, wave_id: str, payload: dict):
    try:
        await manager.broadcast(f"wave:{wave_id}", payload)
        await manager.broadcast("waves:feed", {**payload, "wave_id": wave_id})
    except Exception:
        pass


async def _recompute_wave(db, manager, wave: dict) -> dict:
    """Recompute committed units + auto state (open/almost_full/activated latch)."""
    pipeline = [
        {"$match": {"wave_id": wave["wave_id"], "status": {"$in": ACTIVE_PART_STATUSES}}},
        {"$group": {"_id": None, "units": {"$sum": "$units"}, "people": {"$sum": 1}}},
    ]
    agg = await db.wave_participations.aggregate(pipeline).to_list(1)
    units = int(agg[0]["units"]) if agg else 0
    people = int(agg[0]["people"]) if agg else 0

    updates: Dict[str, Any] = {"units_committed": units, "participants_count": people}
    current = wave.get("state", "open")
    if current not in TERMINAL_OR_MANUAL:
        ideal = max(1, int(wave.get("ideal_target", 1)))
        min_act = int(wave.get("min_activation", ideal))
        if wave.get("activated_at") or units >= min_act:
            updates["state"] = "activated"
            if not wave.get("activated_at"):
                updates["activated_at"] = _now()
        elif units >= ALMOST_FULL_RATIO * ideal:
            updates["state"] = "almost_full"
        else:
            updates["state"] = "open"

    await db.waves.update_one({"wave_id": wave["wave_id"]}, {"$set": updates})
    fresh = await db.waves.find_one({"wave_id": wave["wave_id"]}, {"_id": 0})
    # Notify all participants once, exactly when the Wave flips to "activated".
    if updates.get("state") == "activated" and current != "activated":
        asyncio.create_task(_notify_wave_activation(db, fresh))
    await _broadcast(manager, wave["wave_id"], {
        "type": "wave_update",
        "units_committed": fresh.get("units_committed", 0),
        "participants_count": fresh.get("participants_count", 0),
        "state": fresh.get("state"),
        "progress_pct": round(min(100.0, fresh.get("units_committed", 0) / max(1, fresh.get("ideal_target", 1)) * 100), 1),
    })
    return fresh


async def _notify_wave_activation(db, wave: dict):
    """Email every active participant when a Wave activates (fire-and-forget)."""
    try:
        parts = await db.wave_participations.find(
            {"wave_id": wave["wave_id"], "status": {"$in": ACTIVE_PART_STATUSES}},
            {"_id": 0, "user_id": 1},
        ).to_list(2000)
        uids = list({p["user_id"] for p in parts})
        if not uids:
            return
        async for u in db.users.find({"user_id": {"$in": uids}}, {"_id": 0, "email": 1, "name": 1}):
            await send_wave_activation(u.get("email"), u.get("name"), wave)
    except Exception:  # noqa: BLE001
        pass


async def _release_participation(db, p: dict, new_status: str = "released"):
    """Release a participation's reserved stock and mark it released/cancelled."""
    inc_ops, array_filters = {}, []
    for idx, it in enumerate(p.get("items", [])):
        inc_ops[f"products.$[p{idx}].variants.$[v{idx}].reserved_qty"] = -it["qty"]
        array_filters.append({f"p{idx}.product_id": it["product_id"]})
        array_filters.append({f"v{idx}.variant_id": it["variant_id"]})
    await db.wave_participations.update_one(
        {"participation_id": p["participation_id"]},
        {"$set": {"status": new_status, "released_at": _iso(_now())}},
    )
    if inc_ops:
        await db.waves.update_one({"wave_id": p["wave_id"]}, {"$inc": inc_ops}, array_filters=array_filters)


async def sweep_payment_windows(db, manager, hours: int = PAYMENT_WINDOW_HOURS) -> int:
    """Release unpaid reservations on activated waves past their payment window,
    freeing locked stock for other buyers / respawn rounds."""
    cutoff = _now() - timedelta(hours=hours)
    waves = await db.waves.find(
        {"state": "activated", "activated_at": {"$ne": None, "$lt": cutoff}}, {"_id": 0}
    ).to_list(500)
    released = 0
    for w in waves:
        parts = await db.wave_participations.find(
            {"wave_id": w["wave_id"], "status": {"$in": ["reserved", "authorized"]},
             "payment_status": {"$ne": "paid"}}, {"_id": 0},
        ).to_list(2000)
        for p in parts:
            await _release_participation(db, p, "released")
            released += 1
        if parts:
            fresh = await db.waves.find_one({"wave_id": w["wave_id"]}, {"_id": 0})
            await _recompute_wave(db, manager, fresh)
    return released


async def expire_overdue_waves(db, manager) -> int:
    """Transition under-filled waves past their deadline to `expired`, release their
    reservations, then RELIST leftover stock (regeneration happens whenever stock
    remains). Waves that already met min_activation are left alone (they activate)."""
    now = _now()
    waves = await db.waves.find(
        {"state": {"$in": ["open", "almost_full"]}, "deadline": {"$ne": None, "$lt": now}}, {"_id": 0}
    ).to_list(500)
    expired = 0
    for w in waves:
        ideal = max(1, int(w.get("ideal_target", 1)))
        if int(w.get("units_committed", 0)) >= int(w.get("min_activation", ideal)):
            continue  # threshold met — let it activate, don't expire
        parts = await db.wave_participations.find(
            {"wave_id": w["wave_id"], "status": {"$in": ["reserved", "authorized"]}}, {"_id": 0},
        ).to_list(2000)
        for p in parts:
            await _release_participation(db, p, "released")
        await db.waves.update_one({"wave_id": w["wave_id"]}, {"$set": {"state": "expired"}})
        await _broadcast(manager, w["wave_id"], {"type": "wave_update", "state": "expired"})
        expired += 1
        # Relist leftover stock: an under-filled wave that expires still has stock,
        # so it regenerates (next working-day schedule) keeping its original targets.
        fresh = await db.waves.find_one({"wave_id": w["wave_id"]}, {"_id": 0})
        await complete_wave_and_respawn(db, manager, fresh)
    return expired


async def auto_complete_due_waves(db, manager) -> int:
    """Auto-complete ACTIVATED waves once their deadline passes, then respawn any
    leftover stock — for ALL categories. Symmetric with expire_overdue_waves
    (which expires under-filled open waves). An activated wave has, by definition,
    met its minimum, so on deadline it is finalised: captured units are recorded
    as sold, stranded reservations are carried into a fresh follow-on round.

    This is what makes the auto-respawn engine actually automatic (no admin action
    required) and consistent across every product category.
    """
    now = _now()
    waves = await db.waves.find(
        {"state": "activated", "respawned": {"$ne": True}, "deadline": {"$ne": None, "$lt": now}},
        {"_id": 0},
    ).to_list(500)
    completed = 0
    for w in waves:
        await db.waves.update_one({"wave_id": w["wave_id"]}, {"$set": {"state": "completed"}})
        await _broadcast(manager, w["wave_id"], {"type": "wave_update", "state": "completed"})
        fresh = await db.waves.find_one({"wave_id": w["wave_id"]}, {"_id": 0})
        await complete_wave_and_respawn(db, manager, fresh)
        completed += 1
    return completed


async def _units_used_this_year(db, user_id: str, category: str) -> int:
    """Sum of units the user has committed (reserved/authorized/captured) in this
    category during the current CALENDAR year. Released/cancelled/expired excluded."""
    year_start = _now().replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    parts = await db.wave_participations.find(
        {"user_id": user_id, "category": category,
         "status": {"$in": ACTIVE_PART_STATUSES},
         "created_at": {"$gte": year_start}},
        {"_id": 0, "units": 1},
    ).to_list(5000)
    return sum(int(p.get("units", 0)) for p in parts)


# --------------------------------------------------------------------------
# Heavy request handlers extracted to module level (keeps build_router thin).
# These are pure logic functions: the in-router handlers below just do the
# supplier/admin auth then delegate here. Behaviour is identical.
# --------------------------------------------------------------------------
async def _apply_wave_update(db, manager, wave_id: str, w: dict, payload) -> dict:
    updates: Dict[str, Any] = {}
    for f in ("brand", "title", "description", "image_url", "eta"):
        v = getattr(payload, f)
        if v is not None:
            updates[f] = v.strip() if isinstance(v, str) else v
    if payload.ideal_target is not None:
        updates["ideal_target"] = int(payload.ideal_target)
    if payload.min_activation is not None:
        updates["min_activation"] = int(payload.min_activation)
    if updates.get("min_activation", w["min_activation"]) > updates.get("ideal_target", w["ideal_target"]):
        raise HTTPException(status_code=400, detail="Minimum activation cannot exceed the ideal target")

    if payload.products is not None:
        # Preserve existing reserved/sold counters by variant_id when updating
        existing = {v["variant_id"]: v for p in w.get("products", []) for v in p.get("variants", [])}
        new_products = _normalize_products(payload.products)
        for p in new_products:
            for v in p["variants"]:
                if v["variant_id"] in existing:
                    v["reserved_qty"] = existing[v["variant_id"]].get("reserved_qty", 0)
                    v["sold_qty"] = existing[v["variant_id"]].get("sold_qty", 0)
        updates["products"] = new_products

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.waves.update_one({"wave_id": wave_id}, {"$set": updates})
    fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
    await _recompute_wave(db, manager, fresh)
    fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
    return _public_wave(fresh, full=True)


async def _supplier_order_summary_logic(db, wave_id: str, w: dict) -> dict:
    parts = await db.wave_participations.find(
        {"wave_id": wave_id, "status": {"$in": ACTIVE_PART_STATUSES}}, {"_id": 0}
    ).to_list(2000)

    # Resolve customer contact for each participating user (one query).
    uids = list({p["user_id"] for p in parts})
    users: Dict[str, dict] = {}
    if uids:
        async for u in db.users.find(
            {"user_id": {"$in": uids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1}
        ):
            users[u["user_id"]] = u

    is_tyres = w["category"] == "tyres"
    breakdown: Dict[str, dict] = {}
    destinations: Dict[str, dict] = {}
    orders: List[dict] = []
    total_units = 0
    pay = {"paid_units": 0, "paid_orders": 0, "reserved_units": 0, "reserved_orders": 0,
           "authorized_units": 0, "authorized_orders": 0, "total_orders": len(parts)}

    for p in parts:
        st = p.get("status")
        is_paid = p.get("payment_status") == "paid" or st == "captured"
        units = int(p.get("units", 0))
        u = users.get(p["user_id"], {})
        order_items = []
        for it in p.get("items", []):
            key = it["variant_id"]
            b = breakdown.setdefault(key, {"label": it.get("label"), "model": it.get("model"), "units": 0, "paid_units": 0})
            b["units"] += it["qty"]
            if is_paid:
                b["paid_units"] += it["qty"]
            total_units += it["qty"]
            order_items.append({"model": it.get("model"), "label": it.get("label"), "qty": it["qty"]})

        # payment-status rollup
        if is_paid:
            pay["paid_units"] += units; pay["paid_orders"] += 1
        elif st == "authorized":
            pay["authorized_units"] += units; pay["authorized_orders"] += 1
        else:
            pay["reserved_units"] += units; pay["reserved_orders"] += 1

        dest = p.get("garage_name") or p.get("delivery_address") or "—"
        d = destinations.setdefault(dest, {"destination": dest, "type": "garage" if is_tyres else "delivery",
                                           "units": 0, "items": {}, "fittings": []})
        d["units"] += units
        for it in p.get("items", []):
            ik = f'{it.get("model")} · {it.get("label")}'
            d["items"][ik] = d["items"].get(ik, 0) + it["qty"]
        if p.get("fitting_slot_label"):
            d["fittings"].append({"slot": p["fitting_slot_label"], "units": units})

        orders.append({
            "order_id": p["participation_id"],
            "customer": {"name": u.get("name") or "—", "email": u.get("email"), "phone": u.get("phone")},
            "destination": dest,
            "type": "garage" if is_tyres else "delivery",
            "items": order_items,
            "fitting_slot": p.get("fitting_slot_label"),
            "units": units,
            "subtotal": p.get("subtotal"),
            "payment_status": "paid" if is_paid else ("authorized" if st == "authorized" else "unpaid"),
            "status": st,
            "created_at": p.get("created_at"),
        })

    dest_list = []
    for d in destinations.values():
        d["items"] = [{"label": k, "qty": v} for k, v in d["items"].items()]
        dest_list.append(d)
    orders.sort(key=lambda o: o.get("created_at") or "", reverse=True)

    return {
        "wave_id": wave_id,
        "title": w["title"],
        "state": w["state"],
        "category": w["category"],
        "total_units": total_units,
        "payment_summary": pay,
        "variant_breakdown": list(breakdown.values()),
        "destinations": dest_list,
        "orders": orders,
    }


async def _join_wave_logic(db, manager, get_unit_limits_config, resolve_unit_limit,
                           wave_id: str, payload, user: dict) -> dict:
    w = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
    if not w:
        raise HTTPException(status_code=404, detail="Wave not found")
    if w.get("state") in TERMINAL_OR_MANUAL:
        raise HTTPException(status_code=400, detail="This Wave is no longer accepting participants")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Select at least one product")

    # Wave-level capacity: keep accepting joins (even once activated) until the
    # ideal_target (capacity) is reached — activation is a non-blocking latch.
    ideal = max(1, int(w.get("ideal_target", 1)))
    committed = int(w.get("units_committed", 0))
    if committed >= ideal:
        raise HTTPException(status_code=400, detail="This Wave has reached capacity")

    # Fulfilment validation (garage for tyres, delivery address otherwise)
    garage_name = await _validate_fulfilment(db, w, payload)

    # Derive a human fitting-slot label + validate stock (module helpers)
    fitting_label = _derive_fitting_label(w["category"], payload.fitting_slot_iso, payload.fitting_slot_label)

    # One booking per garage+slot up to the garage's per-slot capacity (bays):
    # reject only once the slot is fully booked (active reservations + bookings).
    if w["category"] == "tyres" and payload.fitting_slot_iso:
        gav = await db.garage_availability.find_one(
            {"garage_id": payload.garage_id}, {"_id": 0, "slot_capacity": 1})
        cap = max(1, int((gav or {}).get("slot_capacity", 1) or 1))
        held = await db.wave_participations.count_documents(
            {"garage_id": payload.garage_id, "fitting_slot_iso": payload.fitting_slot_iso,
             "status": {"$in": ACTIVE_PART_STATUSES}, "user_id": {"$ne": user["user_id"]}})
        booked = await db.bookings.count_documents(
            {"garage_id": payload.garage_id, "slot_iso": payload.fitting_slot_iso, "status": "confirmed"})
        if held + booked >= cap:
            raise HTTPException(status_code=409, detail="That fitting slot is fully booked at this garage — please pick another.")

    items, subtotal, units, inc_ops, array_filters = _validate_join_items(w, payload.items)

    if committed + units > ideal:
        raise HTTPException(status_code=400, detail=f"Only {ideal - committed} unit(s) left in this Wave")

    # Per-user annual unit limit (calendar year), by category. Admin override wins.
    await _enforce_unit_limit(db, w, user, units, get_unit_limits_config, resolve_unit_limit)

    # Atomic-ish reservation: reserve stock, rolling back on a concurrent-join race.
    await _atomic_reserve(db, wave_id, inc_ops, array_filters)

    if payload.accept_terms:
        await _record_terms_acceptance(db, user)

    # Combine repeat joins into ONE payable order: if the user already has an
    # active UNPAID participation on this wave, merge the new items into it
    # (summing quantities) and refresh the fitting/delivery to the latest choice.
    existing = await db.wave_participations.find_one(
        {"wave_id": wave_id, "user_id": user["user_id"],
         "status": {"$in": ["reserved", "authorized"]},
         "payment_status": {"$ne": "paid"}},
        {"_id": 0},
    )
    if existing:
        m_items, m_subtotal, m_units = _merge_items(existing.get("items", []), items)
        update = {
            "items": m_items, "units": m_units, "subtotal": m_subtotal,
            "garage_id": payload.garage_id, "garage_name": garage_name,
            "fitting_slot_iso": payload.fitting_slot_iso, "fitting_slot_label": fitting_label,
            "delivery_address": payload.delivery_address,
            "reservation_expires_at": _iso(_now() + timedelta(minutes=RESERVATION_MINUTES)),
            "updated_at": _iso(_now()),
        }
        await db.wave_participations.update_one(
            {"participation_id": existing["participation_id"]},
            {"$set": update, "$unset": {"payment_session_id": "", "breakdown": "", "payment_method": ""}},
        )
        part = {k: v for k, v in {**existing, **update}.items()
                if k not in ("payment_session_id", "breakdown", "payment_method")}
        merged = True
    else:
        part = _build_participation(w, user, payload, items, subtotal, units, garage_name, fitting_label)
        await db.wave_participations.insert_one(dict(part))
        merged = False

    fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
    await _recompute_wave(db, manager, fresh)
    part.pop("_id", None)
    # Reservation confirmation email (non-blocking, never breaks the join)
    asyncio.create_task(send_join_confirmation(
        user.get("email"), user.get("name"), w, part.get("units", units),
        fitting_label if w["category"] == "tyres" else None,
        payload.delivery_address if w["category"] != "tyres" else None,
    ))
    return {"success": True, "participation": part, "merged": merged,
            "reservation_minutes": RESERVATION_MINUTES}


async def _wave_financials_logic(db, wave_id: str, w: dict) -> dict:
    vidx: Dict[str, dict] = {}
    for p in w.get("products", []):
        for v in p.get("variants", []):
            vidx[v["variant_id"]] = {
                "model": p["model"], "label": v["label"],
                "supplier_cost": float(v.get("supplier_cost", 0) or 0),
                "retail_price": float(v.get("retail_price", 0) or 0),
                "wave_price": float(v.get("wave_price", 0) or 0),
            }
    parts = await db.wave_participations.find(
        {"wave_id": wave_id, "status": {"$in": ACTIVE_PART_STATUSES}}, {"_id": 0}
    ).to_list(5000)

    def _blank():
        return {"units": 0, "revenue": 0.0, "cost": 0.0, "retail_value": 0.0}
    committed, paid = _blank(), _blank()
    by_variant: Dict[str, dict] = {}

    for p in parts:
        is_paid = p.get("payment_status") == "paid" or p.get("status") == "captured"
        for it in p.get("items", []):
            vi = vidx.get(it["variant_id"], {})
            wp = float(it.get("wave_price", vi.get("wave_price", 0)) or 0)
            rp = float(it.get("retail_price", vi.get("retail_price", 0)) or 0)
            sc = float(vi.get("supplier_cost", 0) or 0)
            qty = int(it["qty"])
            committed["units"] += qty; committed["revenue"] += wp * qty
            committed["cost"] += sc * qty; committed["retail_value"] += rp * qty
            if is_paid:
                paid["units"] += qty; paid["revenue"] += wp * qty
                paid["cost"] += sc * qty; paid["retail_value"] += rp * qty
            bv = by_variant.setdefault(it["variant_id"], {
                "model": vi.get("model") or it.get("model"), "label": vi.get("label") or it.get("label"),
                "wave_price": wp, "supplier_cost": sc, "retail_price": rp,
                "units": 0, "paid_units": 0, "revenue": 0.0, "cost": 0.0, "margin": 0.0,
            })
            bv["units"] += qty; bv["revenue"] += wp * qty; bv["cost"] += sc * qty
            bv["margin"] += (wp - sc) * qty
            if is_paid:
                bv["paid_units"] += qty

    def _finalize(b):
        b["margin"] = round(b["revenue"] - b["cost"], 2)
        b["savings"] = round(b["retail_value"] - b["revenue"], 2)
        for k in ("revenue", "cost", "retail_value"):
            b[k] = round(b[k], 2)
        return b
    for bv in by_variant.values():
        for k in ("revenue", "cost", "margin"):
            bv[k] = round(bv[k], 2)

    sup = await db.suppliers.find_one({"supplier_id": w.get("supplier_id")}, {"_id": 0, "business_name": 1})
    return {
        "wave_id": wave_id, "title": w["title"], "category": w["category"],
        "category_label": w.get("category_label"), "state": w["state"],
        "supplier_name": sup.get("business_name") if sup else "—",
        "committed": _finalize(committed), "paid": _finalize(paid),
        "by_variant": list(by_variant.values()),
    }



async def _create_wave_for_supplier(db, supplier: dict, payload) -> dict:
    region = await db.regions.find_one({"region_id": payload.region_id, "active": True}, {"_id": 0})
    if not region:
        raise HTTPException(status_code=400, detail="Invalid or inactive region")
    if payload.min_activation > payload.ideal_target:
        raise HTTPException(status_code=400, detail="Minimum activation cannot exceed the ideal target")
    # Category: canonical id, or a custom slug (for "Other — specify"). Derive a
    # human label; everything except `tyres` ships to a delivery address.
    category = (payload.category or "").strip().lower()
    if not category:
        raise HTTPException(status_code=400, detail="Please choose a product category")
    category_label = (payload.category_label or "").strip() or CATEGORY_LABELS.get(category, category.replace("_", " ").title())
    title = (payload.title or "").strip() or f"{region['name']} {payload.brand} {category_label} Wave"
    wave = {
        "wave_id": f"wave_{uuid.uuid4().hex[:10]}",
        "supplier_id": supplier["supplier_id"],
        "category": category,
        "category_label": category_label,
        "region_id": region["region_id"],
        "region_name": region["name"],
        "brand": payload.brand.strip(),
        "title": title,
        "description": payload.description.strip(),
        "image_url": payload.image_url or "",
        "products": _normalize_products(payload.products),
        "ideal_target": int(payload.ideal_target),
        "min_activation": int(payload.min_activation),
        "eta": payload.eta.strip(),
        "state": "open",
        "units_committed": 0,
        "participants_count": 0,
        "created_at": _now(),
        "activated_at": None,
        "deadline": _now() + timedelta(days=max(1, payload.deadline_days)),
    }
    await db.waves.insert_one(dict(wave))
    await db.suppliers.update_one({"supplier_id": supplier["supplier_id"]}, {"$inc": {"waves_published": 1}})
    return _public_wave(wave, full=True)


async def _store_wave_image(db, owner_id: str, file) -> dict:
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in storage.MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type — use JPG, PNG, GIF or WEBP")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large — max 5MB")
    content_type = storage.MIME_TYPES[ext]
    path = f"{storage.APP_NAME}/wave-images/{owner_id}/{uuid.uuid4().hex}.{ext}"
    try:
        result = await asyncio.to_thread(storage.put_object, path, data, content_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Image upload failed — please try again") from e
    stored_path = result.get("path", path)
    await db.files.insert_one({
        "id": uuid.uuid4().hex,
        "storage_path": stored_path,
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "supplier_id": owner_id,
        "is_deleted": False,
        "created_at": _iso(_now()),
    })
    return {"image_url": f"/api/wave-images/{stored_path}"}


async def _admin_orders_logic(db) -> dict:
    """All consumer purchase orders (wave participations) with complete details,
    enriched with customer / wave / supplier via batched $in queries (no N+1)."""
    parts = await db.wave_participations.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    uids = list({p["user_id"] for p in parts})
    wids = list({p["wave_id"] for p in parts})
    users: Dict[str, dict] = {}
    async for u in db.users.find({"user_id": {"$in": uids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1}):
        users[u["user_id"]] = u
    waves: Dict[str, dict] = {}
    async for w in db.waves.find({"wave_id": {"$in": wids}}, {"_id": 0, "wave_id": 1, "title": 1, "region_name": 1, "category": 1, "category_label": 1, "supplier_id": 1}):
        waves[w["wave_id"]] = w
    sup_ids = list({w.get("supplier_id") for w in waves.values() if w.get("supplier_id")})
    sups: Dict[str, str] = {}
    async for s in db.suppliers.find({"supplier_id": {"$in": sup_ids}}, {"_id": 0, "supplier_id": 1, "business_name": 1}):
        sups[s["supplier_id"]] = s.get("business_name")

    orders: List[dict] = []
    stats = {"total": len(parts), "paid": 0, "authorized": 0, "reserved": 0, "cancelled": 0, "revenue": 0.0, "paid_units": 0}
    for p in parts:
        bd = p.get("breakdown") or {}
        st = p.get("status")
        is_paid = p.get("payment_status") == "paid" or st == "captured"
        if is_paid:
            pay_state = "paid"
        elif st == "authorized":
            pay_state = "authorized"
        elif st in ("cancelled", "expired", "refunded", "released"):
            pay_state = "cancelled"
        else:
            pay_state = "reserved"
        stats[pay_state] = stats.get(pay_state, 0) + 1
        total = bd.get("final_total")
        if is_paid:
            stats["revenue"] += float(total if total is not None else p.get("subtotal", 0) or 0)
            stats["paid_units"] += int(p.get("units", 0))
        u = users.get(p["user_id"], {})
        w = waves.get(p["wave_id"], {})
        is_tyres = p.get("category") == "tyres"
        orders.append({
            "order_id": p["participation_id"],
            "created_at": p.get("created_at"),
            "paid_at": p.get("paid_at"),
            "status": st,
            "payment_status": pay_state,
            "payment_method": p.get("payment_method"),
            "category": p.get("category"),
            "category_label": w.get("category_label") or p.get("category"),
            "units": int(p.get("units", 0)),
            "subtotal": p.get("subtotal"),
            "service_fee": bd.get("service_fee"),
            "payment_fee": bd.get("payment_fee"),
            "total": total,
            "customer": {"name": u.get("name") or "—", "email": u.get("email") or "—", "phone": u.get("phone") or "—"},
            "wave": {
                "wave_id": p["wave_id"],
                "title": w.get("title") or "—",
                "region_name": w.get("region_name") or "—",
                "supplier_name": sups.get(w.get("supplier_id")) or "—",
            },
            "items": [{"model": it.get("model"), "label": it.get("label"), "qty": it.get("qty"), "wave_price": it.get("wave_price")} for it in p.get("items", [])],
            "fulfilment": {
                "type": "garage" if is_tyres else "delivery",
                "garage_name": p.get("garage_name"),
                "fitting_slot": p.get("fitting_slot_label"),
                "delivery_address": p.get("delivery_address"),
            },
        })
    stats["revenue"] = round(stats["revenue"], 2)
    return {"orders": orders, "stats": stats}


# --------------------------------------------------------------------------
# Router
# --------------------------------------------------------------------------
def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    get_current_user_optional = deps["get_current_user_optional"]
    require_role = deps["require_role"]
    manager = deps["manager"]
    get_unit_limits_config = deps.get("get_unit_limits_config")
    resolve_unit_limit = deps.get("resolve_unit_limit")

    router = APIRouter()

    # ----- helpers -----
    async def _require_supplier(user: dict) -> dict:
        if not user.get("supplier_id"):
            raise HTTPException(status_code=403, detail="Supplier account required")
        s = await db.suppliers.find_one({"supplier_id": user["supplier_id"]}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=403, detail="Supplier profile not found")
        if s.get("account_status") in ("suspended", "deleted"):
            raise HTTPException(status_code=403, detail="Supplier account is not active")
        return s

    async def _broadcast_wave(wave_id: str, payload: dict):
        await manager.broadcast(f"wave:{wave_id}", payload)
        await manager.broadcast("waves:feed", {**payload, "wave_id": wave_id})

    async def _recompute(wave: dict) -> dict:
        return await _recompute_wave(db, manager, wave)

    # =================================================================
    # REGIONS
    # =================================================================
    @router.get("/regions")
    async def list_regions(all_regions: bool = False, user: Optional[dict] = Depends(get_current_user_optional)):
        q = {} if (all_regions and user and user.get("role") == "admin") else {"active": True}
        docs = await db.regions.find(q, {"_id": 0}).sort("name", 1).to_list(200)
        return docs

    @router.post("/admin/regions")
    async def create_region(payload: RegionCreateRequest, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        name = payload.name.strip()
        slug = name.lower().replace(" ", "-")
        if await db.regions.find_one({"slug": slug}):
            raise HTTPException(status_code=400, detail="Region already exists")
        doc = {"region_id": f"reg_{uuid.uuid4().hex[:8]}", "name": name, "slug": slug, "active": True, "created_at": _iso(_now())}
        await db.regions.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @router.patch("/admin/regions/{region_id}")
    async def update_region(region_id: str, payload: RegionUpdateRequest, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
        if "name" in updates:
            updates["slug"] = updates["name"].strip().lower().replace(" ", "-")
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        r = await db.regions.update_one({"region_id": region_id}, {"$set": updates})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Region not found")
        return await db.regions.find_one({"region_id": region_id}, {"_id": 0})

    @router.delete("/admin/regions/{region_id}")
    async def delete_region(region_id: str, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        if await db.waves.count_documents({"region_id": region_id}):
            raise HTTPException(status_code=400, detail="Region has waves — deactivate instead")
        await db.regions.delete_one({"region_id": region_id})
        return {"success": True}

    @router.get("/wave-categories")
    async def wave_categories():
        return [{"id": c, "label": CATEGORY_LABELS[c]} for c in CATEGORIES]

    # =================================================================
    # WAVE IMAGES — supplier upload + public serve
    # =================================================================
    @router.post("/supplier/wave-image")
    async def upload_wave_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        return await _store_wave_image(db, supplier["supplier_id"], file)

    @router.get("/wave-images/{path:path}")
    async def serve_wave_image(path: str):
        record = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=404, detail="Image not found")
        try:
            data, content_type = await asyncio.to_thread(storage.get_object, path)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=404, detail="Image not found") from e
        return Response(
            content=data,
            media_type=record.get("content_type") or content_type,
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )


    # =================================================================
    # SUPPLIER — Wave CRUD
    # =================================================================
    @router.post("/supplier/waves")
    async def create_wave(payload: WaveCreateRequest, user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        return await _create_wave_for_supplier(db, supplier, payload)

    @router.get("/supplier/waves")
    async def list_my_waves(user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        docs = await db.waves.find({"supplier_id": supplier["supplier_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return [_public_wave(d, full=True) for d in docs]

    @router.get("/supplier/waves/{wave_id}")
    async def get_my_wave(wave_id: str, user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        w = await db.waves.find_one({"wave_id": wave_id, "supplier_id": supplier["supplier_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        return _public_wave(w, full=True)

    @router.patch("/supplier/waves/{wave_id}")
    async def update_wave(wave_id: str, payload: WaveUpdateRequest, user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        w = await db.waves.find_one({"wave_id": wave_id, "supplier_id": supplier["supplier_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        if w.get("state") in ("processing", "fulfilment", "completed"):
            raise HTTPException(status_code=400, detail="Cannot edit a wave that is already in fulfilment")
        return await _apply_wave_update(db, manager, wave_id, w, payload)

    @router.delete("/supplier/waves/{wave_id}")
    async def delete_wave(wave_id: str, user: dict = Depends(get_current_user)):
        """Cancel/remove a wave. Releases all active reservations and notifies subscribers."""
        supplier = await _require_supplier(user)
        w = await db.waves.find_one({"wave_id": wave_id, "supplier_id": supplier["supplier_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        captured = await db.wave_participations.count_documents({"wave_id": wave_id, "status": "captured"})
        if captured:
            raise HTTPException(status_code=400, detail="Cannot remove — this wave has captured payments. Mark it completed instead.")
        await db.wave_participations.update_many(
            {"wave_id": wave_id, "status": {"$in": ["reserved", "authorized"]}},
            {"$set": {"status": "cancelled", "cancelled_at": _iso(_now())}},
        )
        await db.waves.delete_one({"wave_id": wave_id})
        await db.suppliers.update_one({"supplier_id": supplier["supplier_id"]}, {"$inc": {"waves_published": -1}})
        await _broadcast_wave(wave_id, {"type": "wave_removed"})
        return {"success": True}

    @router.get("/supplier/waves/{wave_id}/order-summary")
    async def supplier_order_summary(wave_id: str, user: dict = Depends(get_current_user)):
        """Post-activation consolidated order summary: per-variant units (+paid),
        payment-status breakdown, per-destination item detail, and per-order
        customer contact for fulfilment coordination."""
        supplier = await _require_supplier(user)
        w = await db.waves.find_one({"wave_id": wave_id, "supplier_id": supplier["supplier_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        return await _supplier_order_summary_logic(db, wave_id, w)

    # =================================================================
    # CONSUMER / PUBLIC
    # =================================================================
    @router.get("/waves")
    async def list_waves(
        category: Optional[str] = None,
        region_id: Optional[str] = None,
        q: Optional[str] = None,
        size: Optional[str] = None,
    ):
        query: Dict[str, Any] = {"state": {"$in": ["open", "almost_full", "activated"]}}
        if category:
            query["category"] = category
        if region_id:
            query["region_id"] = region_id
        if q:
            import re
            qre = {"$regex": re.escape(q), "$options": "i"}
            query["$or"] = [{"title": qre}, {"brand": qre}, {"products.model": qre}, {"region_name": qre}]
        docs = await db.waves.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
        results = [_public_wave(d) for d in docs]
        if size:
            sn = size.strip().lower().replace(" ", "")
            results = [
                w for w in results
                if any(sn in (v["label"].lower().replace(" ", "")) for p in w["products"] for v in p["variants"])
            ]
        return results

    @router.get("/waves/{wave_id}")
    async def get_wave(wave_id: str, user: Optional[dict] = Depends(get_current_user_optional)):
        w = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        is_owner_or_admin = user and (user.get("role") == "admin" or user.get("supplier_id") == w.get("supplier_id"))
        return _public_wave(w, full=bool(is_owner_or_admin))

    @router.post("/waves/{wave_id}/join")
    async def join_wave(wave_id: str, payload: WaveJoinRequest, user: dict = Depends(get_current_user)):
        return await _join_wave_logic(db, manager, get_unit_limits_config, resolve_unit_limit,
                                      wave_id, payload, user)

    @router.get("/me/wave-orders")
    async def my_wave_orders(user: dict = Depends(get_current_user)):
        parts = await db.wave_participations.find(
            {"user_id": user["user_id"], "status": {"$ne": "cancelled"}}, {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        wave_ids = list({p["wave_id"] for p in parts})
        waves = await db.waves.find({"wave_id": {"$in": wave_ids}}, {"_id": 0}).to_list(len(wave_ids) or 1)
        by_id = {w["wave_id"]: w for w in waves}
        out = []
        for p in parts:
            w = by_id.get(p["wave_id"])
            if not w:
                continue
            out.append({**p, "wave": _public_wave(w)})
        return out

    @router.get("/me/unit-allowance")
    async def my_unit_allowance(category: str = Query(...), user: dict = Depends(get_current_user)):
        """Remaining annual (calendar-year) unit allowance for the current user in a category."""
        category = (category or "").strip().lower()
        if not category:
            raise HTTPException(status_code=400, detail="Category is required")
        # Custom categories fall back to the global default limit via resolve_unit_limit.
        cfg = await get_unit_limits_config() if get_unit_limits_config else {}
        limit = resolve_unit_limit(cfg, user, category) if resolve_unit_limit else 0
        used = await _units_used_this_year(db, user["user_id"], category)
        has_override = category in ((user or {}).get("unit_limit_overrides") or {})
        return {
            "category": category, "limit": limit, "used": used,
            "remaining": max(0, limit - used), "year": _now().year,
            "override": has_override,
        }

    @router.delete("/me/wave-orders/{participation_id}")
    async def cancel_my_order(participation_id: str, user: dict = Depends(get_current_user)):
        p = await db.wave_participations.find_one({"participation_id": participation_id, "user_id": user["user_id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Order not found")
        if p["status"] == "captured":
            raise HTTPException(status_code=400, detail="Payment already captured — contact support")
        if p["status"] == "cancelled":
            return {"success": True}
        # release reserved inventory
        inc_ops, array_filters = {}, []
        for idx, it in enumerate(p.get("items", [])):
            inc_ops[f"products.$[p{idx}].variants.$[v{idx}].reserved_qty"] = -it["qty"]
            array_filters.append({f"p{idx}.product_id": it["product_id"]})
            array_filters.append({f"v{idx}.variant_id": it["variant_id"]})
        await db.wave_participations.update_one(
            {"participation_id": participation_id},
            {"$set": {"status": "cancelled", "cancelled_at": _iso(_now())}},
        )
        if inc_ops:
            await db.waves.update_one({"wave_id": p["wave_id"]}, {"$inc": inc_ops}, array_filters=array_filters)
        w = await db.waves.find_one({"wave_id": p["wave_id"]}, {"_id": 0})
        if w:
            await _recompute(w)
        return {"success": True}

    # =================================================================
    # ADMIN — Regional Waves oversight
    # =================================================================
    @router.get("/admin/regional-waves")
    async def admin_list_waves(user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        docs = await db.waves.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
        sup_ids = list({d.get("supplier_id") for d in docs if d.get("supplier_id")})
        sups = await db.suppliers.find({"supplier_id": {"$in": sup_ids}}, {"_id": 0, "supplier_id": 1, "business_name": 1}).to_list(len(sup_ids) or 1)
        sup_names = {s["supplier_id"]: s.get("business_name") for s in sups}
        return [{**_public_wave(d, full=True), "supplier_name": sup_names.get(d.get("supplier_id"), "—")} for d in docs]

    @router.post("/admin/regional-waves")
    async def admin_create_wave(payload: AdminWaveCreateRequest, user: dict = Depends(get_current_user)):
        """Admin creates a Regional Wave on behalf of a chosen supplier (same flow as the supplier console)."""
        await require_role(user, ["admin"])
        supplier = await db.suppliers.find_one({"supplier_id": payload.supplier_id}, {"_id": 0})
        if not supplier:
            raise HTTPException(status_code=400, detail="Select a valid supplier")
        if supplier.get("account_status") in ("suspended", "deleted"):
            raise HTTPException(status_code=400, detail="That supplier account is not active")
        return await _create_wave_for_supplier(db, supplier, payload)

    @router.post("/admin/wave-image")
    async def admin_upload_wave_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        return await _store_wave_image(db, "admin", file)

    @router.get("/admin/orders")
    async def admin_orders(user: dict = Depends(get_current_user)):
        """All consumer purchase orders across every wave, with full details + rollup stats."""
        await require_role(user, ["admin"])
        return await _admin_orders_logic(db)

    @router.get("/admin/scheduled-waves")
    async def admin_list_scheduled_waves(user: dict = Depends(get_current_user)):
        """Pending wave regenerations queued for a future working day (auto-engine monitor)."""
        await require_role(user, ["admin"])
        docs = await db.scheduled_waves.find({"created": {"$ne": True}}, {"_id": 0}).to_list(200)
        sup_ids = list({sw.get("spec", {}).get("supplier_id") for sw in docs if sw.get("spec", {}).get("supplier_id")})
        sups = await db.suppliers.find({"supplier_id": {"$in": sup_ids}}, {"_id": 0, "supplier_id": 1, "business_name": 1}).to_list(len(sup_ids) or 1)
        sup_names = {s["supplier_id"]: s.get("business_name") for s in sups}
        out = []
        for sw in docs:
            spec = sw.get("spec", {})
            out.append({
                "scheduled_id": sw.get("scheduled_id"),
                "title": spec.get("title"),
                "region_name": spec.get("region_name"),
                "category_label": spec.get("category_label") or CATEGORY_LABELS.get(spec.get("category"), spec.get("category")),
                "units": spec.get("ideal_target", 0),
                "carried_units": spec.get("carried_units", 0),
                "round": spec.get("round"),
                "create_at": sw.get("create_at"),
                "create_at_local": sw.get("create_at_local"),
                "parent_wave_id": sw.get("parent_wave_id"),
                "supplier_name": sup_names.get(spec.get("supplier_id"), "—"),
            })
        out.sort(key=lambda x: x.get("create_at") or "")
        return out

    @router.post("/admin/scheduled-waves/{scheduled_id}/start")
    async def admin_start_scheduled_wave(scheduled_id: str, user: dict = Depends(get_current_user)):
        """Force a queued regeneration to go LIVE now (deadline = today's cut-off)."""
        await require_role(user, ["admin"])
        sw = await db.scheduled_waves.find_one({"scheduled_id": scheduled_id, "created": {"$ne": True}}, {"_id": 0})
        if not sw:
            raise HTTPException(404, "Pending wave not found")
        new_id = await _materialize_scheduled_wave(db, manager, sw)
        return {"started": True, "wave_id": new_id}

    @router.delete("/admin/scheduled-waves/{scheduled_id}")
    async def admin_cancel_scheduled_wave(scheduled_id: str, user: dict = Depends(get_current_user)):
        """Cancel (remove) a queued regeneration so it never launches."""
        await require_role(user, ["admin"])
        res = await db.scheduled_waves.delete_one({"scheduled_id": scheduled_id, "created": {"$ne": True}})
        if res.deleted_count == 0:
            raise HTTPException(404, "Pending wave not found")
        return {"cancelled": True}

    @router.patch("/admin/regional-waves/{wave_id}/state")
    async def admin_set_state(wave_id: str, payload: StateUpdateRequest, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        valid = ["open", "almost_full", "activated", "processing", "fulfilment", "completed", "expired"]
        if payload.state not in valid:
            raise HTTPException(status_code=400, detail="Invalid state")
        r = await db.waves.update_one({"wave_id": wave_id}, {"$set": {"state": payload.state}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Wave not found")
        await _broadcast_wave(wave_id, {"type": "wave_update", "state": payload.state})
        respawn = None
        if payload.state == "completed":
            fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
            respawn = await complete_wave_and_respawn(db, manager, fresh)
        result = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        if respawn:
            result["respawn_result"] = respawn
        return result

    @router.get("/admin/regional-waves/{wave_id}/financials")
    async def admin_wave_financials(wave_id: str, user: dict = Depends(get_current_user)):
        """Admin-only wave financials: revenue (wave price × units), supplier cost,
        gross margin, RRP value and savings passed to customers — for committed
        (reserved/authorized/captured) and paid-only (captured) units, plus a
        per-variant breakdown."""
        await require_role(user, ["admin"])
        w = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        return await _wave_financials_logic(db, wave_id, w)


    @router.delete("/admin/regional-waves/{wave_id}")
    async def admin_delete_wave(wave_id: str, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        w = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        await db.wave_participations.update_many(
            {"wave_id": wave_id, "status": {"$in": ["reserved", "authorized"]}},
            {"$set": {"status": "cancelled", "cancelled_at": _iso(_now())}},
        )
        await db.waves.delete_one({"wave_id": wave_id})
        await _broadcast_wave(wave_id, {"type": "wave_removed"})
        return {"success": True}

    return router


# --------------------------------------------------------------------------
# Auto-respawn: when a wave COMPLETES with stock remaining, spin up a follow-on
# wave that keeps the ORIGINAL ideal target & min activation, carrying leftover
# stock, until stock depletes. Schedule (Europe/London, Mon–Sat excl. Sun + UK
# bank holidays): regenerate immediately while within working hours before the
# day's cut-off (Mon–Fri 16:30, Saturday midnight); otherwise the next working
# day 08:30 (e.g. weekend completions relaunch Monday 08:30).
# --------------------------------------------------------------------------
def _london_now() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/London"))
    except Exception:
        return datetime.now(timezone.utc)


def _is_working_day(d: datetime) -> bool:
    """True for Mon–Sat that are NOT UK (England & Wales) bank holidays. Sundays excluded."""
    if d.weekday() == 6:  # Sunday
        return False
    return d.date() not in _UK_HOLIDAYS


def _next_working_day_0830(now: datetime) -> datetime:
    """The FOLLOWING working day at 08:30 (London). Always strictly after `now`'s day —
    orders are placed the next working day, skipping Sundays + UK bank holidays."""
    d = now + timedelta(days=1)
    while not _is_working_day(d):
        d = d + timedelta(days=1)
    return d.replace(hour=WORK_START_H, minute=WORK_START_M, second=0, microsecond=0)


def _next_creation_time_london(now: Optional[datetime] = None) -> datetime:
    """London datetime when the next (respawned) wave/order should be created:
    the following working day at 08:30. (Used for scheduled/deferred respawns.)"""
    now = now or _london_now()
    return _next_working_day_0830(now)


def _day_cutoff_hm(d: datetime):
    """Order/deadline cut-off for a given working day (London):
      • Mon–Fri → 16:30 (corporate offices close ~5pm)
      • Saturday → 24:00 (midnight; distributor fulfils next opening hours)."""
    return (23, 59) if d.weekday() == 5 else (WORK_END_H, WORK_END_M)


def _respawn_schedule(now: Optional[datetime] = None) -> Optional[datetime]:
    """Decide WHEN a respawn should launch (regeneration runs only while stock is left):
      • working day, 08:30 → cut-off  → None (regenerate immediately, live now)
            – Mon–Fri cut-off = 16:30
            – Saturday  cut-off = midnight
      • working day, before 08:30     → today 08:30
      • working day, after cut-off    → next working day 08:30
      • non-working day (Sun/bank hol)→ next working day 08:30 (e.g. Monday 08:30)
    Working days = Mon–Sat excluding Sundays + UK bank holidays."""
    now = now or _london_now()
    if not _is_working_day(now):
        return _next_working_day_0830(now)
    if (now.hour, now.minute) < (WORK_START_H, WORK_START_M):
        return now.replace(hour=WORK_START_H, minute=WORK_START_M, second=0, microsecond=0)
    if (now.hour, now.minute) < _day_cutoff_hm(now):
        return None  # within working hours, before cut-off → regenerate immediately
    return _next_working_day_0830(now)  # past cut-off → next working day 08:30


def _deadline_for_creation_london(create_local: Optional[datetime] = None) -> datetime:
    """Wave deadline (Europe/London → UTC): Mon–Fri 16:30, Saturday midnight."""
    create_local = create_local or _london_now()
    h, m = _day_cutoff_hm(create_local)
    sec = 59 if (h, m) == (23, 59) else 0
    dl_local = create_local.replace(hour=h, minute=m, second=sec, microsecond=0)
    return dl_local.astimezone(timezone.utc)


def _compute_remaining_products(wave: dict):
    """Build fresh product/variant list for leftover (unsold) stock."""
    new_products, total = [], 0
    for p in wave.get("products", []):
        variants = []
        for v in p.get("variants", []):
            remaining = int(v.get("inventory_qty", 0)) - int(v.get("sold_qty", 0))
            if remaining > 0:
                variants.append({
                    "variant_id": f"var_{uuid.uuid4().hex[:8]}",
                    "label": v["label"], "supplier_cost": v["supplier_cost"],
                    "retail_price": v["retail_price"], "wave_price": v["wave_price"],
                    "inventory_qty": remaining, "reserved_qty": 0, "sold_qty": 0,
                })
                total += remaining
        if variants:
            new_products.append({"product_id": f"prd_{uuid.uuid4().hex[:8]}", "model": p["model"], "image_url": p.get("image_url", ""), "variants": variants})
    return new_products, total


def _build_respawn_doc(wave: dict, remaining_products: List[dict], total_remaining: int,
                       carried_units: int = 0) -> dict:
    base_title = wave.get("origin_title") or wave["title"]
    rnd = int(wave.get("round", 1)) + 1
    return {
        "wave_id": f"wave_{uuid.uuid4().hex[:10]}",
        "supplier_id": wave["supplier_id"],
        "category": wave["category"],
        "region_id": wave.get("region_id"),
        "region_name": wave.get("region_name"),
        "brand": wave.get("brand"),
        "title": f"{base_title} · Round {rnd}",
        "origin_title": base_title,
        "description": wave.get("description", ""),
        "image_url": wave.get("image_url", ""),
        "products": remaining_products,
        # Regenerated waves keep the ORIGINAL ideal target & min activation
        # (carried across rounds), not the reduced leftover count.
        "ideal_target": int(wave.get("ideal_target", total_remaining)),
        "min_activation": int(wave.get("min_activation", total_remaining)),
        "eta": wave.get("eta", ""),
        "state": "open",
        "units_committed": 0,
        "participants_count": 0,
        # Informational only — units allocated (reserved/authorized but unpaid) on
        # the previous wave that carry into this round's stock. Does NOT count
        # toward progress/min_activation (the bar starts at 0).
        "carried_units": int(carried_units),
        "round": rnd,
        "origin_wave_id": wave.get("origin_wave_id", wave["wave_id"]),
        "parent_wave_id": wave["wave_id"],
        "created_at": _now(),
        "activated_at": None,
        "deadline": _deadline_for_creation_london(),
    }


async def complete_wave_and_respawn(db, manager, wave: dict) -> dict:
    """Mark a completed wave's committed units as sold, then respawn leftover stock."""
    if wave.get("respawned"):
        return {"respawned": False, "reason": "already_processed"}
    wid = wave["wave_id"]
    # Only CAPTURED (paid) units deplete real stock. Reserved/authorized-but-unpaid
    # participations did NOT sell — their units roll back into the respawn pool.
    parts = await db.wave_participations.find(
        {"wave_id": wid, "status": "captured"}, {"_id": 0}
    ).to_list(5000)
    sold: Dict[str, int] = {}
    for pt in parts:
        for it in pt.get("items", []):
            sold[it["variant_id"]] = sold.get(it["variant_id"], 0) + it["qty"]
    # Demand signal: any active participation (reserved/authorized/captured) means the
    # wave saw real interest — even if nobody completed payment. We respawn the leftover
    # stock on demand, not only on captured sales.
    engaged = await db.wave_participations.count_documents(
        {"wave_id": wid, "status": {"$in": ACTIVE_PART_STATUSES}}
    )
    # Carried units = allocated-but-unpaid (reserved/authorized) units on the
    # completed wave. These roll into the leftover stock of the new round and are
    # surfaced as an informational "carried from previous wave" counter.
    carried_agg = await db.wave_participations.aggregate([
        {"$match": {"wave_id": wid, "status": {"$in": ["reserved", "authorized"]}}},
        {"$group": {"_id": None, "units": {"$sum": "$units"}}},
    ]).to_list(1)
    carried_units = int(carried_agg[0]["units"]) if carried_agg else 0
    prods = wave.get("products", [])
    for p in prods:
        for v in p.get("variants", []):
            if v["variant_id"] in sold:
                v["sold_qty"] = max(int(v.get("sold_qty", 0)), sold[v["variant_id"]])
            v["reserved_qty"] = 0
    await db.waves.update_one({"wave_id": wid}, {"$set": {"products": prods, "respawned": True}})
    wave["products"] = prods

    # Release stranded reservations (joined but never paid) on the now-completed wave.
    await db.wave_participations.update_many(
        {"wave_id": wid, "status": {"$in": ["reserved", "authorized"]}},
        {"$set": {"status": "released", "released_at": _iso(_now())}},
    )

    sold_total = sum(sold.values())
    remaining_products, total_remaining = _compute_remaining_products(wave)
    # Regeneration rule: a wave relists whenever STOCK REMAINS — regardless of demand
    # (completed OR under-filled/expired). It keeps relisting until stock depletes.
    if total_remaining <= 0:
        return {"respawned": False, "reason": "no_stock_left",
                "engaged": engaged, "sold": sold_total, "remaining": total_remaining}

    doc = _build_respawn_doc(wave, remaining_products, total_remaining, carried_units)
    # Option C: launch immediately if completed during working hours (Mon–Sat ≥08:30);
    # otherwise schedule for the next working day 08:30.
    when = _respawn_schedule()
    if when is None:
        doc["created_at"] = _now()
        doc["deadline"] = _deadline_for_creation_london(_london_now())
        await db.waves.insert_one(dict(doc))
        await db.suppliers.update_one({"supplier_id": doc["supplier_id"]}, {"$inc": {"waves_published": 1}})
        await manager.broadcast("waves:feed", {"type": "wave_created", "wave_id": doc["wave_id"], "title": doc["title"]})
        return {"respawned": True, "scheduled": False, "new_wave_id": doc["wave_id"],
                "units": total_remaining, "carried_units": carried_units}

    spec = dict(doc)
    spec["created_at"] = None
    spec["deadline"] = None
    await db.scheduled_waves.insert_one({
        "scheduled_id": f"sw_{uuid.uuid4().hex[:10]}",
        "create_at": when.astimezone(timezone.utc).isoformat(),
        "create_at_local": when.isoformat(),
        "spec": spec,
        "origin_wave_id": doc["origin_wave_id"],
        "parent_wave_id": wid,
        "created": False,
    })
    return {"respawned": True, "scheduled": True, "create_at": when.isoformat(),
            "units": total_remaining, "carried_units": carried_units}


async def _materialize_scheduled_wave(db, manager, sw: dict) -> str:
    """Turn a queued scheduled_wave spec into a live open wave. Returns the new wave_id."""
    spec = dict(sw["spec"])
    spec["wave_id"] = spec.get("wave_id") or f"wave_{uuid.uuid4().hex[:10]}"
    spec["created_at"] = _now()
    spec["deadline"] = _deadline_for_creation_london(_london_now())
    spec["activated_at"] = None
    spec["state"] = "open"
    await db.waves.insert_one(dict(spec))
    await db.suppliers.update_one({"supplier_id": spec["supplier_id"]}, {"$inc": {"waves_published": 1}})
    await db.scheduled_waves.update_one({"scheduled_id": sw["scheduled_id"]},
                                        {"$set": {"created": True, "created_wave_id": spec["wave_id"], "created_real_at": _now().isoformat()}})
    await manager.broadcast("waves:feed", {"type": "wave_created", "wave_id": spec["wave_id"], "title": spec.get("title")})
    return spec["wave_id"]


async def process_due_scheduled_waves(db, manager) -> int:
    """Background worker tick: materialise any scheduled follow-on waves now due."""
    now_iso = _now().isoformat()
    due = await db.scheduled_waves.find({"created": False, "create_at": {"$lte": now_iso}}, {"_id": 0}).to_list(100)
    count = 0
    for sw in due:
        await _materialize_scheduled_wave(db, manager, sw)
        count += 1
    return count


# --------------------------------------------------------------------------
# Seeding (called from server.startup)
# --------------------------------------------------------------------------
SEED_REGIONS = ["Warwickshire", "Coventry", "Leamington Spa", "Rugby", "Midlands"]

SEED_GARAGES = [
    {"business_name": "Coventry Tyre Centre", "city": "Coventry", "postcode": "CV1 2AB", "phone": "+44 24 7600 1010"},
    {"business_name": "Warwick Fast Fit", "city": "Warwick", "postcode": "CV34 4QP", "phone": "+44 1926 400 200"},
    {"business_name": "Leamington Garage Hub", "city": "Leamington Spa", "postcode": "CV31 1XT", "phone": "+44 1926 300 300"},
    {"business_name": "Rugby Wheel & Tyre", "city": "Rugby", "postcode": "CV21 2AA", "phone": "+44 1788 500 500"},
]


async def seed_garages(db) -> int:
    """Idempotent seed of approved local fitting garages (verified + active)."""
    created = 0
    for g in SEED_GARAGES:
        if await db.garages.find_one({"business_name": g["business_name"]}, {"_id": 0}):
            continue
        await db.garages.insert_one({
            "garage_id": f"gar_{uuid.uuid4().hex[:10]}",
            "user_id": f"seed_garage_{uuid.uuid4().hex[:8]}",
            "business_name": g["business_name"],
            "contact_email": "founder@thecollectivesavers.co.uk",
            "contact_phone": g["phone"],
            "garage_type": "local_garage",
            "services": ["tyre_fitting", "balancing", "tpms"],
            "address_line1": "1 High Street",
            "city": g["city"],
            "postcode": g["postcode"],
            "is_active": True,
            "is_verified": True,
            "verified_at": _iso(_now()),
            "created_at": _iso(_now()),
        })
        created += 1
    return created


async def seed_regions_and_waves(db) -> int:
    """Idempotent seed of local regions + two demo Regional Waves."""
    created = 0
    region_ids = {}
    for name in SEED_REGIONS:
        slug = name.lower().replace(" ", "-")
        existing = await db.regions.find_one({"slug": slug}, {"_id": 0})
        if existing:
            region_ids[name] = existing["region_id"]
            continue
        rid = f"reg_{uuid.uuid4().hex[:8]}"
        await db.regions.insert_one({"region_id": rid, "name": name, "slug": slug, "active": True, "created_at": _iso(_now())})
        region_ids[name] = rid
        created += 1

    # Demo waves only if no waves exist yet
    if await db.waves.count_documents({}) == 0:
        supplier = await db.suppliers.find_one({}, {"_id": 0})
        sup_id = supplier["supplier_id"] if supplier else "sup_demo"

        def variant(label, cost, retail, wave, qty):
            return {"variant_id": f"var_{uuid.uuid4().hex[:8]}", "label": label, "supplier_cost": cost,
                    "retail_price": retail, "wave_price": wave, "inventory_qty": qty, "reserved_qty": 0, "sold_qty": 0}

        demos = [
            {
                "category": "tyres", "region": "Warwickshire", "brand": "Continental",
                "title": "Warwickshire Conti Eco Wave", "image_url": "",
                "description": "Regional bulk buy on Continental eco tyres — fitted at an approved local garage.",
                "ideal_target": 50, "min_activation": 40, "eta": "Dispatched within 7 days of activation",
                "products": [
                    {"product_id": f"prd_{uuid.uuid4().hex[:8]}", "model": "EcoContact 6", "variants": [
                        variant("205/55 R16", 58.0, 92.0, 74.0, 60),
                        variant("225/45 R17", 71.0, 118.0, 94.0, 60),
                        variant("225/65 R18", 88.0, 145.0, 116.0, 40),
                    ]},
                    {"product_id": f"prd_{uuid.uuid4().hex[:8]}", "model": "UltraContact", "variants": [
                        variant("205/55 R16", 55.0, 88.0, 70.0, 40),
                    ]},
                ],
            },
            {
                "category": "electronics", "region": "Midlands", "brand": "LG",
                "title": "Midlands LG OLED TV Wave", "image_url": "",
                "description": "Regional group purchase on LG OLED televisions — delivered direct to your door.",
                "ideal_target": 30, "min_activation": 20, "eta": "Delivered within 10 days of activation",
                "products": [
                    {"product_id": f"prd_{uuid.uuid4().hex[:8]}", "model": "OLED C4 evo", "variants": [
                        variant("55-inch", 980.0, 1499.0, 1199.0, 25),
                        variant("65-inch", 1320.0, 1999.0, 1599.0, 20),
                    ]},
                ],
            },
        ]
        for d in demos:
            await db.waves.insert_one({
                "wave_id": f"wave_{uuid.uuid4().hex[:10]}",
                "supplier_id": sup_id,
                "category": d["category"],
                "region_id": region_ids.get(d["region"]),
                "region_name": d["region"],
                "brand": d["brand"], "title": d["title"], "description": d["description"],
                "image_url": d["image_url"], "products": d["products"],
                "ideal_target": d["ideal_target"], "min_activation": d["min_activation"],
                "eta": d["eta"], "state": "open", "units_committed": 0, "participants_count": 0,
                "created_at": _now(), "activated_at": None, "deadline": _now() + timedelta(days=30),
            })
            created += 1
    return created
