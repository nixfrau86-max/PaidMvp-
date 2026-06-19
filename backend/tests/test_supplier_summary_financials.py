"""E2E tests for the enriched supplier Order Summary (payment breakdown,
per-destination items, customer details) and the admin Wave Financials endpoint."""
import os
import uuid
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
SUPPLIER = {"email": os.environ.get("TEST_SUPPLIER_EMAIL", "supplier_test@collective.co"),
            "password": os.environ.get("TEST_SUPPLIER_PASSWORD", "Supplier1234")}
ADMIN = {"email": os.environ.get("TEST_ADMIN_EMAIL", "founder@thecollectivesavers.co.uk"),
         "password": os.environ.get("TEST_ADMIN_PASSWORD", "SaversCollective")}


def _session(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _new_consumer(name):
    s = requests.Session()
    email = f"TEST_sum_{uuid.uuid4().hex[:8]}@test.co"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "TestPass123", "name": name}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return s, email


def _region_id():
    return requests.get(f"{API}/regions", timeout=30).json()[0]["region_id"]


def test_order_summary_and_financials_end_to_end():
    sup = _session(SUPPLIER)
    admin = _session(ADMIN)
    cust_name = f"TEST_Cust_{uuid.uuid4().hex[:5]}"
    cons, cons_email = _new_consumer(cust_name)

    # 1) supplier creates an electronics wave (cost 100, RRP 300, wave 200)
    payload = {
        "category": "electronics", "region_id": _region_id(), "brand": "TestBrand",
        "title": f"TEST_SUM_{uuid.uuid4().hex[:6]}", "description": "summary test",
        "ideal_target": 10, "min_activation": 2, "deadline_days": 30,
        "products": [{"model": "ModelX", "variants": [{
            "label": "Variant-A", "supplier_cost": 100, "retail_price": 300,
            "wave_price": 200, "inventory_qty": 10,
        }]}],
    }
    r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    wave = r.json()
    wid = wave["wave_id"]
    prod = wave["products"][0]
    var = prod["variants"][0]

    try:
        # 2) consumer joins 2 units (reserved / unpaid)
        join = {
            "items": [{"product_id": prod["product_id"], "variant_id": var["variant_id"], "qty": 2}],
            "accept_terms": True, "delivery_address": "1 Test Street, Coventry, CV1 1AA",
        }
        r = cons.post(f"{API}/waves/{wid}/join", json=join, timeout=30)
        assert r.status_code == 200, r.text

        # 3) supplier order summary — enriched fields
        r = sup.get(f"{API}/supplier/waves/{wid}/order-summary", timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["total_units"] == 2
        ps = s["payment_summary"]
        assert ps["reserved_units"] == 2 and ps["reserved_orders"] == 1
        assert ps["paid_units"] == 0 and ps["total_orders"] == 1
        vb = s["variant_breakdown"][0]
        assert vb["units"] == 2 and vb["paid_units"] == 0
        # per-destination items
        dest = s["destinations"][0]
        assert dest["units"] == 2 and dest["type"] == "delivery"
        assert any(it["qty"] == 2 for it in dest["items"])
        # orders + customer details
        assert len(s["orders"]) == 1
        o = s["orders"][0]
        assert o["customer"]["name"] == cust_name
        assert o["customer"]["email"] == cons_email.lower()
        assert o["payment_status"] == "unpaid"
        assert o["items"][0]["qty"] == 2 and o["destination"].startswith("1 Test Street")

        # 4) admin financials
        r = admin.get(f"{API}/admin/regional-waves/{wid}/financials", timeout=30)
        assert r.status_code == 200, r.text
        f = r.json()
        c = f["committed"]
        assert c["units"] == 2
        assert c["revenue"] == 400.0   # 200 * 2
        assert c["cost"] == 200.0      # 100 * 2
        assert c["margin"] == 200.0    # 400 - 200
        assert c["retail_value"] == 600.0  # 300 * 2
        assert c["savings"] == 200.0   # 600 - 400
        assert f["paid"]["units"] == 0
        bv = f["by_variant"][0]
        assert bv["units"] == 2 and bv["paid_units"] == 0 and bv["margin"] == 200.0

        # financials is admin-only
        r = sup.get(f"{API}/admin/regional-waves/{wid}/financials", timeout=30)
        assert r.status_code in (401, 403)
    finally:
        sup.delete(f"{API}/supplier/waves/{wid}", timeout=30)
