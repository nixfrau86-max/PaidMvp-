"""
Backend tests for the Fee Engine + Checkout Quote rework (iteration 4).

Covers:
- GET /api/admin/fees seeded defaults (commission=0.02, mode=flat, value=4.0, 5 methods)
- PUT /api/admin/fees: percent mode, persistence, all validations (neg, >1, no enabled, 2 recommended)
- GET /api/checkout/quote/{vpp_id}: auth required; correct breakdown; percent mode math
- POST /api/checkout/init: full breakdown stored on payment_transactions + vpp_participants
- POST /api/checkout/init: google_pay -> Stripe checkout_url
- POST /api/checkout/init: open_banking -> mock_confirmation
- POST /api/checkout/init: rejects disabled payment method
"""
import os
import uuid
import copy
import subprocess
from typing import Optional

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://slot-booking-system-2.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FOUNDER_EMAIL = "founder@thecollectivesavers.co.uk"
FOUNDER_PW = "SaversCollective"

DEFAULT_FEE_CONFIG = {
    "commission_pct": 0.02,
    "service_fee_mode": "flat",
    "service_fee_value": 4.0,
    "payment_methods": [
        {"id": "open_banking",  "label": "Open Banking",         "sub": "Direct from your bank · Instant",   "fee": 1.00, "recommended": True,  "enabled": True, "order": 1},
        {"id": "apple_pay",     "label": "Apple Pay",            "sub": "One-tap wallet checkout",            "fee": 3.00, "recommended": False, "enabled": True, "order": 2},
        {"id": "google_pay",    "label": "Google Pay",           "sub": "One-tap wallet checkout",            "fee": 3.00, "recommended": False, "enabled": True, "order": 3},
        {"id": "card",          "label": "Debit / Credit Card",  "sub": "Visa · Mastercard · Amex",           "fee": 3.00, "recommended": False, "enabled": True, "order": 4},
        {"id": "bank_transfer", "label": "Bank Transfer",        "sub": "Faster Payments · 1–3 hours",        "fee": 1.50, "recommended": False, "enabled": True, "order": 5},
    ],
}


def H(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _login_founder() -> str:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PW})
    assert r.status_code == 200, r.text
    tok = s.cookies.get("session_token")
    assert tok, "Founder login did not return session_token cookie"
    return tok


def _mongosh_seed_consumer():
    uid = f"test-user-{uuid.uuid4().hex[:10]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    js = f"""
db.users.insertOne({{
  user_id: "{uid}", email: "{email}", name: "Fee Tester", picture: "https://i.pravatar.cc/150",
  role: "consumer", created_at: new Date(), auth_methods: ["mongosh"]
}});
db.user_sessions.insertOne({{
  user_id: "{uid}", session_token: "{tok}",
  expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  created_at: new Date().toISOString()
}});
"""
    res = subprocess.run(
        ["mongosh", MONGO_URL, "--quiet", "--eval", f'db = db.getSiblingDB("{DB_NAME}");{js}'],
        capture_output=True, text=True, timeout=15,
    )
    assert res.returncode == 0, f"mongosh failed: {res.stderr}"
    return tok, uid, email


def _create_locked_vpp(admin_tok: str, category: str = "Tyres",
                       retail: float = 200.0, wave: float = 100.0,
                       supplier_cost: float = 50.0) -> str:
    payload = {
        "title": f"TEST_FeeWave_{uuid.uuid4().hex[:6]}",
        "description": "Fee engine test wave",
        "category": category,
        "image_url": "https://x/y.jpg",
        "supplier_name": "TestSupplier",
        "supplier_cost": supplier_cost,
        "retail_price": retail,
        "customer_price": wave,
        "threshold": 1,
        "max_participants": 50,
        "deadline_hours": 24,
    }
    r = requests.post(f"{API}/admin/vpps", headers=H(admin_tok), json=payload)
    assert r.status_code == 200, r.text
    return r.json()["vpp_id"]


def _force_lock(admin_tok: str, vpp_id: str):
    r = requests.patch(f"{API}/admin/vpps/{vpp_id}/state", headers=H(admin_tok),
                       json={"state": "locked"})
    assert r.status_code == 200, r.text


def _reset_fees(admin_tok: str):
    r = requests.put(f"{API}/admin/fees", headers=H(admin_tok),
                     json=copy.deepcopy(DEFAULT_FEE_CONFIG))
    assert r.status_code == 200, r.text


# ---------- ADMIN FEES ----------
class TestAdminFees:
    def test_get_fees_returns_seeded_defaults(self):
        tok = _login_founder()
        _reset_fees(tok)
        r = requests.get(f"{API}/admin/fees", headers=H(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["commission_pct"] == 0.02
        assert body["service_fee_mode"] == "flat"
        assert body["service_fee_value"] == 4.0
        assert isinstance(body["payment_methods"], list)
        assert len(body["payment_methods"]) == 5
        ids = sorted([m["id"] for m in body["payment_methods"]])
        assert ids == ["apple_pay", "bank_transfer", "card", "google_pay", "open_banking"]

    def test_get_fees_requires_admin(self):
        ctok, _, _ = _mongosh_seed_consumer()
        r = requests.get(f"{API}/admin/fees", headers=H(ctok))
        assert r.status_code in (401, 403), r.text

    def test_put_fees_percent_mode_persists(self):
        tok = _login_founder()
        _reset_fees(tok)
        body = {"service_fee_mode": "percent", "service_fee_value": 0.01}
        r = requests.put(f"{API}/admin/fees", headers=H(tok), json=body)
        assert r.status_code == 200, r.text
        # GET again to verify persistence
        g = requests.get(f"{API}/admin/fees", headers=H(tok)).json()
        assert g["service_fee_mode"] == "percent"
        assert g["service_fee_value"] == 0.01
        _reset_fees(tok)

    def test_put_fees_rejects_negative_service_value(self):
        tok = _login_founder()
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"service_fee_value": -1.0})
        assert r.status_code == 400, r.text

    def test_put_fees_rejects_commission_gt_1(self):
        tok = _login_founder()
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"commission_pct": 1.5})
        assert r.status_code == 400, r.text

    def test_put_fees_rejects_negative_commission(self):
        tok = _login_founder()
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"commission_pct": -0.01})
        assert r.status_code == 400, r.text

    def test_put_fees_rejects_percent_value_gt_1(self):
        tok = _login_founder()
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"service_fee_mode": "percent", "service_fee_value": 2.0})
        assert r.status_code == 400, r.text

    def test_put_fees_rejects_zero_enabled_methods(self):
        tok = _login_founder()
        methods = copy.deepcopy(DEFAULT_FEE_CONFIG["payment_methods"])
        for m in methods:
            m["enabled"] = False
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"payment_methods": methods})
        assert r.status_code == 400, r.text

    def test_put_fees_rejects_two_recommended(self):
        tok = _login_founder()
        methods = copy.deepcopy(DEFAULT_FEE_CONFIG["payment_methods"])
        methods[0]["recommended"] = True
        methods[1]["recommended"] = True
        r = requests.put(f"{API}/admin/fees", headers=H(tok),
                         json={"payment_methods": methods})
        assert r.status_code == 400, r.text


# ---------- CHECKOUT QUOTE ----------
class TestCheckoutQuote:
    def test_auth_required(self):
        admin = _login_founder()
        _reset_fees(admin)
        vid = _create_locked_vpp(admin)
        r = requests.get(f"{API}/checkout/quote/{vid}")
        assert r.status_code == 401, r.text

    def test_quote_flat_mode_breakdown(self):
        admin = _login_founder()
        _reset_fees(admin)
        vid = _create_locked_vpp(admin, retail=200.0, wave=100.0, supplier_cost=50.0)
        ctok, _, _ = _mongosh_seed_consumer()
        r = requests.get(f"{API}/checkout/quote/{vid}", headers=H(ctok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["vpp"]["retail_price"] == 200.0
        assert body["vpp"]["wave_price"] == 100.0
        assert body["service_fee"] == 4.0
        assert body["service_fee_mode"] == "flat"
        assert isinstance(body["payment_methods"], list) and len(body["payment_methods"]) == 5
        # Validate breakdown math per method
        for m in body["payment_methods"]:
            expected_final = round(100.0 + 4.0 + m["fee"], 2)
            assert m["final_total"] == expected_final, m
            assert m["total_savings"] == round(200.0 - expected_final, 2), m
        # Open Banking should be recommended by default
        ob = next(m for m in body["payment_methods"] if m["id"] == "open_banking")
        assert ob["recommended"] is True
        assert ob["fee"] == 1.0
        assert ob["final_total"] == 105.0  # 100 + 4 + 1
        assert ob["total_savings"] == 95.0

    def test_quote_percent_mode_math(self):
        admin = _login_founder()
        # Set percent mode 1%
        r = requests.put(f"{API}/admin/fees", headers=H(admin),
                         json={"service_fee_mode": "percent", "service_fee_value": 0.01})
        assert r.status_code == 200
        try:
            vid = _create_locked_vpp(admin, retail=200.0, wave=100.0)
            ctok, _, _ = _mongosh_seed_consumer()
            q = requests.get(f"{API}/checkout/quote/{vid}", headers=H(ctok)).json()
            assert q["service_fee"] == 1.0  # 100 * 0.01
            assert q["service_fee_mode"] == "percent"
            ob = next(m for m in q["payment_methods"] if m["id"] == "open_banking")
            assert ob["final_total"] == 102.0  # 100 + 1 + 1
        finally:
            _reset_fees(admin)


# ---------- CHECKOUT INIT ----------
class TestCheckoutInit:
    def test_init_open_banking_stores_breakdown_and_returns_mock(self):
        admin = _login_founder()
        _reset_fees(admin)
        vid = _create_locked_vpp(admin, retail=200.0, wave=100.0, supplier_cost=50.0)
        _force_lock(admin, vid)
        ctok, uid, _ = _mongosh_seed_consumer()
        jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(ctok))
        assert jr.status_code == 200, jr.text
        ci = requests.post(f"{API}/checkout/init", headers=H(ctok), json={
            "vpp_id": vid, "payment_method": "open_banking", "origin_url": BASE_URL,
        })
        assert ci.status_code == 200, ci.text
        body = ci.json()
        assert body["success"] is True
        assert body.get("mock_confirmation") is True
        assert body["final_price"] == 105.0  # 100 + 4 + 1
        assert body["checkout_url"] in (None, "")
        sid = body["session_id"]
        # Verify persisted breakdown in payment_transactions
        out = subprocess.run(
            ["mongosh", MONGO_URL, "--quiet", "--eval",
             f'db = db.getSiblingDB("{DB_NAME}"); print(JSON.stringify(db.payment_transactions.findOne({{session_id:"{sid}"}}, {{_id:0}})))'],
            capture_output=True, text=True, timeout=15,
        )
        import json as _json
        doc = _json.loads(out.stdout.strip())
        assert doc is not None
        assert "breakdown" in doc
        bd = doc["breakdown"]
        for k in ("retail_price", "wave_price", "service_fee", "payment_fee",
                  "final_total", "total_savings", "commission"):
            assert k in bd, f"missing breakdown key: {k}"
        assert bd["retail_price"] == 200.0
        assert bd["wave_price"] == 100.0
        assert bd["service_fee"] == 4.0
        assert bd["payment_fee"] == 1.0
        assert bd["final_total"] == 105.0
        assert bd["total_savings"] == 95.0
        # commission = (wave - supplier_cost) + service_fee = (100-50)+4 = 54
        assert bd["commission"] == 54.0
        # vpp_participants also has breakdown
        out2 = subprocess.run(
            ["mongosh", MONGO_URL, "--quiet", "--eval",
             f'db = db.getSiblingDB("{DB_NAME}"); print(JSON.stringify(db.vpp_participants.findOne({{vpp_id:"{vid}", user_id:"{uid}"}}, {{_id:0}})))'],
            capture_output=True, text=True, timeout=15,
        )
        pdoc = _json.loads(out2.stdout.strip())
        assert pdoc is not None
        assert "breakdown" in pdoc
        assert pdoc["breakdown"]["final_total"] == 105.0
        assert pdoc.get("payment_session_id") == sid

    def test_init_google_pay_routes_through_stripe(self):
        admin = _login_founder()
        _reset_fees(admin)
        vid = _create_locked_vpp(admin)
        _force_lock(admin, vid)
        ctok, _, _ = _mongosh_seed_consumer()
        jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(ctok))
        assert jr.status_code == 200, jr.text
        ci = requests.post(f"{API}/checkout/init", headers=H(ctok), json={
            "vpp_id": vid, "payment_method": "google_pay", "origin_url": BASE_URL,
        })
        assert ci.status_code == 200, ci.text
        body = ci.json()
        assert body["success"] is True
        assert body.get("checkout_url"), "Stripe checkout_url missing"
        assert "stripe.com" in body["checkout_url"]
        # final_price = 100 + 4 + 3
        assert body["final_price"] == 107.0
        assert body.get("mock_confirmation") in (None, False)

    def test_init_rejects_disabled_method(self):
        admin = _login_founder()
        _reset_fees(admin)
        # Disable bank_transfer
        cfg = copy.deepcopy(DEFAULT_FEE_CONFIG)
        for m in cfg["payment_methods"]:
            if m["id"] == "bank_transfer":
                m["enabled"] = False
        r = requests.put(f"{API}/admin/fees", headers=H(admin), json=cfg)
        assert r.status_code == 200, r.text
        try:
            vid = _create_locked_vpp(admin)
            _force_lock(admin, vid)
            ctok, _, _ = _mongosh_seed_consumer()
            jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(ctok))
            assert jr.status_code == 200, jr.text
            ci = requests.post(f"{API}/checkout/init", headers=H(ctok), json={
                "vpp_id": vid, "payment_method": "bank_transfer", "origin_url": BASE_URL,
            })
            assert ci.status_code == 400, ci.text
            # Quote should not include bank_transfer either
            q = requests.get(f"{API}/checkout/quote/{vid}", headers=H(ctok)).json()
            assert all(m["id"] != "bank_transfer" for m in q["payment_methods"])
        finally:
            _reset_fees(admin)


@pytest.fixture(scope="session", autouse=True)
def _ensure_fee_defaults_after():
    yield
    try:
        tok = _login_founder()
        _reset_fees(tok)
    except Exception as e:
        print(f"Fee reset on teardown failed: {e}")
