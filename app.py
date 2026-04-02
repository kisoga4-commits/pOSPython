import logging
import base64
import io
import importlib.util
import re
import json
import hashlib
import time
from datetime import datetime
from collections import defaultdict

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, stream_with_context, url_for

from db import ensure_db_exists, load_db, reset_tables, save_db

from security import (
    get_local_ip,
    is_server_request,
    read_json,
    require_license,
    require_roles,
    require_server_request,
)


log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

app = Flask(__name__)
ASSET_VERSION = "20260402-promptpay-fix-v6"


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,X-POS-Role"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.route("/api/<path:_any_path>", methods=["OPTIONS"])
def api_options(_any_path: str):
    return ("", 204)


def bootstrap() -> None:
    ensure_db_exists()


def run_server() -> None:
    bootstrap()
    ip_addr = get_local_ip()
    print("\n" + "=" * 75)
    print("🚀 FAKDU POS Ready")
    print(f"📡 Access Point: http://{ip_addr}:5000")
    print("=" * 75 + "\n")
    app.run(host="0.0.0.0", port=5000)


def local_now() -> str:
    return datetime.now().isoformat()


def _safe_parse_iso_datetime(value: str):
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _safe_parse_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_table_token(raw_value: str) -> tuple[int, str]:
    token = str(raw_value or "").strip()
    if len(token) < 5:
        raise ValueError("invalid_table_token")
    table_prefix = token[:-4]
    suffix = token[-4:]
    if not table_prefix.isdigit() or not suffix.isalnum():
        raise ValueError("invalid_table_token")
    table_id = int(table_prefix)
    if table_id < 1:
        raise ValueError("invalid_table_token")
    return table_id, suffix


def encode_table_token(table_id: int, suffix: str) -> str:
    return f"{int(table_id)}{str(suffix)}"


def build_table_token(table: dict) -> str:
    if not isinstance(table, dict):
        return ""
    table_id = _safe_parse_int(table.get("id"), default=0)
    suffix = str(table.get("suffix", "")).strip()
    if table_id < 1 or len(suffix) != 4 or not suffix.isalnum():
        return ""
    return encode_table_token(table_id, suffix)


def find_table_by_token(db: dict, token: str) -> dict | None:
    try:
        table_id, suffix = parse_table_token(token)
    except ValueError:
        return None
    for table in db.get("tables", []):
        if table.get("id") == table_id and str(table.get("suffix", "")) == suffix:
            return table
    return None


@app.route("/")
def index():
    scanner_mode = request.args.get("mode") == "scanner" or not is_server_request()
    local_ip = get_local_ip()
    port = request.environ.get("SERVER_PORT", "5000")
    local_base_url = f"{request.scheme}://{local_ip}:{port}"
    return render_template(
        "index.html",
        local_ip=local_ip,
        local_base_url=local_base_url,
        scanner_mode=scanner_mode,
        asset_version=ASSET_VERSION,
    )


@app.route("/api/system/network", methods=["GET"])
def api_system_network():
    local_ip = get_local_ip()
    port = request.environ.get("SERVER_PORT", "5000")
    return jsonify({
        "local_ip": local_ip,
        "base_url": f"{request.scheme}://{local_ip}:{port}",
        "request_ip": request.remote_addr,
        "is_host_request": is_server_request(),
    })


@app.route("/manifest.webmanifest")
def manifest():
    return app.send_static_file("manifest.webmanifest")


@app.route("/customer")
def customer_page():
    db = load_db()
    token = request.args.get("t", type=str)
    table_id = request.args.get("table", type=int)
    table = None
    table_token = ""
    if token:
        table = find_table_by_token(db, token)
        if table is None:
            abort(403, description="forbidden_invalid_table_token")
        table_id = int(table.get("id"))
        table_token = token
    else:
        if table_id is None or table_id < 1:
            abort(400, description="missing_or_invalid_table")
        table = next((row for row in db.get("tables", []) if row.get("id") == table_id), None)
        if table is None:
            abort(404, description="table_not_found")
        table_token = encode_table_token(table_id, str(table.get("suffix", "")))
    local_ip = get_local_ip()
    port = request.environ.get("SERVER_PORT", "5000")
    local_base_url = f"{request.scheme}://{local_ip}:{port}"
    return render_template(
        "customer.html",
        table_id=table_id,
        table_token=table_token,
        asset_version=ASSET_VERSION,
        local_base_url=local_base_url,
    )


@app.route("/scan/customer/<int:table_id>")
def customer_scan_page(table_id: int):
    db = load_db()
    table = next((row for row in db.get("tables", []) if row.get("id") == table_id), None)
    if table is None:
        abort(404, description="table_not_found")
    local_ip = get_local_ip()
    port = request.environ.get("SERVER_PORT", "5000")
    local_base_url = f"{request.scheme}://{local_ip}:{port}"
    return render_template(
        "customer.html",
        table_id=table_id,
        table_token=encode_table_token(table_id, str(table.get("suffix", ""))),
        asset_version=ASSET_VERSION,
        local_base_url=local_base_url,
    )


@app.route("/table/<int:table_id>")
def customer_table_page(table_id: int):
    db = load_db()
    table = next((row for row in db.get("tables", []) if row.get("id") == table_id), None)
    if table is None:
        abort(404, description="table_not_found")
    local_ip = get_local_ip()
    port = request.environ.get("SERVER_PORT", "5000")
    local_base_url = f"{request.scheme}://{local_ip}:{port}"
    return render_template(
        "customer.html",
        table_id=table_id,
        table_token=encode_table_token(table_id, str(table.get("suffix", ""))),
        asset_version=ASSET_VERSION,
        local_base_url=local_base_url,
    )


@app.route("/staff")
def staff_page():
    return render_template(
        "staff.html",
        asset_version=ASSET_VERSION,
        auto_staff=False,
    )


@app.route("/customer-display")
def customer_display_page():
    table_id = request.args.get("table", type=int)
    if table_id is not None:
        if table_id < 1:
            abort(400, description="missing_or_invalid_table")
        db = load_db()
        if not any(table.get("id") == table_id for table in db.get("tables", [])):
            abort(404, description="table_not_found")
    return render_template(
        "customer_display.html",
        table_id=table_id,
        asset_version=ASSET_VERSION,
    )


@app.route("/scan/staff")
def staff_scan_page():
    return redirect(url_for("staff_page"))


@app.route("/authorize-staff")
def authorize_staff_page():
    return render_template("authorize_staff.html", asset_version=ASSET_VERSION)


@app.route("/api/license", methods=["GET"])
def api_license_status():
    return jsonify({"licensed": True, "machine_id": "DISABLED"})


@app.route("/api/activate", methods=["POST"])
def api_activate():
    return jsonify({"status": "success", "message": "license_disabled"})



@app.route("/api/data", methods=["GET"])
@require_roles("owner", "staff")
def api_data():
    role = request.headers.get("X-POS-Role", "").strip().lower()
    data = load_db()
    if role != "staff":
        return jsonify(data)
    staff_safe = dict(data)
    settings = dict(staff_safe.get("settings", {}) or {})
    for sensitive_key in ("promptPay", "dynamicPromptPay", "qrImage"):
        settings.pop(sensitive_key, None)
    staff_safe["settings"] = settings
    return jsonify(staff_safe)


@app.route("/api/order", methods=["POST"])
def api_order():
    payload = read_json()
    try:
        return jsonify(_create_order(payload))
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


def _create_order(payload: dict) -> dict:
    target = str(payload.get("target", "table"))
    target_id = payload.get("target_id")
    cart = payload.get("cart", [])
    if not isinstance(cart, list):
        raise ValueError("cart must be a list")

    if not cart:
        raise ValueError("cart is empty")

    source = payload.get("source", "customer")
    db = load_db()
    if target == "table":
        if not isinstance(target_id, int):
            raise ValueError("invalid table target_id")
        table = next((item for item in db.get("tables", []) if item.get("id") == target_id), None)
        if table is None:
            raise ValueError("table not found")
        if source == "customer":
            raw_token = str(payload.get("table_token") or "").strip()
            parsed_id, parsed_suffix = parse_table_token(raw_token)
            if parsed_id != target_id or str(table.get("suffix", "")) != parsed_suffix:
                raise PermissionError("forbidden_invalid_table_token")
    order_id = f"ORD-{int(datetime.now().timestamp())}-{len(db['orders']) + 1}"
    initial_status = "request_pending" if source == "customer" else "accepted"
    normalized_cart = _normalize_cart_items(cart, db.get("menu", []))
    if not normalized_cart:
        raise ValueError("cart has no valid items")
    total_price = sum(float(item.get("price", 0)) * max(1, int(item.get("qty", 1) or 1)) for item in normalized_cart)
    if total_price <= 0:
        raise ValueError("cart total must be greater than 0")
    request_fingerprint = hashlib.sha256(json.dumps({
        "target": target,
        "target_id": target_id,
        "items": normalized_cart,
        "source": source,
    }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    if source == "customer":
        now_ts = datetime.now()
        for order in reversed(db["orders"]):
            if (
                order.get("target") == target
                and order.get("target_id") == target_id
                and order.get("source") == "customer"
                and order.get("request_fingerprint") == request_fingerprint
                and order.get("status") in {"request_pending", "accepted"}
            ):
                existing_client_id = str(order.get("client_order_id") or "").strip()
                incoming_client_id = str(payload.get("client_order_id") or "").strip()
                created_at = _safe_parse_iso_datetime(order.get("created_at"))
                is_recent_retry = False
                if created_at is not None:
                    is_recent_retry = (now_ts - created_at).total_seconds() <= 12
                if incoming_client_id and existing_client_id and incoming_client_id == existing_client_id:
                    return {"status": "success", "order": order, "version": db["meta"]["version"], "deduplicated": True}
                if is_recent_retry and not incoming_client_id and not existing_client_id:
                    return {"status": "success", "order": order, "version": db["meta"]["version"], "deduplicated": True}

    new_order = {
        "id": order_id,
        "target": target,
        "target_id": target_id,
        "items": normalized_cart,
        "total_price": total_price,
        "status": initial_status,
        "created_at": local_now(),
        "updated_at": local_now(),
        "source": source,
        "note": payload.get("note", ""),
        "client_order_id": payload.get("client_order_id"),
        "request_fingerprint": request_fingerprint,
    }
    db["orders"].append(new_order)

    if target == "table" and isinstance(target_id, int):
        for table in db["tables"]:
            if table["id"] == target_id:
                if source == "customer":
                    table["status"] = "pending_order"
                else:
                    table["status"] = "accepted_order"
                    table["items"].extend(normalized_cart)
                break

    db = save_db(db)
    return {"status": "success", "order": new_order, "version": db["meta"]["version"]}


def _refresh_table_state(db: dict, table_id: int) -> None:
    pending_exists = False
    accepted_items = []
    has_accept_or_completed = False
    for order in db["orders"]:
        if order.get("target") != "table" or order.get("target_id") != table_id:
            continue
        status = order.get("status")
        if status == "request_pending":
            pending_exists = True
        order_items = order.get("items", []) or []
        if status in {"accepted", "completed"} and order_items:
            has_accept_or_completed = True
            accepted_items.extend(order_items)

    for table in db.get("tables", []):
        if table.get("id") != table_id:
            continue
        table["status"] = "pending_order" if pending_exists else ("accepted_order" if has_accept_or_completed else "available")
        table["items"] = accepted_items if has_accept_or_completed else []
        break


def _parse_addon_option_price(raw_option: str) -> tuple[str, float]:
    option = str(raw_option or "").strip()
    if not option:
        return "", 0.0
    if "(+" in option and option.endswith(")"):
        try:
            name = option[: option.rfind("(+")].strip()
            amount = option[option.rfind("(+") + 2 : -1].strip().replace(",", ".")
            return (name or option, float(amount))
        except ValueError:
            return option, 0.0

    plus_match = re.match(r"^(.*)\+\s*([\d]+(?:[.,][\d]+)?)\s*(?:บาท|baht|฿)?\s*$", option, flags=re.IGNORECASE)
    if plus_match:
        name = plus_match.group(1).strip()
        amount = plus_match.group(2).replace(",", ".").strip()
        try:
            return (name or option, float(amount))
        except ValueError:
            return option, 0.0
    return option, 0.0


def _build_menu_lookup(menu: list) -> dict:
    lookup = {}
    for item in menu:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        item_name = str(item.get("name", "")).strip()
        if item_id is not None:
            lookup[f"id:{item_id}"] = item
        if item_name:
            lookup[f"name:{item_name.lower()}"] = item
    return lookup


def _normalize_cart_items(raw_cart: list, menu: list) -> list:
    normalized = []
    menu_lookup = _build_menu_lookup(menu)
    for item in raw_cart:
        if not isinstance(item, dict):
            continue
        try:
            qty = max(1, int(item.get("qty", 1) or 1))
        except (TypeError, ValueError):
            qty = 1
        menu_item = None
        item_id = item.get("id")
        item_name = str(item.get("name", "")).strip()
        if item_id is not None:
            menu_item = menu_lookup.get(f"id:{item_id}")
        if menu_item is None and item_name:
            menu_item = menu_lookup.get(f"name:{item_name.lower()}")

        menu_base_price = float((menu_item or {}).get("price", 0) or 0)
        fallback_price = float(item.get("base_price", item.get("price", 0)) or 0)
        base_price = menu_base_price if menu_item is not None else fallback_price
        menu_addon_prices = {}
        for option in (menu_item or {}).get("addons", []) or []:
            addon_name, addon_price = _parse_addon_option_price(option)
            if addon_name:
                menu_addon_prices[addon_name] = addon_price

        resolved_name = str((menu_item or {}).get("name", "")).strip() or item_name or "Unknown Item"
        base = {
            "id": item.get("id") if item.get("id") is not None else item.get("item_id"),
            "name": resolved_name,
            "price": base_price,
            "base_price": base_price,
            "image": str((menu_item or {}).get("image", "")).strip() or str(item.get("image", "")).strip(),
            "note": str(item.get("note", "")).strip(),
            "addon": str(item.get("addon", "")).strip(),
        }
        addons = item.get("addons", [])
        if isinstance(addons, list):
            packed_addons = []
            for addon in addons:
                if isinstance(addon, dict):
                    addon_name = str(addon.get("name", "")).strip()
                    if not addon_name:
                        continue
                    menu_addon_price = menu_addon_prices.get(addon_name)
                    packed_addons.append({
                        "name": addon_name,
                        "price": menu_addon_price if menu_addon_price is not None else float(addon.get("price", 0) or 0),
                    })
                elif isinstance(addon, str) and addon.strip():
                    addon_name = addon.strip()
                    packed_addons.append({
                        "name": addon_name,
                        "price": menu_addon_prices.get(addon_name, 0.0),
                    })
            if packed_addons:
                base["addons"] = packed_addons
                if not base["addon"]:
                    base["addon"] = ", ".join(addon["name"] for addon in packed_addons)
                base["price"] = base_price + sum(float(addon.get("price", 0) or 0) for addon in packed_addons)
        normalized.append({**base, "qty": qty})
    return normalized


@app.route("/api/ping", methods=["GET"])
def api_ping():
    return jsonify({"status": "ok", "server_time": local_now()})


@app.route("/api/sync/pending-orders", methods=["POST"])
def api_sync_pending_orders():
    payload = read_json()
    pending_orders = payload.get("pending_orders", [])
    if not isinstance(pending_orders, list):
        return jsonify({"error": "invalid_pending_orders"}), 400

    accepted = []
    for order_payload in pending_orders:
        try:
            result = _create_order(order_payload)
            accepted.append({
                "client_order_id": order_payload.get("client_order_id"),
                "server_order_id": result["order"]["id"],
            })
        except Exception:
            continue
    return jsonify({"status": "success", "accepted": accepted, "accepted_count": len(accepted)})


@app.route("/api/checkout", methods=["POST"])
@require_roles("owner", "staff")
def api_checkout():
    payload = read_json()
    target = str(payload.get("target", "table"))
    target_id = payload.get("target_id")
    payment_method = str(payload.get("payment_method", "cash")).lower()
    if payment_method not in {"cash", "qr"}:
        payment_method = "cash"

    db = load_db()
    pending_items = []
    had_pending_requests = False
    for order in db["orders"]:
        if order["target"] == target and order["target_id"] == target_id and order["status"] == "accepted":
            order["status"] = "completed"
            order["updated_at"] = local_now()
            pending_items.extend(order["items"])
        elif order["target"] == target and order["target_id"] == target_id and order["status"] == "request_pending":
            order["status"] = "cancelled"
            order["updated_at"] = local_now()
            had_pending_requests = True

    if not pending_items:
        return jsonify({"error": "nothing_to_checkout"}), 409

    total = sum(float(item.get("price", 0)) * max(1, int(item.get("qty", 1) or 1)) for item in pending_items)
    sale_record = {
        "id": f"SALE-{int(datetime.now().timestamp())}",
        "target": target,
        "target_id": target_id,
        "items": pending_items,
        "total": total,
        "payment_method": payment_method,
        "paid_at": local_now(),
    }
    db["sales"].append(sale_record)

    if target == "table" and isinstance(target_id, int):
        for table in db["tables"]:
            if table["id"] == target_id:
                table["status"] = "available"
                table["items"] = []
                table["call_staff_status"] = "idle"
                table["call_staff_requested_at"] = ""
                table["call_staff_ack_at"] = ""
                if had_pending_requests:
                    table["last_order_event"] = "checkout_cleared_pending"
                    table["last_order_event_at"] = local_now()
                break

    db = save_db(db)
    return jsonify({"status": "success", "sale_record": sale_record, "version": db["meta"]["version"]})


@app.route("/api/bill/<string:target>/<int:target_id>", methods=["GET"])
@require_license
def api_bill(target: str, target_id: int):
    db = load_db()
    include_completed = str(request.args.get("include_completed", "0")).strip().lower() in {"1", "true", "yes"}
    allowed_statuses = {"accepted", "completed"} if include_completed else {"accepted"}
    orders = [
        order for order in db["orders"]
        if order["target"] == target and order["target_id"] == target_id and order["status"] in allowed_statuses
    ]
    items = []
    first_created = None
    for order in orders:
        created_at = order.get("created_at")
        if created_at and (first_created is None or created_at < first_created):
            first_created = created_at
        for idx, item in enumerate(order.get("items", [])):
            items.append({
                "order_id": order["id"],
                "item_index": idx,
                "name": item.get("name", "-"),
                "price": float(item.get("price", 0)),
                "qty": max(1, int(item.get("qty", 1) or 1)),
                "image": item.get("image", ""),
                "addon": item.get("addon", ""),
            })
    total = sum(i["price"] * i["qty"] for i in items)
    return jsonify({
        "target": target,
        "target_id": target_id,
        "items": items,
        "total": total,
        "opened_at": first_created,
        "version": db["meta"]["version"],
    })


@app.route("/api/order/item", methods=["DELETE"])
@require_license
@require_roles("owner")
def api_order_item():
    payload = read_json()
    order_id = payload.get("order_id")
    item_index = payload.get("item_index")
    if not isinstance(item_index, int):
        return jsonify({"error": "invalid item_index"}), 400

    db = load_db()
    for order in db["orders"]:
        if order["id"] != order_id:
            continue
        items = order.get("items", [])
        if item_index < 0 or item_index >= len(items):
            return jsonify({"error": "item not found"}), 404

        if not is_server_request():
            return jsonify({"error": "host_machine_only"}), 403
        items.pop(item_index)

        order["items"] = items
        if not items:
            order["status"] = "cancelled"
        order["updated_at"] = local_now()

        if order["target"] == "table" and isinstance(order.get("target_id"), int):
            _refresh_table_state(db, order["target_id"])

        db = save_db(db)
        return jsonify({"status": "success", "version": db["meta"]["version"]})

    return jsonify({"error": "order not found"}), 404


@app.route("/api/menu/upload-image", methods=["POST"])
@require_license
@require_roles("owner")
def api_menu_upload_image():
    if importlib.util.find_spec("PIL") is None:
        return jsonify({"error": "missing_dependency_pillow"}), 503

    from PIL import Image

    payload = read_json()
    raw_image = str(payload.get("image", ""))
    if not raw_image.startswith("data:image/"):
        return jsonify({"error": "invalid_image"}), 400
    try:
        header, encoded = raw_image.split(",", 1)
        binary = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(binary)).convert("RGB")
    except Exception:
        return jsonify({"error": "decode_failed"}), 400

    max_width = 500
    if image.width > max_width:
        ratio = max_width / float(image.width)
        new_size = (max_width, int(image.height * ratio))
        image = image.resize(new_size, Image.Resampling.LANCZOS)

    out = io.BytesIO()
    image.save(out, format="WEBP", optimize=True, quality=62, method=6)
    compressed = base64.b64encode(out.getvalue()).decode("utf-8")
    return jsonify({"status": "success", "image": f"data:image/webp;base64,{compressed}"})


@app.route("/api/table/accept", methods=["POST"])
@require_license
@require_roles("owner", "staff")
def api_table_accept():
    payload = read_json()
    order_id = payload.get("order_id")
    if not isinstance(order_id, str) or not order_id.strip():
        return jsonify({"error": "invalid order_id"}), 400

    db = load_db()
    touched_order = None
    table_id = None
    for order in db["orders"]:
        if order["id"] != order_id:
            continue
        if order["status"] == "accepted":
            return jsonify({"status": "already_confirmed", "version": db["meta"]["version"]})
        if order["status"] != "request_pending":
            return jsonify({"error": "request_not_pending"}), 409
        if order["target"] != "table" or not isinstance(order.get("target_id"), int):
            return jsonify({"error": "invalid_target"}), 400
        table_id = order["target_id"]
        order["status"] = "accepted"
        order["updated_at"] = local_now()
        touched_order = order
        break

    if touched_order is None:
        return jsonify({"error": "order_not_found"}), 404

    has_pending_request = False
    accepted_items = []
    for order in db["orders"]:
        if order.get("target") != "table" or order.get("target_id") != table_id:
            continue
        if order.get("status") == "request_pending":
            has_pending_request = True
        if order.get("status") in {"accepted", "completed"}:
            accepted_items.extend(order.get("items", []))

    for table in db["tables"]:
        if table["id"] == table_id:
            table["status"] = "pending_order" if has_pending_request else "accepted_order"
            table["items"] = accepted_items
            table["last_order_event"] = "accepted"
            table["last_order_event_at"] = local_now()
            break

    db = save_db(db)
    return jsonify({"status": "success", "order_id": order_id, "version": db["meta"]["version"]})


@app.route("/api/table/reject", methods=["POST"])
@require_license
@require_roles("owner", "staff")
def api_table_reject():
    payload = read_json()
    order_id = payload.get("order_id")
    if not isinstance(order_id, str) or not order_id.strip():
        return jsonify({"error": "invalid order_id"}), 400

    db = load_db()
    table_id = None
    touched = False
    for order in db["orders"]:
        if order["id"] != order_id:
            continue
        if order["status"] == "cancelled":
            return jsonify({"status": "already_rejected", "version": db["meta"]["version"]})
        if order["status"] != "request_pending":
            return jsonify({"error": "request_not_pending"}), 409
        order["status"] = "cancelled"
        order["updated_at"] = local_now()
        table_id = order.get("target_id")
        touched = True
        break

    if not touched:
        return jsonify({"error": "order_not_found"}), 404

    pending_exists = any(
        order.get("target") == "table" and order.get("target_id") == table_id and order.get("status") == "request_pending"
        for order in db["orders"]
    )
    accepted_exists = any(
        order.get("target") == "table" and order.get("target_id") == table_id and order.get("status") in {"accepted", "completed"}
        for order in db["orders"]
    )
    for table in db["tables"]:
        if table["id"] == table_id:
            if pending_exists:
                table["status"] = "pending_order"
            elif accepted_exists:
                table["status"] = "accepted_order"
            else:
                table["status"] = "available"
                table["items"] = []
            table["last_order_event"] = "rejected"
            table["last_order_event_at"] = local_now()
            break

    db = save_db(db)
    return jsonify({"status": "success", "order_id": order_id, "version": db["meta"]["version"]})


@app.route("/api/table/call-staff", methods=["POST"])
@require_license
@require_roles("customer")
def api_table_call_staff():
    payload = read_json()
    table_id = payload.get("table_id")
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400

    db = load_db()
    for table in db["tables"]:
        if table["id"] == table_id:
            table["call_staff_status"] = "requested"
            table["call_staff_requested_at"] = local_now()
            table["call_staff_ack_at"] = ""
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "table not found"}), 404


@app.route("/api/table/call-staff/ack", methods=["POST"])
@require_license
@require_roles("owner", "staff")
def api_table_call_staff_ack():
    payload = read_json()
    table_id = payload.get("table_id")
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400

    db = load_db()
    for table in db["tables"]:
        if table["id"] == table_id:
            if table.get("call_staff_status") == "acknowledged":
                return jsonify({"status": "already_acknowledged", "version": db["meta"]["version"]})
            table["call_staff_status"] = "acknowledged"
            table["call_staff_ack_at"] = local_now()
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "table not found"}), 404


@app.route("/api/table/checkout-request", methods=["POST"])
@require_license
@require_roles("customer")
def api_table_checkout_request():
    payload = read_json()
    table_id = payload.get("table_id")
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400

    db = load_db()
    for table in db["tables"]:
        if table["id"] == table_id:
            accepted_exists = any(
                order.get("target") == "table"
                and order.get("target_id") == table_id
                and order.get("status") in {"accepted", "completed"}
                for order in db["orders"]
            )
            if accepted_exists:
                table["status"] = "checkout_requested"
            else:
                _refresh_table_state(db, table_id)
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "table not found"}), 404


@app.route("/api/settings", methods=["POST"])
@require_server_request
@require_roles("owner")
def api_settings():
    payload = read_json()
    db = load_db()

    if "menu" in payload and isinstance(payload["menu"], list):
        db["menu"] = payload["menu"]

    if "tableCount" in payload:
        db["tableCount"] = int(payload["tableCount"])
        db = reset_tables(db)

    if payload.get("reset") is True:
        db = reset_tables(db)
        db["orders"] = []
        db["sales"] = []

    if "settings" in payload and isinstance(payload["settings"], dict):
        db["settings"] = {**db.get("settings", {}), **payload["settings"]}

    db = save_db(db)
    return jsonify({"status": "success", "version": db["meta"]["version"]})


@app.route("/api/backup", methods=["GET"])
@require_server_request
@require_license
@require_roles("owner")
def api_backup():
    return jsonify(load_db())


@app.route("/api/restore", methods=["POST"])
@require_server_request
@require_license
@require_roles("owner")
def api_restore():
    payload = read_json()
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid payload"}), 400
    db = save_db(payload)
    return jsonify({"status": "success", "version": db["meta"]["version"]})


@app.route("/api/kitchen/orders", methods=["GET"])
@require_license
def api_kitchen_orders():
    db = load_db()
    statuses = set(request.args.get("status", "request_pending,accepted").split(","))
    orders = [o for o in db["orders"] if o["status"] in statuses]
    return jsonify({"orders": orders, "version": db["meta"]["version"], "updated_at": db["meta"]["updated_at"]})


@app.route("/api/order/status", methods=["POST"])
@require_license
@require_roles("owner")
def api_order_status():
    payload = read_json()
    order_id = payload.get("order_id")
    status = payload.get("status")
    if status not in {"request_pending", "accepted", "completed", "cancelled"}:
        return jsonify({"error": "invalid status"}), 400

    db = load_db()
    for order in db["orders"]:
        if order["id"] == order_id:
            order["status"] = status
            order["updated_at"] = local_now()
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "order not found"}), 404


@app.route("/api/table/statuses", methods=["GET"])
def api_table_statuses():
    db = load_db()
    return jsonify({
        "tables": db.get("tables", []),
        "version": db.get("meta", {}).get("version", 0),
        "updated_at": db.get("meta", {}).get("updated_at"),
    })


def _project_staff_state(db: dict) -> dict:
    table_projection = []
    for table in db.get("tables", []):
        table_projection.append({
            "id": table.get("id"),
            "status": table.get("status", "available"),
            "call_staff_status": table.get("call_staff_status", "idle"),
            "updated_at": table.get("updated_at", ""),
            "last_order_event": table.get("last_order_event", ""),
            "last_order_event_at": table.get("last_order_event_at", ""),
        })

    order_projection = []
    for order in db.get("orders", []):
        if order.get("target") != "table":
            continue
        if order.get("status") not in {"request_pending", "accepted"}:
            continue
        order_projection.append({
            "id": order.get("id"),
            "target": order.get("target"),
            "target_id": order.get("target_id"),
            "status": order.get("status"),
            "source": order.get("source"),
            "items": order.get("items", []),
            "created_at": order.get("created_at", ""),
            "updated_at": order.get("updated_at", ""),
        })

    return {
        "tables": table_projection,
        "orders": order_projection,
        "service_mode": db.get("settings", {}).get("serviceMode", "table"),
        "version": db.get("meta", {}).get("version", 0),
        "updated_at": db.get("meta", {}).get("updated_at"),
    }


def _compute_staff_delta(previous: dict, current: dict) -> dict:
    def _map_by_id(rows: list) -> dict:
        return {str(row.get("id")): row for row in rows}

    prev_tables = _map_by_id(previous.get("tables", []))
    curr_tables = _map_by_id(current.get("tables", []))
    prev_orders = _map_by_id(previous.get("orders", []))
    curr_orders = _map_by_id(current.get("orders", []))

    table_upserts = [row for row_id, row in curr_tables.items() if prev_tables.get(row_id) != row]
    table_removals = [int(row_id) for row_id in prev_tables if row_id not in curr_tables]
    order_upserts = [row for row_id, row in curr_orders.items() if prev_orders.get(row_id) != row]
    order_removals = [row_id for row_id in prev_orders if row_id not in curr_orders]

    return {
        "tables_upsert": table_upserts,
        "tables_remove": table_removals,
        "orders_upsert": order_upserts,
        "orders_remove": order_removals,
        "service_mode": current.get("service_mode"),
        "version": current.get("version", 0),
        "updated_at": current.get("updated_at"),
    }


@app.route("/api/events", methods=["GET"])
@require_license
def api_events():
    table_id = request.args.get("table_id", type=int)
    token = request.args.get("t", type=str)
    if token:
        table = find_table_by_token(load_db(), token)
        if table is None:
            return jsonify({"error": "forbidden_invalid_table_token"}), 403
        table_id = int(table.get("id"))

    @stream_with_context
    def generate_events():
        last_version = -1
        for _ in range(1800):
            db = load_db()
            current_version = db.get("meta", {}).get("version", 0)
            if current_version != last_version:
                payload = {"version": current_version, "updated_at": db.get("meta", {}).get("updated_at")}
                if table_id is not None:
                    payload["table_id"] = table_id
                yield f"event: update\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                last_version = current_version
            else:
                yield "event: heartbeat\ndata: {}\n\n"
            time.sleep(1.5)

    return Response(generate_events(), mimetype="text/event-stream")


@app.route("/api/staff/bootstrap", methods=["GET"])
@require_license
@require_roles("owner", "staff")
def api_staff_bootstrap():
    db = load_db()
    snapshot = _project_staff_state(db)
    return jsonify({
        "snapshot": snapshot,
        "cursor": snapshot.get("version", 0),
        "updated_at": snapshot.get("updated_at"),
    })


@app.route("/api/staff/stream", methods=["GET"])
@require_license
@require_roles("owner", "staff")
def api_staff_stream():
    since = _safe_parse_int(request.args.get("since", "0"), default=0)

    @stream_with_context
    def generate_staff_events():
        db = load_db()
        previous_snapshot = _project_staff_state(db)
        last_version = max(since, previous_snapshot.get("version", 0))

        if since < previous_snapshot.get("version", 0):
            yield f"event: reset\ndata: {json.dumps({'snapshot': previous_snapshot}, ensure_ascii=False)}\n\n"

        for _ in range(1800):
            db = load_db()
            current_version = db.get("meta", {}).get("version", 0)
            if current_version != last_version:
                current_snapshot = _project_staff_state(db)
                delta_payload = _compute_staff_delta(previous_snapshot, current_snapshot)
                yield f"event: delta\ndata: {json.dumps(delta_payload, ensure_ascii=False)}\n\n"
                previous_snapshot = current_snapshot
                last_version = current_version
            else:
                yield "event: heartbeat\ndata: {}\n\n"
            time.sleep(1.2)

    return Response(generate_staff_events(), mimetype="text/event-stream")


@app.route("/api/staff/live", methods=["GET"])
@require_license
def api_staff_live():
    db = load_db()
    snapshot = _project_staff_state(db)
    return jsonify({
        "changed": True,
        "orders": snapshot.get("orders", []),
        "tables": snapshot.get("tables", []),
        "settings": {"serviceMode": snapshot.get("service_mode", "table")},
        "version": snapshot.get("version", 0),
    })


@app.route("/api/customer/live", methods=["GET"])
@require_license
def api_customer_live():
    since = _safe_parse_int(request.args.get("since", "0"), default=0)
    token = request.args.get("t", type=str) or request.args.get("table_token", type=str)
    table_id = request.args.get("table_id", type=int)
    db = load_db()
    if token:
        table = find_table_by_token(db, token)
        if table is None:
            return jsonify({"error": "forbidden_invalid_table_token"}), 403
        table_id = int(table.get("id"))
    elif table_id is not None and not any(table.get("id") == table_id for table in db.get("tables", [])):
        return jsonify({"error": "table_not_found"}), 404
    if db["meta"]["version"] <= since:
        return jsonify({"changed": False, "version": db["meta"]["version"]})
    tables = db["tables"]
    if table_id is not None:
        tables = [table for table in db["tables"] if table.get("id") == table_id]
    return jsonify({
        "changed": True,
        "menu": db["menu"],
        "tables": tables,
        "orders": [
            order for order in db["orders"]
            if order.get("target") == "table"
            and (table_id is None or order.get("target_id") == table_id)
            and order.get("source") == "customer"
        ],
        "settings": db["settings"],
        "version": db["meta"]["version"],
    })


@app.route("/api/customer-display/active", methods=["GET"])
@require_license
def api_customer_display_active_get():
    db = load_db()
    active_table_id = int(db.get("settings", {}).get("activeCustomerDisplayTable", 0) or 0)
    if active_table_id < 0:
        active_table_id = 0
    return jsonify({"table_id": active_table_id, "version": db["meta"]["version"]})


@app.route("/api/customer-display/active", methods=["POST"])
@require_license
@require_roles("owner", "staff")
def api_customer_display_active_set():
    payload = read_json()
    table_id = payload.get("table_id", 0)
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400
    db = load_db()
    if table_id > 0 and not any(table.get("id") == table_id for table in db.get("tables", [])):
        return jsonify({"error": "table_not_found"}), 404
    db.setdefault("settings", {})["activeCustomerDisplayTable"] = table_id
    db = save_db(db)
    return jsonify({"status": "success", "table_id": table_id, "version": db["meta"]["version"]})


@app.route("/api/sales/best-sellers", methods=["GET"])
@require_license
def api_sales_best_sellers():
    db = load_db()
    totals = defaultdict(int)
    for sale in db.get("sales", []):
        for item in sale.get("items", []):
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            qty = item.get("qty", 1)
            try:
                qty_value = int(qty)
            except (TypeError, ValueError):
                qty_value = 1
            totals[name] += max(1, qty_value)

    top_items = sorted(totals.items(), key=lambda pair: pair[1], reverse=True)[:5]
    return jsonify({
        "items": [{"name": name, "qty": qty} for name, qty in top_items],
        "version": db["meta"]["version"],
    })


@app.route("/api/sales/history", methods=["DELETE"])
@require_server_request
@require_license
@require_roles("owner")
def api_sales_history_delete():
    payload = read_json() or {}
    db = load_db()

    sale_id = payload.get("sale_id")
    if isinstance(sale_id, str) and sale_id.strip():
        before_count = len(db.get("sales", []))
        db["sales"] = [sale for sale in db.get("sales", []) if str(sale.get("id")) != sale_id.strip()]
        if len(db["sales"]) == before_count:
            return jsonify({"error": "sale_not_found"}), 404
        db = save_db(db)
        return jsonify({"status": "success", "deleted": 1, "version": db["meta"]["version"]})

    deleted = len(db.get("sales", []))
    db["sales"] = []
    db = save_db(db)
    return jsonify({"status": "success", "deleted": deleted, "version": db["meta"]["version"]})



if __name__ == "__main__":
    run_server()
