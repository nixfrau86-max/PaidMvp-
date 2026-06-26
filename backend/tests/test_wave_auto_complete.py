"""Tests for the automatic wave-completion engine (auto_complete_due_waves).

An ACTIVATED wave whose deadline has passed must auto-complete and respawn its
leftover stock — for ANY category, with no admin action. This is what makes the
auto-respawn engine actually automatic and consistent across all sections.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from routes.waves import auto_complete_due_waves

load_dotenv("/app/backend/.env")


class _FakeManager:
    async def broadcast(self, *_args, **_kwargs):
        return None


def _db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def _now():
    return datetime.now(timezone.utc)


async def _run_case(category: str):
    client, db = _db()
    tag = f"TEST_AUTOCMP_{uuid.uuid4().hex[:6]}"
    wid = f"wave_{uuid.uuid4().hex[:10]}"
    vid = f"var_{uuid.uuid4().hex[:8]}"
    sup_id = f"sup_{uuid.uuid4().hex[:8]}"
    try:
        # An activated wave whose deadline is in the PAST, inventory 10.
        await db.waves.insert_one({
            "wave_id": wid, "supplier_id": sup_id, "category": category,
            "category_label": category.title(), "region_id": "reg_test",
            "region_name": "Testshire", "brand": "AutoBrand", "title": tag,
            "description": "", "image_url": "",
            "products": [{"product_id": "prd_test", "model": "M", "variants": [{
                "variant_id": vid, "label": "A", "supplier_cost": 1, "retail_price": 3,
                "wave_price": 2, "inventory_qty": 10, "reserved_qty": 2, "sold_qty": 0,
            }]}],
            "ideal_target": 10, "min_activation": 4, "eta": "",
            "state": "activated", "units_committed": 4, "participants_count": 2,
            "created_at": _now() - timedelta(days=2),
            "activated_at": _now() - timedelta(hours=1),
            "deadline": _now() - timedelta(minutes=5),  # PAST → due
            "round": 1,
        })
        # One CAPTURED (paid, 2 units) + one RESERVED (unpaid, 2 units → carried).
        await db.wave_participations.insert_many([
            {"participation_id": f"p_{uuid.uuid4().hex[:8]}", "wave_id": wid, "category": category,
             "user_id": "u_paid", "status": "captured", "payment_status": "paid", "units": 2,
             "items": [{"product_id": "prd_test", "variant_id": vid, "qty": 2}]},
            {"participation_id": f"p_{uuid.uuid4().hex[:8]}", "wave_id": wid, "category": category,
             "user_id": "u_unpaid", "status": "reserved", "payment_status": "pending", "units": 2,
             "items": [{"product_id": "prd_test", "variant_id": vid, "qty": 2}]},
        ])

        completed = await auto_complete_due_waves(db, _FakeManager())
        assert completed >= 1, "worker should auto-complete the due activated wave"

        orig = await db.waves.find_one({"wave_id": wid}, {"_id": 0})
        assert orig["state"] == "completed"
        assert orig.get("respawned") is True

        # A follow-on round must exist EITHER live in `waves` (regenerated within
        # working hours before the cut-off) OR queued in `scheduled_waves`.
        # The new round keeps the ORIGINAL ideal target (10), not the leftover count.
        child = await db.waves.find_one({"parent_wave_id": wid}, {"_id": 0})
        if child is None:
            sched = await db.scheduled_waves.find_one({"parent_wave_id": wid}, {"_id": 0})
            assert sched is not None, "leftover stock should respawn (live or scheduled)"
            child = sched["spec"]
        assert child["category"] == category
        assert child["round"] == 2
        assert child["ideal_target"] == 10        # original target preserved
        assert child["min_activation"] == 4       # original min activation preserved
        assert child.get("carried_units") == 2  # the unpaid/reserved units carry over
        return wid
    finally:
        # cleanup
        await db.waves.delete_many({"$or": [{"wave_id": wid}, {"parent_wave_id": wid}, {"title": {"$regex": "^TEST_AUTOCMP"}}]})
        await db.wave_participations.delete_many({"wave_id": wid})
        await db.scheduled_waves.delete_many({"parent_wave_id": wid})
        client.close()


def test_auto_complete_respawns_electronics():
    asyncio.run(_run_case("electronics"))


def test_auto_complete_respawns_footwear():
    asyncio.run(_run_case("footwear"))


def test_auto_complete_respawns_custom_category():
    # arbitrary supplier "Other (specify)" slug — must work identically
    asyncio.run(_run_case("pet_supplies"))


def test_auto_complete_ignores_non_due_or_non_activated():
    async def _check():
        client, db = _db()
        wid_open = f"wave_{uuid.uuid4().hex[:10]}"
        wid_future = f"wave_{uuid.uuid4().hex[:10]}"
        try:
            await db.waves.insert_many([
                # open (not activated) past deadline → handled by expire worker, NOT this one
                {"wave_id": wid_open, "supplier_id": "sup_x", "category": "electronics",
                 "title": "TEST_AUTOCMP_open", "state": "open", "products": [],
                 "ideal_target": 10, "min_activation": 4, "round": 1,
                 "deadline": _now() - timedelta(minutes=5)},
                # activated but deadline in the FUTURE → not due
                {"wave_id": wid_future, "supplier_id": "sup_x", "category": "electronics",
                 "title": "TEST_AUTOCMP_future", "state": "activated", "products": [],
                 "ideal_target": 10, "min_activation": 4, "round": 1,
                 "activated_at": _now(), "deadline": _now() + timedelta(days=1)},
            ])
            await auto_complete_due_waves(db, _FakeManager())
            o = await db.waves.find_one({"wave_id": wid_open}, {"_id": 0})
            f = await db.waves.find_one({"wave_id": wid_future}, {"_id": 0})
            assert o["state"] == "open"          # untouched
            assert f["state"] == "activated"     # untouched
        finally:
            await db.waves.delete_many({"title": {"$regex": "^TEST_AUTOCMP"}})
            client.close()
    asyncio.run(_check())
