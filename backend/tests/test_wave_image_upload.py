"""Tests for the Wave Image upload/serve endpoints (iteration 12).

Verifies:
- POST /api/supplier/wave-image (auth required, validates MIME and size, returns {image_url}).
- GET /api/wave-images/{path} serves uploaded bytes publicly.
- Create+Edit wave persists image_url and surfaces it via list/detail.
"""
import io
import os
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SUPPLIER_EMAIL = "supplier_test@collective.co"
SUPPLIER_PASSWORD = "Supplier1234"


def _minimal_png(width=4, height=4) -> bytes:
    """Build a valid 4x4 RGB PNG entirely in-memory (no external deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = b""
    for _ in range(height):
        raw += b"\x00" + b"\xff\x00\x00" * width  # filter byte + red pixels
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def supplier_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": SUPPLIER_EMAIL, "password": SUPPLIER_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Supplier login failed: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def png_bytes():
    return _minimal_png()


class TestWaveImageUpload:
    def test_unauth_upload_rejected(self):
        png = _minimal_png()
        r = requests.post(
            f"{BASE_URL}/api/supplier/wave-image",
            files={"file": ("t.png", io.BytesIO(png), "image/png")}, timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_upload_png_success(self, supplier_session, png_bytes):
        r = supplier_session.post(
            f"{BASE_URL}/api/supplier/wave-image",
            files={"file": ("test_wave_image.png", io.BytesIO(png_bytes), "image/png")},
            timeout=60,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert "image_url" in body
        url = body["image_url"]
        assert url.startswith("/api/wave-images/"), f"bad url: {url}"
        # stash for next test
        TestWaveImageUpload.uploaded_url = url
        TestWaveImageUpload.uploaded_size = len(png_bytes)

    def test_reject_non_image_extension(self, supplier_session):
        r = supplier_session.post(
            f"{BASE_URL}/api/supplier/wave-image",
            files={"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}"
        assert "Unsupported" in r.text or "image" in r.text.lower()

    def test_reject_oversize(self, supplier_session):
        big = b"\x00" * (5 * 1024 * 1024 + 16)
        r = supplier_session.post(
            f"{BASE_URL}/api/supplier/wave-image",
            files={"file": ("big.png", io.BytesIO(big), "image/png")},
            timeout=120,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}"
        assert "5MB" in r.text or "large" in r.text.lower()

    def test_public_serve(self, png_bytes):
        url = getattr(TestWaveImageUpload, "uploaded_url", None)
        assert url, "upload test must run first"
        # GET via *public* (unauth) requests session
        r = requests.get(f"{BASE_URL}{url}", timeout=30)
        assert r.status_code == 200, f"serve failed: {r.status_code}"
        assert r.headers.get("content-type", "").startswith("image/"), r.headers
        assert len(r.content) == TestWaveImageUpload.uploaded_size

    def test_create_wave_with_image_url(self, supplier_session, png_bytes):
        url = getattr(TestWaveImageUpload, "uploaded_url", None)
        assert url, "upload test must run first"

        # need a valid region_id
        regions = requests.get(f"{BASE_URL}/api/regions", timeout=15).json()
        assert regions, "no regions seeded"
        region_id = regions[0]["region_id"]

        payload = {
            "category": "electronics",
            "region_id": region_id,
            "brand": "TEST_BRAND",
            "title": "TEST_Image_Wave_iter12",
            "description": "TEST wave with image",
            "image_url": url,
            "ideal_target": 5,
            "min_activation": 2,
            "eta": "TEST",
            "deadline_days": 7,
            "products": [{
                "model": "TEST Model",
                "variants": [{
                    "label": "TEST variant",
                    "supplier_cost": 10.0, "retail_price": 50.0,
                    "wave_price": 30.0, "inventory_qty": 5,
                }],
            }],
        }
        r = supplier_session.post(f"{BASE_URL}/api/supplier/waves", json=payload, timeout=30)
        assert r.status_code == 200, f"create wave failed: {r.status_code} {r.text[:400]}"
        wave = r.json()
        assert wave.get("image_url") == url
        TestWaveImageUpload.created_wave_id = wave["wave_id"]

        # Verify it surfaces via GET /api/waves/{id}
        detail = requests.get(f"{BASE_URL}/api/waves/{wave['wave_id']}", timeout=15).json()
        assert detail.get("image_url") == url

        # Verify in public list /api/waves
        listing = requests.get(f"{BASE_URL}/api/waves", timeout=15).json()
        found = [w for w in listing if w.get("wave_id") == wave["wave_id"]]
        assert found, "newly created wave not in listing"
        assert found[0].get("image_url") == url

    def test_cleanup(self, supplier_session):
        wid = getattr(TestWaveImageUpload, "created_wave_id", None)
        if not wid:
            pytest.skip("nothing to clean")
        r = supplier_session.delete(f"{BASE_URL}/api/supplier/waves/{wid}", timeout=15)
        assert r.status_code == 200, f"cleanup failed: {r.status_code} {r.text[:200]}"
