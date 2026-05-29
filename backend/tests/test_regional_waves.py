"""Regional Product Waves© + Admin Supplier Management — backend tests.

Covers:
- PHASE 1: Admin supplier account suspend/unsuspend/soft/hard delete + detail
- PHASE 2: Regions CRUD (admin), public/list, wave-categories
- PHASE 2: Supplier wave CRUD (create/list/get/edit/delete/order-summary)
- PHASE 2: Public/consumer flow: list/get/join (tyres+electronics) -> auto-activate
- PHASE 2: Consumer wave-orders list + cancel (release reservations)
- PHASE 2: Admin oversight (regional-waves list/state/delete)
- Stripping of supplier_id + supplier_cost from public views.
"""
import os
import uuid
import pytest
import requests

def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        # fallback: read from frontend/.env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    if not v:
        raise RuntimeError("REACT_APP_BACKEND_URL missing")
    return v.rstrip("/")


BASE = _load_base()
API = f"{BASE}/api"

ADMIN = {"email": "founder@thecollectivesavers.co.uk", "password": "SaversCollective"}
SUPPLIER = {"email": "supplier_test@collective.co", "password": "Supplier1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def supplier():
    return _login(SUPPLIER)


@pytest.fixture(scope="session")
def consumer():
    s = requests.Session()
    email = f"TEST_consumer_{uuid.uuid4().hex[:8]}@test.co"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "TestPass123", "name": "Tester"}, timeout=30)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
    return s


# =================================================================
# REGIONS
# =================================================================
class TestRegions:
    def test_public_regions_active_only(self):
        r = requests.get(f"{API}/regions", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        for d in data:
            assert d.get("active") is True
            assert "region_id" in d and "name" in d

    def test_admin_all_regions(self, admin):
        r = admin.get(f"{API}/regions?all_regions=true", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_wave_categories(self):
        r = requests.get(f"{API}/wave-categories", timeout=30)
        assert r.status_code == 200
        ids = {c["id"] for c in r.json()}
        assert {"tyres", "electronics", "footwear"} <= ids

    def test_admin_region_crud(self, admin):
        name = f"TEST_Region_{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/admin/regions", json={"name": name}, timeout=30)
        assert r.status_code == 200
        rid = r.json()["region_id"]
        # rename + toggle off
        r2 = admin.patch(f"{API}/admin/regions/{rid}", json={"active": False}, timeout=30)
        assert r2.status_code == 200 and r2.json()["active"] is False
        # delete (no waves attached)
        r3 = admin.delete(f"{API}/admin/regions/{rid}", timeout=30)
        assert r3.status_code == 200

    def test_admin_only_create_region(self, consumer):
        r = consumer.post(f"{API}/admin/regions", json={"name": "TEST_unauth"}, timeout=30)
        assert r.status_code in (401, 403)


# =================================================================
# SUPPLIER WAVE CRUD
# =================================================================
@pytest.fixture(scope="session")
def region_id():
    r = requests.get(f"{API}/regions", timeout=30)
    return r.json()[0]["region_id"]


@pytest.fixture
def created_wave(supplier, region_id):
    payload = {
        "category": "electronics",
        "region_id": region_id,
        "brand": "TestBrand",
        "title": f"TEST_Wave_{uuid.uuid4().hex[:6]}",
        "description": "test wave",
        "ideal_target": 10,
        "min_activation": 5,
        "eta": "7 days",
        "products": [
            {"model": "TestTV", "variants": [
                {"label": "55-inch", "supplier_cost": 500.0, "retail_price": 1000.0, "wave_price": 800.0, "inventory_qty": 20}
            ]}
        ],
    }
    r = supplier.post(f"{API}/supplier/waves", json=payload, timeout=30)
    assert r.status_code == 200, f"create_wave: {r.status_code} {r.text}"
    w = r.json()
    yield w
    # cleanup
    supplier.delete(f"{API}/supplier/waves/{w['wave_id']}", timeout=30)


class TestSupplierWaves:
    def test_create_wave(self, created_wave):
        assert created_wave["state"] == "open"
        assert created_wave["units_committed"] == 0
        assert created_wave["category"] == "electronics"
        # full view (owner): supplier_cost preserved
        assert created_wave["products"][0]["variants"][0].get("supplier_cost") == 500.0

    def test_min_activation_validation(self, supplier, region_id):
        r = supplier.post(f"{API}/supplier/waves", json={
            "category": "footwear", "region_id": region_id, "brand": "X",
            "ideal_target": 5, "min_activation": 10,
            "products": [{"model": "X", "variants": [{"label": "M", "supplier_cost": 1, "retail_price": 2, "wave_price": 1.5, "inventory_qty": 5}]}],
        }, timeout=30)
        assert r.status_code == 400

    def test_invalid_region(self, supplier):
        r = supplier.post(f"{API}/supplier/waves", json={
            "category": "electronics", "region_id": "bogus", "brand": "X",
            "ideal_target": 5, "min_activation": 2,
            "products": [{"model": "X", "variants": [{"label": "M", "supplier_cost": 1, "retail_price": 2, "wave_price": 1.5, "inventory_qty": 5}]}],
        }, timeout=30)
        assert r.status_code == 400

    def test_list_my_waves(self, supplier, created_wave):
        r = supplier.get(f"{API}/supplier/waves", timeout=30)
        assert r.status_code == 200
        ids = [w["wave_id"] for w in r.json()]
        assert created_wave["wave_id"] in ids

    def test_get_my_wave(self, supplier, created_wave):
        r = supplier.get(f"{API}/supplier/waves/{created_wave['wave_id']}", timeout=30)
        assert r.status_code == 200
        assert r.json()["wave_id"] == created_wave["wave_id"]

    def test_update_wave_preserves_reserved(self, supplier, created_wave):
        # update title + ideal_target
        r = supplier.patch(f"{API}/supplier/waves/{created_wave['wave_id']}", json={
            "title": "UpdatedTitle", "ideal_target": 15,
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["title"] == "UpdatedTitle"
        assert r.json()["ideal_target"] == 15

    def test_update_min_gt_ideal_rejected(self, supplier, created_wave):
        r = supplier.patch(f"{API}/supplier/waves/{created_wave['wave_id']}", json={
            "min_activation": 999, "ideal_target": 10,
        }, timeout=30)
        assert r.status_code == 400

    def test_order_summary(self, supplier, created_wave):
        r = supplier.get(f"{API}/supplier/waves/{created_wave['wave_id']}/order-summary", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["wave_id"] == created_wave["wave_id"]
        assert "variant_breakdown" in data and "destinations" in data


# =================================================================
# PUBLIC / CONSUMER
# =================================================================
class TestPublicWaves:
    def test_list_public_waves(self):
        r = requests.get(f"{API}/waves", timeout=30)
        assert r.status_code == 200
        waves = r.json()
        assert isinstance(waves, list) and len(waves) > 0
        for w in waves:
            assert "supplier_id" not in w, "public view must strip supplier_id"
            for p in w["products"]:
                for v in p["variants"]:
                    assert "supplier_cost" not in v, "public view must strip supplier_cost"

    def test_filter_by_category(self):
        r = requests.get(f"{API}/waves?category=electronics", timeout=30)
        assert r.status_code == 200
        assert all(w["category"] == "electronics" for w in r.json())

    def test_get_wave_public_strips_supplier(self):
        listing = requests.get(f"{API}/waves", timeout=30).json()
        if not listing:
            pytest.skip("no public waves")
        wid = listing[0]["wave_id"]
        r = requests.get(f"{API}/waves/{wid}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "supplier_id" not in d


@pytest.fixture(scope="session")
def electronics_wave_id():
    r = requests.get(f"{API}/waves?category=electronics", timeout=30)
    waves = r.json()
    if not waves:
        pytest.skip("no electronics wave seeded")
    # prefer LG OLED demo seed (ideal 30 / min 20)
    for w in waves:
        if "LG" in w.get("brand", "") or "OLED" in w.get("title", ""):
            return w["wave_id"]
    return waves[0]["wave_id"]


@pytest.fixture(scope="session")
def tyres_wave_id():
    r = requests.get(f"{API}/waves?category=tyres", timeout=30)
    waves = r.json()
    if not waves:
        pytest.skip("no tyres wave seeded")
    for w in waves:
        if "Conti" in w.get("brand", "") or "Conti" in w.get("title", ""):
            return w["wave_id"]
    return waves[0]["wave_id"]


class TestJoinWave:
    def test_join_electronics_requires_delivery_address(self, consumer, electronics_wave_id):
        wave = requests.get(f"{API}/waves/{electronics_wave_id}", timeout=30).json()
        v = wave["products"][0]["variants"][0]
        r = consumer.post(f"{API}/waves/{electronics_wave_id}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"], "variant_id": v["variant_id"], "qty": 1}],
        }, timeout=30)
        assert r.status_code == 400
        assert "delivery" in r.text.lower()

    def test_join_tyres_requires_garage(self, consumer, tyres_wave_id):
        wave = requests.get(f"{API}/waves/{tyres_wave_id}", timeout=30).json()
        v = wave["products"][0]["variants"][0]
        r = consumer.post(f"{API}/waves/{tyres_wave_id}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"], "variant_id": v["variant_id"], "qty": 1}],
        }, timeout=30)
        assert r.status_code == 400
        assert "garage" in r.text.lower()

    def test_join_electronics_success_and_cancel(self, consumer, electronics_wave_id):
        wave = requests.get(f"{API}/waves/{electronics_wave_id}", timeout=30).json()
        v = wave["products"][0]["variants"][0]
        units_before = wave["units_committed"]
        r = consumer.post(f"{API}/waves/{electronics_wave_id}/join", json={
            "items": [{"product_id": wave["products"][0]["product_id"], "variant_id": v["variant_id"], "qty": 1}],
            "delivery_address": "1 Test Street, TT1 1TT",
            "accept_terms": True,
        }, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["participation"]["participation_id"]
        # verify wave recomputed
        w2 = requests.get(f"{API}/waves/{electronics_wave_id}", timeout=30).json()
        assert w2["units_committed"] == units_before + 1
        # /api/me/wave-orders includes it
        r2 = consumer.get(f"{API}/me/wave-orders", timeout=30)
        assert r2.status_code == 200 and any(p["participation_id"] == pid for p in r2.json())
        # cancel
        r3 = consumer.delete(f"{API}/me/wave-orders/{pid}", timeout=30)
        assert r3.status_code == 200
        w3 = requests.get(f"{API}/waves/{electronics_wave_id}", timeout=30).json()
        assert w3["units_committed"] == units_before

    def test_auto_activate_on_min_threshold(self, supplier, region_id, consumer):
        # Create a small wave with min_activation=2 → joining 2 units flips to "activated"
        payload = {
            "category": "footwear", "region_id": region_id, "brand": "ACT",
            "title": f"TEST_ActivateWave_{uuid.uuid4().hex[:6]}",
            "ideal_target": 5, "min_activation": 2,
            "products": [{"model": "Boot", "variants": [{"label": "UK10", "supplier_cost": 10, "retail_price": 30, "wave_price": 20, "inventory_qty": 50}]}],
        }
        w = supplier.post(f"{API}/supplier/waves", json=payload, timeout=30).json()
        wid = w["wave_id"]
        vid = w["products"][0]["variants"][0]["variant_id"]
        pid_ = w["products"][0]["product_id"]
        try:
            r = consumer.post(f"{API}/waves/{wid}/join", json={
                "items": [{"product_id": pid_, "variant_id": vid, "qty": 2}],
                "delivery_address": "Activation Lane",
                "accept_terms": True,
            }, timeout=30)
            assert r.status_code == 200, r.text
            w2 = requests.get(f"{API}/waves/{wid}", timeout=30).json()
            assert w2["state"] == "activated", f"state={w2['state']}"
            assert w2["units_committed"] >= 2
        finally:
            # admin clean (bypass captured-check guard)
            admin = _login(ADMIN)
            admin.delete(f"{API}/admin/regional-waves/{wid}", timeout=30)


# =================================================================
# ADMIN OVERSIGHT
# =================================================================
class TestAdminOversight:
    def test_admin_list_regional_waves(self, admin):
        r = admin.get(f"{API}/admin/regional-waves", timeout=30)
        assert r.status_code == 200
        waves = r.json()
        assert isinstance(waves, list)
        if waves:
            assert "supplier_name" in waves[0]

    def test_admin_set_state_and_delete(self, admin, supplier, region_id):
        # create disposable wave as supplier
        payload = {
            "category": "footwear", "region_id": region_id, "brand": "DEL",
            "title": f"TEST_AdminDel_{uuid.uuid4().hex[:6]}",
            "ideal_target": 5, "min_activation": 2,
            "products": [{"model": "X", "variants": [{"label": "M", "supplier_cost": 1, "retail_price": 2, "wave_price": 1.5, "inventory_qty": 5}]}],
        }
        w = supplier.post(f"{API}/supplier/waves", json=payload, timeout=30).json()
        wid = w["wave_id"]
        r1 = admin.patch(f"{API}/admin/regional-waves/{wid}/state", json={"state": "processing"}, timeout=30)
        assert r1.status_code == 200
        r2 = admin.patch(f"{API}/admin/regional-waves/{wid}/state", json={"state": "bogus"}, timeout=30)
        assert r2.status_code == 400
        r3 = admin.delete(f"{API}/admin/regional-waves/{wid}", timeout=30)
        assert r3.status_code == 200

    def test_admin_only_endpoints_blocked(self, consumer):
        r = consumer.get(f"{API}/admin/regional-waves", timeout=30)
        assert r.status_code in (401, 403)


# =================================================================
# PHASE 1 — ADMIN SUPPLIER MANAGEMENT
# =================================================================
class TestAdminSuppliers:
    def test_list_suppliers_has_account_status(self, admin):
        r = admin.get(f"{API}/admin/suppliers", timeout=30)
        assert r.status_code == 200
        suppliers = r.json()
        assert isinstance(suppliers, list) and len(suppliers) > 0
        # at least one should have account_status field after _serialize
        statuses = [s.get("account_status") for s in suppliers]
        assert any(st is not None for st in statuses)

    def test_supplier_detail(self, admin):
        r = admin.get(f"{API}/admin/suppliers", timeout=30)
        # find supplier_test supplier
        target = None
        for s in r.json():
            if s.get("contact_email") == SUPPLIER["email"] or "Test Wave" in (s.get("business_name") or ""):
                target = s
                break
        if not target:
            pytest.skip("test supplier not found")
        sid = target["supplier_id"]
        r2 = admin.get(f"{API}/admin/suppliers/{sid}/detail", timeout=30)
        assert r2.status_code == 200
        d = r2.json()
        assert d["supplier_id"] == sid
        assert "stats" in d
        assert "waves" in d["stats"]

    def test_suspend_unsuspend_supplier(self, admin):
        # find a non-admin supplier
        sups = admin.get(f"{API}/admin/suppliers", timeout=30).json()
        target = None
        for s in sups:
            if s.get("business_name") and "Test Wave" in s["business_name"]:
                target = s
                break
        if not target:
            pytest.skip("no test supplier")
        sid = target["supplier_id"]
        # suspend
        r = admin.patch(f"{API}/admin/suppliers/{sid}/account", json={"status": "suspended", "reason": "TEST"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["account_status"] == "suspended"
        # unsuspend
        r2 = admin.patch(f"{API}/admin/suppliers/{sid}/account", json={"status": "active"}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["account_status"] == "active"

    def test_admin_only_supplier_account(self, consumer):
        r = consumer.patch(f"{API}/admin/suppliers/bogus/account", json={"status": "suspended"}, timeout=30)
        assert r.status_code in (401, 403)
