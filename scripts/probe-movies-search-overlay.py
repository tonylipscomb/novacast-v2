#!/usr/bin/env python3
"""Navigate to Movies search on TV/emulator via D-pad and verify overlay UI."""
import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE = sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"
OUT = Path(__file__).resolve().parents[1] / "artifacts"
ADB = r"C:\Users\tonyl\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"


def adb(*args: str) -> None:
    subprocess.run([ADB, "-s", DEVICE, *args], check=False, timeout=60)


def adb_text(*args: str) -> str:
    return subprocess.run([ADB, "-s", DEVICE, *args], capture_output=True, timeout=60).stdout.decode("utf-8", errors="ignore")


def key(code: str, delay: float = 0.45) -> None:
    adb("shell", "input", "keyevent", code)
    time.sleep(delay)


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb_text("shell", "cat", "/sdcard/ui.xml")
    (OUT / f"{tag}.xml").write_text(xml, encoding="utf-8")
    img = subprocess.check_output([ADB, "-s", DEVICE, "exec-out", "screencap", "-p"], timeout=60)
    (OUT / f"{tag}.png").write_bytes(img)
    return xml


def focused_label(xml: str) -> str:
    for node in re.findall(r"<node[^>]*/?>", xml):
        if 'focused="true"' not in node:
            continue
        for attr in ("content-desc", "text"):
            match = re.search(rf'{attr}="([^"]*)"', node)
            if match and match.group(1):
                return match.group(1)
    return "(none)"


def main() -> None:
    print(f"Device: {DEVICE}")
    adb("reverse", "tcp:8081", "tcp:8081")
    adb("shell", "am", "force-stop", "com.novacast.novacastv2")
    time.sleep(1)
    adb("shell", "am", "start", "-n", "com.novacast.novacastv2/.MainActivity")
    print("Waiting for startup…")
    time.sleep(28)

    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "novacastv2://movies")
    time.sleep(6)

    xml = dump("emu-movies-browse")
    print("Browse focus:", focused_label(xml)[:80])

    # Focus toolbar Search: left to nav, then traverse to Search button
    key("KEYCODE_DPAD_LEFT")
    key("KEYCODE_DPAD_LEFT")
    for _ in range(5):
        key("KEYCODE_DPAD_UP")
    for _ in range(10):
        key("KEYCODE_DPAD_RIGHT")
        xml = adb_text("shell", "uiautomator", "dump", "/sdcard/ui.xml")
        if 'text="Search"' in xml and focused_label(xml).lower() == "search":
            break
    print("Before enter focus:", focused_label(xml)[:80])
    key("KEYCODE_DPAD_CENTER")
    time.sleep(2)

    xml2 = dump("emu-movies-search")
    print("After enter focus:", focused_label(xml2)[:80])
    for label in ["Search Movies", "Close search", "Use the remote", "Search movies"]:
        print(f"  {label}: {label in xml2}")

    logs = adb_text("logcat", "-d", "-t", "40", "ReactNativeJS:*", "*:S")
    for line in logs.splitlines():
        if "search" in line.lower():
            print(line)


if __name__ == "__main__":
    main()
