"""
Iteration 6 — Admin User Management + Terms & Conditions audit
Tests for /api/admin/users*, /api/admin/audit-log, /api/terms/*, /api/admin/terms/audit
plus suspend/delete login gating behavior.
"""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
assert BASE_URL, "REACT_APP_BACKEND_URL env must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "founder@thecollectivesavers.co.uk"
ADMIN_PASS = "SaversCollective"


# ---------- helpers ----------
def _login_session(email: str, password: str):
    """Returns (response, session_token) — token captured from the Set-Cookie header."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    tok = s.cookies.get("session_token")
    return r, tok


def _register_session(email: str, password: str, name: str = "TEST User"):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name})
    tok = s.cookies.get("session_token")
    return r, tok


def _auth_headers(token: str):
    return {"Authorization": f"Bearer {token}"}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r, tok = _login_session(ADMIN_EMAIL, ADMIN_PASS)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    assert tok, f"No session_token cookie in admin login. Response={r.text}"
    return tok


@pytest.fixture(scope="session")
def admin_user_id(admin_token):
    r = requests.get(f"{API}/auth/me", headers=_auth_headers(admin_token))
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


@pytest.fixture()
def new_consumer():
    email = f"TEST_consumer_{uuid.uuid4().hex[:8]}@example.com"
    pw = "Password123!"
    r, token = _register_session(email, pw, "TEST Consumer")
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    assert token, f"register response missing session_token cookie: {r.text}"
    me = requests.get(f"{API}/auth/me", headers=_auth_headers(token)).json()
    return {"email": email, "password": pw, "token": token, "user_id": me["user_id"]}


def _login(email, pw):
    r, _ = _login_session(email, pw)
    return r


# ===== ADMIN: list users =====
class TestAdminListUsers:
    def test_list_users_admin(self, admin_token):
        r = requests.get(f"{API}/admin/users", headers=_auth_headers(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and "total" in body
        assert isinstance(body["users"], list)
        assert isinstance(body["total"], int)

    def test_list_users_filter_role(self, admin_token):
        r = requests.get(f"{API}/admin/users?role=admin", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        for u in r.json()["users"]:
            assert u["role"] == "admin"

    def test_list_users_search(self, admin_token):
        r = requests.get(f"{API}/admin/users?q=founder", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        emails = [u["email"].lower() for u in r.json()["users"]]
        assert any("founder" in e for e in emails)

    def test_list_users_status_filter(self, admin_token):
        r = requests.get(f"{API}/admin/users?user_status=active", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        for u in r.json()["users"]:
            assert u.get("status", "active") == "active"

    def test_non_admin_forbidden(self, new_consumer):
        r = requests.get(f"{API}/admin/users", headers=_auth_headers(new_consumer["token"]))
        assert r.status_code == 403


# ===== ADMIN: get user detail =====
class TestAdminGetUser:
    def test_get_user_with_stats(self, admin_token, new_consumer):
        r = requests.get(f"{API}/admin/users/{new_consumer['user_id']}", headers=_auth_headers(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == new_consumer["user_id"]
        assert "stats" in body
        for k in ("participations", "tyre_participations", "payment_transactions"):
            assert k in body["stats"]

    def test_get_unknown_user_404(self, admin_token):
        r = requests.get(f"{API}/admin/users/nonexistent_xyz", headers=_auth_headers(admin_token))
        assert r.status_code == 404


# ===== ADMIN: update / suspend =====
class TestAdminPatchUser:
    def test_cannot_modify_self(self, admin_token, admin_user_id):
        r = requests.patch(
            f"{API}/admin/users/{admin_user_id}",
            headers=_auth_headers(admin_token),
            json={"status": "suspended"},
        )
        assert r.status_code == 400

    def test_cannot_suspend_admin(self, admin_token, admin_user_id):
        # Find another admin if any, else uses self-protection already; we just verify the
        # error message path with the founder being unreachable
        r = requests.patch(
            f"{API}/admin/users/{admin_user_id}",
            headers=_auth_headers(admin_token),
            json={"status": "suspended"},
        )
        assert r.status_code == 400  # blocked by self-rule first

    def test_suspend_invalidates_session_and_blocks_login(self, admin_token, new_consumer):
        # Suspend the user
        r = requests.patch(
            f"{API}/admin/users/{new_consumer['user_id']}",
            headers=_auth_headers(admin_token),
            json={"status": "suspended", "suspended_reason": "TEST suspension"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "suspended"
        assert body.get("suspended_reason") == "TEST suspension"

        # /auth/me should 403 for the suspended user's existing token
        # NOTE: session invalidation is best-effort; document any miss as a finding.
        me = requests.get(f"{API}/auth/me", headers=_auth_headers(new_consumer["token"]))
        # If sessions wired correctly, token is gone (401) OR user check returns 403
        assert me.status_code in (401, 403), f"suspended user /me unexpectedly: {me.status_code} {me.text}"

        # Login attempt should 403 with suspension message
        r = _login(new_consumer["email"], new_consumer["password"])
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "suspend" in r.text.lower()

        # Unsuspend clears reason and restores login
        r = requests.patch(
            f"{API}/admin/users/{new_consumer['user_id']}",
            headers=_auth_headers(admin_token),
            json={"status": "active"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "active"
        assert not body.get("suspended_reason")

        r = _login(new_consumer["email"], new_consumer["password"])
        assert r.status_code == 200

    def test_audit_log_written(self, admin_token, new_consumer):
        requests.patch(
            f"{API}/admin/users/{new_consumer['user_id']}",
            headers=_auth_headers(admin_token),
            json={"status": "suspended", "suspended_reason": "audit-check"},
        )
        r = requests.get(f"{API}/admin/audit-log?limit=50", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        entries = r.json()
        assert isinstance(entries, list)
        assert any(
            e.get("target_user_id") == new_consumer["user_id"] and e.get("action") == "user_update"
            for e in entries
        )
        # cleanup: unsuspend
        requests.patch(
            f"{API}/admin/users/{new_consumer['user_id']}",
            headers=_auth_headers(admin_token),
            json={"status": "active"},
        )


# ===== ADMIN: delete =====
class TestAdminDeleteUser:
    def test_soft_delete_blocks_login_and_audit(self, admin_token, new_consumer):
        r = requests.delete(
            f"{API}/admin/users/{new_consumer['user_id']}", headers=_auth_headers(admin_token)
        )
        assert r.status_code == 200
        assert r.json().get("hard") is False

        # Login should now return 401 (Invalid email or password — email mangled)
        r = _login(new_consumer["email"], new_consumer["password"])
        assert r.status_code == 401

        # Audit
        r = requests.get(f"{API}/admin/audit-log", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        assert any(
            e.get("target_user_id") == new_consumer["user_id"] and e.get("action") == "user_soft_delete"
            for e in r.json()
        )

    def test_hard_delete(self, admin_token, new_consumer):
        r = requests.delete(
            f"{API}/admin/users/{new_consumer['user_id']}?hard=true",
            headers=_auth_headers(admin_token),
        )
        assert r.status_code == 200
        assert r.json().get("hard") is True

        # User row is gone — admin GET should be 404
        r = requests.get(
            f"{API}/admin/users/{new_consumer['user_id']}", headers=_auth_headers(admin_token)
        )
        assert r.status_code == 404


# ===== TERMS =====
class TestTermsDocs:
    def test_list_docs_public(self):
        r = requests.get(f"{API}/terms/docs")
        assert r.status_code == 200
        docs = r.json()
        ids = {d["id"]: d for d in docs}
        assert "terms" in ids and "privacy" in ids
        assert ids["terms"]["version"] == "1.0"
        assert ids["privacy"]["version"] == "1.0"
        for d in docs:
            for k in ("title", "effective_date", "summary"):
                assert k in d

    def test_accept_terms_persists(self, new_consumer):
        r = requests.post(
            f"{API}/terms/accept",
            headers=_auth_headers(new_consumer["token"]),
            json={"doc_id": "terms", "version": "1.0", "context": "test:pg_xxx"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["doc_id"] == "terms"
        assert body["is_current"] is True
        assert "ip" in body and "user_agent" in body and "accepted_at" in body

        me = requests.get(f"{API}/terms/me", headers=_auth_headers(new_consumer["token"]))
        assert me.status_code == 200
        d = me.json()
        assert "acceptances" in d and "accepted_current" in d
        assert d["accepted_current"]["terms"] is True

    def test_accept_unknown_doc_400(self, new_consumer):
        r = requests.post(
            f"{API}/terms/accept",
            headers=_auth_headers(new_consumer["token"]),
            json={"doc_id": "unknown_doc", "version": "1.0"},
        )
        # Pydantic Literal validates → 422; server-side check would 400. Accept either.
        assert r.status_code in (400, 422)

    def test_accept_requires_auth(self):
        r = requests.post(
            f"{API}/terms/accept",
            json={"doc_id": "terms", "version": "1.0"},
        )
        assert r.status_code in (401, 403)


class TestAdminTermsAudit:
    def test_admin_audit_list(self, admin_token, new_consumer):
        # Seed an acceptance
        requests.post(
            f"{API}/terms/accept",
            headers=_auth_headers(new_consumer["token"]),
            json={"doc_id": "privacy", "version": "1.0", "context": "supplier_apply"},
        )
        r = requests.get(f"{API}/admin/terms/audit", headers=_auth_headers(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "acceptances" in body and "total" in body
        assert any(a["user_id"] == new_consumer["user_id"] for a in body["acceptances"])

    def test_audit_filter_doc_and_user(self, admin_token, new_consumer):
        requests.post(
            f"{API}/terms/accept",
            headers=_auth_headers(new_consumer["token"]),
            json={"doc_id": "terms", "version": "1.0", "context": "filter_test"},
        )
        r = requests.get(
            f"{API}/admin/terms/audit?doc_id=terms&user_id={new_consumer['user_id']}",
            headers=_auth_headers(admin_token),
        )
        assert r.status_code == 200
        for a in r.json()["acceptances"]:
            assert a["doc_id"] == "terms"
            assert a["user_id"] == new_consumer["user_id"]

    def test_audit_non_admin_forbidden(self, new_consumer):
        r = requests.get(f"{API}/admin/terms/audit", headers=_auth_headers(new_consumer["token"]))
        assert r.status_code == 403
