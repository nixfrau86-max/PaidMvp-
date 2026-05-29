"""Admin supplier account management — suspend / unsuspend / soft+hard delete + detail.

Mirrors routes/admin_users.py. Suspending/deleting a supplier also propagates to the
linked user account (status + session purge) so the operator can lock a bad actor out
in one action.

Mounted via:
    from routes.admin_suppliers import build_router as build_admin_suppliers_router
    api_router.include_router(build_admin_suppliers_router({"db": db, ...}))
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class SupplierAccountUpdate(BaseModel):
    status: Literal["active", "suspended"]
    reason: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize(s: dict) -> dict:
    d = dict(s)
    d.pop("_id", None)
    for k in ("created_at", "verified_at", "rejected_at", "suspended_at", "deleted_at"):
        v = d.get(k)
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    if not d.get("categories"):
        d["categories"] = [d["category"]] if d.get("category") else []
    d["is_tyre_supplier"] = "Tyres" in (d.get("categories") or [])
    d.setdefault("account_status", "active")
    return d


def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    require_role = deps["require_role"]

    router = APIRouter()

    async def _audit(actor: dict, action: str, supplier_id: str, extra: dict):
        await db.admin_audit_log.insert_one({
            "audit_id": f"aud_{uuid.uuid4().hex[:10]}",
            "actor_user_id": actor["user_id"],
            "actor_email": actor["email"],
            "action": action,
            "target_supplier_id": supplier_id,
            "changes": extra,
            "at": _now_iso(),
        })

    @router.get("/admin/suppliers/{supplier_id}/detail")
    async def admin_supplier_detail(supplier_id: str, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        s = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Supplier not found")
        waves = await db.waves.count_documents({"supplier_id": supplier_id})
        vpps = await db.vpps.count_documents({"supplier_id": supplier_id})
        pgs = await db.product_groups.count_documents({"supplier_id": supplier_id})
        owner = await db.users.find_one({"user_id": s.get("user_id")}, {"_id": 0, "password_hash": 0})
        return {
            **_serialize(s),
            "owner": {
                "user_id": owner.get("user_id"),
                "email": owner.get("email"),
                "name": owner.get("name"),
                "status": owner.get("status", "active"),
            } if owner else None,
            "stats": {"waves": waves, "legacy_vpps": vpps, "product_groups": pgs},
        }

    @router.patch("/admin/suppliers/{supplier_id}/account")
    async def admin_set_supplier_account(
        supplier_id: str,
        payload: SupplierAccountUpdate,
        user: dict = Depends(get_current_user),
    ):
        """Suspend / unsuspend a supplier — propagates to the linked user account."""
        await require_role(user, ["admin"])
        s = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Supplier not found")

        updates: Dict[str, Any] = {"account_status": payload.status}
        if payload.status == "suspended":
            updates["suspended_reason"] = payload.reason or "Suspended by admin"
            updates["suspended_at"] = _now_iso()
        else:
            updates["suspended_reason"] = None
            updates["suspended_at"] = None
        await db.suppliers.update_one({"supplier_id": supplier_id}, {"$set": updates})

        uid = s.get("user_id")
        if uid:
            owner = await db.users.find_one({"user_id": uid}, {"_id": 0})
            # Never lock out an admin via the supplier panel
            if owner and owner.get("role") != "admin":
                if payload.status == "suspended":
                    await db.users.update_one({"user_id": uid}, {"$set": {
                        "status": "suspended",
                        "suspended_reason": updates["suspended_reason"],
                        "suspended_at": updates["suspended_at"],
                    }})
                    await db.user_sessions.delete_many({"user_id": uid})
                else:
                    await db.users.update_one({"user_id": uid}, {"$set": {
                        "status": "active", "suspended_reason": None, "suspended_at": None,
                    }})

        await _audit(user, "supplier_account_update", supplier_id, updates)
        fresh = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
        return _serialize(fresh)

    @router.delete("/admin/suppliers/{supplier_id}")
    async def admin_delete_supplier(
        supplier_id: str,
        hard: bool = False,
        user: dict = Depends(get_current_user),
    ):
        """Soft-delete (default): mark deleted + demote owner to consumer + free supplier_id.
        Hard-delete (?hard=true): permanently purge the supplier record."""
        await require_role(user, ["admin"])
        s = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Supplier not found")

        uid = s.get("user_id")
        if uid:
            owner = await db.users.find_one({"user_id": uid}, {"_id": 0})
            if owner and owner.get("role") == "admin":
                raise HTTPException(status_code=400, detail="Cannot delete a supplier owned by an admin")
            if owner:
                await db.users.update_one({"user_id": uid}, {"$set": {"role": "consumer", "supplier_id": None}})
                await db.user_sessions.delete_many({"user_id": uid})

        if hard:
            await db.suppliers.delete_one({"supplier_id": supplier_id})
            action = "supplier_hard_delete"
        else:
            await db.suppliers.update_one({"supplier_id": supplier_id}, {"$set": {
                "account_status": "deleted",
                "status": "rejected",
                "deleted_at": _now_iso(),
            }})
            action = "supplier_soft_delete"

        await _audit(user, action, supplier_id, {"business_name": s.get("business_name")})
        return {"success": True, "hard": bool(hard)}

    return router
