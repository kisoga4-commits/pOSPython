import logging
from datetime import datetime

from flask import Flask, jsonify, render_template, request

from db import load_db, reset_tables, save_db, ensure_db_exists
from license_service import (
    LicenseError,
    activate_license,
    ensure_license_file,
    get_machine_id,
    license_status,
)
from security import require_license, require_server_request

log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

app = Flask(__name__)


def bootstrap() -> None:
    ensure_db_exists()
    ensure_license_file()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/license", methods=["GET"])
def api_license_status():
    try:
        return jsonify(license_status())
    except LicenseError as exc:
        return jsonify({"licensed": False, "error": str(exc)}), 500


@app.route("/api/activate", methods=["POST"])
@require_server_request
def api_activate():
    payload = request.get_json(silent=True) or {}
    ok, message = activate_license(payload.get("key", ""))
    if ok:
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": message}), 400


@app.route("/api/data", methods=["GET"])
@require_license
def api_data():
    db = load_db()
    return jsonify(db)


@app.route("/api/order", methods=["POST"])
@require_license
def api_order():
    payload = request.get_json(silent=True) or {}
    table_id = payload.get("table_id")
    cart = payload.get("cart", [])

    db = load_db()
    for table in db["tables"]:
        if table["id"] == table_id:
            table["status"] = "occupied"
            table["items"].extend(cart)
            break
    save_db(db)
    return jsonify({"status": "success"})


@app.route("/api/checkout", methods=["POST"])
@require_license
def api_checkout():
    payload = request.get_json(silent=True) or {}
    table_id = payload.get("table_id")
    sale_record = payload.get("sale_record", {})

    db = load_db()
    sale_record.setdefault("created_at", datetime.now().isoformat())
    db["sales"].append(sale_record)

    for table in db["tables"]:
        if table["id"] == table_id:
            table["status"] = "available"
            table["items"] = []
            break

    save_db(db)
    return jsonify({"status": "success"})


@app.route("/api/settings", methods=["POST"])
@require_server_request
@require_license
def api_settings():
    payload = request.get_json(silent=True) or {}
    db = load_db()

    if "menu" in payload:
        db["menu"] = payload["menu"]

    if "tableCount" in payload:
        db["tableCount"] = int(payload["tableCount"])
        db = reset_tables(db)

    if payload.get("reset") is True:
        db = reset_tables(db)
        db["sales"] = []

    if "settings" in payload and isinstance(payload["settings"], dict):
        db["settings"] = {**db.get("settings", {}), **payload["settings"]}

    save_db(db)
    return jsonify({"status": "success"})


@app.route("/api/machine-id", methods=["GET"])
def api_machine_id():
    return jsonify({"machine_id": get_machine_id()})


if __name__ == "__main__":
    bootstrap()
    app.run(host="0.0.0.0", port=5000)
