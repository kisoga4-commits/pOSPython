import os
import socket
from functools import wraps

from flask import request, session

LICENSE_DISABLED = os.environ.get("POS_DISABLE_LICENSE", "1") != "0"
POS_ADMIN_HOST = (os.environ.get("POS_ADMIN_HOST") or "").strip().lower()
POS_STAFF_HOST = (os.environ.get("POS_STAFF_HOST") or "").strip().lower()


def get_local_ip() -> str:
    candidates = []

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # This does not require internet connectivity; it only asks the OS
        # which interface would be used to reach a non-loopback address.
        sock.connect(("10.255.255.255", 1))
        candidates.append(sock.getsockname()[0])
    except Exception:
        pass
    finally:
        sock.close()

    try:
        hostname = socket.gethostname()
        for item in socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_DGRAM):
            ip = item[4][0]
            candidates.append(ip)
    except Exception:
        pass

    for ip in candidates:
        if ip and not ip.startswith("127."):
            return ip
    return "127.0.0.1"


def is_server_request() -> bool:
    remote = request.remote_addr
    allowed = {"127.0.0.1", "::1", get_local_ip()}
    return remote in allowed


def _host_without_port(host: str) -> str:
    return (host or "").split(":", 1)[0].strip().lower()


def is_admin_host_request() -> bool:
    current_host = _host_without_port(request.host)
    if POS_ADMIN_HOST:
        return current_host == POS_ADMIN_HOST
    return is_server_request()


def get_staff_host() -> str:
    return POS_STAFF_HOST


def get_request_role(default: str = "guest") -> str:
    role = (request.headers.get("X-POS-Role") or "").strip().lower()
    if role in {"owner", "staff", "customer"}:
        return role
    return default


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


def require_admin_host(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin_host_request():
            return {"error": "admin_host_only"}, 403
        if not session.get("admin_authenticated"):
            return {"error": "admin_login_required"}, 403
        return view(*args, **kwargs)

    return wrapped


def require_roles(*allowed_roles: str):
    normalized_roles = {str(role or "").strip().lower() for role in allowed_roles if str(role or "").strip()}

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            request_role = get_request_role(default="")
            if request_role not in normalized_roles:
                return {"error": "forbidden_role"}, 403
            return view(*args, **kwargs)

        return wrapped

    return decorator


def read_json() -> dict:
    return request.get_json(silent=True) or {}
