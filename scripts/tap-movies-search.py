#!/usr/bin/env python3
import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE = sys.argv[1] if len(sys.argv) > 1 else "10.0.0.151:5555"
OUT = Path(__file__).resolve().parents[1] / "artifacts"
ADB = r"C:\Users\tonyl\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"


def adb(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run([ADB, "-s", DEVICE, *args], capture_output=True, timeout=60)


def adb_text(*args: str) -> str:
    return adb(*args).stdout.decode("utf-8", errors="ignore")


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb_text("shell", "cat", "/sdcard/ui.xml")
    (OUT / f"{tag}.xml").write_text(xml, encoding="utf-8")
    img = subprocess.check_output([ADB, "-s", DEVICE, "exec-out", "screencap", "-p"], timeout=60)
    (OUT / f"{tag}.png").write_bytes(img)
    return xml


def main() -> None:
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "novacastv2://movies")
    time.sleep(5)
    xml = dump("movies-before-search")
    tapped = False
    for node in re.findall(r"<node[^>]*/?>", xml):
        if 'text="Search"' not in node or "Search Movies" in node:
            continue
        match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if not match:
            continue
        x1, y1, x2, y2 = map(int, match.groups())
        x, y = (x1 + x2) // 2, (y1 + y2) // 2
        print(f"Tapping Search at {x},{y}")
        adb("shell", "input", "tap", str(x), str(y))
        tapped = True
        break
    if not tapped:
        print("Search button not found")
        return

    time.sleep(2)
    xml2 = dump("movies-after-search")
    logs = adb_text("logcat", "-d", "-t", "40", "ReactNativeJS:*", "*:S")
    for line in logs.splitlines():
        if "search" in line.lower():
            print(line)
    for label in ["Search Movies", "Close search", "Use the remote", "Search movies"]:
        print(f"{label}: {label in xml2}")


if __name__ == "__main__":
    main()
