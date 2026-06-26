"""Tests for the Regional Wave auto-respawn lifecycle (leftover stock → follow-on wave)."""
from datetime import datetime
from zoneinfo import ZoneInfo

from routes.waves import (
    _next_creation_time_london,
    _respawn_schedule,
    _compute_remaining_products,
    _build_respawn_doc,
)

LON = ZoneInfo("Europe/London")


def test_respawn_immediate_during_working_hours():
    # Mon 2026-06-15 10:00 (working day, ≥08:30) → immediate (None)
    assert _respawn_schedule(datetime(2026, 6, 15, 10, 0, tzinfo=LON)) is None
    # Sat 2026-06-13 11:00 is now a working day → immediate
    assert _respawn_schedule(datetime(2026, 6, 13, 11, 0, tzinfo=LON)) is None


def test_respawn_before_open_schedules_today_0830():
    r = _respawn_schedule(datetime(2026, 6, 15, 7, 0, tzinfo=LON))  # Mon 07:00
    assert r.day == 15 and (r.hour, r.minute) == (8, 30)


def test_respawn_sunday_schedules_next_working_day():
    r = _respawn_schedule(datetime(2026, 6, 14, 12, 0, tzinfo=LON))  # Sunday
    assert r.weekday() == 0 and (r.hour, r.minute) == (8, 30)  # Monday 08:30


def test_respawn_bank_holiday_schedules_next_working_day():
    # Good Friday 2026-04-03 (bank holiday) → next working day Sat 2026-04-04 08:30
    r = _respawn_schedule(datetime(2026, 4, 3, 10, 0, tzinfo=LON))
    assert r.day == 4 and (r.hour, r.minute) == (8, 30)


def test_creation_time_is_following_working_day_0830():
    # Mon 2026-06-08 10:00 → next working day Tue 2026-06-09 08:30
    r = _next_creation_time_london(datetime(2026, 6, 8, 10, 0, tzinfo=LON))
    assert r.day == 9 and r.weekday() == 1 and (r.hour, r.minute) == (8, 30)


def test_creation_time_friday_rolls_to_saturday_working_day():
    # Sat is now a working day → Fri 2026-06-12 → Sat 2026-06-13 08:30
    r = _next_creation_time_london(datetime(2026, 6, 12, 17, 0, tzinfo=LON))
    assert r.weekday() == 5 and (r.hour, r.minute) == (8, 30)  # Saturday


def test_creation_time_saturday_skips_sunday_to_monday():
    # Sat 2026-06-13 → Sun excluded → Mon 2026-06-15 08:30
    r = _next_creation_time_london(datetime(2026, 6, 13, 11, 0, tzinfo=LON))
    assert r.weekday() == 0 and r.day == 15 and (r.hour, r.minute) == (8, 30)


def test_creation_time_skips_uk_bank_holiday():
    # Thu 2026-04-02 → Fri 2026-04-03 is Good Friday (bank holiday) → Sat 2026-04-04
    r = _next_creation_time_london(datetime(2026, 4, 2, 10, 0, tzinfo=LON))
    assert r.day == 4 and r.weekday() == 5 and (r.hour, r.minute) == (8, 30)


def test_remaining_products_only_unsold_stock():
    wave = {"products": [
        {"product_id": "p1", "model": "M", "variants": [
            {"variant_id": "v1", "label": "A", "supplier_cost": 1, "retail_price": 3, "wave_price": 2, "inventory_qty": 10, "sold_qty": 4},
            {"variant_id": "v2", "label": "B", "supplier_cost": 1, "retail_price": 3, "wave_price": 2, "inventory_qty": 5, "sold_qty": 5},
        ]},
    ]}
    products, total = _compute_remaining_products(wave)
    assert total == 6  # 6 left on v1, 0 on v2 (excluded)
    assert len(products) == 1 and len(products[0]["variants"]) == 1
    assert products[0]["variants"][0]["inventory_qty"] == 6
    assert products[0]["variants"][0]["sold_qty"] == 0


def test_build_respawn_doc_increments_round_and_caps_targets():
    wave = {
        "wave_id": "wave_orig", "supplier_id": "sup_1", "category": "electronics",
        "region_id": "r1", "region_name": "Coventry", "brand": "Sony",
        "title": "Coventry Sony Electronics Wave", "min_activation": 20, "round": 1,
    }
    products = [{"product_id": "p", "model": "M", "variants": [
        {"variant_id": "v", "label": "A", "supplier_cost": 1, "retail_price": 3, "wave_price": 2, "inventory_qty": 6, "reserved_qty": 0, "sold_qty": 0}
    ]}]
    doc = _build_respawn_doc(wave, products, 6)
    assert doc["round"] == 2
    assert doc["ideal_target"] == 6
    assert doc["min_activation"] == 6  # capped to remaining (was 20)
    assert doc["origin_wave_id"] == "wave_orig"
    assert doc["parent_wave_id"] == "wave_orig"
    assert "Round 2" in doc["title"]
    assert doc["state"] == "open"
