#!/usr/bin/env python3
"""Smoke check for core POS workflows requested by operations.

Covers:
- staff scan page availability
- staff console availability
- menu availability via API
- customer order creation
- staff order acceptance
- checkout flow completion
"""

from __future__ import annotations

import os
import tempfile

import db
from app import app


def assert_status(response, expected: int, label: str) -> None:
    if response.status_code != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, got {response.status_code}, body={response.get_data(as_text=True)}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pos-smoke-") as tmp:
        db.DB_FILE = os.path.join(tmp, "pos_local.sqlite3")
        db.ensure_db_exists()

        client = app.test_client()

        staff_scan = client.get("/scan/staff")
        assert_status(staff_scan, 200, "scan staff page")

        staff_page = client.get("/staff")
        assert_status(staff_page, 200, "staff page")

        data = client.get("/api/data", environ_overrides={"REMOTE_ADDR": "127.0.0.1"})
        assert_status(data, 200, "api data")
        payload = data.get_json()
        if not payload or not payload.get("menu"):
            raise AssertionError("menu is empty")

        create_order = client.post(
            "/api/order",
            json={
                "target": "table",
                "target_id": 1,
                "source": "customer",
                "cart": [{"id": 1, "name": "เนื้อใบพายพรีเมียม", "price": 150, "qty": 2}],
            },
        )
        assert_status(create_order, 200, "create order")
        order_json = create_order.get_json() or {}
        order_id = order_json.get("order", {}).get("id")
        if not order_id:
            raise AssertionError("create order did not return order id")

        accept = client.post("/api/table/accept", json={"order_id": order_id})
        assert_status(accept, 200, "accept order")

        checkout = client.post(
            "/api/checkout",
            json={"target": "table", "target_id": 1, "payment_method": "cash"},
        )
        assert_status(checkout, 200, "checkout")

    print("SYSTEM READY: scan/staff/menu/order/checkout smoke checks passed.")


if __name__ == "__main__":
    main()
