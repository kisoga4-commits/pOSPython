import json
import os
import sqlite3
import random
import string
from copy import deepcopy
from datetime import datetime
from threading import Lock

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_FILE = os.path.join(BASE_DIR, "pos_local.sqlite3")
_db_lock = Lock()
_initialized_db_file = None


def now_iso() -> str:
    return datetime.now().isoformat()


def normalize_table_status(status: str) -> str:
    mapping = {"occupied": "accepted_order", "free": "available", "ว่าง": "available"}
    normalized = mapping.get(str(status), str(status))
    valid = {"available", "pending_order", "accepted_order", "checkout_requested", "closed"}
    return normalized if normalized in valid else "available"


def generate_table_suffix(length: int = 4) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


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
        "tables": [
            {
                "id": i,
                "status": "available",
                "items": [],
                "call_staff_status": "idle",
                "call_staff_requested_at": "",
                "call_staff_ack_at": "",
                "last_order_event": "",
                "last_order_event_at": "",
                "suffix": generate_table_suffix(),
            }
            for i in range(1, table_count + 1)
        ],
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
            "cardColor": "#ffffff",
            "themePreset": "sunset",
            "dynamicPromptPay": False,
            "adminRecoveryPhone": "",
            "adminRecoveryColor": "",
            "adminRecoveryCelebrity": "",
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
    global _initialized_db_file
    if _initialized_db_file == DB_FILE:
        return
    with _db_lock:
        if _initialized_db_file == DB_FILE:
            return
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    state_key TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            cur = conn.execute("SELECT state_json FROM app_state WHERE state_key = ?", ("main",))
            row = cur.fetchone()
            if row is None:
                payload = json.dumps(default_db(), ensure_ascii=False)
                conn.execute(
                    "INSERT INTO app_state(state_key, state_json, updated_at) VALUES(?, ?, ?)",
                    ("main", payload, now_iso()),
                )
            conn.commit()
        _initialized_db_file = DB_FILE


def _normalize_db(data: dict) -> dict:
    base = default_db()
    merged = deepcopy(base)
    merged.update(data or {})
    merged["settings"] = {**base["settings"], **(data or {}).get("settings", {})}
    merged["tables"] = [
        {
            **table,
            "status": normalize_table_status(table.get("status", "available")),
            "items": table.get("items", []),
            "call_staff_status": table.get("call_staff_status", "idle"),
            "call_staff_requested_at": table.get("call_staff_requested_at", ""),
            "call_staff_ack_at": table.get("call_staff_ack_at", ""),
            "last_order_event": table.get("last_order_event", ""),
            "last_order_event_at": table.get("last_order_event_at", ""),
            "suffix": (
                str(table.get("suffix", "")).strip()
                if len(str(table.get("suffix", "")).strip()) == 4
                and str(table.get("suffix", "")).strip().isalnum()
                else generate_table_suffix()
            ),
        }
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
        with sqlite3.connect(DB_FILE) as conn:
            cur = conn.execute("SELECT state_json FROM app_state WHERE state_key = ?", ("main",))
            row = cur.fetchone()
            if row is None:
                return default_db()
            return _normalize_db(json.loads(row[0]))


def save_db(data: dict) -> dict:
    normalized = _normalize_db(data)
    with _db_lock:
        normalized["meta"]["version"] = int(normalized["meta"].get("version", 0)) + 1
        normalized["meta"]["updated_at"] = now_iso()
        payload = json.dumps(normalized, ensure_ascii=False)
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                """
                INSERT INTO app_state(state_key, state_json, updated_at)
                VALUES(?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                ("main", payload, normalized["meta"]["updated_at"]),
            )
            conn.commit()
    return normalized


def reset_tables(data: dict, preserve_existing_suffix: bool = True) -> dict:
    table_count = int(data.get("tableCount", 8))
    existing_suffix_by_id = {}
    if preserve_existing_suffix:
        for table in data.get("tables", []):
            table_id = int(table.get("id", 0) or 0)
            suffix = str(table.get("suffix", "")).strip()
            if table_id > 0 and len(suffix) == 4 and suffix.isalnum():
                existing_suffix_by_id[table_id] = suffix
    data["tables"] = [
        {
            "id": i,
            "status": "available",
            "items": [],
            "call_staff_status": "idle",
            "call_staff_requested_at": "",
            "call_staff_ack_at": "",
            "last_order_event": "",
            "last_order_event_at": "",
            "suffix": existing_suffix_by_id.get(i) or generate_table_suffix(),
        }
        for i in range(1, table_count + 1)
    ]
    return data
