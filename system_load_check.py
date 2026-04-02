#!/usr/bin/env python3
"""Quick runtime load snapshot for POS host."""

from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone


def _read_meminfo() -> dict[str, int]:
    data: dict[str, int] = {}
    try:
        with open('/proc/meminfo', 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.split(':', 1)
                if len(parts) != 2:
                    continue
                key = parts[0].strip()
                value = parts[1].strip().split()[0]
                if value.isdigit():
                    data[key] = int(value)  # KiB
    except OSError:
        return {}
    return data


def _fmt_pct(v: float) -> str:
    return f"{v:.1f}%"


def main() -> None:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    cpus = os.cpu_count() or 1
    la1, la5, la15 = os.getloadavg()

    mem = _read_meminfo()
    total = mem.get('MemTotal', 0)
    available = mem.get('MemAvailable', 0)
    used = max(total - available, 0)
    mem_pct = (used / total * 100.0) if total else 0.0

    disk = shutil.disk_usage('/')
    disk_pct = (disk.used / disk.total * 100.0) if disk.total else 0.0

    cpu_load_pct_1m = la1 / cpus * 100.0
    cpu_load_pct_5m = la5 / cpus * 100.0

    status = []
    status.append('CPU heavy' if cpu_load_pct_1m > 85 else 'CPU ok')
    status.append('Memory heavy' if mem_pct > 85 else 'Memory ok')
    status.append('Disk heavy' if disk_pct > 90 else 'Disk ok')

    print(f'Time: {now}')
    print(f'CPU cores: {cpus}')
    print(f'Load avg (1m/5m/15m): {la1:.2f} / {la5:.2f} / {la15:.2f}')
    print(f'CPU load per core (1m): {_fmt_pct(cpu_load_pct_1m)}')
    print(f'CPU load per core (5m): {_fmt_pct(cpu_load_pct_5m)}')
    print(f'Memory used: {used/1024/1024:.2f} GiB / {total/1024/1024:.2f} GiB ({_fmt_pct(mem_pct)})')
    print(f'Disk used (/): {disk.used/1024/1024/1024:.2f} GiB / {disk.total/1024/1024/1024:.2f} GiB ({_fmt_pct(disk_pct)})')
    print('Health: ' + ', '.join(status))


if __name__ == '__main__':
    main()
