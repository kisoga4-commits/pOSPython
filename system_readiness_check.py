#!/usr/bin/env python3
"""Smoke check for core POS workflows requested by operations.

Covers:
- staff scan page availability
- customer scan page availability
- mobile viewport hints in UI templates
- menu availability via API
- customer live data updates/version increments
- customer order creation
- staff order acceptance
- checkout flow completion
"""

from __future__ import annotations

import os
import tempfile
import base64
import io

import db
from app import app, build_table_token
from PIL import Image


def assert_status(response, expected: int, label: str) -> None:
    if response.status_code != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, got {response.status_code}, body={response.get_data(as_text=True)}")


def assert_contains(text: str, expected: str, label: str) -> None:
    if expected not in text:
        raise AssertionError(f"{label}: expected to find '{expected}'")


def assert_version_increased(new_version: int, previous_version: int, label: str) -> None:
    if int(new_version) <= int(previous_version):
        raise AssertionError(f"{label}: version did not increase (prev={previous_version}, new={new_version})")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pos-smoke-") as tmp:
        db.DB_FILE = os.path.join(tmp, "pos_local.sqlite3")
        db.ensure_db_exists()

        client = app.test_client()

        staff_scan = client.get("/scan/staff")
        assert_status(staff_scan, 302, "scan staff page redirect")
        location = staff_scan.headers.get("Location", "")
        if "/?mode=scanner" not in location:
            raise AssertionError(f"scan staff redirect target is unexpected: {location}")

        scanner_page = client.get("/scan/staff", follow_redirects=True)
        assert_status(scanner_page, 200, "scan staff landing page")
        assert_contains(scanner_page.get_data(as_text=True), 'name="viewport"', "scan staff mobile viewport")

        staff_page = client.get("/staff")
        assert_status(staff_page, 200, "staff page")
        assert_contains(staff_page.get_data(as_text=True), 'name="viewport"', "staff mobile viewport")

        data = client.get(
            "/api/data",
            headers={"X-POS-Role": "staff"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(data, 200, "api data")
        payload = data.get_json()
        if not payload or not payload.get("menu"):
            raise AssertionError("menu is empty")
        base_version = int(payload.get("meta", {}).get("version", 0))

        table_token = build_table_token(payload["tables"][0])
        if not table_token:
            raise AssertionError("table token cannot be built")

        customer_scan = client.get("/scan/customer/1")
        assert_status(customer_scan, 200, "scan customer page")
        assert_contains(customer_scan.get_data(as_text=True), 'name="viewport"', "scan customer mobile viewport")

        # PromptPay setting should be persisted and available to UI checks.
        save_settings = client.post(
            "/api/settings",
            headers={"X-POS-Role": "owner"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
            json={"settings": {"promptPay": "0812345678"}},
        )
        assert_status(save_settings, 200, "save promptpay setting")

        data_after_promptpay = client.get(
            "/api/data",
            headers={"X-POS-Role": "owner"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(data_after_promptpay, 200, "api data after promptpay")
        if str((data_after_promptpay.get_json() or {}).get("settings", {}).get("promptPay", "")).strip() != "0812345678":
            raise AssertionError("promptpay setting was not persisted correctly")

        # Uploaded menu image should be normalized into square WEBP (420x420).
        sample_image = Image.new("RGB", (1200, 400), (255, 60, 60))
        sample_io = io.BytesIO()
        sample_image.save(sample_io, format="PNG")
        sample_data_url = f"data:image/png;base64,{base64.b64encode(sample_io.getvalue()).decode('utf-8')}"
        upload_image = client.post(
            "/api/menu/upload-image",
            headers={"X-POS-Role": "owner"},
            json={"image": sample_data_url},
        )
        assert_status(upload_image, 200, "menu image normalize")
        upload_payload = upload_image.get_json() or {}
        normalized_data_url = str(upload_payload.get("image", ""))
        if not normalized_data_url.startswith("data:image/webp;base64,"):
            raise AssertionError("menu image normalize did not return webp data URL")
        normalized_binary = base64.b64decode(normalized_data_url.split(",", 1)[1])
        normalized_image = Image.open(io.BytesIO(normalized_binary))
        if normalized_image.width != 420 or normalized_image.height != 420:
            raise AssertionError(
                f"normalized menu image should be 420x420, got {normalized_image.width}x{normalized_image.height}"
            )

        customer_with_token = client.get(f"/customer?t={table_token}")
        assert_status(customer_with_token, 200, "customer token page")
        assert_contains(customer_with_token.get_data(as_text=True), 'name="viewport"', "customer page mobile viewport")

        customer_live_initial = client.get(f"/api/customer/live?table_id=1&since={base_version - 1}")
        assert_status(customer_live_initial, 200, "customer live initial")
        customer_live_initial_payload = customer_live_initial.get_json() or {}
        if not customer_live_initial_payload.get("changed"):
            raise AssertionError("customer live should indicate changed on initial pull")

        create_order = client.post(
            "/api/order",
            headers={"X-POS-Role": "customer"},
            json={
                "target": "table",
                "target_id": 1,
                "table_token": table_token,
                "source": "customer",
                "cart": [{"id": 1, "name": "เนื้อใบพายพรีเมียม", "price": 150, "qty": 2}],
            },
        )
        assert_status(create_order, 200, "create order")
        order_json = create_order.get_json() or {}
        order_id = order_json.get("order", {}).get("id")
        if not order_id:
            raise AssertionError("create order did not return order id")
        version_after_order = int(order_json.get("version", 0))
        assert_version_increased(version_after_order, base_version, "version after customer order")

        customer_live_after_order = client.get(f"/api/customer/live?t={table_token}&since={base_version}")
        assert_status(customer_live_after_order, 200, "customer live after order")
        live_after_order_payload = customer_live_after_order.get_json() or {}
        if not live_after_order_payload.get("changed"):
            raise AssertionError("customer live did not update after order")
        if not any(order.get("id") == order_id for order in live_after_order_payload.get("orders", [])):
            raise AssertionError("customer live missing created order")

        accept = client.post("/api/table/accept", headers={"X-POS-Role": "staff"}, json={"order_id": order_id})
        assert_status(accept, 200, "accept order")
        accept_json = accept.get_json() or {}
        version_after_accept = int(accept_json.get("version", 0))
        assert_version_increased(version_after_accept, version_after_order, "version after accept")

        customer_live_after_accept = client.get(f"/api/customer/live?t={table_token}&since={version_after_order}")
        assert_status(customer_live_after_accept, 200, "customer live after accept")
        live_after_accept_payload = customer_live_after_accept.get_json() or {}
        accepted_order = next((order for order in live_after_accept_payload.get("orders", []) if order.get("id") == order_id), None)
        if accepted_order is None or accepted_order.get("status") != "accepted":
            raise AssertionError("order status was not updated to accepted in customer live")

        checkout = client.post(
            "/api/checkout",
            headers={"X-POS-Role": "staff"},
            json={"target": "table", "target_id": 1, "payment_method": "cash"},
        )
        assert_status(checkout, 200, "checkout")
        checkout_json = checkout.get_json() or {}
        version_after_checkout = int(checkout_json.get("version", 0))
        assert_version_increased(version_after_checkout, version_after_accept, "version after checkout")

        customer_live_after_checkout = client.get(f"/api/customer/live?t={table_token}&since={version_after_accept}")
        assert_status(customer_live_after_checkout, 200, "customer live after checkout")
        live_after_checkout_payload = customer_live_after_checkout.get_json() or {}
        table_state = next((table for table in live_after_checkout_payload.get("tables", []) if int(table.get("id", 0)) == 1), None)
        if table_state is None:
            raise AssertionError("customer live missing table state after checkout")
        if table_state.get("status") != "available":
            raise AssertionError(f"table should be available after checkout, got {table_state.get('status')}")

    print("SYSTEM READY: staff+customer scan, live updates, mobile UI hints, order/accept/checkout checks passed.")


if __name__ == "__main__":
    main()
