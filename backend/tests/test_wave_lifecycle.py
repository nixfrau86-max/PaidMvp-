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
