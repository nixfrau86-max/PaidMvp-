"""Pay-on-activation payments for Regional Waves© — The Collective Savers™.

Members only pay AFTER a Wave reaches its activation threshold. Joining merely
reserves stock (no charge). Once the Wave is `activated`/`processing`, each member
completes a single bundled payment (product subtotal + platform service fee +
payment processing fee) via Stripe Checkout (card/wallet) or a mocked Open
Banking / Bank Transfer flow. On success we mark the participation captured, move
reserved → sold stock, and auto-confirm the chosen garage + fitting slot booking.

Uses the Emergent Stripe Checkout integration (immediate-charge redirect) — true
card pre-auth holds aren't available, so payment is deferred to activation.
"""
import os
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionResponse, CheckoutStatusResponse, CheckoutSessionRequest,
)

logger = logging.getLogger("collective-savers")

PAYABLE_WAVE_STATES = {"activated", "processing", "fulfilment"}
STRIPE_METHODS = {"card", "apple_pay", "google_pay"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WaveCheckoutRequest(BaseModel):
    origin_url: str
    payment_method: str


def _method(config: dict, method_id: str) -> dict:
    m = next((m for m in config["payment_methods"] if m["id"] == method_id and m.get("enabled", True)), None)
    if not m:
        raise HTTPException(status_code=400, detail="Selected payment method is not available.")
    return m


def _breakdown(subtotal: float, method: dict, config: dict, compute_service_fee) -> dict:
    service_fee = compute_service_fee(subtotal, config)
    payment_fee = round(float(method["fee"]), 2)
    total = round(subtotal + service_fee + payment_fee, 2)
    return {"subtotal": round(subtotal, 2), "service_fee": service_fee, "payment_fee": payment_fee, "final_total": total}


async def settle_wave_participation(db, manager, participation_id: str, payment_method: str) -> bool:
    """Idempotently mark a participation paid → sold stock + confirm fitting booking."""
    p = await db.wave_participations.find_one({"participation_id": participation_id}, {"_id": 0})
    if not p:
        return False
    if p.get("payment_status") == "paid":
        return True

    # move reserved -> sold for each item
    inc_ops, array_filters = {}, []
    for idx, it in enumerate(p.get("items", [])):
        inc_ops[f"products.$[p{idx}].variants.$[v{idx}].reserved_qty"] = -it["qty"]
        inc_ops[f"products.$[p{idx}].variants.$[v{idx}].sold_qty"] = it["qty"]
        array_filters.append({f"p{idx}.product_id": it["product_id"]})
        array_filters.append({f"v{idx}.variant_id": it["variant_id"]})
    if inc_ops:
        try:
            await db.waves.update_one({"wave_id": p["wave_id"]}, {"$inc": inc_ops}, array_filters=array_filters)
        except Exception as e:
            logger.warning(f"stock settle warning: {e}")

    await db.wave_participations.update_one(
        {"participation_id": participation_id},
        {"$set": {"status": "captured", "payment_status": "paid",
                  "payment_method": payment_method, "paid_at": _now_iso()}},
    )

    # auto-confirm fitting booking (tyres)
    if p.get("category") == "tyres" and p.get("garage_id") and p.get("fitting_slot_iso") and not p.get("booking_id"):
        user = await db.users.find_one({"user_id": p["user_id"]}, {"_id": 0}) or {}
        booking_id = f"bk_{uuid.uuid4().hex[:10]}"
        await db.bookings.insert_one({
            "booking_id": booking_id,
            "wave_id": p["wave_id"],
            "vpp_id": p["wave_id"],  # legacy field reuse for garage dashboard compatibility
            "participation_id": participation_id,
            "user_id": p["user_id"],
            "user_name": user.get("name", ""),
            "user_email": user.get("email", ""),
            "garage_id": p["garage_id"],
            "slot_iso": p["fitting_slot_iso"],
            "slot_minutes": 30,
            "status": "confirmed",
            "notes": f"Wave fitting · {p.get('fitting_slot_label', '')}",
            "created_at": _now_iso(),
        })
        await db.wave_participations.update_one({"participation_id": participation_id}, {"$set": {"booking_id": booking_id}})

    try:
        await manager.broadcast(f"wave:{p['wave_id']}", {"type": "payment_captured", "participation_id": participation_id})
    except Exception:
        pass

    # Payment receipt + fitting confirmation email (non-blocking)
    try:
        from email_service import send_payment_receipt
        w = await db.waves.find_one({"wave_id": p["wave_id"]},
                                    {"_id": 0, "title": 1, "region_name": 1, "wave_id": 1}) or {}
        u = await db.users.find_one({"user_id": p["user_id"]}, {"_id": 0, "email": 1, "name": 1}) or {}
        asyncio.create_task(send_payment_receipt(
            u.get("email"), u.get("name"), w,
            float(p.get("subtotal", 0) or 0), p.get("units", 0),
            p.get("fitting_slot_label") if p.get("category") == "tyres" else None,
        ))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"receipt email skipped: {e}")
    return True


def build_router(deps: Dict[str, Any]) -> APIRouter:
    db = deps["db"]
    get_current_user = deps["get_current_user"]
    manager = deps["manager"]
    get_fee_config = deps["get_fee_config"]
    compute_service_fee = deps["compute_service_fee"]

    router = APIRouter()

    async def _load_payable(participation_id: str, user: dict):
        p = await db.wave_participations.find_one({"participation_id": participation_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Order not found")
        if p["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not your order")
        if p.get("payment_status") == "paid":
            raise HTTPException(status_code=400, detail="This order is already paid")
        if p.get("status") not in ("reserved", "authorized"):
            raise HTTPException(status_code=400, detail="This order can no longer be paid")
        w = await db.waves.find_one({"wave_id": p["wave_id"]}, {"_id": 0})
        if not w:
            raise HTTPException(status_code=404, detail="Wave not found")
        if w.get("state") not in PAYABLE_WAVE_STATES:
            raise HTTPException(status_code=400, detail="Payment opens once the Wave activates")
        return p, w

    @router.get("/wave-checkout/{participation_id}/quote")
    async def wave_quote(participation_id: str, user: dict = Depends(get_current_user)):
        p, w = await _load_payable(participation_id, user)
        config = await get_fee_config()
        subtotal = float(p.get("subtotal", 0))
        service_fee = compute_service_fee(subtotal, config)
        methods = []
        for m in sorted(config["payment_methods"], key=lambda x: x.get("order", 99)):
            if not m.get("enabled", True):
                continue
            fee = round(float(m["fee"]), 2)
            methods.append({"id": m["id"], "label": m["label"], "sub": m.get("sub", ""),
                            "fee": fee, "recommended": m.get("recommended", False),
                            "total": round(subtotal + service_fee + fee, 2)})
        return {
            "participation_id": participation_id,
            "wave_title": w["title"],
            "items": p.get("items", []),
            "subtotal": round(subtotal, 2),
            "service_fee": service_fee,
            "methods": methods,
        }

    @router.post("/wave-checkout/{participation_id}")
    async def wave_checkout(participation_id: str, payload: WaveCheckoutRequest,
                            request: Request, user: dict = Depends(get_current_user)):
        p, w = await _load_payable(participation_id, user)
        config = await get_fee_config()
        method = _method(config, payload.payment_method)
        subtotal = float(p.get("subtotal", 0))
        bd = _breakdown(subtotal, method, config, compute_service_fee)
        total = bd["final_total"]
        host = payload.origin_url.rstrip("/")

        if payload.payment_method in STRIPE_METHODS:
            api_key = os.environ.get("STRIPE_API_KEY")
            webhook_url = f"{str(request.base_url).rstrip('/')}/api/webhook/stripe"
            stripe_checkout = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
            success_url = f"{host}/wave-payment/success?session_id={{CHECKOUT_SESSION_ID}}&pid={participation_id}"
            cancel_url = f"{host}/wave/{w['wave_id']}"
            req = CheckoutSessionRequest(
                amount=float(total), currency="gbp",
                success_url=success_url, cancel_url=cancel_url,
                metadata={"kind": "wave", "participation_id": participation_id,
                          "wave_id": w["wave_id"], "user_id": user["user_id"]},
            )
            try:
                session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(req)
            except Exception as e:
                logger.exception("Stripe error")
                raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
            await db.payment_transactions.insert_one({
                "session_id": session.session_id, "kind": "wave",
                "participation_id": participation_id, "wave_id": w["wave_id"],
                "user_id": user["user_id"], "user_email": user["email"],
                "amount": float(total), "currency": "gbp",
                "payment_method": payload.payment_method,
                "metadata": {"kind": "wave", "participation_id": participation_id},
                "status": "initiated", "payment_status": "unpaid",
                "created_at": _now_iso(), "breakdown": bd,
            })
            await db.wave_participations.update_one(
                {"participation_id": participation_id},
                {"$set": {"payment_session_id": session.session_id, "payment_method": payload.payment_method, "breakdown": bd}},
            )
            return {"success": True, "checkout_url": session.url, "session_id": session.session_id, "amount": total}

        # MOCK: Open Banking / Bank Transfer
        mock_id = f"mock_{uuid.uuid4().hex[:16]}"
        await db.payment_transactions.insert_one({
            "session_id": mock_id, "kind": "wave",
            "participation_id": participation_id, "wave_id": w["wave_id"],
            "user_id": user["user_id"], "user_email": user["email"],
            "amount": float(total), "currency": "gbp",
            "payment_method": payload.payment_method,
            "metadata": {"kind": "wave", "participation_id": participation_id},
            "status": "initiated", "payment_status": "unpaid",
            "created_at": _now_iso(), "mock": True, "breakdown": bd,
        })
        await db.wave_participations.update_one(
            {"participation_id": participation_id},
            {"$set": {"payment_session_id": mock_id, "payment_method": payload.payment_method, "breakdown": bd}},
        )
        return {"success": True, "session_id": mock_id, "mock_confirmation": True, "amount": total}

    @router.post("/wave-checkout/mock-confirm/{session_id}")
    async def wave_mock_confirm(session_id: str, user: dict = Depends(get_current_user)):
        tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not tx or tx.get("kind") != "wave":
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not your transaction")
        if not tx.get("mock"):
            raise HTTPException(status_code=400, detail="Use the card flow for this method")
        if tx["payment_status"] != "paid":
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"status": "complete", "payment_status": "paid", "paid_at": _now_iso()}},
            )
            await settle_wave_participation(db, manager, tx["participation_id"], tx["payment_method"])
        return {"success": True}

    @router.get("/wave-checkout/status/{session_id}")
    async def wave_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
        tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not tx or tx.get("kind") != "wave":
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not your transaction")

        if tx["payment_status"] == "paid":
            return {"status": tx["status"], "payment_status": "paid", "amount_total": int(tx["amount"] * 100), "currency": tx["currency"]}
        if tx.get("mock"):
            return {"status": tx["status"], "payment_status": tx["payment_status"], "amount_total": int(tx["amount"] * 100), "currency": tx["currency"]}

        api_key = os.environ.get("STRIPE_API_KEY")
        webhook_url = f"{str(request.base_url).rstrip('/')}/api/webhook/stripe"
        stripe_checkout = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
        try:
            sr: Optional[CheckoutStatusResponse] = await stripe_checkout.get_checkout_status(session_id)
        except Exception as e:
            logger.exception("Stripe status error")
            raise HTTPException(status_code=502, detail=f"Stripe status error: {e}")
        if sr is None:
            raise HTTPException(status_code=502, detail="Stripe returned empty status")

        if sr.payment_status == "paid" and tx["payment_status"] != "paid":
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"status": sr.status, "payment_status": "paid", "paid_at": _now_iso()}},
            )
            await settle_wave_participation(db, manager, tx["participation_id"], tx["payment_method"])
        else:
            await db.payment_transactions.update_one(
                {"session_id": session_id}, {"$set": {"status": sr.status, "payment_status": sr.payment_status}},
            )
        return {"status": sr.status, "payment_status": sr.payment_status, "amount_total": sr.amount_total, "currency": sr.currency}

    return router
