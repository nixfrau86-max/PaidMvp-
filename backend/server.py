"""
The Collective Savers - Backend Server
=======================================
Real-time collective buying platform powered by VPPs (Value Party Power Systems).
"""
import os
import re
import uuid
import json
import secrets
import asyncio
import logging
import bcrypt
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
UserRole = Literal["consumer", "supplier", "admin", "garage"]
PaymentMethod = Literal["card", "apple_pay", "open_banking", "bank_transfer"]
GarageType = Literal["auth_repair_shop", "mobile_fitter", "local_garage", "dealership"]


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: UserRole = "consumer"
    phone: Optional[str] = None
    password_hash: Optional[str] = None
    auth_methods: List[str] = Field(default_factory=lambda: [])  # google | email | sms
    supplier_id: Optional[str] = None  # if user is a supplier, links to Supplier doc
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


SupplierStatus = Literal["provisional", "pending_review", "verified", "payout_ready", "rejected"]


class Supplier(BaseModel):
    model_config = ConfigDict(extra="ignore")
    supplier_id: str = Field(default_factory=lambda: f"sup_{uuid.uuid4().hex[:10]}")
    user_id: str
    # Light info
    business_name: str
    contact_email: str
    category: str
    description: str
    logo_url: Optional[str] = None
    # Standard info (optional at signup)
    contact_phone: Optional[str] = None
    vat_number: Optional[str] = None
    company_reg: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None
    # Full info (payouts)
    bank_account_name: Optional[str] = None
    bank_sort_code: Optional[str] = None
    bank_account_number_last4: Optional[str] = None
    # Status
    status: SupplierStatus = "provisional"
    info_level: str = "light"  # light | standard | full
    waves_published: int = 0
    provisional_cap: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verified_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None


class SupplierApplyRequest(BaseModel):
    business_name: str
    contact_email: str
    category: str
    description: str
    logo_url: Optional[str] = None


class SupplierUpdateRequest(BaseModel):
    business_name: Optional[str] = None
    contact_email: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    contact_phone: Optional[str] = None
    vat_number: Optional[str] = None
    company_reg: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_sort_code: Optional[str] = None
    bank_account_number: Optional[str] = None  # only last4 stored


class SupplierWaveRequest(BaseModel):
    title: str
    description: str
    category: str
    image_url: str
    supplier_cost: float
    retail_price: float
    customer_price: float
    threshold: int
    max_participants: int = 200
    deadline_hours: int = 72


# =====================================================================
# GARAGE MODELS
# =====================================================================
GARAGE_TYPE_LABELS = {
    "auth_repair_shop": "Authorised Automotive Repair Shop",
    "mobile_fitter": "Mobile Fitter",
    "local_garage": "Local Garage",
    "dealership": "Preferred Car Dealership",
}


class Garage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    garage_id: str = Field(default_factory=lambda: f"gar_{uuid.uuid4().hex[:10]}")
    user_id: str
    business_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    garage_type: GarageType
    services: List[str] = Field(default_factory=list)  # ["tyre_fitting", "wheel_alignment", "balancing", "tpms", "other"]
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    postcode: str
    calendar_url: Optional[str] = None  # iCal/ICS feed URL — placeholder for Calendar integration
    calendar_provider: Optional[str] = None  # "google" | "ical" | "manual"
    is_active: bool = True
    is_verified: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verified_at: Optional[datetime] = None


class GarageApplyRequest(BaseModel):
    business_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    garage_type: GarageType
    services: List[str] = Field(default_factory=list)
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    postcode: str
    calendar_url: Optional[str] = None


class GarageUpdateRequest(BaseModel):
    business_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    garage_type: Optional[GarageType] = None
    services: Optional[List[str]] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None
    calendar_url: Optional[str] = None
    calendar_provider: Optional[str] = None


# ----- Garage Availability (recurring weekly + per-day overrides) -----
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class TimeRange(BaseModel):
    start: str  # "09:00"
    end: str    # "17:00"


class DayOverride(BaseModel):
    closed: bool = False
    ranges: List[TimeRange] = Field(default_factory=list)


class GarageAvailability(BaseModel):
    """Stored as { garage_id, weekly: {mon: [{start,end},...]}, overrides: {"YYYY-MM-DD": {closed, ranges}}, slot_minutes }"""
    weekly: Dict[str, List[TimeRange]] = Field(default_factory=dict)
    overrides: Dict[str, DayOverride] = Field(default_factory=dict)
    slot_minutes: int = 30


class BookingCreateRequest(BaseModel):
    vpp_id: str
    garage_id: str
    slot_iso: str  # ISO datetime "2026-03-14T10:30:00+00:00"
    notes: Optional[str] = None


class Booking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booking_id: str = Field(default_factory=lambda: f"bk_{uuid.uuid4().hex[:10]}")
    vpp_id: str
    user_id: str
    user_name: str
    user_email: str
    garage_id: str
    slot_iso: str
    slot_minutes: int = 30
    status: str = "confirmed"  # confirmed | cancelled | completed
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VPP(BaseModel):
    model_config = ConfigDict(extra="ignore")
    vpp_id: str = Field(default_factory=lambda: f"vpp_{uuid.uuid4().hex[:10]}")
    title: str
    description: str
    category: str
    image_url: str
    supplier_name: str
    supplier_id: Optional[str] = None  # link to Supplier doc (None for admin-created seed waves)
    supplier_cost: float            # cost per unit from supplier
    retail_price: float             # standalone retail price
    customer_price: float           # VPP price per unit (locked)
    threshold: int                  # min participants to trigger POWERED
    max_participants: int = 500
    participants_count: int = 0
    deadline: datetime
    state: VPPState = "active"
    publish_status: str = "live"    # live | pending_approval | rejected
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    powered_at: Optional[datetime] = None
    locked_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None


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
    # Garage selection (Tyres/Automotive only)
    garage_id: Optional[str] = None             # selected from platform garage directory
    delivery_address_type: Optional[GarageType] = None  # used when shipping to a non-listed registered place
    delivery_address_line1: Optional[str] = None
    delivery_address_line2: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_postcode: Optional[str] = None
    delivery_business_name: Optional[str] = None


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
    # Tyres/Automotive: garage selection — exactly one of these two must be provided
    garage_id: Optional[str] = None
    # OR ship-to address (must be a registered place, NO private addresses)
    delivery_address_type: Optional[GarageType] = None
    delivery_business_name: Optional[str] = None
    delivery_address_line1: Optional[str] = None
    delivery_address_line2: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_postcode: Optional[str] = None


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
    "card": 0.0,             # baseline
    "apple_pay": 0.0,        # same as card
    "open_banking": 0.01,    # 1% additional savings unlocked
    "bank_transfer": 0.005,  # 0.5% additional savings unlocked
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

    # Auto-promote to admin if email is in allowlist
    allowlist = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
    if email.lower() in allowlist and user.get("role") != "admin":
        await db.users.update_one({"user_id": user_id}, {"$set": {"role": "admin"}})
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

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
    """Allow consumers to switch to supplier/garage via the apply flows.
    Admin role is restricted: only emails listed in ADMIN_EMAILS env var may hold it."""
    target = payload.role
    if target == "admin":
        allowlist = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
        if user.get("email", "").lower() not in allowlist:
            raise HTTPException(status_code=403, detail="Admin role is restricted")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": target}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return updated


# =====================================================================
# AUTH — Email / Password + SMS OTP (multi-provider, shared session_token)
# =====================================================================
EMAIL_RE = re.compile(r"^[\w\.\-\+]+@[\w\.\-]+\.[a-zA-Z]{2,}$")
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


async def _create_session_for_user(user_id: str, response: Response) -> str:
    """Create a session_token entry (same shape as Google flow) and set cookie."""
    # Auto-promote to admin if email is in allowlist
    allowlist = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
    if allowlist:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if u and u.get("email", "").lower() in allowlist and u.get("role") != "admin":
            await db.users.update_one({"user_id": user_id}, {"$set": {"role": "admin"}})
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    response.set_cookie(
        key="session_token", value=token,
        max_age=7 * 24 * 60 * 60,
        httponly=True, secure=True, samesite="none", path="/",
    )
    return token


async def _check_brute_force(identifier: str):
    """Block after 5 failed attempts in last 15 minutes."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    count = await db.login_attempts.count_documents({
        "identifier": identifier,
        "created_at": {"$gte": cutoff.isoformat()},
    })
    if count >= 5:
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")


async def _record_failed_attempt(identifier: str):
    await db.login_attempts.insert_one({
        "identifier": identifier,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def _clear_attempts(identifier: str):
    await db.login_attempts.delete_many({"identifier": identifier})


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class SmsRequestOtp(BaseModel):
    phone: str  # E.164 e.g. +447900123456


class SmsVerifyOtp(BaseModel):
    phone: str
    code: str
    name: Optional[str] = None  # provided on first signup


@api_router.post("/auth/register")
async def auth_register(payload: RegisterRequest, response: Response):
    email = payload.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(payload.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Name is required")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = User(
        user_id=user_id,
        email=email,
        name=payload.name.strip(),
        role="consumer",
        password_hash=hash_password(payload.password),
        auth_methods=["email"],
    ).model_dump()
    user["created_at"] = user["created_at"].isoformat()
    await db.users.insert_one(user)
    await _create_session_for_user(user_id, response)
    user.pop("password_hash", None)
    user.pop("_id", None)
    return {"user": user}


@api_router.post("/auth/login")
async def auth_login(payload: LoginRequest, request: Request, response: Response):
    email = payload.email.strip().lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    await _check_brute_force(identifier)

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        await _record_failed_attempt(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, user["password_hash"]):
        await _record_failed_attempt(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await _clear_attempts(identifier)
    await _create_session_for_user(user["user_id"], response)
    user.pop("password_hash", None)
    user.pop("_id", None)
    return {"user": user}


# -------- SMS OTP via Twilio Verify ----------
def _twilio_client():
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    if not sid or not token:
        return None
    try:
        from twilio.rest import Client
        return Client(sid, token)
    except ImportError:
        return None


@api_router.post("/auth/sms/request-otp")
async def auth_sms_request(payload: SmsRequestOtp, request: Request):
    phone = payload.phone.strip().replace(" ", "")
    if not E164_RE.match(phone):
        raise HTTPException(status_code=400, detail="Phone must be in E.164 format e.g. +447900123456")

    ip = request.client.host if request.client else "unknown"
    identifier = f"sms:{ip}:{phone}"
    await _check_brute_force(identifier)

    client = _twilio_client()
    verify_sid = os.environ.get("TWILIO_VERIFY_SERVICE")
    if not client or not verify_sid:
        # DEV FALLBACK: generate a 6-digit code and store it locally so flow can be tested without Twilio
        code = f"{secrets.randbelow(900000) + 100000}"
        await db.sms_otp_dev.update_one(
            {"phone": phone},
            {"$set": {"phone": phone, "code": code, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        logger.warning(f"[DEV-OTP] phone={phone} code={code}  (Twilio not configured)")
        return {"status": "pending", "dev_mode": True, "hint": "Twilio not configured — check backend logs for code"}

    try:
        verification = client.verify.v2.services(verify_sid).verifications.create(to=phone, channel="sms")
        return {"status": verification.status, "dev_mode": False}
    except Exception as e:
        logger.exception("Twilio send error")
        raise HTTPException(status_code=502, detail=f"Could not send SMS: {e}")


@api_router.post("/auth/sms/verify-otp")
async def auth_sms_verify(payload: SmsVerifyOtp, request: Request, response: Response):
    phone = payload.phone.strip().replace(" ", "")
    if not E164_RE.match(phone):
        raise HTTPException(status_code=400, detail="Invalid phone")
    if not re.fullmatch(r"\d{4,8}", payload.code):
        raise HTTPException(status_code=400, detail="Invalid code format")

    ip = request.client.host if request.client else "unknown"
    identifier = f"sms:{ip}:{phone}"
    await _check_brute_force(identifier)

    client = _twilio_client()
    verify_sid = os.environ.get("TWILIO_VERIFY_SERVICE")
    approved = False
    if not client or not verify_sid:
        # DEV FALLBACK
        rec = await db.sms_otp_dev.find_one({"phone": phone}, {"_id": 0})
        if rec and rec.get("code") == payload.code:
            approved = True
            await db.sms_otp_dev.delete_one({"phone": phone})
    else:
        try:
            check = client.verify.v2.services(verify_sid).verification_checks.create(to=phone, code=payload.code)
            approved = check.status == "approved"
        except Exception as e:
            logger.exception("Twilio verify error")
            raise HTTPException(status_code=502, detail=f"Could not verify SMS: {e}")

    if not approved:
        await _record_failed_attempt(identifier)
        raise HTTPException(status_code=401, detail="Invalid or expired code")

    await _clear_attempts(identifier)

    # Find or create user by phone
    user = await db.users.find_one({"phone": phone}, {"_id": 0})
    if not user:
        # Need a name for new user; use provided or default
        name = (payload.name or "").strip() or f"Member {phone[-4:]}"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        # synthetic email if none — phone-based unique
        synthetic_email = f"phone_{phone.lstrip('+')}@phone.thecollectivesavers.local"
        user = User(
            user_id=user_id, email=synthetic_email, name=name,
            role="consumer", phone=phone, auth_methods=["sms"],
        ).model_dump()
        user["created_at"] = user["created_at"].isoformat()
        await db.users.insert_one(user)
    else:
        # Ensure "sms" is in auth_methods
        if "sms" not in (user.get("auth_methods") or []):
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$addToSet": {"auth_methods": "sms"}}
            )

    await _create_session_for_user(user["user_id"], response)
    user.pop("password_hash", None)
    user.pop("_id", None)
    return {"user": user}


# =====================================================================
# VPP ROUTES (Consumer)
# =====================================================================
@api_router.get("/vpps")
async def list_vpps(category: Optional[str] = None, state: Optional[str] = None):
    q = {"publish_status": "live"}
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
        item = serialize_vpp(d)
        # Privacy: do not reveal supplier_name to public list — only the product
        item["supplier_name"] = "Verified Supplier"
        item["supplier_id"] = None
        out.append(item)
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
    # Privacy: hide supplier identity until the user has paid for this Wave.
    # Admins always see it; suppliers viewing their own waves always see it.
    is_admin = user and user.get("role") == "admin"
    is_own_supplier = user and user.get("role") == "supplier" and user.get("supplier_id") == doc.get("supplier_id")
    if not out["has_paid"] and not is_admin and not is_own_supplier:
        out["supplier_name"] = "Verified Supplier"
        out["supplier_id"] = None
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
@api_router.get("/me/waves")
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
        # If paid + automotive + no booking yet → flag
        cat_auto = (vpp.get("category") or "").lower() in ("tyres", "automotive")
        booking_id = p.get("booking_id")
        booking = None
        if booking_id:
            booking = await db.bookings.find_one({"booking_id": booking_id, "status": "confirmed"}, {"_id": 0})
            if booking:
                g = await db.garages.find_one({"garage_id": booking["garage_id"]}, {"_id": 0})
                booking["garage"] = _serialize_garage(g, public=True) if g else None
        needs_booking = bool(p.get("paid") and cat_auto and not booking)
        out.append({
            "vpp": v,
            "joined_at": p["joined_at"] if isinstance(p["joined_at"], str) else p["joined_at"].isoformat(),
            "paid": p.get("paid", False),
            "payment_method": p.get("payment_method"),
            "savings": round(savings, 2),
            "fulfilment_status": p.get("fulfilment_status", "pending"),
            "needs_booking": needs_booking,
            "booking": booking,
        })
    return {"waves": out, "parties": out, "total_savings": round(total_savings, 2)}


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

    # Validate garage / delivery address for automotive categories
    # NOTE (V1 flow): At checkout we do NOT require a garage. Members pre-authorise
    # payment first; once the Wave LOCKS we email them a link to choose a fitting
    # garage + slot. Booking is captured via /api/me/bookings. We only persist a
    # garage/delivery here if the member chose to lock one in early (optional).
    automotive_cats = {"tyres", "automotive"}
    is_automotive = vpp.get("category", "").lower() in automotive_cats
    garage_update: Dict[str, Any] = {}
    if is_automotive and payload.garage_id:
        garage = await db.garages.find_one({"garage_id": payload.garage_id, "is_active": True}, {"_id": 0})
        if not garage:
            raise HTTPException(status_code=400, detail="Selected garage not found")
        garage_update["garage_id"] = payload.garage_id
    elif is_automotive and payload.delivery_address_type:
        if payload.delivery_address_type not in ("auth_repair_shop", "mobile_fitter", "local_garage", "dealership"):
            raise HTTPException(status_code=400, detail="Delivery must be to a registered place. Private addresses are not permitted.")
        required = [payload.delivery_business_name, payload.delivery_address_line1, payload.delivery_city, payload.delivery_postcode]
        if not all(required):
            raise HTTPException(status_code=400, detail="Provide full delivery address (business name, line 1, city, postcode).")
        garage_update.update({
            "delivery_address_type": payload.delivery_address_type,
            "delivery_business_name": payload.delivery_business_name,
            "delivery_address_line1": payload.delivery_address_line1,
            "delivery_address_line2": payload.delivery_address_line2,
            "delivery_city": payload.delivery_city,
            "delivery_postcode": payload.delivery_postcode,
        })

    if garage_update:
        await db.vpp_participants.update_one(
            {"vpp_id": payload.vpp_id, "user_id": user["user_id"]},
            {"$set": garage_update}
        )

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
# GARAGE ROUTES — Onboarding & Directory
# =====================================================================
def _serialize_garage(g: dict, public: bool = False) -> dict:
    d = dict(g)
    d.pop("_id", None)
    for k in ("created_at", "verified_at"):
        v = d.get(k)
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    d["garage_type_label"] = GARAGE_TYPE_LABELS.get(d.get("garage_type"), d.get("garage_type"))
    if public:
        # Strip private contact fields from the public directory
        d.pop("contact_email", None)
        d.pop("contact_phone", None)
        d.pop("calendar_url", None)
        d.pop("calendar_feed_token", None)
    return d


@api_router.post("/garages/apply")
async def garage_apply(payload: GarageApplyRequest, user: dict = Depends(get_current_user)):
    existing = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if existing:
        return _serialize_garage(existing)
    garage = Garage(
        user_id=user["user_id"],
        business_name=payload.business_name,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        garage_type=payload.garage_type,
        services=payload.services or [],
        address_line1=payload.address_line1,
        address_line2=payload.address_line2,
        city=payload.city,
        postcode=payload.postcode,
        calendar_url=payload.calendar_url,
        calendar_provider="ical" if payload.calendar_url else "manual",
    ).model_dump()
    garage["created_at"] = garage["created_at"].isoformat()
    await db.garages.insert_one(garage)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": "garage"}, "$addToSet": {"auth_methods": user.get("auth_methods", ["email"])[0] if user.get("auth_methods") else "email"}}
    )
    # Refetch and return clean copy
    g = await db.garages.find_one({"garage_id": garage["garage_id"]}, {"_id": 0})
    return _serialize_garage(g)


@api_router.get("/garages/me")
async def garage_me(user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    return _serialize_garage(g)


@api_router.patch("/garages/me")
async def garage_update(payload: GarageUpdateRequest, user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    update: Dict[str, Any] = {}
    for f in ("business_name", "contact_email", "contact_phone", "garage_type",
              "services", "address_line1", "address_line2", "city", "postcode",
              "calendar_url", "calendar_provider"):
        v = getattr(payload, f, None)
        if v is not None:
            update[f] = v
    if update:
        await db.garages.update_one({"garage_id": g["garage_id"]}, {"$set": update})
    g = await db.garages.find_one({"garage_id": g["garage_id"]}, {"_id": 0})
    return _serialize_garage(g)


@api_router.get("/garages")
async def list_garages(postcode: Optional[str] = None, garage_type: Optional[str] = None):
    """Public directory — for users to select a garage at checkout."""
    q: Dict[str, Any] = {"is_active": True}
    if garage_type:
        q["garage_type"] = garage_type
    if postcode:
        # Loose postcode prefix match (first 3-4 chars)
        pc = postcode.strip().upper().replace(" ", "")[:3]
        q["postcode"] = {"$regex": f"^{re.escape(pc)}", "$options": "i"}
    docs = await db.garages.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [_serialize_garage(d, public=True) for d in docs]


# Admin endpoint to verify a garage
@api_router.post("/admin/garages/{garage_id}/verify")
async def admin_verify_garage(garage_id: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    await db.garages.update_one(
        {"garage_id": garage_id},
        {"$set": {"is_verified": True, "verified_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"success": True}


@api_router.get("/admin/garages")
async def admin_list_garages(user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    docs = await db.garages.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_serialize_garage(d) for d in docs]


# ----- Garage Availability & Bookings -----
DEFAULT_AVAILABILITY = {
    "weekly": {d: ([{"start": "09:00", "end": "17:00"}] if d not in ("sat", "sun") else []) for d in WEEKDAYS},
    "overrides": {},
    "slot_minutes": 30,
}


@api_router.get("/garages/me/availability")
async def garage_my_availability(user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    av = await db.garage_availability.find_one({"garage_id": g["garage_id"]}, {"_id": 0})
    if not av:
        return {"garage_id": g["garage_id"], **DEFAULT_AVAILABILITY}
    av.pop("_id", None)
    return av


@api_router.put("/garages/me/availability")
async def garage_set_availability(payload: GarageAvailability, user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    # Validate weekday keys
    weekly: Dict[str, Any] = {}
    for d in WEEKDAYS:
        ranges = payload.weekly.get(d, [])
        weekly[d] = [{"start": r.start, "end": r.end} for r in ranges]
    overrides: Dict[str, Any] = {}
    for date_key, ov in (payload.overrides or {}).items():
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_key):
            continue
        overrides[date_key] = {
            "closed": bool(ov.closed),
            "ranges": [{"start": r.start, "end": r.end} for r in (ov.ranges or [])],
        }
    doc = {
        "garage_id": g["garage_id"],
        "weekly": weekly,
        "overrides": overrides,
        "slot_minutes": int(payload.slot_minutes or 30),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.garage_availability.update_one(
        {"garage_id": g["garage_id"]}, {"$set": doc}, upsert=True
    )
    doc.pop("_id", None)
    return doc


def _generate_slots_for_date(date_str: str, av: dict, booked: set) -> List[dict]:
    """Generate available slot start times for a given YYYY-MM-DD."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        return []
    wd = WEEKDAYS[dt.weekday()]
    overrides = (av or {}).get("overrides", {}) or {}
    weekly = (av or {}).get("weekly", {}) or {}
    slot_min = int((av or {}).get("slot_minutes", 30))

    ov = overrides.get(date_str)
    if ov:
        if ov.get("closed"):
            return []
        ranges = ov.get("ranges", []) or weekly.get(wd, [])
    else:
        ranges = weekly.get(wd, [])

    slots: List[dict] = []
    for r in ranges:
        try:
            sh, sm = [int(x) for x in r["start"].split(":")]
            eh, em = [int(x) for x in r["end"].split(":")]
        except Exception:
            continue
        cursor = dt.replace(hour=sh, minute=sm, second=0, microsecond=0, tzinfo=timezone.utc)
        end_at = dt.replace(hour=eh, minute=em, second=0, microsecond=0, tzinfo=timezone.utc)
        while cursor + timedelta(minutes=slot_min) <= end_at:
            iso = cursor.isoformat()
            if iso not in booked:
                slots.append({"slot_iso": iso, "label": cursor.strftime("%H:%M")})
            cursor = cursor + timedelta(minutes=slot_min)
    return slots


@api_router.get("/garages/{garage_id}/slots")
async def list_garage_slots(garage_id: str, days: int = 14):
    """Return upcoming open slots grouped by date for the next N days."""
    g = await db.garages.find_one({"garage_id": garage_id, "is_active": True}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Garage not found")
    av = await db.garage_availability.find_one({"garage_id": garage_id}, {"_id": 0}) or DEFAULT_AVAILABILITY
    # Booked slots in next `days`
    booked_docs = await db.bookings.find(
        {"garage_id": garage_id, "status": "confirmed"}, {"_id": 0, "slot_iso": 1}
    ).to_list(2000)
    booked = {b["slot_iso"] for b in booked_docs}

    today = datetime.now(timezone.utc).date()
    out = []
    for i in range(max(1, min(days, 30))):
        d = today + timedelta(days=i)
        date_str = d.isoformat()
        slots = _generate_slots_for_date(date_str, av, booked)
        # Filter out past slots for today
        if i == 0:
            now_iso = datetime.now(timezone.utc).isoformat()
            slots = [s for s in slots if s["slot_iso"] > now_iso]
        out.append({"date": date_str, "weekday": WEEKDAYS[d.weekday()], "slots": slots})
    return {"garage": _serialize_garage(g, public=True), "days": out}


@api_router.post("/me/bookings")
async def create_booking(payload: BookingCreateRequest, user: dict = Depends(get_current_user)):
    """Member books a fitting slot at a selected garage for a Wave they've paid for."""
    vpp = await db.vpps.find_one({"vpp_id": payload.vpp_id}, {"_id": 0})
    if not vpp:
        raise HTTPException(status_code=404, detail="Wave not found")
    if vpp.get("category", "").lower() not in ("tyres", "automotive"):
        raise HTTPException(status_code=400, detail="Bookings are only for automotive Waves")
    participant = await db.vpp_participants.find_one(
        {"vpp_id": payload.vpp_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not participant or not participant.get("paid"):
        raise HTTPException(status_code=403, detail="You must have paid for this Wave to book a fitting")
    garage = await db.garages.find_one({"garage_id": payload.garage_id, "is_active": True}, {"_id": 0})
    if not garage:
        raise HTTPException(status_code=404, detail="Garage not found")
    # Check slot is not already booked
    clash = await db.bookings.find_one(
        {"garage_id": payload.garage_id, "slot_iso": payload.slot_iso, "status": "confirmed"}, {"_id": 0}
    )
    if clash:
        raise HTTPException(status_code=409, detail="That slot was just taken — please pick another.")
    # Replace existing booking for this wave by this user
    existing = await db.bookings.find_one(
        {"vpp_id": payload.vpp_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if existing:
        await db.bookings.update_one(
            {"booking_id": existing["booking_id"]},
            {"$set": {"status": "cancelled"}}
        )
    av = await db.garage_availability.find_one({"garage_id": payload.garage_id}, {"_id": 0})
    slot_min = int((av or {}).get("slot_minutes", 30))
    booking = Booking(
        vpp_id=payload.vpp_id,
        user_id=user["user_id"],
        user_name=user["name"],
        user_email=user["email"],
        garage_id=payload.garage_id,
        slot_iso=payload.slot_iso,
        slot_minutes=slot_min,
        notes=payload.notes,
    ).model_dump()
    booking["created_at"] = booking["created_at"].isoformat()
    await db.bookings.insert_one(booking)
    # Link the booking to the participant
    await db.vpp_participants.update_one(
        {"vpp_id": payload.vpp_id, "user_id": user["user_id"]},
        {"$set": {"garage_id": payload.garage_id, "booking_id": booking["booking_id"]}}
    )
    booking.pop("_id", None)
    return booking


@api_router.get("/me/bookings")
async def my_bookings(user: dict = Depends(get_current_user)):
    docs = await db.bookings.find(
        {"user_id": user["user_id"], "status": "confirmed"}, {"_id": 0}
    ).sort("slot_iso", 1).to_list(100)
    out = []
    for b in docs:
        g = await db.garages.find_one({"garage_id": b["garage_id"]}, {"_id": 0})
        v = await db.vpps.find_one({"vpp_id": b["vpp_id"]}, {"_id": 0})
        out.append({
            **b,
            "garage": _serialize_garage(g, public=True) if g else None,
            "vpp_title": v.get("title") if v else None,
        })
    return out


@api_router.get("/garages/me/bookings")
async def garage_my_bookings(user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    docs = await db.bookings.find(
        {"garage_id": g["garage_id"]}, {"_id": 0}
    ).sort("slot_iso", 1).to_list(500)
    out = []
    for b in docs:
        v = await db.vpps.find_one({"vpp_id": b["vpp_id"]}, {"_id": 0})
        out.append({
            **b,
            "vpp_title": v.get("title") if v else None,
            "vpp_category": v.get("category") if v else None,
        })
    return out


# ----- Calendar Sync (iCal subscription feed) -----
def _ics_escape(text: str) -> str:
    if not text:
        return ""
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
    )


def _ics_dt(iso: str) -> str:
    """Convert ISO datetime to ICS UTC format YYYYMMDDTHHMMSSZ."""
    try:
        if iso.endswith("Z"):
            iso = iso[:-1] + "+00:00"
        dt = datetime.fromisoformat(iso)
        dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y%m%dT%H%M%SZ")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _build_ics_for_garage(g: dict, bookings: List[dict]) -> str:
    """Render an RFC-5545 iCalendar feed for a garage's confirmed bookings."""
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//The Collective Savers//Garage Bookings//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(g.get('business_name', 'Collective Savers'))} — Fittings",
        "X-WR-TIMEZONE:Europe/London",
        "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
        "X-PUBLISHED-TTL:PT15M",
    ]
    addr = ", ".join([x for x in [
        g.get("address_line1"), g.get("address_line2"), g.get("city"), g.get("postcode")
    ] if x])
    for b in bookings:
        slot_min = int(b.get("slot_minutes", 30))
        try:
            start_dt = datetime.fromisoformat(b["slot_iso"].replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        end_dt = start_dt + timedelta(minutes=slot_min)
        ev_status = "CONFIRMED" if b.get("status") == "confirmed" else "CANCELLED"
        summary = f"Fitting — {b.get('user_name', 'Member')}"
        if b.get("vpp_title"):
            summary += f" ({b['vpp_title']})"
        desc_parts = [
            f"Member: {b.get('user_name', '')}",
            f"Contact: {b.get('user_email', '')}",
            f"Wave: {b.get('vpp_title', '')}",
            f"Category: {b.get('vpp_category', '')}",
            f"Booking ID: {b.get('booking_id', '')}",
        ]
        if b.get("notes"):
            desc_parts.append(f"Notes: {b['notes']}")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{b.get('booking_id', uuid.uuid4().hex)}@collectivesavers",
            f"DTSTAMP:{now}",
            f"DTSTART:{_ics_dt(start_dt.isoformat())}",
            f"DTEND:{_ics_dt(end_dt.isoformat())}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"DESCRIPTION:{_ics_escape(chr(10).join(desc_parts))}",
            f"LOCATION:{_ics_escape(addr)}",
            f"STATUS:{ev_status}",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


async def _ensure_calendar_token(garage: dict) -> str:
    token = garage.get("calendar_feed_token")
    if not token:
        token = secrets.token_urlsafe(24)
        await db.garages.update_one(
            {"garage_id": garage["garage_id"]},
            {"$set": {"calendar_feed_token": token}}
        )
    return token


@api_router.get("/garages/me/calendar")
async def garage_calendar_info(user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    token = await _ensure_calendar_token(g)
    feed_path = f"/api/calendar/garage/{g['garage_id']}.ics?token={token}"
    return {
        "garage_id": g["garage_id"],
        "feed_path": feed_path,
        "token": token,
    }


@api_router.post("/garages/me/calendar/regenerate")
async def garage_calendar_regenerate(user: dict = Depends(get_current_user)):
    g = await db.garages.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="No garage profile")
    new_token = secrets.token_urlsafe(24)
    await db.garages.update_one(
        {"garage_id": g["garage_id"]}, {"$set": {"calendar_feed_token": new_token}}
    )
    return {"token": new_token}


@api_router.get("/calendar/garage/{garage_id}.ics")
async def garage_ics_feed(garage_id: str, token: str = ""):
    """Public iCal feed — secured by per-garage token (not session auth)."""
    g = await db.garages.find_one({"garage_id": garage_id}, {"_id": 0})
    if not g or not g.get("calendar_feed_token") or g["calendar_feed_token"] != token:
        raise HTTPException(status_code=404, detail="Calendar not found")
    docs = await db.bookings.find(
        {"garage_id": garage_id}, {"_id": 0}
    ).sort("slot_iso", 1).to_list(2000)
    for b in docs:
        v = await db.vpps.find_one({"vpp_id": b.get("vpp_id")}, {"_id": 0, "title": 1, "category": 1})
        if v:
            b["vpp_title"] = v.get("title")
            b["vpp_category"] = v.get("category")
    ics = _build_ics_for_garage(g, docs)
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="{garage_id}.ics"',
            "Cache-Control": "private, max-age=300",
        },
    )


# =====================================================================
# SUPPLIER ROUTES — Onboarding
# =====================================================================
def _serialize_supplier(s: dict) -> dict:
    d = dict(s)
    d.pop("_id", None)
    for k in ("created_at", "verified_at", "rejected_at"):
        v = d.get(k)
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


async def _get_my_supplier(user: dict) -> Optional[dict]:
    if not user.get("supplier_id"):
        return None
    return await db.suppliers.find_one({"supplier_id": user["supplier_id"]}, {"_id": 0})


@api_router.post("/suppliers/apply")
async def supplier_apply(payload: SupplierApplyRequest, user: dict = Depends(get_current_user)):
    # If already a supplier, return existing
    existing = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if existing:
        return _serialize_supplier(existing)
    supplier = Supplier(
        user_id=user["user_id"],
        business_name=payload.business_name,
        contact_email=payload.contact_email,
        category=payload.category,
        description=payload.description,
        logo_url=payload.logo_url,
        status="provisional",
        info_level="light",
    ).model_dump()
    supplier["created_at"] = supplier["created_at"].isoformat()
    await db.suppliers.insert_one(supplier)
    # Update user role & link
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": "supplier", "supplier_id": supplier["supplier_id"]}}
    )
    return _serialize_supplier(supplier)


@api_router.get("/suppliers/me")
async def supplier_me(user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="No supplier profile")
    return _serialize_supplier(s)


@api_router.patch("/suppliers/me")
async def supplier_update_me(payload: SupplierUpdateRequest, user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="No supplier profile")
    update: Dict[str, Any] = {}
    for field in ("business_name", "contact_email", "category", "description", "logo_url",
                  "contact_phone", "vat_number", "company_reg",
                  "address_line1", "address_line2", "city", "postcode",
                  "bank_account_name", "bank_sort_code"):
        v = getattr(payload, field, None)
        if v is not None:
            update[field] = v
    if payload.bank_account_number:
        update["bank_account_number_last4"] = payload.bank_account_number[-4:]
    if update:
        await db.suppliers.update_one({"supplier_id": s["supplier_id"]}, {"$set": update})

    # Compute new info_level
    merged = {**s, **update}
    has_standard = all(merged.get(f) for f in ("contact_phone", "vat_number", "address_line1", "city", "postcode"))
    has_full = has_standard and merged.get("bank_account_name") and merged.get("bank_sort_code") and merged.get("bank_account_number_last4")
    new_level = "full" if has_full else ("standard" if has_standard else "light")
    if new_level != merged.get("info_level"):
        await db.suppliers.update_one({"supplier_id": s["supplier_id"]}, {"$set": {"info_level": new_level}})

    return await supplier_me(user)


@api_router.post("/suppliers/me/request-verification")
async def supplier_request_verification(user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="No supplier profile")
    if s["status"] in ("verified", "payout_ready"):
        return _serialize_supplier(s)
    if s.get("info_level") not in ("standard", "full"):
        raise HTTPException(status_code=400, detail="Provide Standard info (phone, VAT, address) before requesting verification")
    await db.suppliers.update_one({"supplier_id": s["supplier_id"]}, {"$set": {"status": "pending_review"}})
    s = await db.suppliers.find_one({"supplier_id": s["supplier_id"]}, {"_id": 0})
    return _serialize_supplier(s)


@api_router.post("/suppliers/me/waves")
async def supplier_create_wave(payload: SupplierWaveRequest, user: dict = Depends(get_current_user)):
    supplier = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=403, detail="Apply as a supplier first")
    if supplier["status"] == "rejected":
        raise HTTPException(status_code=403, detail="Your supplier account was rejected")

    # Provisional caps
    if supplier["status"] == "provisional":
        # Cap threshold & retail price
        if payload.threshold > 30:
            raise HTTPException(status_code=400, detail="Provisional suppliers: threshold capped at 30. Get verified to lift limits.")
        if payload.retail_price > 500:
            raise HTTPException(status_code=400, detail="Provisional suppliers: retail price capped at £500. Get verified to lift limits.")

    # Decide publish_status:
    # Provisional + first wave → auto-live
    # Provisional + 2nd+ wave → pending_approval
    # Verified/payout_ready → auto-live
    if supplier["status"] in ("verified", "payout_ready"):
        publish_status = "live"
    elif supplier["status"] == "provisional" and supplier.get("waves_published", 0) < supplier.get("provisional_cap", 1):
        publish_status = "live"
    else:
        publish_status = "pending_approval"

    deadline = datetime.now(timezone.utc) + timedelta(hours=payload.deadline_hours)
    vpp = VPP(
        title=payload.title,
        description=payload.description,
        category=payload.category,
        image_url=payload.image_url,
        supplier_name=supplier["business_name"],
        supplier_id=supplier["supplier_id"],
        supplier_cost=payload.supplier_cost,
        retail_price=payload.retail_price,
        customer_price=payload.customer_price,
        threshold=payload.threshold,
        max_participants=payload.max_participants,
        deadline=deadline,
        state="active",
        publish_status=publish_status,
    ).model_dump()
    vpp["created_at"] = vpp["created_at"].isoformat()
    vpp["deadline"] = vpp["deadline"].isoformat()
    await db.vpps.insert_one(vpp)
    await db.suppliers.update_one(
        {"supplier_id": supplier["supplier_id"]},
        {"$inc": {"waves_published": 1}}
    )
    out = serialize_vpp(vpp)
    if publish_status == "live":
        await manager.broadcast("vpps:all", {"type": "vpp_created", "vpp": out})
    return {**out, "publish_status": publish_status}


@api_router.get("/suppliers/me/waves")
async def supplier_my_waves(user: dict = Depends(get_current_user)):
    supplier = await db.suppliers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="No supplier profile")
    docs = await db.vpps.find(
        {"supplier_id": supplier["supplier_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    out = []
    for d in docs:
        paid = await db.vpp_participants.count_documents({"vpp_id": d["vpp_id"], "paid": True})
        out.append({
            **serialize_vpp(d),
            "publish_status": d.get("publish_status", "live"),
            "paid_count": paid,
            "total_supplier_value": round(paid * d["supplier_cost"], 2),
        })
    return out


# =====================================================================
# SUPPLIER ROUTES — Orders / Fulfilment
# =====================================================================
@api_router.get("/supplier/orders")
async def supplier_orders(user: dict = Depends(get_current_user)):
    await require_role(user, ["supplier", "admin"])
    # If supplier, scope to own waves. If admin, return all.
    q: Dict[str, Any] = {"state": {"$in": ["locked", "executing", "completed"]}}
    if user.get("role") == "supplier" and user.get("supplier_id"):
        q["supplier_id"] = user["supplier_id"]
    docs = await db.vpps.find(q, {"_id": 0}).sort("locked_at", -1).to_list(100)
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
        out.append({
            **serialize_vpp(d),
            "publish_status": d.get("publish_status", "live"),
            "paid_count": paid,
        })
    return out


@api_router.get("/admin/suppliers")
async def admin_list_suppliers(user: dict = Depends(get_current_user), status_filter: Optional[str] = None):
    await require_role(user, ["admin"])
    q: Dict[str, Any] = {}
    if status_filter:
        q["status"] = status_filter
    docs = await db.suppliers.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_serialize_supplier(d) for d in docs]


@api_router.post("/admin/suppliers/{supplier_id}/verify")
async def admin_verify_supplier(supplier_id: str, body: dict, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    s = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    new_status = "payout_ready" if s.get("info_level") == "full" else "verified"
    await db.suppliers.update_one(
        {"supplier_id": supplier_id},
        {"$set": {"status": new_status, "verified_at": datetime.now(timezone.utc).isoformat()}}
    )
    return await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})


@api_router.post("/admin/suppliers/{supplier_id}/reject")
async def admin_reject_supplier(supplier_id: str, body: dict, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    reason = (body or {}).get("reason", "Did not meet criteria")
    await db.suppliers.update_one(
        {"supplier_id": supplier_id},
        {"$set": {"status": "rejected", "rejected_at": datetime.now(timezone.utc).isoformat(), "rejection_reason": reason}}
    )
    return {"success": True}


@api_router.get("/admin/waves/pending")
async def admin_pending_waves(user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    docs = await db.vpps.find({"publish_status": "pending_approval"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [serialize_vpp(d) for d in docs]


@api_router.post("/admin/waves/{vpp_id}/approve")
async def admin_approve_wave(vpp_id: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    await db.vpps.update_one({"vpp_id": vpp_id}, {"$set": {"publish_status": "live"}})
    vpp = await db.vpps.find_one({"vpp_id": vpp_id}, {"_id": 0})
    if vpp:
        out = serialize_vpp(vpp)
        await manager.broadcast("vpps:all", {"type": "vpp_created", "vpp": out})
    return {"success": True}


@api_router.post("/admin/waves/{vpp_id}/reject")
async def admin_reject_wave(vpp_id: str, body: dict, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    reason = (body or {}).get("reason", "Did not meet criteria")
    await db.vpps.update_one(
        {"vpp_id": vpp_id},
        {"$set": {"publish_status": "rejected", "rejection_reason": reason}}
    )
    return {"success": True}


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
    pending_suppliers = await db.suppliers.count_documents({"status": "pending_review"})
    total_suppliers = await db.suppliers.count_documents({})
    pending_waves = await db.vpps.count_documents({"publish_status": "pending_approval"})
    return {
        "total_vpps": total_vpps,
        "active_vpps": active,
        "locked_vpps": locked,
        "completed_vpps": completed,
        "total_users": total_users,
        "paid_orders": paid_count,
        "gmv": gmv,
        "total_suppliers": total_suppliers,
        "pending_suppliers": pending_suppliers,
        "pending_waves": pending_waves,
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


@api_router.post("/waitlist")
async def waitlist_signup(payload: dict):
    email = (payload or {}).get("email", "").strip().lower()
    roles = (payload or {}).get("roles", [])
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    if not isinstance(roles, list):
        roles = []
    roles = [r for r in roles if r in ("consumer", "supplier", "garage")]
    existing = await db.waitlist.find_one({"email": email}, {"_id": 0})
    if existing:
        if roles:
            await db.waitlist.update_one({"email": email}, {"$addToSet": {"roles": {"$each": roles}}})
        return {"success": True, "already": True}
    await db.waitlist.insert_one({
        "email": email,
        "roles": roles,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True}


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
    # Indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("phone", unique=False, sparse=True)
        await db.login_attempts.create_index("identifier")
        await db.user_sessions.create_index("session_token", unique=True)
        await db.bookings.create_index([("garage_id", 1), ("slot_iso", 1)])
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")
    # Auto-seed if empty
    existing = await db.vpps.count_documents({})
    if existing == 0:
        logger.info("Seeding initial VPPs...")
        await seed(force=False)
        logger.info("Seed complete")
    # Seed/refresh founder admin
    try:
        founder_email = os.environ.get("FOUNDER_EMAIL", "").strip().lower()
        founder_pw = os.environ.get("FOUNDER_PASSWORD", "")
        if founder_email and founder_pw:
            existing_admin = await db.users.find_one({"email": founder_email}, {"_id": 0})
            pw_hash = hash_password(founder_pw)
            if not existing_admin:
                user_id = f"user_{uuid.uuid4().hex[:12]}"
                await db.users.insert_one({
                    "user_id": user_id,
                    "email": founder_email,
                    "name": "Founder",
                    "role": "admin",
                    "password_hash": pw_hash,
                    "auth_methods": ["email"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"Seeded founder admin: {founder_email}")
            else:
                # Always refresh password + ensure admin role
                await db.users.update_one(
                    {"email": founder_email},
                    {"$set": {"password_hash": pw_hash, "role": "admin"}, "$addToSet": {"auth_methods": "email"}}
                )
                logger.info(f"Refreshed founder admin: {founder_email}")
    except Exception as e:
        logger.warning(f"Founder admin seed failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
