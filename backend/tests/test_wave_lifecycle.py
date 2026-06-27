"""Lifecycle tests for the 'fill-to-capacity' wave behaviour.

Validates the code-review fixes:
- A wave keeps accepting joins AFTER it activates (min_activation reached) until it
  hits ideal_target (capacity). `activated` is a non-blocking latch.
- Joins are rejected once the wave is at capacity.
"""
import os
import uuid
import pytest
import requests

from datetime import datetime
from zoneinfo import ZoneInfo
from routes import waves as waves_mod


def _base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
    return v.rstrip("/")


API = f"{_base()}/api"
SUPPLIER = {"email": "supplier_test@collective.co", "password": "Supplier1234"}
ADMIN = {"email": "founder@thecollectivesavers.co.uk", "password": "SaversCollective"}


def _admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _supplier_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=SUPPLIER, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _new_consumer():
    s = requests.Session()
    email = f"TEST_life_{uuid.uuid4().hex[:8]}@test.co"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "TestPass123", "name": "Tester"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return s


def _region_id():
    return requests.get(f"{API}/regions", timeout=30).json()[0]["region_id"]


@pytest.fixture
def small_wave():
    """electronics wave: ideal_target=4, min_activation=2, plenty of inventory."""
    sup = _supplier_session()
    payload = {
        "category": "electronics",
        "region_id": _region_id(),
        "brand": "TestBrand",
        "title": f"TEST_Life_{uuid.uuid4().hex[:6]}",
        "description": "lifecycle test",
        "ideal_target": 4,
        "min_activation": 2,
        "eta": "7 days",
        "products": [
            {"model": "TestTV", "variants": [
                {"label": "55-inch", "supplier_cost": 500.0, "retail_price": 1000.0, "wave_price": 800.0, "inventory_qty": 100},
            ]},
        ],
    }
    r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    w = r.json()
    yield sup, w
    sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)


def _variant_id(wave):
    return wave["products"][0]["variants"][0]["variant_id"]
def _product_id(wave):
    return wave["products"][0]["product_id"]


def _join(session, wave, qty):
    return session.post(
        f"{API}/waves/{wave['wave_id']}/join",
        json={
            "items": [{"product_id": _product_id(wave), "variant_id": _variant_id(wave), "qty": qty}],
            "delivery_address": "1 Test Street, Coventry",
            "accept_terms": True,
        },
        timeout=30,
    )


def _state(wave_id):
    return requests.get(f"{API}/waves/{wave_id}", timeout=30).json()


class TestFillToCapacity:
    def test_join_continues_after_activation_until_capacity(self, small_wave):
        sup, w = small_wave
        wid = w["wave_id"]

        # consumer A joins 2 → hits min_activation → state activates
        a = _new_consumer()
        r = _join(a, w, 2)
        assert r.status_code == 200, r.text
        st = _state(wid)
        assert st["state"] == "activated", f"expected activated, got {st['state']}"
        assert st["units_committed"] == 2

        # consumer B can STILL join an activated wave (the key fix)
        b = _new_consumer()
        r = _join(b, w, 1)
        assert r.status_code == 200, f"join after activation must succeed: {r.text}"
        st = _state(wid)
        assert st["state"] == "activated"
        assert st["units_committed"] == 3

        # consumer C fills it to capacity (4/4)
        c = _new_consumer()
        r = _join(c, w, 1)
        assert r.status_code == 200, r.text
        st = _state(wid)
        assert st["units_committed"] == 4

        # consumer D is rejected — wave at capacity
        d = _new_consumer()
        r = _join(d, w, 1)
        assert r.status_code == 400
        assert "capacity" in r.json()["detail"].lower()

    def test_partial_join_capped_at_remaining(self, small_wave):
        sup, w = small_wave
        wid = w["wave_id"]
        # join 3 of 4
        a = _new_consumer()
        assert _join(a, w, 3).status_code == 200
        # request 2 more but only 1 slot left → rejected with helpful message
        b = _new_consumer()
        r = _join(b, w, 2)
        assert r.status_code == 400
        assert "1 unit" in r.json()["detail"]


class TestRespawnOnDemand:
    """Completed waves with leftover stock respawn whenever there was genuine demand
    (reserved/allocated OR paid) — not only when units were captured/paid."""

    def _make_wave(self, sup, inventory=4, ideal=4, minact=2):
        payload = {
            "category": "electronics", "region_id": _region_id(), "brand": "RESPAWN",
            "title": f"TEST_RSPAWN_{uuid.uuid4().hex[:6]}", "description": "x",
            "ideal_target": ideal, "min_activation": minact, "eta": "7 days",
            "products": [{"model": "M", "variants": [
                {"label": "X", "supplier_cost": 10.0, "retail_price": 30.0, "wave_price": 20.0, "inventory_qty": inventory},
            ]}],
        }
        r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _join(self, wave, qty):
        c = _new_consumer()
        r = c.post(f"{API}/waves/{wave['wave_id']}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"],
                       "variant_id": wave["products"][0]["variants"][0]["variant_id"], "qty": qty}],
            "delivery_address": "1 Test St", "accept_terms": True}, timeout=30)
        assert r.status_code == 200, r.text
        return c, r.json()["participation"]["participation_id"]

    def test_respawn_when_stock_allocated_but_unpaid(self):
        sup = _supplier_session()
        admin = _admin_session()
        w = self._make_wave(sup, inventory=4, ideal=4, minact=2)
        cons, pid = self._join(w, 2)  # reserved/allocated, NOT paid
        r = admin.patch(f"{API}/admin/regional-waves/{w['wave_id']}/state", json={"state": "completed"}, timeout=30)
        assert r.status_code == 200, r.text
        res = r.json().get("respawn_result")
        assert res and res.get("respawned") is True, f"expected respawn on allocated demand: {res}"
        assert res.get("units") == 4  # full leftover (nothing paid)
        assert res.get("carried_units") == 2, f"allocated-but-unpaid units must carry: {res}"
        # stranded reservation released
        orders = cons.get(f"{API}/me/wave-orders", timeout=30).json()
        mine = [o for o in orders if o["participation_id"] == pid]
        assert mine and mine[0]["status"] == "released"

    def test_respawn_with_stock_even_without_demand(self):
        # Regeneration rule: stock left → relist, regardless of demand (no joins).
        sup = _supplier_session()
        admin = _admin_session()
        w = self._make_wave(sup, inventory=4)
        r = admin.patch(f"{API}/admin/regional-waves/{w['wave_id']}/state", json={"state": "completed"}, timeout=30)
        assert r.status_code == 200, r.text
        res = r.json().get("respawn_result")
        assert res and res.get("respawned") is True, f"stock-left should relist even with no demand: {res}"
        assert res.get("units") == 4  # full inventory carried into the new round
        assert res.get("carried_units") == 0  # nothing was allocated


class TestAnnualUnitLimits:
    """Per-user calendar-year unit caps, enforcement, allowance endpoint, admin override."""

    def _wave(self, sup, inventory=50, ideal=30):
        payload = {
            "category": "electronics", "region_id": _region_id(), "brand": "LIMIT",
            "title": f"TEST_UL_{uuid.uuid4().hex[:6]}", "description": "x",
            "ideal_target": ideal, "min_activation": 2, "eta": "7 days",
            "products": [{"model": "M", "variants": [
                {"label": "X", "supplier_cost": 10.0, "retail_price": 30.0, "wave_price": 20.0, "inventory_qty": inventory}]}],
        }
        r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _join(self, cons, wave, qty):
        return cons.post(f"{API}/waves/{wave['wave_id']}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"],
                       "variant_id": wave["products"][0]["variants"][0]["variant_id"], "qty": qty}],
            "delivery_address": "1 Rd", "accept_terms": True}, timeout=30)

    def test_electronics_cap_and_override(self):
        sup = _supplier_session(); admin = _admin_session()
        # ensure platform default electronics limit = 5
        admin.put(f"{API}/admin/unit-limits", json={"category_limits": {"tyres": 12, "electronics": 5, "footwear": 3}, "default_limit": 3}, timeout=30)
        w = self._wave(sup)
        cons = _new_consumer()
        uid = cons.get(f"{API}/auth/me", timeout=30).json()["user_id"]

        a = cons.get(f"{API}/me/unit-allowance?category=electronics", timeout=30).json()
        assert a["limit"] == 5 and a["used"] == 0 and a["remaining"] == 5

        assert self._join(cons, w, 4).status_code == 200
        a = cons.get(f"{API}/me/unit-allowance?category=electronics", timeout=30).json()
        assert a["used"] == 4 and a["remaining"] == 1

        r = self._join(cons, w, 2)  # 4+2 > 5
        assert r.status_code == 400 and "limit" in r.json()["detail"].lower()

        # admin grants override
        r = admin.patch(f"{API}/admin/users/{uid}", json={"unit_limit_overrides": {"electronics": 10}}, timeout=30)
        assert r.status_code == 200 and r.json()["unit_limit_overrides"]["electronics"] == 10

        assert self._join(cons, w, 2).status_code == 200  # now allowed
        a = cons.get(f"{API}/me/unit-allowance?category=electronics", timeout=30).json()
        assert a["override"] is True and a["limit"] == 10 and a["used"] == 6

        sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)

    def test_admin_unit_limits_config(self):
        admin = _admin_session()
        cfg = admin.get(f"{API}/admin/unit-limits", timeout=30).json()
        assert "category_limits" in cfg and "default_limit" in cfg
        r = admin.put(f"{API}/admin/unit-limits", json={"category_limits": {"tyres": 12, "electronics": 5, "footwear": 3}, "default_limit": 3}, timeout=30)
        assert r.status_code == 200 and r.json()["category_limits"]["tyres"] == 12


class TestRespawnWorkingWindow:
    """Pure-function tests for the Mon–Sat (excl. Sun + UK bank holidays) respawn
    schedule: order placed the following working day 08:30; deadline = midnight."""

    @staticmethod
    def _london(y, mo, d, h, mi):
        return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("Europe/London"))

    def test_always_following_working_day(self):
        w = waves_mod
        # Mon 2026-06-15 09:00 → next working day Tue 2026-06-16 08:30 (never same-day)
        nxt = w._next_creation_time_london(self._london(2026, 6, 15, 9, 0))
        assert nxt.day == 16 and nxt.weekday() == 1 and (nxt.hour, nxt.minute) == (8, 30)

    def test_friday_rolls_to_saturday(self):
        w = waves_mod
        # Saturday is a working day → Fri 2026-06-12 → Sat 2026-06-13 08:30
        nxt = w._next_creation_time_london(self._london(2026, 6, 12, 17, 0))
        assert nxt.weekday() == 5 and (nxt.hour, nxt.minute) == (8, 30)

    def test_saturday_skips_sunday_to_monday(self):
        w = waves_mod
        nxt = w._next_creation_time_london(self._london(2026, 6, 13, 12, 0))  # Sat
        assert nxt.weekday() == 0 and nxt.day == 15 and (nxt.hour, nxt.minute) == (8, 30)

    def test_skips_uk_bank_holiday(self):
        w = waves_mod
        # Thu 2026-04-02 → Good Friday 2026-04-03 skipped → Sat 2026-04-04
        nxt = w._next_creation_time_london(self._london(2026, 4, 2, 10, 0))
        assert nxt.day == 4 and nxt.weekday() == 5 and (nxt.hour, nxt.minute) == (8, 30)

    def test_deadline_is_1630_on_weekday(self):
        w = waves_mod
        dl = w._deadline_for_creation_london(self._london(2026, 6, 15, 9, 0))  # Monday
        assert dl.tzinfo is not None
        loc = dl.astimezone(ZoneInfo("Europe/London"))
        assert (loc.hour, loc.minute) == (16, 30) and loc.day == 15

    def test_deadline_is_midnight_on_saturday(self):
        w = waves_mod
        dl = w._deadline_for_creation_london(self._london(2026, 6, 13, 9, 0))  # Saturday
        loc = dl.astimezone(ZoneInfo("Europe/London"))
        assert (loc.hour, loc.minute) == (23, 59) and loc.day == 13



class TestMergeRepeatJoins:
    """Repeat joins on the same wave merge into ONE unpaid payable order."""

    def _wave(self, sup, variants=None, ideal=20, minact=2, inventory=50):
        variants = variants or [
            {"label": "X", "supplier_cost": 10.0, "retail_price": 30.0, "wave_price": 20.0, "inventory_qty": inventory},
        ]
        payload = {
            "category": "electronics", "region_id": _region_id(), "brand": "MERGE",
            "title": f"TEST_MERGE_{uuid.uuid4().hex[:6]}", "description": "x",
            "ideal_target": ideal, "min_activation": minact, "eta": "7 days",
            "products": [{"model": "M", "variants": variants}],
        }
        r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _join(self, cons, wave, variant_idx, qty):
        v = wave["products"][0]["variants"][variant_idx]
        return cons.post(f"{API}/waves/{wave['wave_id']}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"], "variant_id": v["variant_id"], "qty": qty}],
            "delivery_address": "1 Rd", "accept_terms": True}, timeout=30)

    def _orders_for(self, cons, wave_id):
        orders = cons.get(f"{API}/me/wave-orders", timeout=30).json()
        return [o for o in orders if o["wave_id"] == wave_id]

    def test_same_variant_repeat_join_sums_into_one_order(self):
        sup = _supplier_session(); w = self._wave(sup)
        cons = _new_consumer()
        r1 = self._join(cons, w, 0, 2); assert r1.status_code == 200, r1.text
        assert r1.json()["merged"] is False
        r2 = self._join(cons, w, 0, 3); assert r2.status_code == 200, r2.text
        assert r2.json()["merged"] is True
        mine = self._orders_for(cons, w["wave_id"])
        assert len(mine) == 1, f"expected ONE merged order, got {len(mine)}"
        o = mine[0]
        assert o["units"] == 5
        assert len(o["items"]) == 1 and o["items"][0]["qty"] == 5
        assert abs(o["subtotal"] - 100.0) < 0.01  # 5 * 20
        sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)

    def test_different_variant_adds_line_item_same_order(self):
        sup = _supplier_session()
        w = self._wave(sup, variants=[
            {"label": "A", "supplier_cost": 10.0, "retail_price": 30.0, "wave_price": 20.0, "inventory_qty": 50},
            {"label": "B", "supplier_cost": 12.0, "retail_price": 40.0, "wave_price": 25.0, "inventory_qty": 50},
        ])
        cons = _new_consumer()
        assert self._join(cons, w, 0, 1).status_code == 200
        assert self._join(cons, w, 1, 2).status_code == 200
        mine = self._orders_for(cons, w["wave_id"])
        assert len(mine) == 1
        o = mine[0]
        assert o["units"] == 3 and len(o["items"]) == 2
        assert abs(o["subtotal"] - (20.0 + 50.0)) < 0.01  # 1*20 + 2*25
        sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)

    def test_paid_order_does_not_merge_new_join_starts_fresh(self):
        sup = _supplier_session()
        w = self._wave(sup, ideal=10, minact=2)
        cons = _new_consumer()
        r = self._join(cons, w, 0, 2); assert r.status_code == 200, r.text  # activates wave
        pid = r.json()["participation"]["participation_id"]
        q = cons.get(f"{API}/wave-checkout/{pid}/quote", timeout=30).json()
        method = next((m["id"] for m in q.get("methods", []) if m["id"] not in ("card", "apple_pay", "google_pay")), None)
        assert method, f"no mock method available: {q}"
        co = cons.post(f"{API}/wave-checkout/{pid}", json={"origin_url": "https://x.co", "payment_method": method}, timeout=30)
        assert co.status_code == 200, co.text
        sid = co.json()["session_id"]
        mc = cons.post(f"{API}/wave-checkout/mock-confirm/{sid}", timeout=30)
        assert mc.status_code == 200, mc.text
        r2 = self._join(cons, w, 0, 1); assert r2.status_code == 200, r2.text
        assert r2.json()["merged"] is False, "join after a PAID order must start a fresh order"
        mine = self._orders_for(cons, w["wave_id"])
        assert len(mine) == 2, f"expected paid + new = 2 orders, got {len(mine)}: {[o['status'] for o in mine]}"


class TestExpandedCategories:
    """Expanded canonical categories + custom 'Other' category for wave creation."""

    def test_wave_categories_expanded(self):
        cats = requests.get(f"{API}/wave-categories", timeout=30).json()
        ids = {c["id"] for c in cats}
        assert {"tyres", "electronics", "footwear", "clothing", "home_appliances"}.issubset(ids)

    def test_create_custom_category_wave_and_join(self):
        sup = _supplier_session()
        payload = {
            "category": "pet_supplies", "category_label": "Pet Supplies",
            "region_id": _region_id(), "brand": "PETCO",
            "title": f"TEST_CAT_{uuid.uuid4().hex[:6]}", "description": "x",
            "ideal_target": 10, "min_activation": 2, "eta": "7 days",
            "products": [{"model": "M", "variants": [
                {"label": "X", "supplier_cost": 5.0, "retail_price": 15.0, "wave_price": 10.0, "inventory_qty": 20}]}],
        }
        r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w["category"] == "pet_supplies" and w["category_label"] == "Pet Supplies"

        # Custom (non-tyre) category → join needs a delivery address, no garage.
        cons = _new_consumer()
        # allowance endpoint must not 400 on an unknown category (falls back to default)
        a = cons.get(f"{API}/me/unit-allowance?category=pet_supplies", timeout=30).json()
        assert a["limit"] >= 1 and a["used"] == 0
        jr = cons.post(f"{API}/waves/{w['wave_id']}/join", json={
            "items": [{"product_id": w["products"][0]["product_id"],
                       "variant_id": w["products"][0]["variants"][0]["variant_id"], "qty": 1}],
            "delivery_address": "1 Test Rd", "accept_terms": True}, timeout=30)
        assert jr.status_code == 200, jr.text
        sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)
        sup.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)