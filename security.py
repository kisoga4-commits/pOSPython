import socket
from functools import wraps

from flask import jsonify, request

from license_service import is_licensed


def get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        sock.close()


def is_server_request() -> bool:
    remote = request.remote_addr
    allowed = {"127.0.0.1", "::1", get_local_ip()}
    return remote in allowed


def require_license(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_licensed():
            return jsonify({"error": "ระบบยังไม่ได้เปิดใช้งาน"}), 403
        return view(*args, **kwargs)

    return wrapped


def require_server_request(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_server_request():
            return jsonify({"error": "Unauthorized"}), 403
        return view(*args, **kwargs)

    return wrapped


def read_json() -> dict:
    return request.get_json(silent=True) or {}
