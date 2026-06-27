"""
Backend tests for Tyre Product Group Waves© (auto-engine MVP).

Covers: /api/tyre/*, /api/supplier/product-groups/*, /api/me/tyre-waves,
/api/admin/product-groups + privacy/RBAC + idempotent join + lock transition.
"""
import os
import uuid
import subprocess

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://wave-regional-pivot.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Helpers ----------
def _mongo(js: str) -> str:
    res = subprocess.run(
        ["mongosh", MONGO_URL, "--quiet", "--eval", f'db = db.getSiblingDB("{DB_NAME}");{js}'],
        capture_output=True, text=True, timeout=20,
    )
    assert res.returncode == 0, f"mongosh failed: {res.stderr}"
    return res.stdout


def _seed_user(role: str = "consumer"):
    uid = f"test-user-{uuid.uuid4().hex[:10]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    js = f"""
db.users.insertOne({{user_id:"{uid}", email:"{email}", name:"Test User",
  picture:"https://i.pravatar.cc/150", role:"{role}", created_at:new Date()}});
db.user_sessions.insertOne({{user_id:"{uid}", session_token:"{tok}",
  expires_at:new Date(Date.now()+7*86400000), created_at:new Date()}});
"""
    _mongo(js)
    return tok, uid, email


def _seed_supplier_user():
    tok, uid, email = _seed_user("supplier")
    sid = f"sup_{uuid.uuid4().hex[:10]}"
    js = f"""
db.suppliers.insertOne({{supplier_id:"{sid}", user_id:"{uid}",
  business_name:"TEST_Supplier_{uid}", status:"verified",
  contact_email:"{email}", created_at:new Date()}});
"""
    _mongo(js)
    return tok, uid, sid


def H(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def consumer_token():
    tok, _, _ = _seed_user("consumer")
    return tok


@pytest.fixture(scope="module")
def admin_token():
    tok, _, _ = _seed_user("admin")
    return tok


@pytest.fixture(scope="module")
def supplier():
    tok, uid, sid = _seed_supplier_user()
    return {"token": tok, "user_id": uid, "supplier_id": sid}


# ============================================================
# Public Tyre Waves listing/detail
# ============================================================
class TestTyreWavesPublic:
    def test_list_tyre_waves_seeded(self):
        r = requests.get(f"{API}/tyre/waves")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) >= 3
        brands = {f"{x['brand']} {x['model']}" for x in data}
        # At least 3 seeded brands present
        assert any("Michelin" in b for b in brands)
        assert any("Continental" in b for b in brands)
        assert any("Pirelli" in b for b in brands)
        # Schema
        item = data[0]
        for k in ("product_group_id", "brand", "model", "wave", "stats"):
            assert k in item
        for k in ("participants_count", "target_count", "progress_pct", "state"):
            assert k in item["wave"]
        for k in ("size_count", "total_inventory", "savings_band_pct"):
            assert k in item["stats"]

    def test_list_tyre_sizes(self):
        r = requests.get(f"{API}/tyre/sizes")
        assert r.status_code == 200
        sizes = r.json()
        assert isinstance(sizes, list) and len(sizes) > 0
        # Canonical format XXX/XX/RXX
        import re
        assert all(re.match(r"^\d{3}/\d{2}/R\d{2}$", s) for s in sizes), sizes

    def test_filter_by_size_michelin_only(self):
        # 225/65/R18 should be on Michelin CrossClimate 2 per seed
        r = requests.get(f"{API}/tyre/waves", params={"size": "225/65/R18"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data) == 1, f"Expected 1, got {len(data)}: {[d['model'] for d in data]}"
        assert "Michelin" in data[0]["brand"]

    def test_filter_by_q(self):
        r = requests.get(f"{API}/tyre/waves", params={"q": "michelin"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all("michelin" in (d["brand"] + d["model"]).lower() for d in data)

    def test_detail_privacy_no_supplier_price(self):
        lst = requests.get(f"{API}/tyre/waves").json()
        pg_id = lst[0]["product_group_id"]
        r = requests.get(f"{API}/tyre/waves/{pg_id}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("supplier_name") == "Verified Supplier"
        assert "sizes" in d and len(d["sizes"]) > 0
        for s in d["sizes"]:
            assert "supplier_price" not in s, "supplier_price LEAKED to public detail"
            for k in ("size_id", "tyre_size", "retail_price", "availability", "eta_days", "inventory_band"):
                assert k in s
        assert "wave" in d and "stats" in d

    def test_detail_not_found(self):
        r = requests.get(f"{API}/tyre/waves/pg_does_not_exist")
        assert r.status_code == 404


# ============================================================
# Join Tyre Wave
# ============================================================
class TestJoinTyreWave:
    def _michelin_pg(self):
        lst = requests.get(f"{API}/tyre/waves").json()
        return next(x for x in lst if "Michelin" in x["brand"])

    def test_join_requires_auth(self):
        pg = self._michelin_pg()
        r = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                          json={"selected_size": "225/65/R18"})
        assert r.status_code == 401

    def test_join_invalid_size_format(self, consumer_token):
        pg = self._michelin_pg()
        r = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                          headers=H(consumer_token), json={"selected_size": "garbage"})
        assert r.status_code == 400

    def test_join_size_not_in_wave(self, consumer_token):
        pg = self._michelin_pg()
        r = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                          headers=H(consumer_token), json={"selected_size": "999/99/R99"})
        assert r.status_code == 400

    def test_join_increments_and_idempotent(self):
        # fresh user so participant count increments by exactly 1
        tok, uid, _email = _seed_user("consumer")
        pg = self._michelin_pg()
        before = pg["wave"]["participants_count"]
        r1 = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                           headers=H(tok), json={"selected_size": "225/65/R18"})
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("success") is True
        assert d1["wave"]["participants_count"] == before + 1
        assert d1["selected_size"] == "225/65/R18"

        # Idempotent: rejoin same size -> already_joined=True, no extra increment
        r2 = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                           headers=H(tok), json={"selected_size": "225/65/R18"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("already_joined") is True
        assert d2["wave"]["participants_count"] == before + 1

        # Rejoin with different (valid) size -> updates selected_size; participants_count unchanged
        # Pull detail to find a second valid size
        det = requests.get(f"{API}/tyre/waves/{pg['product_group_id']}").json()
        other_sizes = [s["tyre_size"] for s in det["sizes"]
                       if s["tyre_size"] != "225/65/R18" and s["availability"] != "out_of_stock"
                       and s["inventory_band"] != "out_of_stock"]
        if other_sizes:
            r3 = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                               headers=H(tok), json={"selected_size": other_sizes[0]})
            assert r3.status_code == 200
            assert r3.json().get("already_joined") is True
            assert r3.json()["selected_size"] == other_sizes[0]

    def test_my_tyre_waves(self):
        tok, _, _ = _seed_user("consumer")
        # unauth
        rb = requests.get(f"{API}/me/tyre-waves")
        assert rb.status_code == 401
        pg = self._michelin_pg()
        requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                      headers=H(tok), json={"selected_size": "225/65/R18"})
        r = requests.get(f"{API}/me/tyre-waves", headers=H(tok))
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) == 1
        rec = arr[0]
        for k in ("product_group", "wave", "selected_size", "payment_status", "joined_at"):
            assert k in rec
        assert rec["selected_size"] == "225/65/R18"
        assert rec["payment_status"] == "preauth_pending"


# ============================================================
# Supplier Product Groups (CRUD, RBAC, CSV, api-sync)
# ============================================================
class TestSupplierProductGroups:
    def test_consumer_cannot_create(self, consumer_token):
        r = requests.post(f"{API}/supplier/product-groups", headers=H(consumer_token), json={
            "brand": "X", "model": "Y", "category": "Z", "target_count": 10, "sizes": []
        })
        assert r.status_code == 403

    def test_supplier_create_pg_auto_wave(self, supplier):
        payload = {
            "brand": "TEST_Brand", "model": f"TEST_Model_{uuid.uuid4().hex[:5]}",
            "category": "Premium All-Season", "target_count": 3,
            "description": "test pg",
            "sizes": [
                {"tyre_size": "205/55R16", "inventory": 5, "supplier_price": 60,
                 "retail_price": 100, "availability": "in_stock", "eta_days": 2},
                {"tyre_size": "225/45/R17", "inventory": 0, "supplier_price": 65,
                 "retail_price": 110, "availability": "out_of_stock", "eta_days": 5},
            ],
        }
        r = requests.post(f"{API}/supplier/product-groups", headers=H(supplier["token"]),
                          json=payload)
        assert r.status_code == 200, r.text
        pg = r.json()
        assert pg["brand"] == "TEST_Brand"
        pg_id = pg["product_group_id"]

        # List -> should include this one, with stats + wave
        lst = requests.get(f"{API}/supplier/product-groups",
                          headers=H(supplier["token"])).json()
        mine = next((x for x in lst if x["product_group_id"] == pg_id), None)
        assert mine is not None
        assert mine["stats"]["size_count"] == 2
        assert mine["wave"]["target_count"] == 3
        assert mine["wave"]["state"] in ("active", "locked")

        # Detail
        det = requests.get(f"{API}/supplier/product-groups/{pg_id}",
                           headers=H(supplier["token"])).json()
        assert det["product_group_id"] == pg_id
        # supplier_price visible to supplier (their own)
        assert all("supplier_price" in s for s in det["sizes"])

        return pg_id

    def test_create_invalid_size_returns_400(self, supplier):
        payload = {
            "brand": "TEST_BadBrand", "model": "TEST_BadModel",
            "category": "X", "target_count": 5,
            "sizes": [{"tyre_size": "abc", "inventory": 1, "supplier_price": 1,
                       "retail_price": 2, "availability": "in_stock", "eta_days": 2}],
        }
        r = requests.post(f"{API}/supplier/product-groups", headers=H(supplier["token"]),
                          json=payload)
        assert r.status_code == 400

    def test_supplier_cannot_view_other_supplier_pg(self, supplier):
        # Create another supplier and their PG
        tok2, _, _ = _seed_supplier_user()
        pg2 = requests.post(f"{API}/supplier/product-groups", headers=H(tok2), json={
            "brand": "TEST_Other", "model": "Mdl", "category": "C", "target_count": 5,
            "sizes": [{"tyre_size": "195/65R15", "inventory": 1, "supplier_price": 1,
                       "retail_price": 2, "availability": "in_stock", "eta_days": 2}],
        }).json()
        # First supplier tries to view
        r = requests.get(f"{API}/supplier/product-groups/{pg2['product_group_id']}",
                         headers=H(supplier["token"]))
        assert r.status_code == 403

    def test_admin_can_view_all(self, admin_token):
        r = requests.get(f"{API}/admin/product-groups", headers=H(admin_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 3

    def test_patch_target_syncs_wave(self, supplier):
        pg_id = self.test_supplier_create_pg_auto_wave(supplier)
        r = requests.patch(f"{API}/supplier/product-groups/{pg_id}",
                           headers=H(supplier["token"]),
                           json={"target_count": 99, "description": "updated"})
        assert r.status_code == 200
        # Verify wave reflects new target
        det = requests.get(f"{API}/supplier/product-groups/{pg_id}",
                           headers=H(supplier["token"])).json()
        assert det["wave"]["target_count"] == 99
        assert det["description"] == "updated"

    def test_sizes_upsert_and_overwrite(self, supplier):
        pg_id = self.test_supplier_create_pg_auto_wave(supplier)
        # Upsert: add new + update existing
        r = requests.put(f"{API}/supplier/product-groups/{pg_id}/sizes",
                         headers=H(supplier["token"]), json={
            "mode": "upsert",
            "sizes": [
                {"tyre_size": "205/55R16", "inventory": 10, "supplier_price": 70,
                 "retail_price": 120, "availability": "in_stock", "eta_days": 2},
                {"tyre_size": "255/40R19", "inventory": 4, "supplier_price": 90,
                 "retail_price": 150, "availability": "limited", "eta_days": 3},
                # bad row
                {"tyre_size": "BAD", "inventory": 1, "supplier_price": 1,
                 "retail_price": 1, "availability": "in_stock", "eta_days": 1},
            ]
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] >= 1 and d["updated"] >= 1
        assert len(d["errors"]) >= 1  # bad row reported

        # Overwrite: replace all sizes
        r2 = requests.put(f"{API}/supplier/product-groups/{pg_id}/sizes",
                          headers=H(supplier["token"]), json={
            "mode": "overwrite",
            "sizes": [
                {"tyre_size": "215/60R17", "inventory": 8, "supplier_price": 75,
                 "retail_price": 130, "availability": "in_stock", "eta_days": 2}
            ]
        })
        assert r2.status_code == 200
        det = requests.get(f"{API}/supplier/product-groups/{pg_id}",
                           headers=H(supplier["token"])).json()
        assert len(det["sizes"]) == 1
        assert det["sizes"][0]["tyre_size"] == "215/60/R17"

    def test_delete_size(self, supplier):
        pg_id = self.test_supplier_create_pg_auto_wave(supplier)
        det = requests.get(f"{API}/supplier/product-groups/{pg_id}",
                           headers=H(supplier["token"])).json()
        sid = det["sizes"][0]["size_id"]
        r = requests.delete(f"{API}/supplier/product-groups/{pg_id}/sizes/{sid}",
                            headers=H(supplier["token"]))
        assert r.status_code == 200
        det2 = requests.get(f"{API}/supplier/product-groups/{pg_id}",
                            headers=H(supplier["token"])).json()
        assert all(s["size_id"] != sid for s in det2["sizes"])

    def test_csv_import_with_errors(self, supplier):
        pg_id = self.test_supplier_create_pg_auto_wave(supplier)
        csv_text = ("tyre_size,inventory,supplier_price,retail_price,availability,eta_days\n"
                    "225/65/R18,40,88,138,in_stock,2\n"
                    "BAD_SIZE,5,50,100,in_stock,2\n"
                    "245/40R19,12,99,179,limited,3\n")
        r = requests.post(f"{API}/supplier/product-groups/{pg_id}/csv-import",
                          headers=H(supplier["token"]),
                          json={"csv": csv_text, "mode": "upsert"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] + d["updated"] >= 2
        assert len(d["errors"]) >= 1

    def test_api_sync_idempotent(self, supplier):
        payload = {
            "brand": "TEST_API", "model": f"Sync_{uuid.uuid4().hex[:5]}",
            "category": "Performance", "target_count": 40,
            "sizes": [
                {"tyre_size": "245/40R19", "inventory": 20, "supplier_price": 110,
                 "retail_price": 170, "availability": "in_stock", "eta_days": 2}
            ],
        }
        r1 = requests.post(f"{API}/supplier/product-groups/api-sync",
                           headers=H(supplier["token"]), json=payload)
        assert r1.status_code == 200, r1.text
        pg_id1 = r1.json().get("product_group_id")
        # second call same brand/model -> upsert, same product_group_id
        r2 = requests.post(f"{API}/supplier/product-groups/api-sync",
                           headers=H(supplier["token"]), json=payload)
        assert r2.status_code == 200
        assert r2.json().get("product_group_id") == pg_id1


# ============================================================
# Auto-lock transition
# ============================================================
class TestAutoLockTransition:
    def test_wave_locks_when_target_reached(self, supplier):
        # Create a tiny target=2 PG with 10 inventory
        payload = {
            "brand": f"TEST_Lock_{uuid.uuid4().hex[:4]}", "model": "Auto",
            "category": "Test", "target_count": 2,
            "sizes": [{"tyre_size": "205/55R16", "inventory": 10, "supplier_price": 50,
                       "retail_price": 100, "availability": "in_stock", "eta_days": 2}],
        }
        pg = requests.post(f"{API}/supplier/product-groups", headers=H(supplier["token"]),
                           json=payload).json()
        pg_id = pg["product_group_id"]
        # Two consumers join
        for i in range(2):
            tok, _, _ = _seed_user("consumer")
            r = requests.post(f"{API}/tyre/waves/{pg_id}/join", headers=H(tok),
                              json={"selected_size": "205/55R16"})
            assert r.status_code == 200, r.text
        # Wave state should now be locked
        det = requests.get(f"{API}/tyre/waves/{pg_id}").json()
        assert det["wave"]["state"] == "locked", det["wave"]


# ============================================================
# Out-of-stock rejection
# ============================================================
class TestOutOfStock:
    def test_join_out_of_stock_size_rejected(self, supplier):
        payload = {
            "brand": f"TEST_OOS_{uuid.uuid4().hex[:4]}", "model": "OOS",
            "category": "Test", "target_count": 10,
            "sizes": [
                {"tyre_size": "205/55R16", "inventory": 0, "supplier_price": 50,
                 "retail_price": 100, "availability": "out_of_stock", "eta_days": 5},
                {"tyre_size": "215/60R17", "inventory": 5, "supplier_price": 55,
                 "retail_price": 110, "availability": "in_stock", "eta_days": 2},
            ],
        }
        pg = requests.post(f"{API}/supplier/product-groups", headers=H(supplier["token"]),
                           json=payload).json()
        tok, _, _ = _seed_user("consumer")
        r = requests.post(f"{API}/tyre/waves/{pg['product_group_id']}/join",
                          headers=H(tok), json={"selected_size": "205/55R16"})
        assert r.status_code == 400
