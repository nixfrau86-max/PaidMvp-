"""T&Cs static document descriptors + acceptance audit log endpoints."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel


# Static documents — version-bump forces every user to re-accept before gated flows.
TERMS_DOCS: Dict[str, Dict[str, str]] = {
    "terms": {
        "title": "Terms of Service",
        "version": "1.0",
        "effective_date": "2026-05-28",
        "summary": "Marketplace usage, collective-purchasing model, supplier fulfilment, refund policy.",
    },
    "privacy": {
        "title": "Privacy Policy",
        "version": "1.0",
        "effective_date": "2026-05-28",
        "summary": "What we collect, how we use it, your rights under UK GDPR.",
    },
}


class TermsAcceptRequest(BaseModel):
    doc_id: Literal["terms", "privacy"]
    version: str
    context: Optional[str] = None


def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    require_role = deps["require_role"]

    router = APIRouter()

    @router.get("/terms/docs")
    async def terms_list_docs():
        """Public list of T&C docs with current versions."""
        return [{"id": k, **v} for k, v in TERMS_DOCS.items()]

    @router.post("/terms/accept")
    async def terms_accept(
        payload: TermsAcceptRequest,
        request: Request,
        user: dict = Depends(get_current_user),
    ):
        if payload.doc_id not in TERMS_DOCS:
            raise HTTPException(status_code=400, detail="Unknown document")
        current_ver = TERMS_DOCS[payload.doc_id]["version"]
        record = {
            "acceptance_id": f"acc_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "user_email": user["email"],
            "doc_id": payload.doc_id,
            "version": payload.version,
            "current_version": current_ver,
            "is_current": payload.version == current_ver,
            "context": payload.context or "general",
            "ip": request.client.host if request.client else "unknown",
            "user_agent": request.headers.get("user-agent", ""),
            "accepted_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.terms_acceptances.insert_one(record)
        record.pop("_id", None)
        return record

    @router.get("/terms/me")
    async def terms_me(user: dict = Depends(get_current_user)):
        docs = await db.terms_acceptances.find(
            {"user_id": user["user_id"]}, {"_id": 0}
        ).sort("accepted_at", -1).to_list(100)
        accepted_current: Dict[str, bool] = {}
        for doc_id, meta in TERMS_DOCS.items():
            accepted_current[doc_id] = any(
                d["doc_id"] == doc_id and d.get("version") == meta["version"] for d in docs
            )
        return {"acceptances": docs, "accepted_current": accepted_current}

    @router.get("/admin/terms/audit")
    async def admin_terms_audit(
        doc_id: Optional[str] = None,
        user_id: Optional[str] = None,
        limit: int = 200,
        user: dict = Depends(get_current_user),
    ):
        await require_role(user, ["admin"])
        q: Dict[str, Any] = {}
        if doc_id:
            q["doc_id"] = doc_id
        if user_id:
            q["user_id"] = user_id
        docs = await db.terms_acceptances.find(q, {"_id": 0}).sort("accepted_at", -1).limit(
            max(1, min(1000, int(limit)))
        ).to_list(1000)
        return {"acceptances": docs, "total": await db.terms_acceptances.count_documents(q)}

    return router
