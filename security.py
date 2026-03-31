import os
import socket
from functools import wraps

from flask import request

LICENSE_DISABLED = os.environ.get("POS_DISABLE_LICENSE", "1") != "0"


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
        if LICENSE_DISABLED:
            return view(*args, **kwargs)
        return view(*args, **kwargs)

    return wrapped


def require_server_request(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_server_request():
            return {"error": "Unauthorized"}, 403
        return view(*args, **kwargs)

    return wrapped


def read_json() -> dict:
    return request.get_json(silent=True) or {}
