#!/usr/bin/env python3
"""Capture NovaCast Search diagnostics from Fire TV logcat.

Usage:
  python scripts/search-logcat-diag.py [device]
  python scripts/search-logcat-diag.py 10.0.0.151:5555

Then on the TV: open Movies → Search → type a query → select a result / Back.
Press Ctrl+C when done. Writes artifacts/search-logcat-diag.txt
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE = sys.argv[1] if len(sys.argv) > 1 else "10.0.0.151:5555"
OUT = Path(__file__).resolve().parents[1] / "artifacts" / "search-logcat-diag.txt"
FILTER = re.compile(
    r"\[NovaCast Search\]|search_overlay|search_result|search_poster|ReactNativeJS",
    re.I,
)


def adb(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["adb", "-s", DEVICE, *args], capture_output=True, timeout=30)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    print(f"Device: {DEVICE}")
    print(f"Clearing logcat, then watching for [NovaCast Search] events...")
    print("On TV: Movies → Search → type → browse results → Back/select")
    print("Ctrl+C to stop.\n")

    adb("logcat", "-c")
    proc = subprocess.Popen(
        ["adb", "-s", DEVICE, "logcat", "-v", "time"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    hits: list[str] = []
    started = time.time()
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if not FILTER.search(line):
                continue
            hits.append(line.rstrip())
            print(line.rstrip())
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    header = [
        f"# NovaCast search logcat diag",
        f"# device={DEVICE}",
        f"# elapsed_s={time.time() - started:.1f}",
        f"# hits={len(hits)}",
        "",
    ]
    OUT.write_text("\n".join(header + hits) + "\n", encoding="utf-8")
    print(f"\nWrote {len(hits)} lines → {OUT}")

    events = [ln for ln in hits if "[NovaCast Search]" in ln]
    print(f"Search events: {len(events)}")
    for ln in events[-20:]:
        print(f"  {ln}")


if __name__ == "__main__":
    main()
