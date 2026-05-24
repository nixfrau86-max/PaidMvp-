"""
The Collective Savers - Backend Server
=======================================
Real-time collective buying platform powered by VPPs (Value Party Power Systems).
"""
import os
import uuid
import json
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Literal

import httpx
from fastapi import (
    FastAPI, APIRouter, Request, Response, Cookie, HTTPException,
    WebSocket, WebSocketDisconnect, Depends, Header, status
)
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from dotenv import load_dotenv

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionResponse, CheckoutStatusResponse, CheckoutSessionRequest
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------- Logging ----------
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("collective-savers")

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- App ----------
app = FastAPI(title="The Collective Savers API")
api_router = APIRouter(prefix="/api")

# =====================================================================
# MODELS
# =====================================================================
VPPState = Literal["seed", "active", "powered", "locked", "executing", "completed"]
UserRole = Literal["consumer", "supplier", "admin"]
PaymentMethod = Literal["card", "open_banking", "bank_transfer"]


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: UserRole = "consumer"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VPP(BaseModel):
    model_config = ConfigDict(extra="ignore")
    vpp_id: str = Field(default_factory=lambda: f"vpp_{uuid.uuid4().hex[:10]}")
    title: str
    description: str
    category: str
    image_url: str
    supplier_name: str
    supplier_cost: float            # cost per unit from supplier
    retail_price: float             # standalone retail price
    customer_price: float           # VPP price per unit (locked)
    threshold: int                  # min participants to trigger POWERED
    max_participants: int = 500
    participants_count: int = 0
    deadline: datetime
    state: VPPState = "active"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    powered_at: Optional[datetime] = None
    locked_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class VPPParticipant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    participant_id: str = Field(default_factory=lambda: f"part_{uuid.uuid4().hex[:10]}")
    vpp_id: str
    user_id: str
    user_email: str
    user_name: str
    joined_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    paid: bool = False
    payment_method: Optional[PaymentMethod] = None
    payment_session_id: Optional[str] = None
    fulfilment_status: str = "pending"  # pending | dispatched | delivered


class CreateVPPRequest(BaseModel):
    title: str
    description: str
    category: str
    image_url: str
    supplier_name: str
    supplier_cost: float
    retail_price: float
    customer_price: float
    threshold: int
    max_participants: int = 500
    deadline_hours: int = 72  # hours from now


class JoinVPPResponse(BaseModel):
    success: bool
    vpp: dict
    message: str


class CheckoutInitRequest(BaseModel):
    vpp_id: str
    payment_method: PaymentMethod
    origin_url: str


class CheckoutInitResponse(BaseModel):
    success: bool
    payment_method: PaymentMethod
    final_price: float
    discount_applied: float
    # For card: stripe url. For others: a mock confirmation token
    checkout_url: Optional[str] = None
    session_id: Optional[str] = None
    mock_confirmation: Optional[bool] = False


class UpdateRoleRequest(BaseModel):
    role: UserRole


# =====================================================================
# AUTH HELPERS (Emergent Google Auth)
# =====================================================================
EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def _get_user_from_session_token(session_token: str) -> Optional[dict]:
    if not session_token:
        return None
    session_doc = await db.user_sessions.find_one(
        {"session_token": session_token}, {"_id": 0}
    )
    if not session_doc:
        return None
    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user_doc = await db.users.find_one(
        {"user_id": session_doc["user_id"]}, {"_id": 0}
    )
    return user_doc


async def get_current_user(
    request: Request,
    session_token_cookie: Optional[str] = Cookie(default=None, alias="session_token"),
    authorization: Optional[str] = Header(default=None),
) -> dict:
    token = session_token_cookie
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
    user = await _get_user_from_session_token(token) if token else None
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_current_user_optional(
    request: Request,
    session_token_cookie: Optional[str] = Cookie(default=None, alias="session_token"),
    authorization: Optional[str] = Header(default=None),
) -> Optional[dict]:
    token = session_token_cookie
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    return await _get_user_from_session_token(token)


async def require_role(user: dict, roles: List[UserRole]):
    if user.get("role") not in roles:
        raise HTTPException(status_code=403, detail=f"Requires role: {roles}")


# =====================================================================
# WEBSOCKET CONNECTION MANAGER
# =====================================================================
class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, List[WebSocket]] = {}  # room -> list

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self.connections.setdefault(room, []).append(ws)

    def disconnect(self, ws: WebSocket, room: str):
        if room in self.connections and ws in self.connections[room]:
            self.connections[room].remove(ws)

    async def broadcast(self, room: str, message: dict):
        dead = []
        for ws in self.connections.get(room, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, room)

manager = ConnectionManager()


# =====================================================================
# UTILITIES
# =====================================================================
PAYMENT_DISCOUNTS = {
    "card": 0.0,            # baseline
    "open_banking": 0.03,   # 3% discount
    "bank_transfer": 0.02,  # 2% discount
}


def serialize_vpp(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    for k in ("created_at", "powered_at", "locked_at", "completed_at", "deadline"):
        v = d.get(k)
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    d["savings_pct"] = round(
        max(0.0, (d["retail_price"] - d["customer_price"]) / d["retail_price"] * 100), 1
    )
    d["progress_pct"] = round(min(100.0, d["participants_count"] / d["threshold"] * 100), 1) if d.get("threshold") else 0
    return d


async def _transition_vpp_if_needed(vpp_doc: dict) -> dict:
    """Check & auto-transition VPP states. Returns possibly updated doc."""
    now = datetime.now(timezone.utc)
    updates: Dict[str, Any] = {}
    state = vpp_doc["state"]
    if state == "active" and vpp_doc["participants_count"] >= vpp_doc["threshold"]:
        updates["state"] = "powered"
        updates["powered_at"] = now.isoformat()
        # Auto-lock immediately for MVP demo simplicity
        updates["state"] = "locked"
        updates["locked_at"] = now.isoformat()
    if updates:
        await db.vpps.update_one({"vpp_id": vpp_doc["vpp_id"]}, {"$set": updates})
        vpp_doc.update(updates)
        # Broadcast state change
        await manager.broadcast(
            f"vpp:{vpp_doc['vpp_id']}",
            {"type": "state_change", "vpp": serialize_vpp(vpp_doc)}
        )
        await manager.broadcast(
            "vpps:all",
            {"type": "state_change", "vpp": serialize_vpp(vpp_doc)}
        )
    return vpp_doc


# =====================================================================
# AUTH ROUTES
# =====================================================================
@api_router.post("/auth/session")
async def auth_session(request: Request, response: Response):
    """Exchange session_id from Emergent OAuth for our session_token."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(EMERGENT_AUTH_SESSION_URL, headers={"X-Session-ID": session_id})
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()

    email = data["email"]
    # Find or create user
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Update name/picture if changed
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name")),
                       "picture": data.get("picture", existing.get("picture"))}}
        )
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = User(
            user_id=user_id,
            email=email,
            name=data.get("name", email.split("@")[0]),
            picture=data.get("picture"),
            role="consumer",
        ).model_dump()
        user["created_at"] = user["created_at"].isoformat()
        await db.users.insert_one(user)

    # Store session
    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    # Normalize datetime in response
    safe_user = dict(user)
    return {"user": safe_user, "session_token": session_token}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def auth_logout(
    response: Response,
    session_token_cookie: Optional[str] = Cookie(default=None, alias="session_token"),
):
    if session_token_cookie:
        await db.user_sessions.delete_one({"session_token": session_token_cookie})
    response.delete_cookie(key="session_token", path="/", samesite="none", secure=True)
    return {"success": True}


@api_router.post("/auth/role")
async def update_role(payload: UpdateRoleRequest, user: dict = Depends(get_current_user)):
    """Demo-only: any authenticated user can switch role (consumer/supplier/admin).
    In production, role assignment would be controlled."""
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": payload.role}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return updated


# =====================================================================
# VPP ROUTES (Consumer)
# =====================================================================
@api_router.get("/vpps")
async def list_vpps(category: Optional[str] = None, state: Optional[str] = None):
    q: Dict[str, Any] = {}
    if category:
        q["category"] = category
    if state:
        q["state"] = state
    else:
        # don't show seed VPPs in public list
        q["state"] = {"$ne": "seed"}
    docs = await db.vpps.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # auto-transition any that should be powered/locked
    out = []
    for d in docs:
        d = await _transition_vpp_if_needed(d)
        out.append(serialize_vpp(d))
    return out


@api_router.get("/vpps/categories")
async def vpp_categories():
    cats = await db.vpps.distinct("category")
    return cats


@api_router.get("/vpps/{vpp_id}")
async def get_vpp(vpp_id: str, user: Optional[dict] = Depends(get_current_user_optional)):
    doc = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="VPP not found")
    doc = await _transition_vpp_if_needed(doc)
    out = serialize_vpp(doc)
    out["has_joined"] = False
    out["has_paid"] = False
    if user:
        p = await db.vpp_participants.find_one(
            {"vpp_id": vpp_id, "user_id": user["user_id"]}, {"_id": 0}
        )
        if p:
            out["has_joined"] = True
            out["has_paid"] = bool(p.get("paid"))
    # Recent participants (anonymised first-name only)
    parts = await db.vpp_participants.find(
        {"vpp_id": vpp_id}, {"_id": 0, "user_name": 1, "joined_at": 1}
    ).sort("joined_at", -1).limit(10).to_list(10)
    for p in parts:
        if isinstance(p.get("joined_at"), datetime):
            p["joined_at"] = p["joined_at"].isoformat()
        n = p.get("user_name", "Someone")
        p["display_name"] = n.split(" ")[0] + " " + (n.split(" ")[-1][:1] + "." if len(n.split(" ")) > 1 else "")
    out["recent_participants"] = parts
    return out


@api_router.post("/vpps/{vpp_id}/join", response_model=JoinVPPResponse)
async def join_vpp(vpp_id: str, user: dict = Depends(get_current_user)):
    doc = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="VPP not found")
    if doc["state"] not in ("active", "powered", "locked"):
        raise HTTPException(status_code=400, detail=f"Cannot join VPP in state {doc['state']}")
    existing = await db.vpp_participants.find_one(
        {"vpp_id": vpp_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if existing:
        return JoinVPPResponse(success=True, vpp=serialize_vpp(doc), message="Already joined")
    if doc["participants_count"] >= doc.get("max_participants", 500):
        raise HTTPException(status_code=400, detail="VPP at capacity")

    participant = VPPParticipant(
        vpp_id=vpp_id,
        user_id=user["user_id"],
        user_email=user["email"],
        user_name=user["name"],
    ).model_dump()
    participant["joined_at"] = participant["joined_at"].isoformat()
    await db.vpp_participants.insert_one(participant)

    await db.vpps.update_one({"vpp_id": vpp_id}, {"$inc": {"participants_count": 1}})
    doc = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    doc = await _transition_vpp_if_needed(doc)

    # Broadcast join event
    await manager.broadcast(
        f"vpp:{vpp_id}",
        {"type": "user_joined", "vpp": serialize_vpp(doc),
         "user_name": user["name"].split(" ")[0]}
    )
    await manager.broadcast(
        "vpps:all",
        {"type": "user_joined", "vpp": serialize_vpp(doc)}
    )
    return JoinVPPResponse(success=True, vpp=serialize_vpp(doc), message="Joined party!")


@api_router.get("/me/parties")
async def my_parties(user: dict = Depends(get_current_user)):
    parts = await db.vpp_participants.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("joined_at", -1).to_list(200)
    out = []
    total_savings = 0.0
    for p in parts:
        vpp = await db.vpps.find_one({"vpp_id": p["vpp_id"]}, {"_id": 0})
        if not vpp:
            continue
        vpp = await _transition_vpp_if_needed(vpp)
        v = serialize_vpp(vpp)
        savings = max(0.0, vpp["retail_price"] - vpp["customer_price"]) if p.get("paid") else 0
        total_savings += savings
        out.append({
            "vpp": v,
            "joined_at": p["joined_at"] if isinstance(p["joined_at"], str) else p["joined_at"].isoformat(),
            "paid": p.get("paid", False),
            "payment_method": p.get("payment_method"),
            "savings": round(savings, 2),
            "fulfilment_status": p.get("fulfilment_status", "pending"),
        })
    return {"parties": out, "total_savings": round(total_savings, 2)}


# =====================================================================
# CHECKOUT (Stripe + Mock for Open Banking / Bank Transfer)
# =====================================================================
@api_router.post("/checkout/init", response_model=CheckoutInitResponse)
async def checkout_init(payload: CheckoutInitRequest, request: Request,
                        user: dict = Depends(get_current_user)):
    vpp = await db.vpps.find_one({"vpp_id": payload.vpp_id}, {"_id": 0})
    if not vpp:
        raise HTTPException(status_code=404, detail="VPP not found")
    vpp = await _transition_vpp_if_needed(vpp)
    if vpp["state"] not in ("locked", "executing"):
        raise HTTPException(status_code=400, detail="VPP not ready for checkout. State must be LOCKED.")

    participant = await db.vpp_participants.find_one(
        {"vpp_id": payload.vpp_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not participant:
        raise HTTPException(status_code=400, detail="You haven't joined this party")
    if participant.get("paid"):
        raise HTTPException(status_code=400, detail="Already paid for this party")

    base_price = float(vpp["customer_price"])
    discount_pct = PAYMENT_DISCOUNTS.get(payload.payment_method, 0.0)
    discount_amount = round(base_price * discount_pct, 2)
    final_price = round(base_price - discount_amount, 2)

    if payload.payment_method == "card":
        # Real Stripe Checkout
        api_key = os.environ.get("STRIPE_API_KEY")
        host_url = payload.origin_url.rstrip("/")
        webhook_url = f"{str(request.base_url).rstrip('/')}/api/webhook/stripe"
        stripe_checkout = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
        success_url = f"{host_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}&vpp_id={vpp['vpp_id']}"
        cancel_url = f"{host_url}/vpp/{vpp['vpp_id']}"
        checkout_request = CheckoutSessionRequest(
            amount=float(final_price),
            currency="gbp",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "vpp_id": vpp["vpp_id"],
                "user_id": user["user_id"],
                "user_email": user["email"],
                "payment_method": "card",
            },
        )
        try:
            session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(checkout_request)
        except Exception as e:
            logger.exception("Stripe error")
            raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

        await db.payment_transactions.insert_one({
            "session_id": session.session_id,
            "user_id": user["user_id"],
            "user_email": user["email"],
            "vpp_id": vpp["vpp_id"],
            "amount": float(final_price),
            "currency": "gbp",
            "payment_method": "card",
            "metadata": {"vpp_id": vpp["vpp_id"], "user_id": user["user_id"]},
            "status": "initiated",
            "payment_status": "unpaid",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Update participant with session info
        await db.vpp_participants.update_one(
            {"vpp_id": vpp["vpp_id"], "user_id": user["user_id"]},
            {"$set": {"payment_method": "card", "payment_session_id": session.session_id}}
        )
        return CheckoutInitResponse(
            success=True,
            payment_method="card",
            final_price=final_price,
            discount_applied=discount_amount,
            checkout_url=session.url,
            session_id=session.session_id,
        )

    # MOCK: Open Banking / Bank Transfer
    mock_session_id = f"mock_{uuid.uuid4().hex[:16]}"
    await db.payment_transactions.insert_one({
        "session_id": mock_session_id,
        "user_id": user["user_id"],
        "user_email": user["email"],
        "vpp_id": vpp["vpp_id"],
        "amount": float(final_price),
        "currency": "gbp",
        "payment_method": payload.payment_method,
        "metadata": {"vpp_id": vpp["vpp_id"], "user_id": user["user_id"]},
        "status": "initiated",
        "payment_status": "unpaid",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mock": True,
    })
    await db.vpp_participants.update_one(
        {"vpp_id": vpp["vpp_id"], "user_id": user["user_id"]},
        {"$set": {"payment_method": payload.payment_method, "payment_session_id": mock_session_id}}
    )
    return CheckoutInitResponse(
        success=True,
        payment_method=payload.payment_method,
        final_price=final_price,
        discount_applied=discount_amount,
        session_id=mock_session_id,
        mock_confirmation=True,
    )


@api_router.post("/checkout/mock-confirm/{session_id}")
async def mock_confirm(session_id: str, user: dict = Depends(get_current_user)):
    """Simulates successful Open Banking / Bank Transfer payment."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your transaction")
    if not tx.get("mock"):
        raise HTTPException(status_code=400, detail="Use Stripe flow for card payments")
    if tx["payment_status"] == "paid":
        return {"success": True, "already_paid": True}
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "complete", "payment_status": "paid",
                  "paid_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _mark_participant_paid(tx["vpp_id"], tx["user_id"], tx["payment_method"])
    return {"success": True}


@api_router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, request: Request,
                          user: dict = Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your transaction")

    # Already paid - return
    if tx["payment_status"] == "paid":
        return {"status": tx["status"], "payment_status": "paid",
                "amount_total": int(tx["amount"] * 100), "currency": tx["currency"],
                "metadata": tx.get("metadata", {})}

    if tx.get("mock"):
        return {"status": tx["status"], "payment_status": tx["payment_status"],
                "amount_total": int(tx["amount"] * 100), "currency": tx["currency"],
                "metadata": tx.get("metadata", {})}

    # Real stripe poll
    api_key = os.environ.get("STRIPE_API_KEY")
    webhook_url = f"{str(request.base_url).rstrip('/')}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
    try:
        status_resp: CheckoutStatusResponse = await stripe_checkout.get_checkout_status(session_id)
    except Exception as e:
        logger.exception("Stripe status error")
        raise HTTPException(status_code=502, detail=f"Stripe status error: {e}")

    # Update DB only if newly paid
    if status_resp.payment_status == "paid" and tx["payment_status"] != "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"status": status_resp.status, "payment_status": "paid",
                      "paid_at": datetime.now(timezone.utc).isoformat()}}
        )
        await _mark_participant_paid(tx["vpp_id"], tx["user_id"], tx["payment_method"])
    else:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"status": status_resp.status, "payment_status": status_resp.payment_status}}
        )

    return {
        "status": status_resp.status,
        "payment_status": status_resp.payment_status,
        "amount_total": status_resp.amount_total,
        "currency": status_resp.currency,
        "metadata": status_resp.metadata,
    }


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    api_key = os.environ.get("STRIPE_API_KEY")
    webhook_url = f"{str(request.base_url).rstrip('/')}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
    body = await request.body()
    sig = request.headers.get("Stripe-Signature")
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, sig)
    except Exception as e:
        logger.exception("Webhook error")
        raise HTTPException(status_code=400, detail=str(e))

    if webhook_response.payment_status == "paid" and webhook_response.session_id:
        tx = await db.payment_transactions.find_one(
            {"session_id": webhook_response.session_id}, {"_id": 0}
        )
        if tx and tx["payment_status"] != "paid":
            await db.payment_transactions.update_one(
                {"session_id": webhook_response.session_id},
                {"$set": {"payment_status": "paid", "status": "complete",
                          "paid_at": datetime.now(timezone.utc).isoformat()}}
            )
            await _mark_participant_paid(tx["vpp_id"], tx["user_id"], tx["payment_method"])
    return {"received": True}


async def _mark_participant_paid(vpp_id: str, user_id: str, payment_method: str):
    await db.vpp_participants.update_one(
        {"vpp_id": vpp_id, "user_id": user_id},
        {"$set": {"paid": True, "payment_method": payment_method,
                   "paid_at": datetime.now(timezone.utc).isoformat()}}
    )
    # Move VPP to EXECUTING on first paid; COMPLETED when all paid (or threshold met)
    vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    if not vpp:
        return
    paid_count = await db.vpp_participants.count_documents({"vpp_id": vpp_id, "paid": True})
    updates: Dict[str, Any] = {}
    if vpp["state"] == "locked":
        updates["state"] = "executing"
    if paid_count >= vpp["participants_count"] and vpp["state"] in ("locked", "executing"):
        updates["state"] = "completed"
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    if updates:
        await db.vpps.update_one({"vpp_id": vpp_id}, {"$set": updates})
        vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
        await manager.broadcast(f"vpp:{vpp_id}",
                                {"type": "state_change", "vpp": serialize_vpp(vpp)})
        await manager.broadcast("vpps:all",
                                {"type": "state_change", "vpp": serialize_vpp(vpp)})


# =====================================================================
# SUPPLIER ROUTES
# =====================================================================
@api_router.get("/supplier/orders")
async def supplier_orders(user: dict = Depends(get_current_user)):
    await require_role(user, ["supplier", "admin"])
    # Returns VPPs in locked/executing/completed states grouped as supplier orders
    docs = await db.vpps.find(
        {"state": {"$in": ["locked", "executing", "completed"]}}, {"_id": 0}
    ).sort("locked_at", -1).to_list(100)
    out = []
    for d in docs:
        paid = await db.vpp_participants.count_documents({"vpp_id": d["vpp_id"], "paid": True})
        out.append({
            **serialize_vpp(d),
            "paid_count": paid,
            "total_supplier_value": round(paid * d["supplier_cost"], 2),
        })
    return out


@api_router.post("/supplier/orders/{vpp_id}/dispatch")
async def dispatch_order(vpp_id: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["supplier", "admin"])
    vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    if not vpp:
        raise HTTPException(status_code=404, detail="VPP not found")
    await db.vpp_participants.update_many(
        {"vpp_id": vpp_id, "paid": True, "fulfilment_status": "pending"},
        {"$set": {"fulfilment_status": "dispatched"}}
    )
    await db.vpps.update_one(
        {"vpp_id": vpp_id},
        {"$set": {"state": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    await manager.broadcast(f"vpp:{vpp_id}",
                            {"type": "state_change", "vpp": serialize_vpp(vpp)})
    return {"success": True, "vpp": serialize_vpp(vpp)}


# =====================================================================
# ADMIN ROUTES
# =====================================================================
@api_router.post("/admin/vpps")
async def admin_create_vpp(payload: CreateVPPRequest, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    deadline = datetime.now(timezone.utc) + timedelta(hours=payload.deadline_hours)
    vpp = VPP(
        title=payload.title,
        description=payload.description,
        category=payload.category,
        image_url=payload.image_url,
        supplier_name=payload.supplier_name,
        supplier_cost=payload.supplier_cost,
        retail_price=payload.retail_price,
        customer_price=payload.customer_price,
        threshold=payload.threshold,
        max_participants=payload.max_participants,
        deadline=deadline,
        state="active",
    ).model_dump()
    vpp["created_at"] = vpp["created_at"].isoformat()
    vpp["deadline"] = vpp["deadline"].isoformat()
    await db.vpps.insert_one(vpp)
    out = serialize_vpp(vpp)
    await manager.broadcast("vpps:all", {"type": "vpp_created", "vpp": out})
    return out


@api_router.get("/admin/vpps")
async def admin_list_vpps(user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    docs = await db.vpps.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        paid = await db.vpp_participants.count_documents({"vpp_id": d["vpp_id"], "paid": True})
        out.append({**serialize_vpp(d), "paid_count": paid})
    return out


@api_router.patch("/admin/vpps/{vpp_id}/state")
async def admin_force_state(vpp_id: str, body: dict, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    new_state = body.get("state")
    if new_state not in ("seed", "active", "powered", "locked", "executing", "completed"):
        raise HTTPException(status_code=400, detail="Invalid state")
    updates: Dict[str, Any] = {"state": new_state}
    now = datetime.now(timezone.utc).isoformat()
    if new_state == "powered":
        updates["powered_at"] = now
    elif new_state == "locked":
        updates["locked_at"] = now
    elif new_state == "completed":
        updates["completed_at"] = now
    await db.vpps.update_one({"vpp_id": vpp_id}, {"$set": updates})
    vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    out = serialize_vpp(vpp)
    await manager.broadcast(f"vpp:{vpp_id}", {"type": "state_change", "vpp": out})
    await manager.broadcast("vpps:all", {"type": "state_change", "vpp": out})
    return out


@api_router.delete("/admin/vpps/{vpp_id}")
async def admin_delete_vpp(vpp_id: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    await db.vpps.delete_one({"vpp_id": vpp_id})
    await db.vpp_participants.delete_many({"vpp_id": vpp_id})
    return {"success": True}


@api_router.get("/admin/stats")
async def admin_stats(user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    total_vpps = await db.vpps.count_documents({})
    active = await db.vpps.count_documents({"state": "active"})
    locked = await db.vpps.count_documents({"state": "locked"})
    completed = await db.vpps.count_documents({"state": "completed"})
    total_users = await db.users.count_documents({})
    paid_count = await db.vpp_participants.count_documents({"paid": True})
    # GMV
    txs = await db.payment_transactions.find({"payment_status": "paid"}, {"_id": 0, "amount": 1}).to_list(10000)
    gmv = round(sum(t["amount"] for t in txs), 2)
    return {
        "total_vpps": total_vpps,
        "active_vpps": active,
        "locked_vpps": locked,
        "completed_vpps": completed,
        "total_users": total_users,
        "paid_orders": paid_count,
        "gmv": gmv,
    }


# =====================================================================
# WEBSOCKET ROUTES
# =====================================================================
@app.websocket("/api/ws/vpp/{vpp_id}")
async def ws_vpp(websocket: WebSocket, vpp_id: str):
    room = f"vpp:{vpp_id}"
    await manager.connect(websocket, room)
    try:
        while True:
            await websocket.receive_text()  # keepalive
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)


@app.websocket("/api/ws/feed")
async def ws_feed(websocket: WebSocket):
    room = "vpps:all"
    await manager.connect(websocket, room)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)


# =====================================================================
# SEEDING
# =====================================================================
SEED_VPPS = [
    {
        "title": "Michelin Pilot Sport 4 — Set of 4",
        "description": "Premium summer performance tyres. 225/45 R17. Fitted at partner garages.",
        "category": "Tyres",
        "image_url": "https://images.unsplash.com/photo-1601411101851-ea0e07766235?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxjYXIlMjB0aXJlJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzc5NjE1NzkzfDA&ixlib=rb-4.1.0&q=85",
        "supplier_name": "TyreDirect UK",
        "supplier_cost": 320.00,
        "retail_price": 520.00,
        "customer_price": 380.00,
        "threshold": 25,
        "max_participants": 200,
        "deadline_hours": 72,
        "state": "active",
        "participants_count": 18,
    },
    {
        "title": "Sony WF-1000XM5 Wireless Earbuds",
        "description": "Industry-leading noise cancellation, 24h battery. UK warranty.",
        "category": "Electronics",
        "image_url": "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHx3aXJlbGVzcyUyMGVhcnBob25lcyUyMHNsZWVrfGVufDB8fHx8MTc3OTYxNTc5M3ww&ixlib=rb-4.1.0&q=85",
        "supplier_name": "AudioWholesale Ltd",
        "supplier_cost": 159.00,
        "retail_price": 259.00,
        "customer_price": 199.00,
        "threshold": 40,
        "max_participants": 300,
        "deadline_hours": 48,
        "state": "active",
        "participants_count": 33,
    },
    {
        "title": "Continental EcoContact 6 — Set of 4",
        "description": "Eco-focused tyres. Lowest rolling resistance class. 205/55 R16.",
        "category": "Tyres",
        "image_url": "https://images.unsplash.com/photo-1601411101851-ea0e07766235?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxjYXIlMjB0aXJlJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzc5NjE1NzkzfDA&ixlib=rb-4.1.0&q=85",
        "supplier_name": "TyreDirect UK",
        "supplier_cost": 240.00,
        "retail_price": 380.00,
        "customer_price": 285.00,
        "threshold": 20,
        "max_participants": 200,
        "deadline_hours": 96,
        "state": "active",
        "participants_count": 7,
    },
    {
        "title": "Anker Soundcore Liberty 4 NC",
        "description": "Hi-Res audio + adaptive ANC. Great value collective deal.",
        "category": "Electronics",
        "image_url": "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHx3aXJlbGVzcyUyMGVhcnBob25lcyUyMHNsZWVrfGVufDB8fHx8MTc3OTYxNTc5M3ww&ixlib=rb-4.1.0&q=85",
        "supplier_name": "AudioWholesale Ltd",
        "supplier_cost": 55.00,
        "retail_price": 99.00,
        "customer_price": 69.00,
        "threshold": 60,
        "max_participants": 400,
        "deadline_hours": 36,
        "state": "active",
        "participants_count": 58,
    },
    {
        "title": "Pirelli P Zero — Set of 4",
        "description": "Ultra high performance summer tyres. 245/35 R19.",
        "category": "Tyres",
        "image_url": "https://images.unsplash.com/photo-1601411101851-ea0e07766235?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxjYXIlMjB0aXJlJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzc5NjE1NzkzfDA&ixlib=rb-4.1.0&q=85",
        "supplier_name": "TyreDirect UK",
        "supplier_cost": 480.00,
        "retail_price": 760.00,
        "customer_price": 549.00,
        "threshold": 15,
        "max_participants": 100,
        "deadline_hours": 24,
        "state": "locked",
        "participants_count": 15,
    },
    {
        "title": "JBL Tune 770NC Headphones",
        "description": "Wireless over-ear with active noise cancelling. 70 hour battery.",
        "category": "Electronics",
        "image_url": "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHx3aXJlbGVzcyUyMGVhcnBob25lcyUyMHNsZWVrfGVufDB8fHx8MTc3OTYxNTc5M3ww&ixlib=rb-4.1.0&q=85",
        "supplier_name": "AudioWholesale Ltd",
        "supplier_cost": 78.00,
        "retail_price": 149.00,
        "customer_price": 99.00,
        "threshold": 50,
        "max_participants": 300,
        "deadline_hours": 60,
        "state": "completed",
        "participants_count": 52,
    },
]


@api_router.post("/admin/seed")
async def seed(force: bool = False):
    existing = await db.vpps.count_documents({})
    if existing > 0 and not force:
        return {"seeded": False, "existing": existing}
    if force:
        await db.vpps.delete_many({})
        await db.vpp_participants.delete_many({})
    now = datetime.now(timezone.utc)
    inserted = []
    for s in SEED_VPPS:
        vpp = VPP(
            title=s["title"],
            description=s["description"],
            category=s["category"],
            image_url=s["image_url"],
            supplier_name=s["supplier_name"],
            supplier_cost=s["supplier_cost"],
            retail_price=s["retail_price"],
            customer_price=s["customer_price"],
            threshold=s["threshold"],
            max_participants=s["max_participants"],
            deadline=now + timedelta(hours=s["deadline_hours"]),
            state=s["state"],
            participants_count=s["participants_count"],
        ).model_dump()
        vpp["created_at"] = vpp["created_at"].isoformat()
        vpp["deadline"] = vpp["deadline"].isoformat()
        if s["state"] == "locked":
            vpp["locked_at"] = now.isoformat()
            vpp["powered_at"] = now.isoformat()
        if s["state"] == "completed":
            vpp["powered_at"] = now.isoformat()
            vpp["locked_at"] = now.isoformat()
            vpp["completed_at"] = now.isoformat()
        await db.vpps.insert_one(vpp)
        inserted.append(vpp["vpp_id"])
    return {"seeded": True, "count": len(inserted)}


@api_router.get("/")
async def root():
    return {"message": "The Collective Savers API", "version": "1.0"}


# Register router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    # Auto-seed if empty
    existing = await db.vpps.count_documents({})
    if existing == 0:
        logger.info("Seeding initial VPPs...")
        await seed(force=False)
        logger.info("Seed complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()
