import hashlib
import hmac
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

LICENSE_FILE = Path("shabu_license.key")
SECRET = os.environ.get("POS_LICENSE_SECRET", "shabu2026premium")


class LicenseError(Exception):
    pass


def _linux_physical_mac() -> str:
    base = Path("/sys/class/net")
    if not base.exists():
        raise LicenseError("Cannot detect physical MAC address on this platform")

    for iface in sorted(base.iterdir()):
        if iface.name == "lo":
            continue
        address_file = iface / "address"
        type_file = iface / "type"
        if not address_file.exists() or not type_file.exists():
            continue

        iface_type = type_file.read_text(encoding="utf-8").strip()
        if iface_type != "1":
            continue

        mac = address_file.read_text(encoding="utf-8").strip().upper()
        if re.fullmatch(r"([0-9A-F]{2}:){5}[0-9A-F]{2}", mac) and mac != "00:00:00:00:00:00":
            return mac

    raise LicenseError("No physical MAC address found")


def _fallback_mac() -> str:
    mac_int = uuid.getnode()
    mac = ":".join(f"{(mac_int >> shift) & 0xFF:02X}" for shift in range(40, -1, -8))
    if mac == "00:00:00:00:00:00":
        raise LicenseError("Cannot detect MAC address")
    return mac


def get_physical_mac_address() -> str:
    try:
        return _linux_physical_mac()
    except LicenseError:
        return _fallback_mac()


def get_machine_id() -> str:
    mac = get_physical_mac_address()
    return hashlib.sha256(mac.encode("utf-8")).hexdigest()[:24].upper()


def generate_license_key(machine_id: str) -> str:
    digest = hmac.new(SECRET.encode("utf-8"), machine_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:16].upper()


def expected_license_key() -> str:
    return generate_license_key(get_machine_id())


def _read_license_payload() -> dict | None:
    if not LICENSE_FILE.exists():
        return None

    content = LICENSE_FILE.read_text(encoding="utf-8").strip().splitlines()
    payload = {}
    for line in content:
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        payload[k.strip()] = v.strip()
    return payload


def _write_license_payload(machine_id: str, key: str) -> None:
    activated_at = datetime.now(timezone.utc).isoformat()
    LICENSE_FILE.write_text(
        f"machine_id={machine_id}\nlicense_key={key}\nactivated_at={activated_at}\n",
        encoding="utf-8",
    )


def license_status() -> dict:
    machine_id = get_machine_id()
    payload = _read_license_payload()

    if not payload:
        return {
            "licensed": False,
            "machine_id": machine_id,
            "reason": "license_file_not_found",
        }

    stored_machine = payload.get("machine_id", "")
    stored_key = payload.get("license_key", "")
    expected_key = generate_license_key(machine_id)

    if stored_machine != machine_id:
        return {
            "licensed": False,
            "machine_id": machine_id,
            "reason": "mac_changed_machine_mismatch",
        }

    if stored_key != expected_key:
        return {
            "licensed": False,
            "machine_id": machine_id,
            "reason": "invalid_license_key",
        }

    return {
        "licensed": True,
        "machine_id": machine_id,
        "activated_at": payload.get("activated_at"),
    }


def is_licensed() -> bool:
    return bool(license_status().get("licensed"))


def activate_license(provided_key: str) -> tuple[bool, str]:
    machine_id = get_machine_id()
    expected_key = generate_license_key(machine_id)
    normalized = (provided_key or "").strip().upper()

    if normalized != expected_key:
        return False, "คีย์ไม่ถูกต้องสำหรับเครื่องนี้"

    _write_license_payload(machine_id, normalized)
    return True, "activated"


def ensure_license_file() -> None:
    if not LICENSE_FILE.exists():
        LICENSE_FILE.touch()
