"""Admin user management — list, suspend, role change, soft/hard delete + audit log.

Mounted onto the main api_router via:
    from routes.admin_users import build_router as build_admin_users_router
    api_router.include_router(build_admin_users_router({"db": db, ...}))
"""
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class AdminUserUpdateRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[Literal["active", "suspended", "deleted"]] = None
    suspended_reason: Optional[str] = None
    unit_limit_overrides: Optional[Dict[str, int]] = None


def _serialize_user(u: dict) -> dict:
    d = dict(u)
    d.pop("_id", None)
    d.pop("password_hash", None)
    for k in ("created_at", "suspended_at"):
        v = d.get(k)
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    d.setdefault("status", "active")
    return d


def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    require_role = deps["require_role"]

    router = APIRouter()

    @router.get("/admin/users")
    async def admin_list_users(
        q: Optional[str] = None,
        role: Optional[str] = None,
        user_status: Optional[str] = None,
        limit: int = 100,
        user: dict = Depends(get_current_user),
    ):
        """List + filter users for admin console."""
        await require_role(user, ["admin"])
        query: Dict[str, Any] = {}
        if q:
            qre = {"$regex": re.escape(q), "$options": "i"}
            query["$or"] = [{"email": qre}, {"name": qre}, {"user_id": qre}]
        if role and role != "all":
            query["role"] = role
        if user_status and user_status != "all":
            query["status"] = user_status
        docs = await db.users.find(query, {"_id": 0}).sort("created_at", -1).limit(
            max(1, min(500, int(limit)))
        ).to_list(500)
        total = await db.users.count_documents(query)
        return {"users": [_serialize_user(u) for u in docs], "total": total}

    @router.get("/admin/users/{user_id}")
    async def admin_get_user(user_id: str, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        parts = await db.participations.count_documents({"user_id": user_id})
        tyre_parts = await db.tyre_participations.count_documents({"user_id": user_id})
        txs = await db.payment_transactions.count_documents({"user_id": user_id})
        return {
            **_serialize_user(u),
            "stats": {
                "participations": parts,
                "tyre_participations": tyre_parts,
                "payment_transactions": txs,
            },
        }

    @router.patch("/admin/users/{user_id}")
    async def admin_update_user(
        user_id: str,
        payload: AdminUserUpdateRequest,
        user: dict = Depends(get_current_user),
    ):
        await require_role(user, ["admin"])
        if user_id == user["user_id"]:
            raise HTTPException(status_code=400, detail="You cannot modify your own account here")
        target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        updates: Dict[str, Any] = {}
        if payload.role is not None:
            if payload.role == "admin":
                allowlist = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
                if target["email"].lower() not in allowlist:
                    raise HTTPException(
                        status_code=400,
                        detail="To grant admin, add the email to ADMIN_EMAILS env first",
                    )
            updates["role"] = payload.role
        if payload.status is not None:
            if target.get("role") == "admin" and payload.status != "active":
                raise HTTPException(status_code=400, detail="Cannot suspend or delete an admin account")
            updates["status"] = payload.status
            if payload.status == "suspended":
                updates["suspended_reason"] = payload.suspended_reason or "Suspended by admin"
                updates["suspended_at"] = datetime.now(timezone.utc).isoformat()
                await db.user_sessions.delete_many({"user_id": user_id})
            elif payload.status == "active":
                updates["suspended_reason"] = None
                updates["suspended_at"] = None

        if payload.unit_limit_overrides is not None:
            cleaned: Dict[str, int] = {}
            for k, v in payload.unit_limit_overrides.items():
                if v is None:
                    continue
                if int(v) < 0:
                    raise HTTPException(status_code=400, detail="Override limit must be >= 0")
                cleaned[k] = int(v)
            updates["unit_limit_overrides"] = cleaned

        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        await db.users.update_one({"user_id": user_id}, {"$set": updates})

        await db.admin_audit_log.insert_one({
            "audit_id": f"aud_{uuid.uuid4().hex[:10]}",
            "actor_user_id": user["user_id"],
            "actor_email": user["email"],
            "action": "user_update",
            "target_user_id": user_id,
            "changes": updates,
            "at": datetime.now(timezone.utc).isoformat(),
        })

        fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        return _serialize_user(fresh)

    @router.delete("/admin/users/{user_id}")
    async def admin_delete_user(
        user_id: str,
        hard: bool = False,
        user: dict = Depends(get_current_user),
    ):
        """Soft-delete by default; ?hard=true purges the record."""
        await require_role(user, ["admin"])
        if user_id == user["user_id"]:
            raise HTTPException(status_code=400, detail="You cannot delete your own account")
        target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("role") == "admin":
            raise HTTPException(status_code=400, detail="Cannot delete an admin account")

        await db.user_sessions.delete_many({"user_id": user_id})

        if hard:
            await db.users.delete_one({"user_id": user_id})
            action = "user_hard_delete"
        else:
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {
                    "status": "deleted",
                    "deleted_at": datetime.now(timezone.utc).isoformat(),
                    "email": f"{target['email']}.deleted.{uuid.uuid4().hex[:6]}",
                }},
            )
            action = "user_soft_delete"

        await db.admin_audit_log.insert_one({
            "audit_id": f"aud_{uuid.uuid4().hex[:10]}",
            "actor_user_id": user["user_id"],
            "actor_email": user["email"],
            "action": action,
            "target_user_id": user_id,
            "target_email": target.get("email"),
            "at": datetime.now(timezone.utc).isoformat(),
        })
        return {"success": True, "hard": bool(hard)}

    @router.get("/admin/audit-log")
    async def admin_audit_log_endpoint(limit: int = 100, user: dict = Depends(get_current_user)):
        await require_role(user, ["admin"])
        docs = await db.admin_audit_log.find({}, {"_id": 0}).sort("at", -1).limit(
            max(1, min(500, int(limit)))
        ).to_list(500)
        return docs

    return router
