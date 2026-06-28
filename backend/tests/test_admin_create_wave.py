"""Iteration 15 — Tests for the new admin Regional Wave creation endpoint.

Covers:
- POST /api/admin/regional-waves (admin only, supplier-on-behalf-of)
- POST /api/admin/wave-image (admin only)
- Validation: missing / invalid supplier_id
- Role enforcement (supplier cannot call admin endpoint)
- Supplier endpoint regression (create + edit)
Auth is cookie-session-based (no token).
"""
import os
import pytest
import requests

def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
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


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def supplier():
    return _login(SUPPLIER)


@pytest.fixture(scope="module")
def region_id():
    r = requests.get(f"{API}/regions", timeout=15)
    assert r.status_code == 200
    return r.json()[0]["region_id"]


@pytest.fixture(scope="module")
def supplier_id(admin):
    r = admin.get(f"{API}/admin/suppliers", timeout=15)
    assert r.status_code == 200, r.text
    sups = r.json()
    active = [s for s in sups if s.get("account_status") not in ("suspended", "deleted")]
    assert active, "Need at least one active supplier"
    test_sup = next((s for s in active if s.get("business_name") == "Test Wave Supplier"), None)
    return (test_sup or active[0])["supplier_id"]


_created = []


def _payload(region_id, supplier_id=None, brand="TEST_ADMIN_BRAND"):
    body = {
        "category": "electronics",
        "region_id": region_id,
        "brand": brand,
        "title": "TEST_admin_wave",
        "description": "automated test",
        "image_url": "",
        "ideal_target": 10,
        "min_activation": 5,
        "eta": "Within 7 days of activation",
        "deadline_days": 14,
        "products": [{
            "model": "TEST Model A", "image_url": "",
            "variants": [{"label": "X", "supplier_cost": 5.0, "retail_price": 30.0,
                          "wave_price": 20.0, "inventory_qty": 50}],
        }],
    }
    if supplier_id is not None:
        body["supplier_id"] = supplier_id
    return body


class TestAdminCreateWave:
    def test_admin_creates_wave_for_supplier(self, admin, region_id, supplier_id):
        r = admin.post(f"{API}/admin/regional-waves",
                       json=_payload(region_id, supplier_id), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["supplier_id"] == supplier_id
        assert data["brand"] == "TEST_ADMIN_BRAND"
        assert data["category"] == "electronics"
        assert data["state"] == "open"
        assert "wave_id" in data
        _created.append(data["wave_id"])
        # Verify in admin list
        r2 = admin.get(f"{API}/admin/regional-waves", timeout=15)
        assert r2.status_code == 200
        ids = {w["wave_id"] for w in r2.json()}
        assert data["wave_id"] in ids

    def test_admin_create_missing_supplier_rejected(self, admin, region_id):
        r = admin.post(f"{API}/admin/regional-waves",
                       json=_payload(region_id, supplier_id=None), timeout=15)
        assert r.status_code in (400, 422), r.text

    def test_admin_create_invalid_supplier_rejected(self, admin, region_id):
        r = admin.post(f"{API}/admin/regional-waves",
                       json=_payload(region_id, "sup_does_not_exist"), timeout=15)
        assert r.status_code == 400, r.text
        assert "supplier" in r.json().get("detail", "").lower()

    def test_supplier_cannot_call_admin_endpoint(self, supplier, region_id, supplier_id):
        r = supplier.post(f"{API}/admin/regional-waves",
                          json=_payload(region_id, supplier_id), timeout=15)
        assert r.status_code == 403, r.text

    def test_admin_wave_image_upload(self, admin):
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
               b"\xc0\x00\x00\x00\x03\x00\x01\xfb\xb0\x9e\x9b\x00\x00\x00\x00IEND\xaeB`\x82")
        r = admin.post(f"{API}/admin/wave-image",
                       files={"file": ("t.png", png, "image/png")}, timeout=20)
        assert r.status_code == 200, r.text
        assert "image_url" in r.json()


class TestSupplierRegression:
    def test_supplier_create_wave(self, supplier, region_id):
        r = supplier.post(f"{API}/supplier/waves",
                          json=_payload(region_id, brand="TEST_SUPPLIER_REG"), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["brand"] == "TEST_SUPPLIER_REG"
        _created.append(data["wave_id"])

    def test_supplier_edit_wave(self, supplier, region_id):
        r = supplier.post(f"{API}/supplier/waves",
                          json=_payload(region_id, brand="TEST_EDIT_BEFORE"), timeout=20)
        assert r.status_code == 200
        wid = r.json()["wave_id"]
        _created.append(wid)
        r2 = supplier.patch(f"{API}/supplier/waves/{wid}",
                            json={"brand": "TEST_EDIT_AFTER"}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["brand"] == "TEST_EDIT_AFTER"
        r3 = supplier.get(f"{API}/supplier/waves/{wid}", timeout=15)
        assert r3.status_code == 200
        assert r3.json()["brand"] == "TEST_EDIT_AFTER"


def test_zz_cleanup(admin):
    for wid in _created:
        try:
            admin.delete(f"{API}/admin/regional-waves/{wid}", timeout=10)
        except Exception:
            pass
