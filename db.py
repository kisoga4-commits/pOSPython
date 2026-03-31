import json
from pathlib import Path
from threading import Lock

DB_FILE = Path("shabu_database.json")
_db_lock = Lock()


def default_db() -> dict:
    table_count = 8
    return {
        "menu": [
            {"id": 1, "name": "เนื้อใบพายพรีเมียม", "price": 150},
            {"id": 2, "name": "หมูสันคอสไลซ์", "price": 120},
            {"id": 3, "name": "ชุดผักรวมสุขภาพ", "price": 50},
        ],
        "tableCount": table_count,
        "tables": [
            {"id": i, "status": "available", "items": []}
            for i in range(1, table_count + 1)
        ],
        "sales": [],
        "settings": {"shopName": "SHABU PRO", "currency": "THB"},
    }


def ensure_db_exists() -> None:
    if DB_FILE.exists():
        return
    save_db(default_db())


def load_db() -> dict:
    ensure_db_exists()
    with _db_lock:
        with DB_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)


def save_db(data: dict) -> None:
    with _db_lock:
        with DB_FILE.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def reset_tables(data: dict) -> dict:
    table_count = int(data.get("tableCount", 8))
    data["tables"] = [
        {"id": i, "status": "available", "items": []}
        for i in range(1, table_count + 1)
    ]
    return data
