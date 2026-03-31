import logging
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request

from db import ensure_db_exists, load_db, reset_tables, save_db
from license_service import LicenseError, activate_license, ensure_license_file, get_machine_id, license_status
from security import get_local_ip, read_json, require_license, require_server_request

log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

app = Flask(__name__)
ASSET_VERSION = "20260331-scan-status-admin"

TABLE_STATUSES = {"available", "pending_order", "accepted_order", "checkout_requested", "closed"}


def bootstrap() -> None:
    ensure_db_exists()
    ensure_license_file()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.route("/")
def index():
    return render_template("index.html", local_ip=get_local_ip(), asset_version=ASSET_VERSION)


@app.route("/customer")
def customer_page():
    table_id = request.args.get("table", type=int)
    return render_template("customer.html", table_id=table_id, asset_version=ASSET_VERSION)


@app.route("/scan/customer/<int:table_id>")
def customer_scan_page(table_id: int):
    return render_template("customer.html", table_id=table_id, asset_version=ASSET_VERSION)


@app.route("/staff")
def staff_page():
    return render_template("staff.html", asset_version=ASSET_VERSION)


@app.route("/scan/staff")
def staff_scan_page():
    return render_template("staff.html", asset_version=ASSET_VERSION)


@app.route("/api/license", methods=["GET"])
def api_license_status():
    try:
        return jsonify(license_status())
    except LicenseError as exc:
        return jsonify({"licensed": False, "error": str(exc)}), 500


@app.route("/api/activate", methods=["POST"])
@require_server_request
def api_activate():
    payload = read_json()
    ok, message = activate_license(payload.get("key", ""))
    if ok:
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": message}), 400


@app.route("/api/data", methods=["GET"])
@require_license
def api_data():
    return jsonify(load_db())


@app.route("/api/order", methods=["POST"])
@require_license
def api_order():
    payload = read_json()
    target = str(payload.get("target", "table"))
    target_id = payload.get("target_id")
    cart = payload.get("cart", [])

    if not cart:
        return jsonify({"error": "cart is empty"}), 400

    db = load_db()
    order_id = f"ORD-{int(datetime.now().timestamp())}-{len(db['orders']) + 1}"
    new_order = {
        "id": order_id,
        "target": target,
        "target_id": target_id,
        "items": cart,
        "status": "new",
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "source": payload.get("source", "customer"),
        "note": payload.get("note", ""),
    }
    db["orders"].append(new_order)

    if target == "table" and isinstance(target_id, int):
        for table in db["tables"]:
            if table["id"] == target_id:
                table["status"] = "pending_order"
                table["items"].extend(cart)
                break

    db = save_db(db)
    return jsonify({"status": "success", "order": new_order, "version": db["meta"]["version"]})


@app.route("/api/checkout", methods=["POST"])
@require_license
def api_checkout():
    payload = read_json()
    target = str(payload.get("target", "table"))
    target_id = payload.get("target_id")
    payment_method = str(payload.get("payment_method", "cash")).lower()
    if payment_method not in {"cash", "qr"}:
        payment_method = "cash"

    db = load_db()
    pending_items = []
    for order in db["orders"]:
        if order["target"] == target and order["target_id"] == target_id and order["status"] != "served":
            order["status"] = "served"
            order["updated_at"] = utc_now()
        if order["target"] == target and order["target_id"] == target_id:
            pending_items.extend(order["items"])

    total = sum(float(item.get("price", 0)) for item in pending_items)
    sale_record = {
        "id": f"SALE-{int(datetime.now().timestamp())}",
        "target": target,
        "target_id": target_id,
        "items": pending_items,
        "total": total,
        "payment_method": payment_method,
        "paid_at": utc_now(),
    }
    db["sales"].append(sale_record)

    if target == "table" and isinstance(target_id, int):
        for table in db["tables"]:
            if table["id"] == target_id:
                table["status"] = "available"
                table["items"] = []
                break

    db = save_db(db)
    return jsonify({"status": "success", "sale_record": sale_record, "version": db["meta"]["version"]})


@app.route("/api/table/accept", methods=["POST"])
@require_license
def api_table_accept():
    payload = read_json()
    table_id = payload.get("table_id")
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400

    db = load_db()
    touched = False
    for order in db["orders"]:
        if order["target"] == "table" and order["target_id"] == table_id and order["status"] == "new":
            order["status"] = "preparing"
            order["updated_at"] = utc_now()
            touched = True

    for table in db["tables"]:
        if table["id"] == table_id:
            table["status"] = "accepted_order"
            touched = True
            break

    if not touched:
        return jsonify({"error": "table not found or no pending order"}), 404

    db = save_db(db)
    return jsonify({"status": "success", "version": db["meta"]["version"]})


@app.route("/api/table/checkout-request", methods=["POST"])
@require_license
def api_table_checkout_request():
    payload = read_json()
    table_id = payload.get("table_id")
    if not isinstance(table_id, int):
        return jsonify({"error": "invalid table_id"}), 400

    db = load_db()
    for table in db["tables"]:
        if table["id"] == table_id:
            table["status"] = "checkout_requested"
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "table not found"}), 404


@app.route("/api/settings", methods=["POST"])
@require_server_request
@require_license
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


@app.route("/api/kitchen/orders", methods=["GET"])
@require_license
def api_kitchen_orders():
    db = load_db()
    statuses = set(request.args.get("status", "new,preparing").split(","))
    orders = [o for o in db["orders"] if o["status"] in statuses]
    return jsonify({"orders": orders, "version": db["meta"]["version"], "updated_at": db["meta"]["updated_at"]})


@app.route("/api/order/status", methods=["POST"])
@require_license
def api_order_status():
    payload = read_json()
    order_id = payload.get("order_id")
    status = payload.get("status")
    if status not in {"new", "preparing", "served", "cancelled"}:
        return jsonify({"error": "invalid status"}), 400

    db = load_db()
    for order in db["orders"]:
        if order["id"] == order_id:
            order["status"] = status
            order["updated_at"] = utc_now()
            db = save_db(db)
            return jsonify({"status": "success", "version": db["meta"]["version"]})
    return jsonify({"error": "order not found"}), 404


@app.route("/api/staff/live", methods=["GET"])
@require_license
def api_staff_live():
    since = int(request.args.get("since", "0"))
    db = load_db()
    if db["meta"]["version"] <= since:
        return jsonify({"changed": False, "version": db["meta"]["version"]})

    orders = [o for o in db["orders"] if o["status"] in {"new", "preparing", "served"}]
    return jsonify({
        "changed": True,
        "orders": orders,
        "tables": db["tables"],
        "version": db["meta"]["version"],
    })


@app.route("/api/customer/live", methods=["GET"])
@require_license
def api_customer_live():
    since = int(request.args.get("since", "0"))
    db = load_db()
    if db["meta"]["version"] <= since:
        return jsonify({"changed": False, "version": db["meta"]["version"]})
    return jsonify({
        "changed": True,
        "menu": db["menu"],
        "tables": db["tables"],
        "settings": db["settings"],
        "version": db["meta"]["version"],
    })


if __name__ == "__main__":
    bootstrap()
    app.run(host="0.0.0.0", port=5000)
