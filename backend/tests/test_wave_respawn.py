"""Tests for the Regional Wave auto-respawn lifecycle (leftover stock → follow-on wave)."""
from datetime import datetime
from zoneinfo import ZoneInfo

from routes.waves import (
    _next_creation_time_london,
    _compute_remaining_products,
    _build_respawn_doc,
)

LON = ZoneInfo("Europe/London")


def test_creation_time_working_day_before_4pm_is_now():
    assert _next_creation_time_london(datetime(2026, 6, 8, 10, 0, tzinfo=LON)) is None
    # before the 08:30 window opens → today 08:30 (not immediate)
    r = _next_creation_time_london(datetime(2026, 6, 8, 7, 0, tzinfo=LON))
    assert r.day == 8 and (r.hour, r.minute) == (8, 30)


def test_creation_time_past_4pm_rolls_to_next_working_day_830am():
    r = _next_creation_time_london(datetime(2026, 6, 8, 16, 30, tzinfo=LON))  # Mon 4:30pm (window closed)
    assert r.weekday() == 1 and (r.hour, r.minute) == (8, 30)  # Tue 8:30am


def test_creation_time_friday_evening_skips_weekend():
    r = _next_creation_time_london(datetime(2026, 6, 12, 17, 0, tzinfo=LON))  # Fri 5pm
    assert r.weekday() == 0 and (r.hour, r.minute) == (8, 30)  # Monday 8:30am


def test_creation_time_weekend_schedules_monday():
    r = _next_creation_time_london(datetime(2026, 6, 13, 11, 0, tzinfo=LON))  # Sat
    assert r.weekday() == 0 and (r.hour, r.minute) == (8, 30)  # Monday 8:30am


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
