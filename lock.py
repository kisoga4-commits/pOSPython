"""Primary executable entrypoint for the POS server.

Run this file with:
    python lock.py

Do not open templates/index.html directly because it needs Flask rendering
and API endpoints from this server process.
"""

from app import app, bootstrap
from security import get_local_ip


def main() -> None:
    bootstrap()
    ip_addr = get_local_ip()
    print("\n" + "=" * 75)
    print("🚀 FAKDU POS Ready")
    print(f"📡 Access Point: http://{ip_addr}:5000")
    print("=" * 75 + "\n")
    app.run(host="0.0.0.0", port=5000)


if __name__ == "__main__":
    main()
