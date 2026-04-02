#!/usr/bin/env python3
"""Smoke check for core POS workflows requested by operations.

Covers:
- staff scan page availability
- customer scan page availability
- mobile viewport hints in UI templates
- menu availability via API
- menu category update propagation
- customer live data updates/version increments
- customer order creation
- staff order acceptance
- checkout flow completion (cash + QR)
- online/offline QR payment readiness settings
- offline pending-order sync to master endpoint
- image normalization + compression effectiveness
"""

from __future__ import annotations

import os
import tempfile
import base64
import io
from urllib.parse import urlparse

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


def assert_true(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pos-smoke-") as tmp:
        db.DB_FILE = os.path.join(tmp, "pos_local.sqlite3")
        db.ensure_db_exists()

        client = app.test_client()

        staff_scan = client.get("/scan/staff")
        assert_status(staff_scan, 302, "scan staff page redirect")
        location = staff_scan.headers.get("Location", "")
        if not ("/?mode=scanner" in location or location.endswith("/staff")):
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
        original_menu = payload.get("menu", [])

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
            json={"settings": {"promptPay": "0812345678", "dynamicPromptPay": True}},
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
        if not bool((data_after_promptpay.get_json() or {}).get("settings", {}).get("dynamicPromptPay")):
            raise AssertionError("dynamic promptpay setting was not persisted correctly")
        staff_data_after_promptpay = client.get(
            "/api/data",
            headers={"X-POS-Role": "staff"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(staff_data_after_promptpay, 200, "staff data after promptpay")
        staff_settings = (staff_data_after_promptpay.get_json() or {}).get("settings", {})
        if any(key in staff_settings for key in ("promptPay", "dynamicPromptPay", "qrImage")):
            raise AssertionError("promptpay qr settings should not sync to staff machine payload")

        # Upload and persist offline QR image setting.
        qr_image = Image.new("RGB", (920, 320), (60, 130, 255))
        qr_io = io.BytesIO()
        qr_image.save(qr_io, format="PNG")
        qr_data_url = f"data:image/png;base64,{base64.b64encode(qr_io.getvalue()).decode('utf-8')}"
        save_offline_qr = client.post(
            "/api/settings",
            headers={"X-POS-Role": "owner"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
            json={"settings": {"dynamicPromptPay": False, "qrImage": qr_data_url}},
        )
        assert_status(save_offline_qr, 200, "save uploaded qr image setting")

        data_after_uploaded_qr = client.get(
            "/api/data",
            headers={"X-POS-Role": "owner"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(data_after_uploaded_qr, 200, "api data after uploaded qr")
        uploaded_settings = (data_after_uploaded_qr.get_json() or {}).get("settings", {})
        assert_true(bool(str(uploaded_settings.get("qrImage", "")).startswith("data:image/")), "uploaded qr image setting missing")
        assert_true(not bool(uploaded_settings.get("dynamicPromptPay")), "uploaded qr image should disable dynamic promptpay")
        staff_data_after_uploaded_qr = client.get(
            "/api/data",
            headers={"X-POS-Role": "staff"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(staff_data_after_uploaded_qr, 200, "staff data after uploaded qr")
        if any(key in ((staff_data_after_uploaded_qr.get_json() or {}).get("settings", {})) for key in ("promptPay", "dynamicPromptPay", "qrImage")):
            raise AssertionError("uploaded qr should still be excluded from staff payload")

        # Categories should update from server settings.
        updated_menu = [dict(item, category="ทดสอบหมวด") for item in original_menu]
        save_menu = client.post(
            "/api/settings",
            headers={"X-POS-Role": "owner"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
            json={"menu": updated_menu},
        )
        assert_status(save_menu, 200, "save menu categories")
        data_after_menu = client.get(
            "/api/data",
            headers={"X-POS-Role": "staff"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
        )
        assert_status(data_after_menu, 200, "api data after menu category update")
        refreshed_menu = (data_after_menu.get_json() or {}).get("menu", [])
        if not refreshed_menu or not all(str(item.get("category", "")).strip() == "ทดสอบหมวด" for item in refreshed_menu):
            raise AssertionError("menu category update was not reflected to staff data")

        # Uploaded menu image should be normalized into square WEBP (420x420).
        sample_image = Image.new("RGB", (1200, 400), (255, 60, 60))
        sample_io = io.BytesIO()
        sample_image.save(sample_io, format="PNG")
        original_binary = sample_io.getvalue()
        sample_data_url = f"data:image/png;base64,{base64.b64encode(sample_io.getvalue()).decode('utf-8')}"
        upload_image = client.post(
            "/api/menu/upload-image",
            headers={"X-POS-Role": "owner"},
            json={"image": sample_data_url},
        )
        assert_status(upload_image, 200, "menu image normalize")
        upload_payload = upload_image.get_json() or {}
        normalized_image_url = str(upload_payload.get("image", "")).strip()
        if normalized_image_url.startswith("data:image/webp;base64,"):
            normalized_binary = base64.b64decode(normalized_image_url.split(",", 1)[1])
            normalized_file_path = None
        else:
            parsed_url = urlparse(normalized_image_url)
            image_path = parsed_url.path
            if not image_path.startswith("/static/menu/") or not image_path.endswith(".webp"):
                raise AssertionError(f"menu image normalize returned unexpected URL: {normalized_image_url}")
            file_name = os.path.basename(image_path)
            normalized_file_path = os.path.join(app.static_folder or "static", "menu", file_name)
            if not os.path.isfile(normalized_file_path):
                raise AssertionError(f"normalized menu image file not found: {normalized_file_path}")
            with open(normalized_file_path, "rb") as normalized_file:
                normalized_binary = normalized_file.read()
        if len(normalized_binary) >= len(original_binary):
            raise AssertionError(
                f"menu image compressed size did not improve (original={len(original_binary)}, normalized={len(normalized_binary)})"
            )
        normalized_image_source = io.BytesIO(normalized_binary) if normalized_file_path is None else normalized_file_path
        with Image.open(normalized_image_source) as normalized_image:
            if normalized_image.format != "WEBP":
                raise AssertionError(f"normalized menu image should be WEBP, got {normalized_image.format}")
            if normalized_image.width <= 0 or normalized_image.height <= 0:
                raise AssertionError("normalized menu image dimensions are invalid")

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
        bill_after_checkout = client.get("/api/bill/table/1")
        assert_status(bill_after_checkout, 200, "bill excludes completed by default")
        bill_after_checkout_payload = bill_after_checkout.get_json() or {}
        if float(bill_after_checkout_payload.get("total", -1)) != 0:
            raise AssertionError(
                f"bill total should reset after checkout, got {bill_after_checkout_payload.get('total')}"
            )
        bill_with_completed = client.get("/api/bill/table/1?include_completed=1")
        assert_status(bill_with_completed, 200, "bill includes completed when requested")
        bill_with_completed_payload = bill_with_completed.get_json() or {}
        if float(bill_with_completed_payload.get("total", 0)) <= 0:
            raise AssertionError("bill with include_completed should contain historical paid items")

        # Create one more order to verify QR payment checkout mode.
        order_qr = client.post(
            "/api/order",
            headers={"X-POS-Role": "customer"},
            json={
                "target": "table",
                "target_id": 1,
                "table_token": table_token,
                "source": "customer",
                "cart": [{"id": 2, "name": "หมูสันคอสไลซ์", "price": 120, "qty": 1}],
            },
        )
        assert_status(order_qr, 200, "create order for qr checkout")
        qr_order_id = (order_qr.get_json() or {}).get("order", {}).get("id")
        assert_true(bool(qr_order_id), "qr checkout flow missing order id")
        accept_qr = client.post("/api/table/accept", headers={"X-POS-Role": "staff"}, json={"order_id": qr_order_id})
        assert_status(accept_qr, 200, "accept order for qr checkout")
        checkout_qr = client.post(
            "/api/checkout",
            headers={"X-POS-Role": "staff"},
            json={"target": "table", "target_id": 1, "payment_method": "qr"},
        )
        assert_status(checkout_qr, 200, "checkout qr")
        sale_record = (checkout_qr.get_json() or {}).get("sale_record", {})
        if str(sale_record.get("payment_method")) != "qr":
            raise AssertionError("sale record did not store qr payment method")

        # Offline sync (client cached order list) to master endpoint should be accepted.
        pending_sync_payload = [{
            "client_order_id": "LOCAL-001",
            "target": "table",
            "target_id": 1,
            "table_token": table_token,
            "source": "customer",
            "cart": [{"id": 1, "name": "เนื้อใบพายพรีเมียม", "price": 150, "qty": 1}],
        }]
        sync_pending = client.post("/api/sync/pending-orders", json={"pending_orders": pending_sync_payload})
        assert_status(sync_pending, 200, "sync pending orders")
        sync_result = sync_pending.get_json() or {}
        if int(sync_result.get("accepted_count", 0)) != 1:
            raise AssertionError(f"pending order sync did not accept expected items: {sync_result}")

    print(
        "SYSTEM READY: scan pages, customer/staff live sync, menu categories, QR payment "
        "(dynamic+uploaded/cash+qr checkout), offline sync, and image compression checks passed."
    )


if __name__ == "__main__":
    main()
