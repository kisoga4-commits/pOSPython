"""Primary executable entrypoint for the POS server.

Run this file with:
    python lock.py

Do not open templates/index.html directly because it needs Flask rendering
and API endpoints from this server process.
"""

from app import run_server


def main() -> None:
    run_server()


if __name__ == "__main__":
    main()
