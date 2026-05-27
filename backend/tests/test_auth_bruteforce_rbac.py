"""
Iteration 4 — Bug fix + access-control hardening for The Collective Savers.

Verifies:
1. Founder admin login succeeds (bug fix for "cant log in using admin details").
2. Brute-force allowlist: founder email survives 6+ wrong attempts and a subsequent
   correct attempt still works (allowlisted emails skip the limiter).
3. Brute-force limiter still works for non-allowlisted emails: 10 wrong attempts
   in a single session trips 429.
4. Supplier role is forbidden (403) from GET /api/vpps, GET /api/vpps/{id} (not own),
   POST /api/vpps/{id}/join, POST /api/checkout/init.
5. Supplier CAN view their OWN wave at GET /api/vpps/{id}.
6. Garage role is forbidden (403) from the same endpoints.
7. Anonymous (no session) still gets 200 on GET /api/vpps and GET /api/vpps/{id}.
8. Consumer + Admin retain full read/join access (regression).
"""
import os
import uuid
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://party-power-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
FOUNDER_EMAIL = "founder@thecollectivesavers.co.uk"
FOUNDER_PASS = "SaversCollective"


# -------------- helpers --------------
def _mongosh(js: str) -> str:
    res = subprocess.run(
        ["mongosh", MONGO_URL, "--quiet", "--eval", f'db = db.getSiblingDB("{DB_NAME}");{js}'],
        capture_output=True, text=True, timeout=15,
    )
    assert res.returncode == 0, f"mongosh failed: {res.stderr}\n{res.stdout}"
    return res.stdout


def _clear_login_attempts():
    _mongosh("db.login_attempts.deleteMany({});")


def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register_consumer(session: requests.Session, password: str = "Password123!") -> dict:
    email = f"test_consumer_{uuid.uuid4().hex[:10]}@example.com"
    r = session.post(f"{API}/auth/register",
                     json={"email": email, "password": password, "name": "TEST Consumer"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return {"email": email, "password": password, "user": r.json()["user"]}


def _apply_as_supplier(session: requests.Session) -> dict:
    """Auto-promotes the logged-in user to supplier role and returns supplier doc."""
    payload = {
        "business_name": f"TEST Supplier {uuid.uuid4().hex[:6]}",
        "contact_email": f"sup_{uuid.uuid4().hex[:6]}@test.example",
        "category": "tyres",
        "description": "Supplier role RBAC test"
    }
    r = session.post(f"{API}/suppliers/apply", json=payload)
    assert r.status_code in (200, 201), f"supplier apply failed: {r.status_code} {r.text}"
    return r.json()


def _apply_as_garage(session: requests.Session) -> dict:
    payload = {
        "business_name": f"TEST Garage {uuid.uuid4().hex[:6]}",
        "contact_email": f"gar_{uuid.uuid4().hex[:6]}@test.example",
        "garage_type": "auth_repair_shop",
        "services": ["tyres"],
        "address_line1": "1 Test Street",
        "city": "London",
        "postcode": "EC1A 1AA",
    }
    r = session.post(f"{API}/garages/apply", json=payload)
    assert r.status_code in (200, 201), f"garage apply failed: {r.status_code} {r.text}"
    return r.json()


def _get_me(session: requests.Session) -> dict:
    r = session.get(f"{API}/auth/me")
    assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
    body = r.json()
    # /auth/me returns the user object directly (no wrapper)
    return body.get("user", body)


# -------------- fixtures --------------
@pytest.fixture(autouse=True)
def _wipe_attempts_between_tests():
    _clear_login_attempts()
    yield
    _clear_login_attempts()


@pytest.fixture
def founder_session():
    s = _new_session()
    r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PASS})
    assert r.status_code == 200, f"founder login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["user"]["role"] == "admin", f"founder role should be admin: {body['user']}"
    return s


@pytest.fixture
def a_live_vpp_id(founder_session) -> str:
    r = founder_session.get(f"{API}/vpps")
    assert r.status_code == 200
    items = r.json()
    assert items, "Expected at least one live VPP in DB"
    return items[0]["vpp_id"]


# =========================================================================
# 1. Founder admin login (the original reported bug)
# =========================================================================
class TestFounderLogin:
    def test_founder_login_returns_200_admin(self):
        s = _new_session()
        r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PASS})
        assert r.status_code == 200, f"founder login failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["user"]["email"] == FOUNDER_EMAIL
        assert body["user"]["role"] == "admin"
        # session cookie should be set
        assert "session_token" in s.cookies, f"session_token cookie missing: {s.cookies}"


# =========================================================================
# 2. Brute-force allowlist — founder cannot be locked out
# =========================================================================
class TestBruteForceAllowlist:
    def test_founder_survives_many_wrong_then_correct_works(self):
        s = _new_session()
        # 8 wrong attempts (more than the 5 old threshold AND well above the new 10
        # threshold's 6-attempt mark mentioned in the PRD)
        for i in range(8):
            r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": f"wrong-{i}"})
            assert r.status_code == 401, (
                f"Attempt {i+1}: allowlisted founder must keep getting 401 (not 429). "
                f"Got {r.status_code} {r.text}"
            )
        # Correct password should still succeed (no lockout)
        r = s.post(f"{API}/auth/login", json={"email": FOUNDER_EMAIL, "password": FOUNDER_PASS})
        assert r.status_code == 200, (
            f"After 8 wrong attempts, founder correct login must still succeed. "
            f"Got {r.status_code} {r.text}"
        )
        assert r.json()["user"]["role"] == "admin"


# =========================================================================
# 3. Brute-force limiter still works for NON-allowlisted accounts
# =========================================================================
class TestBruteForceNonAllowlisted:
    def test_non_allowlisted_locks_out_after_10_attempts(self):
        s = _new_session()
        # First register a fresh consumer (so the email exists and we control its pw)
        creds = _register_consumer(s, password="GoodPassword123!")
        email = creds["email"]
        # Use a fresh session so the brute-force identifier (ip:email) is consistent
        bs = _new_session()
        for i in range(10):
            r = bs.post(f"{API}/auth/login", json={"email": email, "password": f"wrong-{i}"})
            assert r.status_code == 401, (
                f"Attempt {i+1}/10 should be 401, got {r.status_code} {r.text}"
            )
        # 11th attempt MUST be blocked even with correct password
        r = bs.post(f"{API}/auth/login", json={"email": email, "password": creds["password"]})
        assert r.status_code == 429, (
            f"After 10 wrong attempts the limiter must trip. Got {r.status_code} {r.text}"
        )


# =========================================================================
# 4-6. RBAC: supplier & garage blocked from member endpoints
# =========================================================================
class TestSupplierRBAC:
    def test_supplier_403_on_vpp_list_detail_join_checkout(self, a_live_vpp_id):
        s = _new_session()
        _register_consumer(s)
        _apply_as_supplier(s)
        me = _get_me(s)
        assert me["role"] == "supplier", f"role should be supplier, got {me['role']}"

        # GET /api/vpps
        r = s.get(f"{API}/vpps")
        assert r.status_code == 403, f"supplier should get 403 on /vpps, got {r.status_code} {r.text}"

        # GET /api/vpps/{id} (not own)
        r = s.get(f"{API}/vpps/{a_live_vpp_id}")
        assert r.status_code == 403, f"supplier should get 403 on /vpps/<not-own>, got {r.status_code} {r.text}"

        # POST /api/vpps/{id}/join
        r = s.post(f"{API}/vpps/{a_live_vpp_id}/join")
        assert r.status_code == 403, f"supplier should get 403 on /vpps/<id>/join, got {r.status_code} {r.text}"

        # POST /api/checkout/init (include origin_url so we pass Pydantic validation
        # and actually hit the role check)
        r = s.post(f"{API}/checkout/init",
                   json={"vpp_id": a_live_vpp_id, "payment_method": "card",
                         "origin_url": "https://example.test"})
        assert r.status_code == 403, f"supplier should get 403 on /checkout/init, got {r.status_code} {r.text}"

    def test_supplier_can_view_own_wave(self, founder_session):
        """A supplier viewing GET /api/vpps/{id} for a wave they own (supplier_id matches)
        should succeed (200). We seed the VPP directly via mongosh because there is no
        admin REST endpoint for VPP creation."""
        sup_session = _new_session()
        _register_consumer(sup_session)
        _apply_as_supplier(sup_session)
        me = _get_me(sup_session)
        sup_id = me.get("supplier_id")
        assert sup_id, f"supplier_id missing from /auth/me: {me}"

        # Seed an active+live VPP belonging to this supplier_id
        vpp_id = f"test-vpp-{uuid.uuid4().hex[:10]}"
        _mongosh(
            "db.vpps.insertOne({"
            f"vpp_id: '{vpp_id}', name: 'TEST OwnWave', category: 'tyres',"
            f"supplier_id: '{sup_id}', supplier_name: 'TEST Supplier',"
            "state: 'active', publish_status: 'live',"
            "threshold: 10, participants_count: 0,"
            "max_participants: 50,"
            "retail_price: 100.0, customer_price: 80.0,"
            "description: 'RBAC own-wave test', created_at: new Date(),"
            "deadline: new Date(Date.now() + 7*86400000)"
            "});"
        )

        # Supplier views their own wave — should succeed
        r = sup_session.get(f"{API}/vpps/{vpp_id}")
        assert r.status_code == 200, (
            f"supplier viewing their OWN wave should be 200, got {r.status_code} {r.text}"
        )
        assert r.json()["vpp_id"] == vpp_id

        # And a DIFFERENT supplier still gets 403 on this wave (sanity)
        other = _new_session()
        _register_consumer(other)
        _apply_as_supplier(other)
        r = other.get(f"{API}/vpps/{vpp_id}")
        assert r.status_code == 403, (
            f"another supplier should still get 403 for someone else's wave, got {r.status_code}"
        )

        # Cleanup
        _mongosh(f"db.vpps.deleteOne({{vpp_id:'{vpp_id}'}});")


class TestGarageRBAC:
    def test_garage_403_on_vpp_list_detail_join_checkout(self, a_live_vpp_id):
        s = _new_session()
        _register_consumer(s)
        _apply_as_garage(s)
        me = _get_me(s)
        assert me["role"] == "garage", f"role should be garage, got {me['role']}"

        r = s.get(f"{API}/vpps")
        assert r.status_code == 403, f"garage should get 403 on /vpps, got {r.status_code} {r.text}"

        r = s.get(f"{API}/vpps/{a_live_vpp_id}")
        assert r.status_code == 403, f"garage should get 403 on /vpps/<id>, got {r.status_code} {r.text}"

        r = s.post(f"{API}/vpps/{a_live_vpp_id}/join")
        assert r.status_code == 403, f"garage should get 403 on join, got {r.status_code} {r.text}"

        r = s.post(f"{API}/checkout/init",
                   json={"vpp_id": a_live_vpp_id, "payment_method": "card",
                         "origin_url": "https://example.test"})
        assert r.status_code == 403, f"garage should get 403 on checkout, got {r.status_code} {r.text}"


# =========================================================================
# 7. Anonymous + Consumer + Admin regression
# =========================================================================
class TestAnonAndConsumerAndAdmin:
    def test_anonymous_can_list_and_view_vpps(self, a_live_vpp_id):
        s = _new_session()  # NO auth
        r = s.get(f"{API}/vpps")
        assert r.status_code == 200, f"anon /vpps should be 200, got {r.status_code} {r.text}"
        assert isinstance(r.json(), list)

        r = s.get(f"{API}/vpps/{a_live_vpp_id}")
        assert r.status_code == 200, f"anon /vpps/<id> should be 200, got {r.status_code} {r.text}"
        assert r.json()["vpp_id"] == a_live_vpp_id

    def test_consumer_can_list_and_view_vpps(self, a_live_vpp_id):
        s = _new_session()
        _register_consumer(s)
        r = s.get(f"{API}/vpps")
        assert r.status_code == 200
        r = s.get(f"{API}/vpps/{a_live_vpp_id}")
        assert r.status_code == 200

    def test_admin_can_list_and_view_vpps(self, founder_session, a_live_vpp_id):
        r = founder_session.get(f"{API}/vpps")
        assert r.status_code == 200
        r = founder_session.get(f"{API}/vpps/{a_live_vpp_id}")
        assert r.status_code == 200
