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
# Router
# --------------------------------------------------------------------------
def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    get_current_user_optional = deps["get_current_user_optional"]
    require_role = deps["require_role"]
    manager = deps["manager"]

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

    async def _broadcast_wave(wave_id: str, payload: dict):
        await manager.broadcast(f"wave:{wave_id}", payload)
        await manager.broadcast("waves:feed", {**payload, "wave_id": wave_id})

    async def _recompute(wave: dict) -> dict:
        """Recompute committed units + auto state (open/almost_full/activated)."""
        pipeline = [
            {"$match": {"wave_id": wave["wave_id"], "status": {"$in": ACTIVE_PART_STATUSES}}},
            {"$group": {"_id": None, "units": {"$sum": "$units"}, "people": {"$sum": 1}}},
        ]
        agg = await db.wave_participations.aggregate(pipeline).to_list(1)
        units = int(agg[0]["units"]) if agg else 0
        people = int(agg[0]["people"]) if agg else 0

        updates = {"units_committed": units, "participants_count": people}
        current = wave.get("state", "open")
        if current not in TERMINAL_OR_MANUAL and current != "activated":
            ideal = max(1, int(wave.get("ideal_target", 1)))
            if units >= int(wave.get("min_activation", ideal)):
                updates["state"] = "activated"
                updates["activated_at"] = _now()
            elif units >= ALMOST_FULL_RATIO * ideal:
                updates["state"] = "almost_full"
            else:
                updates["state"] = "open"

        await db.waves.update_one({"wave_id": wave["wave_id"]}, {"$set": updates})
        fresh = await db.waves.find_one({"wave_id": wave["wave_id"]}, {"_id": 0})
        await _broadcast_wave(wave["wave_id"], {
            "type": "wave_update",
            "units_committed": fresh.get("units_committed", 0),
            "participants_count": fresh.get("participants_count", 0),
            "state": fresh.get("state"),
            "progress_pct": round(min(100.0, fresh.get("units_committed", 0) / max(1, fresh.get("ideal_target", 1)) * 100), 1),
        })
        return fresh

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
        destinations: Dict[str, int] = {}
        total_units = 0
        for p in parts:
            for it in p.get("items", []):
                key = it["variant_id"]
                if key not in breakdown:
                    breakdown[key] = {"label": it.get("label"), "model": it.get("model"), "units": 0}
                breakdown[key]["units"] += it["qty"]
                total_units += it["qty"]
            dest = p.get("garage_name") or p.get("delivery_address") or "—"
            destinations[dest] = destinations.get(dest, 0) + p.get("units", 0)

        return {
            "wave_id": wave_id,
            "title": w["title"],
            "state": w["state"],
            "total_units": total_units,
            "variant_breakdown": list(breakdown.values()),
            "destinations": [{"destination": k, "units": v} for k, v in destinations.items()],
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
        if w.get("state") not in ("open", "almost_full"):
            raise HTTPException(status_code=400, detail="This Wave is no longer accepting participants")
        if not payload.items:
            raise HTTPException(status_code=400, detail="Select at least one product")

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

        # Validate stock + build items
        variant_index = {v["variant_id"]: (p, v) for p in w["products"] for v in p["variants"]}
        items, subtotal, units = [], 0.0, 0
        inc_ops, array_filters = {}, []
        for idx, it in enumerate(payload.items):
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
            "fitting_slot_label": payload.fitting_slot_label,
            "delivery_address": payload.delivery_address,
            "status": "reserved",
            "reservation_expires_at": _iso(_now() + timedelta(minutes=RESERVATION_MINUTES)),
            "payment_status": "pending",
            "created_at": _iso(_now()),
        }
        await db.wave_participations.insert_one(dict(part))
        await db.waves.update_one({"wave_id": wave_id}, {"$inc": inc_ops}, array_filters=array_filters)
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
        return await db.waves.find_one({"wave_id": wave_id}, {"_id": 0})

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
