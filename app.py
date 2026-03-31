import logging
from datetime import datetime

from flask import Flask, jsonify, render_template, request

from db import ensure_db_exists, load_db, reset_tables, save_db

log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

app = Flask(__name__)


def bootstrap() -> None:
    ensure_db_exists()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/license", methods=["GET"])
def api_license_status():
    return jsonify({"licensed": True, "machine_id": "DISABLED"})


@app.route("/api/activate", methods=["POST"])
def api_activate():
    return jsonify({"status": "success", "message": "license_disabled"})


@app.route("/api/data", methods=["GET"])
def api_data():
    db = load_db()
    return jsonify(db)


@app.route("/api/order", methods=["POST"])
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


if __name__ == "__main__":
    bootstrap()
    app.run(host="0.0.0.0", port=5000)
