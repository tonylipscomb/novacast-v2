# Stage 2.75 ONN capture: launch, wait for sync phases, dump catalog/write/focus logs + meminfo.
# Physical remote still required for FocusLatency — adb keyevents do not fire TVEventHandler on this device.

import subprocess
import time
import re
from collections import defaultdict

DEVICE = "10.0.0.151:5555"
PKG = "com.novacast.novacastv2"


def adb(*args: str) -> str:
    return subprocess.check_output(["adb", "-s", DEVICE, *args], text=True, errors="replace")


def main() -> None:
    adb("logcat", "-c")
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LEANBACK_LAUNCHER",
        "1",
    )
    print("Launched. Capturing 180s of sync...")
    time.sleep(180)

    dump = adb("logcat", "-d", "-t", "8000")
    markers = [ln for ln in dump.splitlines() if "stage275-writer-hardening-v1" in ln or "CatalogWritePhase" in ln or "CatalogSqlite" in ln or "long_task_candidate" in ln or "EarlyBoot" in ln or "FocusLatency" in ln or "sqlite-items-streamed" in ln or "sqlite-categories-streamed" in ln or "movie-category-synced" in ln or "series-category-synced" in ln or "movie-sync-completed" in ln or "series-sync-completed" in ln]

    print(f"\n=== relevant log lines: {len(markers)} ===")
    for ln in markers[-120:]:
        print(ln)

    # Summarize write phases
    phase_ms = defaultdict(list)
    for ln in markers:
        m = re.search(r"phase: '([^']+)'.*?wallMs: ([0-9.]+).*?itemCount: ([0-9]+)", ln)
        if not m:
            m = re.search(r'"phase":"([^"]+)".*?"wallMs":([0-9.]+).*?"itemCount":([0-9]+)', ln)
        if m:
            phase_ms[m.group(1)].append((float(m.group(2)), int(m.group(3))))

    print("\n=== phase summary ===")
    for phase, samples in sorted(phase_ms.items()):
        walls = [s[0] for s in samples]
        items = [s[1] for s in samples]
        print(
            f"{phase}: n={len(samples)} maxWall={max(walls):.1f} avgWall={sum(walls)/len(walls):.1f} maxItems={max(items)}"
        )

    lags = []
    for ln in markers:
        m = re.search(r"lagMs[:\"]\s*([0-9.]+)", ln)
        if m:
            lags.append(float(m.group(1)))
    if lags:
        lags.sort()
        print(
            f"\n=== long_task_candidate lags === n={len(lags)} max={max(lags):.1f} p95={lags[int(len(lags)*0.95)-1]:.1f}"
        )

    mem = adb("shell", "dumpsys", "meminfo", PKG)
    for ln in mem.splitlines():
        if any(k in ln for k in ("TOTAL PSS", "TOTAL RSS", "Java Heap", "Native Heap", "Unknown", "Private Other")):
            print(ln)

    print("\nForce-stop to leave device idle.")
    adb("shell", "am", "force-stop", PKG)


if __name__ == "__main__":
    main()
