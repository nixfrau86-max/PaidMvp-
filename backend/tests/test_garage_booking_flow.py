"""
Backend tests for new garage availability + bookings flow + founder admin login.

Covers:
- POST /api/auth/login (founder admin) returns role=admin
- POST /api/auth/role admin restriction (allowlist via ADMIN_EMAILS)
- POST /api/checkout/init for tyres without garage_id succeeds
- GET /api/me/waves returns needs_booking=true after paid tyre wave
- GET/PUT /api/garages/me/availability
- GET /api/garages/{id}/slots honours weekly template
- POST /api/me/bookings (success, 409 on clash, replace own)
- GET /api/me/waves after booking has needs_booking=false + booking populated
- GET /api/garages/me/bookings
- Public GET /api/garages excludes contact_email/contact_phone
"""
import os
import uuid
import subprocess
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://wave-regional-pivot.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FOUNDER_EMAIL = "founder@thecollectivesavers.co.uk"
FOUNDER_PW = "SaversCollective"


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _mongosh_seed_user(role: str = "consumer") -> tuple[str, str, str]:
    uid = f"test-user-{uuid.uuid4().hex[:10]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    js = f"""
db.users.insertOne({{
  user_id: "{uid}", email: "{email}", name: "Test User", picture: "https://i.pravatar.cc/150",
  role: "{role}", created_at: new Date(), auth_methods: ["mongosh"]
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


def _login_founder() -> str:
    """Login as founder and return Bearer token from set-cookie."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PW})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "admin"
    tok = s.cookies.get("session_token")
    assert tok, "session_token cookie not set"
    return tok


def _make_paid_tyre_consumer(admin_tok: str) -> tuple[str, str, str, str]:
    """Create a tyre wave (locked threshold 1), seed a consumer, join, checkout (open_banking, no garage), mock-confirm. Return (consumer_tok, consumer_uid, vpp_id, session_id)."""
    payload = {
        "title": f"TEST_TyreWave_{uuid.uuid4().hex[:6]}",
        "description": "Tyre wave for booking flow tests",
        "category": "Tyres",
        "image_url": "https://x/y.jpg",
        "supplier_name": "Pirelli",
        "supplier_cost": 50, "retail_price": 200, "customer_price": 100,
        "threshold": 1, "max_participants": 10, "deadline_hours": 24,
    }
    r = requests.post(f"{API}/admin/vpps", headers=H(admin_tok), json=payload)
    assert r.status_code == 200, r.text
    vid = r.json()["vpp_id"]

    tok, uid, _ = _mongosh_seed_user("consumer")
    jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))
    assert jr.status_code == 200, jr.text

    # Checkout WITHOUT garage_id for tyres
    ci = requests.post(f"{API}/checkout/init", headers=H(tok), json={
        "vpp_id": vid, "payment_method": "open_banking", "origin_url": BASE_URL
    })
    assert ci.status_code == 200, ci.text
    sid = ci.json()["session_id"]
    # mock-confirm
    cr = requests.post(f"{API}/checkout/mock-confirm/{sid}", headers=H(tok))
    assert cr.status_code == 200 and cr.json()["success"], cr.text
    return tok, uid, vid, sid


def _make_garage(admin_tok: str) -> tuple[str, str, str]:
    """Seed a garage user + apply. Return (garage_tok, garage_uid, garage_id)."""
    tok, uid, email = _mongosh_seed_user("consumer")
    body = {
        "business_name": f"TEST Garage {uuid.uuid4().hex[:5]}",
        "contact_email": email,
        "contact_phone": "+447700900000",
        "garage_type": "local_garage",
        "services": ["tyre_fitting"],
        "address_line1": "1 Main St", "city": "Manchester", "postcode": "M1 1AA",
    }
    r = requests.post(f"{API}/garages/apply", headers=H(tok), json=body)
    assert r.status_code == 200, r.text
    g = r.json()
    return tok, uid, g["garage_id"]


# --------- Tests ---------
class TestFounderAdminLogin:
    def test_founder_login_returns_admin(self):
        r = requests.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PW})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == FOUNDER_EMAIL
        assert body["user"]["role"] == "admin"

    def test_role_admin_blocked_for_non_allowlist(self):
        tok, _, _ = _mongosh_seed_user("consumer")
        r = requests.post(f"{API}/auth/role", headers=H(tok), json={"role": "admin"})
        assert r.status_code == 403, r.text

    def test_role_admin_allowed_for_founder(self):
        founder_tok = _login_founder()
        r = requests.post(f"{API}/auth/role", headers=H(founder_tok), json={"role": "admin"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "admin"


class TestCheckoutNoGarage:
    def test_checkout_tyres_without_garage_id(self):
        admin_tok = _login_founder()
        _, _, vid, _ = _make_paid_tyre_consumer(admin_tok)
        # If we got here, checkout_init succeeded sans garage_id
        v = requests.get(f"{API}/vpps/{vid}").json()
        assert v["state"] in ("locked", "executing", "completed")

    def test_me_waves_needs_booking_true(self):
        admin_tok = _login_founder()
        tok, _, vid, _ = _make_paid_tyre_consumer(admin_tok)
        r = requests.get(f"{API}/me/waves", headers=H(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "waves" in body
        match = [w for w in body["waves"] if w["vpp"]["vpp_id"] == vid]
        assert match, "tyre wave not found in /me/waves"
        w = match[0]
        assert w["paid"] is True
        assert w["needs_booking"] is True, f"expected needs_booking=true, got {w}"
        assert w["booking"] is None


class TestGarageAvailability:
    def test_get_defaults(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        r = requests.get(f"{API}/garages/me/availability", headers=H(gtok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["garage_id"] == gid
        assert "weekly" in body and "mon" in body["weekly"]
        # default mon non-empty
        assert isinstance(body["weekly"]["mon"], list)
        assert body["slot_minutes"] == 30

    def test_put_availability_and_persist(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        # Set Mon 09:00-12:00 and Sat 10:00-14:00, one override
        weekly = {d: [] for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}
        weekly["mon"] = [{"start": "09:00", "end": "12:00"}]
        weekly["sat"] = [{"start": "10:00", "end": "14:00"}]
        override_date = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
        payload = {
            "weekly": weekly,
            "overrides": {override_date: {"closed": True, "ranges": []}},
            "slot_minutes": 60,
        }
        r = requests.put(f"{API}/garages/me/availability", headers=H(gtok), json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["slot_minutes"] == 60
        assert body["weekly"]["mon"][0]["start"] == "09:00"
        assert override_date in body["overrides"]
        # GET back
        r2 = requests.get(f"{API}/garages/me/availability", headers=H(gtok))
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["slot_minutes"] == 60
        assert b2["weekly"]["sat"][0]["end"] == "14:00"


class TestSlotsAndBookings:
    def test_slots_honour_weekly_template_and_booking_flow(self):
        admin_tok = _login_founder()
        # Set up garage with a wide weekly window so slots exist whatever today is
        gtok, _, gid = _make_garage(admin_tok)
        weekly = {d: [{"start": "08:00", "end": "20:00"}] for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}
        pr = requests.put(f"{API}/garages/me/availability", headers=H(gtok), json={
            "weekly": weekly, "overrides": {}, "slot_minutes": 60
        })
        assert pr.status_code == 200

        # Slots
        sr = requests.get(f"{API}/garages/{gid}/slots", params={"days": 7})
        assert sr.status_code == 200, sr.text
        sdata = sr.json()
        assert "days" in sdata and len(sdata["days"]) == 7
        # at least one day has slots (tomorrow definitely)
        non_empty = [d for d in sdata["days"] if d["slots"]]
        assert non_empty, "no slots generated for a wide-open week"
        # Pick a slot from tomorrow (index 1) to avoid past-slot filter
        target_day = sdata["days"][1]
        assert target_day["slots"], f"no slots tomorrow: {target_day}"
        slot_iso = target_day["slots"][0]["slot_iso"]

        # Paid tyre consumer
        ctok, _, vid, _ = _make_paid_tyre_consumer(admin_tok)

        # Book
        br = requests.post(f"{API}/me/bookings", headers=H(ctok), json={
            "vpp_id": vid, "garage_id": gid, "slot_iso": slot_iso
        })
        assert br.status_code == 200, br.text
        booking = br.json()
        assert booking["garage_id"] == gid
        assert booking["slot_iso"] == slot_iso
        assert booking["status"] == "confirmed"

        # Double-book by different user -> 409
        ctok2, _, vid2, _ = _make_paid_tyre_consumer(admin_tok)
        br2 = requests.post(f"{API}/me/bookings", headers=H(ctok2), json={
            "vpp_id": vid2, "garage_id": gid, "slot_iso": slot_iso
        })
        assert br2.status_code == 409, br2.text

        # Same user re-books a different slot for same wave -> previous cancelled
        slot_iso_2 = target_day["slots"][1]["slot_iso"]
        br3 = requests.post(f"{API}/me/bookings", headers=H(ctok), json={
            "vpp_id": vid, "garage_id": gid, "slot_iso": slot_iso_2
        })
        assert br3.status_code == 200, br3.text
        new_booking = br3.json()
        assert new_booking["slot_iso"] == slot_iso_2
        # Original slot no longer 'confirmed' for this user-wave
        mb = requests.get(f"{API}/me/bookings", headers=H(ctok)).json()
        confirmed_isos = [b["slot_iso"] for b in mb if b["vpp_id"] == vid]
        assert slot_iso_2 in confirmed_isos
        assert slot_iso not in confirmed_isos

        # /me/waves: needs_booking now False + booking populated
        mw = requests.get(f"{API}/me/waves", headers=H(ctok)).json()
        match = [w for w in mw["waves"] if w["vpp"]["vpp_id"] == vid]
        assert match
        w = match[0]
        assert w["needs_booking"] is False, w
        assert w["booking"] is not None
        assert w["booking"]["slot_iso"] == slot_iso_2

        # Garage console bookings
        gb = requests.get(f"{API}/garages/me/bookings", headers=H(gtok))
        assert gb.status_code == 200, gb.text
        gbl = gb.json()
        ids = [b["booking_id"] for b in gbl if b["status"] == "confirmed"]
        assert new_booking["booking_id"] in ids


class TestPublicGarages:
    def test_public_list_excludes_contact(self):
        admin_tok = _login_founder()
        _, _, gid = _make_garage(admin_tok)
        r = requests.get(f"{API}/garages")
        assert r.status_code == 200, r.text
        items = r.json()
        ours = [g for g in items if g["garage_id"] == gid]
        assert ours, "newly created garage not in public list"
        g = ours[0]
        assert "contact_email" not in g
        assert "contact_phone" not in g
        # ensure public-facing fields are still present
        for k in ("business_name", "city", "postcode", "garage_type"):
            assert k in g
