"""
Backend tests for The Collective Savers.

Covers: VPP listing/detail, auth (mongosh-seeded session_token Bearer),
join + state transitions, checkout (card + mock open banking),
supplier & admin RBAC, websockets.
"""
import os
import json
import uuid
import time
import asyncio
import subprocess
from datetime import datetime, timezone, timedelta

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://wave-regional-pivot.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Helpers: mongosh-seeded session ----------
def _mongosh_seed_user(role: str = "consumer") -> tuple[str, str]:
    """Create a fresh test user + session_token via mongosh; return (token, user_id)."""
    uid = f"test-user-{uuid.uuid4().hex[:10]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    js = f"""
db.users.insertOne({{
  user_id: "{uid}", email: "{email}", name: "Test User", picture: "https://i.pravatar.cc/150",
  role: "{role}", created_at: new Date()
}});
db.user_sessions.insertOne({{
  user_id: "{uid}", session_token: "{tok}",
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
}});
"""
    res = subprocess.run(
        ["mongosh", MONGO_URL, "--quiet", "--eval", f'db = db.getSiblingDB("{DB_NAME}");{js}'],
        capture_output=True, text=True, timeout=15,
    )
    assert res.returncode == 0, f"mongosh seed failed: {res.stderr}"
    return tok, uid


@pytest.fixture(scope="session")
def consumer_token():
    tok, _ = _mongosh_seed_user("consumer")
    return tok


@pytest.fixture(scope="session")
def supplier_token():
    tok, _ = _mongosh_seed_user("supplier")
    return tok


@pytest.fixture(scope="session")
def admin_token():
    tok, _ = _mongosh_seed_user("admin")
    return tok


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Health ----------
class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert "message" in r.json()


# ---------- Public VPPs ----------
class TestVPPsPublic:
    def test_list_vpps(self):
        r = requests.get(f"{API}/vpps")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 4
        v = data[0]
        for k in ("vpp_id", "title", "state", "progress_pct", "savings_pct", "participants_count"):
            assert k in v
        assert all(d["state"] != "seed" for d in data)

    def test_categories(self):
        r = requests.get(f"{API}/vpps/categories")
        assert r.status_code == 200
        cats = r.json()
        assert "Tyres" in cats and "Electronics" in cats

    def test_filter_by_state(self):
        r = requests.get(f"{API}/vpps", params={"state": "locked"})
        assert r.status_code == 200
        assert all(v["state"] == "locked" for v in r.json())

    def test_vpp_detail_unauth(self):
        lst = requests.get(f"{API}/vpps").json()
        vid = lst[0]["vpp_id"]
        r = requests.get(f"{API}/vpps/{vid}")
        assert r.status_code == 200
        d = r.json()
        assert d["has_joined"] is False
        assert d["has_paid"] is False
        assert "recent_participants" in d

    def test_vpp_detail_not_found(self):
        r = requests.get(f"{API}/vpps/does_not_exist")
        assert r.status_code == 404


# ---------- Auth ----------
class TestAuth:
    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_with_token(self, consumer_token):
        r = requests.get(f"{API}/auth/me", headers=H(consumer_token))
        assert r.status_code == 200
        u = r.json()
        assert u["role"] == "consumer"
        assert "email" in u and "user_id" in u

    def test_role_switch(self, consumer_token):
        r = requests.post(f"{API}/auth/role", headers=H(consumer_token), json={"role": "supplier"})
        assert r.status_code == 200
        assert r.json()["role"] == "supplier"
        # switch back
        r = requests.post(f"{API}/auth/role", headers=H(consumer_token), json={"role": "consumer"})
        assert r.status_code == 200

    def test_session_missing_id(self):
        r = requests.post(f"{API}/auth/session", json={})
        assert r.status_code == 400


# ---------- Join VPP & state transitions ----------
class TestJoinAndTransition:
    def test_join_requires_auth(self):
        lst = requests.get(f"{API}/vpps").json()
        vid = next(v["vpp_id"] for v in lst if v["state"] == "active")
        r = requests.post(f"{API}/vpps/{vid}/join")
        assert r.status_code == 401

    def test_join_increments_and_idempotent(self, consumer_token):
        lst = requests.get(f"{API}/vpps").json()
        v = next(v for v in lst if v["state"] == "active")
        before = v["participants_count"]
        r1 = requests.post(f"{API}/vpps/{v['vpp_id']}/join", headers=H(consumer_token))
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["success"]
        assert d1["vpp"]["participants_count"] == before + 1
        # Idempotent
        r2 = requests.post(f"{API}/vpps/{v['vpp_id']}/join", headers=H(consumer_token))
        assert r2.status_code == 200
        assert "Already joined" in r2.json()["message"]
        # Detail flag
        d = requests.get(f"{API}/vpps/{v['vpp_id']}", headers=H(consumer_token)).json()
        assert d["has_joined"] is True

    def test_auto_transition_to_locked(self, admin_token):
        """Create a small-threshold VPP, fill it past threshold via mongosh, then trigger transition by GET."""
        payload = {
            "title": "TEST_Transition_VPP", "description": "auto-transition test",
            "category": "Electronics", "image_url": "https://x/y.jpg",
            "supplier_name": "X", "supplier_cost": 10, "retail_price": 30,
            "customer_price": 20, "threshold": 2, "max_participants": 50,
            "deadline_hours": 24,
        }
        r = requests.post(f"{API}/admin/vpps", headers=H(admin_token), json=payload)
        assert r.status_code == 200, r.text
        vid = r.json()["vpp_id"]

        # Two users join via tokens
        for _ in range(2):
            tok, _u = _mongosh_seed_user("consumer")
            jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))
            assert jr.status_code == 200, jr.text
        # State should now be locked (auto-skip powered)
        d = requests.get(f"{API}/vpps/{vid}").json()
        assert d["state"] == "locked", f"expected locked got {d['state']}"


# ---------- Checkout ----------
class TestCheckout:
    def test_checkout_card_creates_stripe_session(self, admin_token):
        # Create a locked VPP and have a consumer join it
        payload = {
            "title": "TEST_Checkout_Card", "description": "x", "category": "Electronics",
            "image_url": "https://x/y.jpg", "supplier_name": "X",
            "supplier_cost": 10, "retail_price": 30, "customer_price": 20,
            "threshold": 1, "max_participants": 10, "deadline_hours": 24,
        }
        vid = requests.post(f"{API}/admin/vpps", headers=H(admin_token), json=payload).json()["vpp_id"]
        tok, _u = _mongosh_seed_user("consumer")
        jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))
        assert jr.status_code == 200
        # After 1 join with threshold 1 -> auto-locked
        assert jr.json()["vpp"]["state"] == "locked"

        r = requests.post(f"{API}/checkout/init", headers=H(tok), json={
            "vpp_id": vid, "payment_method": "card", "origin_url": BASE_URL
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["success"] and d["checkout_url"] and d["session_id"]
        assert d["discount_applied"] == 0.0
        # Status endpoint (tolerate Stripe lookup quirk; record outcome)
        sr = requests.get(f"{API}/checkout/status/{d['session_id']}", headers=H(tok))
        # Either succeeds (200) or returns 502 if Stripe upstream lookup fails for freshly created test session
        assert sr.status_code in (200, 502), f"Unexpected status: {sr.status_code} {sr.text}"

    def test_checkout_open_banking_mock_flow(self, admin_token):
        payload = {
            "title": "TEST_Checkout_OB", "description": "x", "category": "Electronics",
            "image_url": "https://x/y.jpg", "supplier_name": "X",
            "supplier_cost": 10, "retail_price": 100, "customer_price": 100,
            "threshold": 1, "max_participants": 10, "deadline_hours": 24,
        }
        vid = requests.post(f"{API}/admin/vpps", headers=H(admin_token), json=payload).json()["vpp_id"]
        tok, _u = _mongosh_seed_user("consumer")
        requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))

        r = requests.post(f"{API}/checkout/init", headers=H(tok), json={
            "vpp_id": vid, "payment_method": "open_banking", "origin_url": BASE_URL
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mock_confirmation"] is True
        # open_banking unlocks 1% on the customer_price (was 3%); see PAYMENT_DISCOUNTS
        assert d["discount_applied"] == 1.0  # 1% of 100
        assert d["final_price"] == 99.0
        sid = d["session_id"]
        # Confirm
        cr = requests.post(f"{API}/checkout/mock-confirm/{sid}", headers=H(tok))
        assert cr.status_code == 200 and cr.json()["success"]
        # Status now paid
        sr = requests.get(f"{API}/checkout/status/{sid}", headers=H(tok)).json()
        assert sr["payment_status"] == "paid"
        # VPP should transition executing or completed
        v = requests.get(f"{API}/vpps/{vid}").json()
        assert v["state"] in ("executing", "completed")

    def test_my_parties(self, admin_token):
        payload = {
            "title": "TEST_MyParties", "description": "x", "category": "Tyres",
            "image_url": "https://x/y.jpg", "supplier_name": "X",
            "supplier_cost": 50, "retail_price": 150, "customer_price": 100,
            "threshold": 1, "max_participants": 5, "deadline_hours": 24,
        }
        vid = requests.post(f"{API}/admin/vpps", headers=H(admin_token), json=payload).json()["vpp_id"]
        tok, _u = _mongosh_seed_user("consumer")
        requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))
        ci = requests.post(f"{API}/checkout/init", headers=H(tok), json={
            "vpp_id": vid, "payment_method": "open_banking", "origin_url": BASE_URL
        }).json()
        requests.post(f"{API}/checkout/mock-confirm/{ci['session_id']}", headers=H(tok))

        r = requests.get(f"{API}/me/parties", headers=H(tok))
        assert r.status_code == 200
        body = r.json()
        assert "parties" in body and "total_savings" in body
        assert len(body["parties"]) >= 1
        assert body["total_savings"] >= 50  # 150 - 100


# ---------- RBAC ----------
class TestRBAC:
    def test_consumer_cannot_access_supplier(self, consumer_token):
        r = requests.get(f"{API}/supplier/orders", headers=H(consumer_token))
        assert r.status_code == 403

    def test_consumer_cannot_access_admin(self, consumer_token):
        r = requests.get(f"{API}/admin/stats", headers=H(consumer_token))
        assert r.status_code == 403

    def test_supplier_orders(self, supplier_token):
        r = requests.get(f"{API}/supplier/orders", headers=H(supplier_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_stats(self, admin_token):
        r = requests.get(f"{API}/admin/stats", headers=H(admin_token))
        assert r.status_code == 200
        s = r.json()
        for k in ("total_vpps", "active_vpps", "locked_vpps", "completed_vpps", "total_users", "paid_orders", "gmv"):
            assert k in s

    def test_admin_list_vpps(self, admin_token):
        r = requests.get(f"{API}/admin/vpps", headers=H(admin_token))
        assert r.status_code == 200

    def test_admin_force_state_and_delete(self, admin_token):
        payload = {
            "title": "TEST_ForceState", "description": "x", "category": "Electronics",
            "image_url": "https://x/y.jpg", "supplier_name": "X",
            "supplier_cost": 10, "retail_price": 30, "customer_price": 20,
            "threshold": 100, "max_participants": 200, "deadline_hours": 24,
        }
        vid = requests.post(f"{API}/admin/vpps", headers=H(admin_token), json=payload).json()["vpp_id"]
        r = requests.patch(f"{API}/admin/vpps/{vid}/state", headers=H(admin_token), json={"state": "locked"})
        assert r.status_code == 200 and r.json()["state"] == "locked"
        dr = requests.delete(f"{API}/admin/vpps/{vid}", headers=H(admin_token))
        assert dr.status_code == 200


# ---------- WebSockets ----------
class TestWebSockets:
    @pytest.mark.asyncio
    async def test_ws_feed_accepts(self):
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/feed"
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                await ws.send("ping")
        except Exception as e:
            pytest.fail(f"WS feed connect failed: {e}")

    @pytest.mark.asyncio
    async def test_ws_vpp_accepts(self):
        lst = requests.get(f"{API}/vpps").json()
        vid = lst[0]["vpp_id"]
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws/vpp/{vid}"
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            await ws.send("ping")
