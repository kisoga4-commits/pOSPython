import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

DB_FILE = Path("shabu_database.json")
_db_lock = Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()




def normalize_table_status(status: str) -> str:
    mapping = {"occupied": "accepted_order", "free": "available", "ว่าง": "available"}
    normalized = mapping.get(str(status), str(status))
    valid = {"available", "pending_order", "accepted_order", "checkout_requested", "closed"}
    return normalized if normalized in valid else "available"

def default_db() -> dict:
    table_count = 8
    return {
        "meta": {"version": 1, "updated_at": now_iso()},
        "menu": [
            {"id": 1, "name": "เนื้อใบพายพรีเมียม", "price": 150, "category": "เนื้อ", "image": ""},
            {"id": 2, "name": "หมูสันคอสไลซ์", "price": 120, "category": "หมู", "image": ""},
            {"id": 3, "name": "ชุดผักรวมสุขภาพ", "price": 50, "category": "ผัก", "image": ""},
        ],
        "tableCount": table_count,
        "tables": [{"id": i, "status": "available", "items": []} for i in range(1, table_count + 1)],
        "orders": [],
        "sales": [],
        "settings": {
            "shopName": "FAKDU",
            "currency": "THB",
            "pollingMs": 2500,
            "serviceChargePct": 0,
            "vatPct": 0,
            "adminPin": "admin",
            "storeName": "FAKDU",
            "serviceMode": "table",
            "promptPay": "",
            "bankName": "",
            "themeColor": "#8f1d2a",
            "bgColor": "#f6efe9",
            "dynamicPromptPay": False,
            "masterNode": "main",
            "sync": {
                "session": "main-session",
                "queue": "default",
                "snapshotVersion": 1,
                "lastSyncAt": "",
            },
        },
    }


def ensure_db_exists() -> None:
    if not DB_FILE.exists():
        save_db(default_db())


def _normalize_db(data: dict) -> dict:
    base = default_db()
    merged = deepcopy(base)
    merged.update(data or {})
    merged["settings"] = {**base["settings"], **(data or {}).get("settings", {})}
    merged["tables"] = [
        {**table, "status": normalize_table_status(table.get("status", "available")), "items": table.get("items", [])}
        for table in merged.get("tables", [])
    ]
    merged["menu"] = [
        {**item, "image": item.get("image", "")}
        for item in merged.get("menu", [])
    ]
    merged["sales"] = [
        {**sale, "payment_method": sale.get("payment_method", "cash")}
        for sale in merged.get("sales", [])
    ]
    if "meta" not in merged:
        merged["meta"] = {"version": 1, "updated_at": now_iso()}
    merged["meta"].setdefault("version", 1)
    merged["meta"].setdefault("updated_at", now_iso())
    return merged


def load_db() -> dict:
    ensure_db_exists()
    with _db_lock:
        with DB_FILE.open("r", encoding="utf-8") as f:
            return _normalize_db(json.load(f))


def _write_db(data: dict) -> None:
    with DB_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def save_db(data: dict) -> dict:
    normalized = _normalize_db(data)
    with _db_lock:
        normalized["meta"]["version"] = int(normalized["meta"].get("version", 0)) + 1
        normalized["meta"]["updated_at"] = now_iso()
        _write_db(normalized)
    return normalized


def reset_tables(data: dict) -> dict:
    table_count = int(data.get("tableCount", 8))
    data["tables"] = [{"id": i, "status": "available", "items": []} for i in range(1, table_count + 1)]
    return data
