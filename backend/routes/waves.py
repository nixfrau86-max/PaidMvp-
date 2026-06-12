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
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
CATEGORIES = ["tyres", "electronics", "footwear"]
CATEGORY_LABELS = {"tyres": "Tyres", "electronics": "Electronics", "footwear": "Footwear"}

ACTIVE_PART_STATUSES = ["reserved", "authorized", "captured"]
ALMOST_FULL_RATIO = 0.8
RESERVATION_MINUTES = 25

# Respawn working window (Europe/London): Mon–Fri 08:30 → 16:30. Waves that
# complete inside this window respawn immediately; otherwise the next working
# day 08:30. Every respawned wave gets a same-day 16:30 deadline.
WORK_START_H, WORK_START_M = 8, 30
WORK_END_H, WORK_END_M = 16, 30

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
    variants: List[VariantInput] = Field(default_factory=list)


class WaveCreateRequest(BaseModel):
    category: Literal["tyres", "electronics", "footwear"]
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
        products.append({"product_id": p["product_id"], "model": p["model"], "variants": variants})
    d["products"] = products
    if not full:
        d.pop("supplier_id", None)
    ideal = max(1, int(d.get("ideal_target", 1)))
    d["progress_pct"] = round(min(100.0, _wave_units(w) / ideal * 100), 1)
    d["category_label"] = CATEGORY_LABELS.get(d.get("category"), d.get("category"))
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
    await _broadcast(manager, wave["wave_id"], {
        "type": "wave_update",
        "units_committed": fresh.get("units_committed", 0),
        "participants_count": fresh.get("participants_count", 0),
        "state": fresh.get("state"),
        "progress_pct": round(min(100.0, fresh.get("units_committed", 0) / max(1, fresh.get("ideal_target", 1)) * 100), 1),
    })
    return fresh


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
    """Transition under-filled waves past their deadline to `expired` and release
    their reservations. Waves that already met min_activation are left alone."""
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
    return expired


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
    # SUPPLIER — Wave CRUD
    # =================================================================
    @router.post("/supplier/waves")
    async def create_wave(payload: WaveCreateRequest, user: dict = Depends(get_current_user)):
        supplier = await _require_supplier(user)
        region = await db.regions.find_one({"region_id": payload.region_id, "active": True}, {"_id": 0})
        if not region:
            raise HTTPException(status_code=400, detail="Invalid or inactive region")
        if payload.min_activation > payload.ideal_target:
            raise HTTPException(status_code=400, detail="Minimum activation cannot exceed the ideal target")
        title = (payload.title or "").strip() or f"{region['name']} {payload.brand} {CATEGORY_LABELS[payload.category]} Wave"
        wave = {
            "wave_id": f"wave_{uuid.uuid4().hex[:10]}",
            "supplier_id": supplier["supplier_id"],
            "category": payload.category,
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
        await _recompute(fresh)
        fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        return _public_wave(fresh, full=True)

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
        """Post-activation consolidated order summary: units per variant + fulfilment destinations."""
        supplier = await _require_supplier(user)
        w = await db.waves.find_one({"wave_id": wave_id, "supplier_id": supplier["supplier_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        parts = await db.wave_participations.find(
            {"wave_id": wave_id, "status": {"$in": ACTIVE_PART_STATUSES}}, {"_id": 0}
        ).to_list(2000)

        breakdown: Dict[str, dict] = {}
        destinations: Dict[str, dict] = {}
        total_units = 0
        for p in parts:
            for it in p.get("items", []):
                key = it["variant_id"]
                if key not in breakdown:
                    breakdown[key] = {"label": it.get("label"), "model": it.get("model"), "units": 0}
                breakdown[key]["units"] += it["qty"]
                total_units += it["qty"]
            dest = p.get("garage_name") or p.get("delivery_address") or "—"
            d = destinations.setdefault(dest, {"destination": dest, "units": 0, "fittings": []})
            d["units"] += p.get("units", 0)
            if p.get("fitting_slot_label"):
                d["fittings"].append({"slot": p["fitting_slot_label"], "units": p.get("units", 0)})

        return {
            "wave_id": wave_id,
            "title": w["title"],
            "state": w["state"],
            "category": w["category"],
            "total_units": total_units,
            "variant_breakdown": list(breakdown.values()),
            "destinations": list(destinations.values()),
        }

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

        # Fulfilment validation
        garage_name = None
        if w["category"] == "tyres":
            if not payload.garage_id:
                raise HTTPException(status_code=400, detail="Please select an approved fitting garage")
            g = await db.garages.find_one({"garage_id": payload.garage_id}, {"_id": 0})
            if not g or not g.get("is_verified") or not g.get("is_active", True):
                raise HTTPException(status_code=400, detail="Selected garage is not available")
            garage_name = g.get("business_name") or g.get("name")
        else:
            if not (payload.delivery_address and payload.delivery_address.strip()):
                raise HTTPException(status_code=400, detail="Please enter a delivery address")

        # Derive a human fitting-slot label + validate stock (module helpers)
        fitting_label = _derive_fitting_label(w["category"], payload.fitting_slot_iso, payload.fitting_slot_label)
        items, subtotal, units, inc_ops, array_filters = _validate_join_items(w, payload.items)

        if committed + units > ideal:
            raise HTTPException(status_code=400, detail=f"Only {ideal - committed} unit(s) left in this Wave")

        # Per-user annual unit limit (calendar year), by category. Counts active
        # commitments (reserved/authorized/captured). Admin per-user override wins.
        if get_unit_limits_config and resolve_unit_limit:
            cfg = await get_unit_limits_config()
            limit = resolve_unit_limit(cfg, user, w["category"])
            used = await _units_used_this_year(db, user["user_id"], w["category"])
            if used + units > limit:
                cat = CATEGORY_LABELS.get(w["category"], w["category"])
                remaining = max(0, limit - used)
                raise HTTPException(
                    status_code=400,
                    detail=(f"Annual {cat} limit reached — up to {limit} units per calendar year. "
                            f"You've committed {used} so far ({remaining} left). "
                            f"Contact us if you need a higher limit."),
                )

        # Atomic-ish reservation: increment reserved_qty FIRST, then verify no
        # variant went negative (concurrent-join race). Roll back on oversell.
        await db.waves.update_one({"wave_id": wave_id}, {"$inc": inc_ops}, array_filters=array_filters)
        post = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        if any(_variant_available(v) < 0 for p in post["products"] for v in p["variants"]):
            neg_inc = {k: -val for k, val in inc_ops.items()}
            await db.waves.update_one({"wave_id": wave_id}, {"$inc": neg_inc}, array_filters=array_filters)
            raise HTTPException(status_code=409, detail="That stock was just reserved by someone else — please try again")

        if payload.accept_terms:
            await db.terms_acceptances.insert_one({
                "acceptance_id": f"acc_{uuid.uuid4().hex[:10]}",
                "user_id": user["user_id"], "doc_id": "terms", "version": "1.0",
                "is_current": True, "context": "wave_join", "accepted_at": _iso(_now()),
            })

        part = {
            "participation_id": f"wp_{uuid.uuid4().hex[:10]}",
            "wave_id": wave_id,
            "user_id": user["user_id"],
            "category": w["category"],
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
        await db.wave_participations.insert_one(dict(part))
        fresh = await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})
        await _recompute(fresh)
        part.pop("_id", None)
        return {"success": True, "participation": part, "reservation_minutes": RESERVATION_MINUTES}

    @router.get("/me/wave-orders")
    async def my_wave_orders(user: dict = Depends(get_current_user)):
        parts = await db.wave_participations.find(
            {"user_id": user["user_id"], "status": {"$ne": "cancelled"}}, {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        out = []
        for p in parts:
            w = await db.waves.find_one({"wave_id": p["wave_id"]}, {"_id": 0})
            if not w:
                continue
            out.append({**p, "wave": _public_wave(w)})
        return out

    @router.get("/me/unit-allowance")
    async def my_unit_allowance(category: str = Query(...), user: dict = Depends(get_current_user)):
        """Remaining annual (calendar-year) unit allowance for the current user in a category."""
        if category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category")
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
        out = []
        for d in docs:
            sup = await db.suppliers.find_one({"supplier_id": d.get("supplier_id")}, {"_id": 0, "business_name": 1})
            out.append({**_public_wave(d, full=True), "supplier_name": sup.get("business_name") if sup else "—"})
        return out

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
# wave for the leftover inventory until stock depletes. Working window
# (Europe/London): Mon–Fri 08:30–16:30 — complete inside the window → create
# immediately; otherwise schedule for the next working day 08:30. Every
# respawned wave gets a same-day 16:30 deadline.
# --------------------------------------------------------------------------
def _london_now() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/London"))
    except Exception:
        return datetime.now(timezone.utc)


def _in_working_window(now: datetime) -> bool:
    """True when `now` (London) is Mon–Fri between 08:30 and 16:30."""
    if now.weekday() >= 5:  # Sat/Sun
        return False
    return (WORK_START_H, WORK_START_M) <= (now.hour, now.minute) < (WORK_END_H, WORK_END_M)


def _next_creation_time_london(now: Optional[datetime] = None) -> Optional[datetime]:
    """Return None to create immediately (inside Mon–Fri 08:30–16:30), else the
    London datetime of the next working-day at 08:30."""
    now = now or _london_now()
    if _in_working_window(now):
        return None
    # Weekday but before the window opens → today 08:30.
    if now.weekday() < 5 and (now.hour, now.minute) < (WORK_START_H, WORK_START_M):
        return now.replace(hour=WORK_START_H, minute=WORK_START_M, second=0, microsecond=0)
    # Otherwise (after 16:30 or weekend) → next working day 08:30.
    d = now + timedelta(days=1)
    while d.weekday() >= 5:  # skip Sat/Sun
        d = d + timedelta(days=1)
    return d.replace(hour=WORK_START_H, minute=WORK_START_M, second=0, microsecond=0)


def _deadline_for_creation_london(create_local: Optional[datetime] = None) -> datetime:
    """16:30 Europe/London on the creation day, returned as a UTC datetime."""
    create_local = create_local or _london_now()
    dl_local = create_local.replace(hour=WORK_END_H, minute=WORK_END_M, second=0, microsecond=0)
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
            new_products.append({"product_id": f"prd_{uuid.uuid4().hex[:8]}", "model": p["model"], "variants": variants})
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
        "ideal_target": total_remaining,
        "min_activation": min(int(wave.get("min_activation", total_remaining)), total_remaining),
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
    # Respawn leftover stock whenever the wave saw genuine demand (joins/allocations
    # OR sales) and stock remains. The demand check avoids cloning never-touched waves.
    if engaged <= 0 or total_remaining <= 0:
        return {"respawned": False, "reason": "no_demand_or_no_stock",
                "engaged": engaged, "sold": sold_total, "remaining": total_remaining}

    doc = _build_respawn_doc(wave, remaining_products, total_remaining, carried_units)
    when = _next_creation_time_london()
    if when is None:
        # Inside the working window → go live immediately, deadline today 16:30.
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


async def process_due_scheduled_waves(db, manager) -> int:
    """Background worker tick: materialise any scheduled follow-on waves now due."""
    now_iso = _now().isoformat()
    due = await db.scheduled_waves.find({"created": False, "create_at": {"$lte": now_iso}}, {"_id": 0}).to_list(100)
    count = 0
    for sw in due:
        spec = dict(sw["spec"])
        spec["wave_id"] = spec.get("wave_id") or f"wave_{uuid.uuid4().hex[:10]}"
        spec["created_at"] = _now()
        spec["deadline"] = _deadline_for_creation_london(_london_now())
        spec["activated_at"] = None
        spec["state"] = "open"
        await db.waves.insert_one(dict(spec))
        await db.suppliers.update_one({"supplier_id": spec["supplier_id"]}, {"$inc": {"waves_published": 1}})
        await db.scheduled_waves.update_one({"scheduled_id": sw["scheduled_id"]},
                                            {"$set": {"created": True, "created_wave_id": spec["wave_id"], "created_real_at": now_iso}})
        await manager.broadcast("waves:feed", {"type": "wave_created", "wave_id": spec["wave_id"], "title": spec.get("title")})
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
            "address_line1": f"1 High Street",
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
