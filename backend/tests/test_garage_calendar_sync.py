"""
Backend tests for Garage Calendar Sync (iCal feed).

Covers:
- GET /api/garages/me/calendar — auth required, returns feed_path + token
- POST /api/garages/me/calendar/regenerate — rotates token (old=404, new=200)
- Public GET /api/calendar/garage/{id}.ics?token=... — valid, wrong, missing token
- ICS body contains BEGIN:VCALENDAR / END:VCALENDAR, VEVENT with UID/DTSTART/DTEND/SUMMARY/LOCATION/STATUS
- Cancelled bookings still appear with STATUS:CANCELLED (since _build_ics_for_garage iterates all bookings)
- Public GET /api/garages does NOT include calendar_feed_token field
"""
import os
import uuid
import re
import subprocess
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://regional-waves.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FOUNDER_EMAIL = "founder@thecollectivesavers.co.uk"
FOUNDER_PW = "SaversCollective"


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---- helpers (copied/adapted from test_garage_booking_flow.py) ----
def _mongosh_seed_user(role: str = "consumer"):
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


def _login_founder():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PW})
    assert r.status_code == 200, r.text
    return s.cookies.get("session_token")


def _make_garage(admin_tok):
    tok, uid, email = _mongosh_seed_user("consumer")
    body = {
        "business_name": f"TEST CalGarage {uuid.uuid4().hex[:5]}",
        "contact_email": email,
        "contact_phone": "+447700900000",
        "garage_type": "local_garage",
        "services": ["tyre_fitting"],
        "address_line1": "10 Cal St", "city": "Manchester", "postcode": "M2 2BB",
    }
    r = requests.post(f"{API}/garages/apply", headers=H(tok), json=body)
    assert r.status_code == 200, r.text
    return tok, uid, r.json()["garage_id"]


def _make_paid_tyre_consumer(admin_tok, name="Test Consumer"):
    payload = {
        "title": f"TEST_TyreWaveCal_{uuid.uuid4().hex[:6]}",
        "description": "Tyre wave for calendar sync tests",
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
    # set a friendly user.name for ICS SUMMARY assertion
    subprocess.run(
        ["mongosh", MONGO_URL, "--quiet", "--eval",
         f'db = db.getSiblingDB("{DB_NAME}"); db.users.updateOne({{user_id:"{uid}"}}, {{$set:{{name:"{name}"}}}});'],
        capture_output=True, text=True, timeout=10,
    )
    jr = requests.post(f"{API}/vpps/{vid}/join", headers=H(tok))
    assert jr.status_code == 200, jr.text
    ci = requests.post(f"{API}/checkout/init", headers=H(tok), json={
        "vpp_id": vid, "payment_method": "open_banking", "origin_url": BASE_URL
    })
    assert ci.status_code == 200, ci.text
    sid = ci.json()["session_id"]
    cr = requests.post(f"{API}/checkout/mock-confirm/{sid}", headers=H(tok))
    assert cr.status_code == 200 and cr.json()["success"], cr.text
    return tok, uid, vid


def _open_garage_full_week(gtok):
    weekly = {d: [{"start": "08:00", "end": "20:00"}] for d in ["mon","tue","wed","thu","fri","sat","sun"]}
    r = requests.put(f"{API}/garages/me/availability", headers=H(gtok), json={
        "weekly": weekly, "overrides": {}, "slot_minutes": 60
    })
    assert r.status_code == 200, r.text


# ---- Tests ----
class TestCalendarInfoEndpoint:
    def test_auth_required(self):
        r = requests.get(f"{API}/garages/me/calendar")
        assert r.status_code == 401, r.text

    def test_returns_feed_path_and_token(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        r = requests.get(f"{API}/garages/me/calendar", headers=H(gtok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["garage_id"] == gid
        assert body["token"] and isinstance(body["token"], str)
        assert body["feed_path"].startswith(f"/api/calendar/garage/{gid}.ics?token=")
        assert body["token"] in body["feed_path"]


class TestPublicICSFeed:
    def test_valid_token_returns_ics(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        info = requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()
        r = requests.get(f"{BASE_URL}{info['feed_path']}")
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("text/calendar"), r.headers
        body = r.text
        assert body.startswith("BEGIN:VCALENDAR"), body[:200]
        assert "END:VCALENDAR" in body
        assert body.rstrip().endswith("END:VCALENDAR")

    def test_wrong_token_returns_404(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        # ensure token exists
        requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()
        r = requests.get(f"{API}/calendar/garage/{gid}.ics", params={"token": "deadbeef-not-real"})
        assert r.status_code == 404, r.text

    def test_missing_token_returns_404(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()
        r = requests.get(f"{API}/calendar/garage/{gid}.ics")
        assert r.status_code == 404, r.text


class TestICSContent:
    def test_event_block_with_booking(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        _open_garage_full_week(gtok)
        info = requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()

        # find a tomorrow slot
        sr = requests.get(f"{API}/garages/{gid}/slots", params={"days": 7})
        assert sr.status_code == 200
        target_day = sr.json()["days"][1]
        slot_iso = target_day["slots"][0]["slot_iso"]

        # paid consumer with a known name
        consumer_name = f"Cal Tester {uuid.uuid4().hex[:4]}"
        ctok, _, vid = _make_paid_tyre_consumer(admin_tok, name=consumer_name)
        br = requests.post(f"{API}/me/bookings", headers=H(ctok), json={
            "vpp_id": vid, "garage_id": gid, "slot_iso": slot_iso
        })
        assert br.status_code == 200, br.text
        booking_id = br.json()["booking_id"]

        # fetch ICS
        r = requests.get(f"{BASE_URL}{info['feed_path']}")
        assert r.status_code == 200, r.text
        body = r.text

        # has at least one VEVENT
        assert "BEGIN:VEVENT" in body
        assert "END:VEVENT" in body

        # UID format: booking_id@collectivesavers
        assert f"UID:{booking_id}@collectivesavers" in body

        # SUMMARY mentions Fitting and consumer name
        # Look for SUMMARY line referencing the consumer name
        m = re.search(r"SUMMARY:Fitting.*", body)
        assert m, "SUMMARY:Fitting... not found"
        # Consumer name should be present somewhere in the calendar body (escaped or not)
        assert consumer_name in body, "Consumer name missing from ICS"

        # LOCATION includes address city/postcode
        assert "LOCATION:" in body
        assert "Manchester" in body
        assert "M2 2BB" in body

        # STATUS:CONFIRMED present
        assert "STATUS:CONFIRMED" in body

        # DTSTART/DTEND present and DTEND - DTSTART == slot_minutes (60)
        # find a DTSTART/DTEND in YYYYMMDDTHHMMSSZ form
        dt_pairs = re.findall(r"DTSTART:(\d{8}T\d{6}Z)\r?\nDTEND:(\d{8}T\d{6}Z)", body)
        assert dt_pairs, f"No DTSTART/DTEND pair found in ICS: {body[:500]}"
        fmt = "%Y%m%dT%H%M%SZ"
        # find the pair for our booking by checking proximity to slot_iso
        slot_dt = datetime.fromisoformat(slot_iso.replace("Z","+00:00")).astimezone(timezone.utc)
        slot_str = slot_dt.strftime(fmt)
        match_pair = next((p for p in dt_pairs if p[0] == slot_str), None)
        assert match_pair, f"No DTSTART matching {slot_str}, got {dt_pairs}"
        s = datetime.strptime(match_pair[0], fmt)
        e = datetime.strptime(match_pair[1], fmt)
        assert (e - s).total_seconds() == 60 * 60, f"Expected 60 min slot, got {e - s}"

    def test_cancelled_booking_appears_as_cancelled(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        _open_garage_full_week(gtok)
        info = requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()

        sr = requests.get(f"{API}/garages/{gid}/slots", params={"days": 7})
        target_day = sr.json()["days"][1]
        slot_iso_a = target_day["slots"][0]["slot_iso"]
        slot_iso_b = target_day["slots"][1]["slot_iso"]

        ctok, _, vid = _make_paid_tyre_consumer(admin_tok)
        # book A
        r1 = requests.post(f"{API}/me/bookings", headers=H(ctok), json={
            "vpp_id": vid, "garage_id": gid, "slot_iso": slot_iso_a
        })
        assert r1.status_code == 200, r1.text
        bid_a = r1.json()["booking_id"]
        # re-book same wave on B → A should be cancelled
        r2 = requests.post(f"{API}/me/bookings", headers=H(ctok), json={
            "vpp_id": vid, "garage_id": gid, "slot_iso": slot_iso_b
        })
        assert r2.status_code == 200, r2.text
        bid_b = r2.json()["booking_id"]

        ics = requests.get(f"{BASE_URL}{info['feed_path']}").text
        # Both events present
        assert f"UID:{bid_a}@collectivesavers" in ics
        assert f"UID:{bid_b}@collectivesavers" in ics
        # cancelled one has STATUS:CANCELLED
        # split VEVENTs
        events = re.findall(r"BEGIN:VEVENT.*?END:VEVENT", ics, flags=re.DOTALL)
        ev_a = next((e for e in events if f"UID:{bid_a}@" in e), None)
        ev_b = next((e for e in events if f"UID:{bid_b}@" in e), None)
        assert ev_a and ev_b
        assert "STATUS:CANCELLED" in ev_a, f"Booking A should be CANCELLED: {ev_a}"
        assert "STATUS:CONFIRMED" in ev_b, f"Booking B should be CONFIRMED: {ev_b}"


class TestRegenerateToken:
    def test_regenerate_invalidates_old_and_returns_new(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        info = requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()
        old_token = info["token"]

        # old token works
        r_old_ok = requests.get(f"{API}/calendar/garage/{gid}.ics", params={"token": old_token})
        assert r_old_ok.status_code == 200, r_old_ok.text

        # regenerate
        rr = requests.post(f"{API}/garages/me/calendar/regenerate", headers=H(gtok))
        assert rr.status_code == 200, rr.text
        new_token = rr.json()["token"]
        assert new_token and new_token != old_token

        # old token now 404
        r_old = requests.get(f"{API}/calendar/garage/{gid}.ics", params={"token": old_token})
        assert r_old.status_code == 404, r_old.text

        # new token works
        r_new = requests.get(f"{API}/calendar/garage/{gid}.ics", params={"token": new_token})
        assert r_new.status_code == 200, r_new.text
        assert r_new.text.startswith("BEGIN:VCALENDAR")


class TestPublicGarageListing:
    def test_public_garages_excludes_calendar_token(self):
        admin_tok = _login_founder()
        gtok, _, gid = _make_garage(admin_tok)
        # ensure token exists
        requests.get(f"{API}/garages/me/calendar", headers=H(gtok)).json()
        r = requests.get(f"{API}/garages")
        assert r.status_code == 200
        items = r.json()
        ours = [g for g in items if g["garage_id"] == gid]
        assert ours
        g = ours[0]
        assert "calendar_feed_token" not in g, f"token leaked in public garage listing: {g}"
        assert "contact_email" not in g
        assert "contact_phone" not in g
