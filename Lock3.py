"""Legacy entrypoint shim.

This project previously served a large inline HTML UI from this file.
To avoid stale UI rendering, running `python Lock3.py` now starts the
same Flask app as `python app.py`, which renders templates/index.html.
"""

from app import app, bootstrap
from security import get_local_ip


if __name__ == "__main__":
    bootstrap()
    ip_addr = get_local_ip()
    print("\n" + "=" * 75)
    print("🚀 FAKDU POS Ready")
    print(f"📡 Access Point: http://{ip_addr}:5000")
    print("=" * 75 + "\n")
    app.run(host="0.0.0.0", port=5000)
