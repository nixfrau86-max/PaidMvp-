"""One customer per garage+fitting-slot: a slot taken by an active wave
reservation must disappear from the slot list and reject a second joiner.
Per-slot capacity (bays): a garage with capacity N allows N fittings per slot."""
import os
import uuid
import asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


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


def _session(creds):
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json=creds, timeout=30).status_code == 200
    return s


def _new_consumer():
    s = requests.Session()
    email = f"TEST_slot_{uuid.uuid4().hex[:8]}@test.co"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "TestPass123", "name": "SlotTester"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return s


def _verified_garage_id():
    # public list returns active garages; pick one that yields slots
    gs = requests.get(f"{API}/garages", timeout=30).json()
    return gs[0]["garage_id"]


def test_one_customer_per_garage_slot():
    sup = _session(SUPPLIER)
    a, b = _new_consumer(), _new_consumer()
    gid = _verified_garage_id()

    # find an available slot >= 2 lead days out
    slots = requests.get(f"{API}/garages/{gid}/slots?days=12&min_lead_days=2", timeout=30).json()
    day = next((d for d in slots["days"] if d["slots"]), None)
    assert day, "garage should expose at least one open slot"
    slot_iso = day["slots"][0]["slot_iso"]

    # supplier creates a tyres wave
    payload = {
        "category": "tyres", "region_id": requests.get(f"{API}/regions", timeout=30).json()[0]["region_id"],
        "brand": "TestTyre", "title": f"TEST_SLOT_{uuid.uuid4().hex[:6]}",
        "ideal_target": 10, "min_activation": 2, "deadline_days": 30,
        "products": [{"model": "GripX", "variants": [{
            "label": "205/55 R16", "supplier_cost": 40, "retail_price": 90, "wave_price": 65, "inventory_qty": 10,
        }]}],
    }
    r = sup.post(f"{API}/supplier/waves", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    wave = r.json(); wid = wave["wave_id"]
    prod = wave["products"][0]; var = prod["variants"][0]
    join = lambda sess: sess.post(f"{API}/waves/{wid}/join", json={
        "items": [{"product_id": prod["product_id"], "variant_id": var["variant_id"], "qty": 1}],
        "accept_terms": True, "garage_id": gid, "fitting_slot_iso": slot_iso,
        "fitting_slot_label": day["slots"][0]["label"],
    }, timeout=30)

    try:
        # consumer A grabs the slot
        ra = join(a)
        assert ra.status_code == 200, ra.text

        # the slot must no longer be offered for that garage
        slots2 = requests.get(f"{API}/garages/{gid}/slots?days=12&min_lead_days=2", timeout=30).json()
        all_isos = {s["slot_iso"] for d in slots2["days"] for s in d["slots"]}
        assert slot_iso not in all_isos, "a held slot must be removed from the available list"

        # consumer B cannot take the same garage+slot
        rb = join(b)
        assert rb.status_code == 409, rb.text
        assert "slot" in rb.text.lower()
    finally:
        sup.delete(f"{API}/supplier/waves/{wid}", timeout=30)


def _set_capacity(gid, cap):
    """Directly set a garage's per-slot capacity; returns the prior doc (or None)."""
    async def _do():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        prior = await db.garage_availability.find_one({"garage_id": gid}, {"_id": 0})
        weekly = (prior or {}).get("weekly") or {d: ([{"start": "09:00", "end": "17:00"}] if d not in ("sat", "sun") else []) for d in WEEKDAYS}
        await db.garage_availability.update_one(
            {"garage_id": gid},
            {"$set": {"weekly": weekly, "overrides": (prior or {}).get("overrides", {}),
                      "slot_minutes": (prior or {}).get("slot_minutes", 30), "slot_capacity": cap}},
            upsert=True,
        )
        c.close()
        return prior
    return asyncio.run(_do())


def _restore_capacity(gid, prior):
    async def _do():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        if prior is None:
            await db.garage_availability.delete_one({"garage_id": gid})
        else:
            await db.garage_availability.update_one({"garage_id": gid}, {"$set": prior}, upsert=True)
        c.close()
    asyncio.run(_do())


def test_per_slot_capacity_allows_multiple_until_full():
    sup = _session(SUPPLIER)
    a, b, cc = _new_consumer(), _new_consumer(), _new_consumer()
    gid = _verified_garage_id()
    prior = _set_capacity(gid, 2)
    wid = None
    try:
        slots = requests.get(f"{API}/garages/{gid}/slots?days=12&min_lead_days=2", timeout=30).json()
        day = next((d for d in slots["days"] if d["slots"]), None)
        assert day, "garage should expose at least one open slot"
        slot = day["slots"][0]
        assert slot["capacity"] == 2 and slot["remaining"] == 2

        payload = {
            "category": "tyres", "region_id": requests.get(f"{API}/regions", timeout=30).json()[0]["region_id"],
            "brand": "CapTyre", "title": f"TEST_CAP_{uuid.uuid4().hex[:6]}",
            "ideal_target": 10, "min_activation": 2, "deadline_days": 30,
            "products": [{"model": "GripX", "variants": [{
                "label": "205/55 R16", "supplier_cost": 40, "retail_price": 90, "wave_price": 65, "inventory_qty": 10,
            }]}],
        }
        wave = sup.post(f"{API}/supplier/waves", json=payload, timeout=30).json()
        wid = wave["wave_id"]
        prod = wave["products"][0]; var = prod["variants"][0]
        join = lambda sess: sess.post(f"{API}/waves/{wid}/join", json={
            "items": [{"product_id": prod["product_id"], "variant_id": var["variant_id"], "qty": 1}],
            "accept_terms": True, "garage_id": gid, "fitting_slot_iso": slot["slot_iso"],
            "fitting_slot_label": slot["label"],
        }, timeout=30)

        # two members can share the same slot (2 bays)
        assert join(a).status_code == 200
        # after one booking the slot shows 1 remaining (still offered)
        s2 = requests.get(f"{API}/garages/{gid}/slots?days=12&min_lead_days=2", timeout=30).json()
        match = next((s for d in s2["days"] for s in d["slots"] if s["slot_iso"] == slot["slot_iso"]), None)
        assert match and match["remaining"] == 1
        assert join(b).status_code == 200
        # now full → removed from the list
        s3 = requests.get(f"{API}/garages/{gid}/slots?days=12&min_lead_days=2", timeout=30).json()
        assert slot["slot_iso"] not in {s["slot_iso"] for d in s3["days"] for s in d["slots"]}
        # third member is rejected
        rc = join(cc)
        assert rc.status_code == 409, rc.text
    finally:
        if wid:
            sup.delete(f"{API}/supplier/waves/{wid}", timeout=30)
        _restore_capacity(gid, prior)

