#!/usr/bin/env python3
"""Capture logcat + UI dumps around Movies Play on ONN/Fire TV."""
import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE = sys.argv[1] if len(sys.argv) > 1 else "10.0.0.151:5555"
OUT = Path(__file__).resolve().parents[1] / "artifacts" / "movies-play-diagnose"
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["adb", "-s", DEVICE, *args],
        capture_output=True,
        timeout=timeout,
    )


def dump_ui(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/nc-diagnose.xml", timeout=60)
    xml = adb("shell", "cat", "/sdcard/nc-diagnose.xml", timeout=60).stdout.decode("utf-8", "ignore")
    (OUT / f"{tag}.xml").write_text(xml, encoding="utf-8")
    img = adb("exec-out", "screencap", "-p", timeout=60).stdout
    (OUT / f"{tag}.png").write_bytes(img)
    labels = re.findall(r'text="([^"]+)"', xml)
    interesting = [t for t in labels if t and any(k in t.lower() for k in ("play", "movie", "back", "loading", "playback", "buffer", "retry", "dismiss", "favorite", "watchlist"))]
    return "\n".join(interesting[:40])


def key(code: str) -> None:
    adb("shell", "input", "keyevent", code)
    time.sleep(0.35)


def main() -> None:
    print(f"Device: {DEVICE}")
    adb("connect", DEVICE.split(":")[0] if ":" in DEVICE else DEVICE)
    adb("logcat", "-c")
    adb("shell", "am", "force-stop", "com.novacast.novacastv2")
    time.sleep(1)
    adb("shell", "am", "start", "-n", "com.novacast.novacastv2/.MainActivity")
    print("Waiting for app boot…")
    time.sleep(12)

    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "novacastv2://movies")
    for attempt in range(40):
        xml = adb("shell", "uiautomator", "dump", "/sdcard/nc-diagnose.xml", timeout=90).stdout.decode("utf-8", "ignore")
        if "novacast" in xml.lower() or "Movies" in xml or "movie" in xml.lower():
            browse = adb("shell", "cat", "/sdcard/nc-diagnose.xml", timeout=60).stdout.decode("utf-8", "ignore")
            if "Loading movie categories" not in browse and ("All Movies" in browse or "FEATURE" in browse or "poster" in browse.lower()):
                break
        time.sleep(2)
        print(f"waiting for movies grid ({attempt + 1}/40)")

    print("=== UI: movies browse ===")
    print(dump_ui("01-browse"))

    # Move to first poster and open detail
    for _ in range(3):
        key("KEYCODE_DPAD_RIGHT")
    key("KEYCODE_DPAD_DOWN")
    key("KEYCODE_DPAD_CENTER")
    time.sleep(1.5)
    print("=== UI: detail ===")
    detail = dump_ui("02-detail")
    print(detail)
    has_play = "Play" in detail or "play" in detail.lower()
    print(f"HAS_PLAY={has_play}")

    if not has_play:
        for _ in range(8):
            key("KEYCODE_DPAD_RIGHT")
        time.sleep(0.5)
        print("=== UI: detail retry ===")
        print(dump_ui("02b-detail"))
        key("KEYCODE_DPAD_CENTER")

    adb("logcat", "-c")
    print("=== Navigating focus to Play ===")
    for _ in range(4):
        key("KEYCODE_DPAD_DOWN")
    time.sleep(0.5)
    focused = dump_ui("02c-focus-play")
    print(focused)
    print("=== Pressing Play ===")
    key("KEYCODE_DPAD_CENTER")
    time.sleep(0.4)
    print("=== UI: +400ms ===")
    print(dump_ui("03-400ms"))
    time.sleep(1.2)
    print("=== UI: +1.6s ===")
    ui_16 = dump_ui("04-1600ms")
    print(ui_16)
    time.sleep(3)
    print("=== UI: +4.6s ===")
    ui_46 = dump_ui("05-4600ms")
    print(ui_46)

    log = adb("logcat", "-d", "-t", "800").stdout.decode("utf-8", "ignore")
    patterns = (
        "ReactNativeJS",
        "ExpoVideo",
        "ExoPlayer",
        "Movies",
        "playback",
        "Unified",
        "NovaStream",
        "error",
        "Error",
        "PictureInPicture",
        "MediaDetail",
    )
    filtered = [ln for ln in log.splitlines() if any(p.lower() in ln.lower() for p in patterns)]
    movies_playback = [ln for ln in log.splitlines() if "NovaCast Movies Playback" in ln or "NovaCast Unified Player" in ln]
    log_path = OUT / "logcat.txt"
    log_path.write_text("\n".join(filtered + ["", "--- Movies Playback ---", ""] + movies_playback), encoding="utf-8")
    print(f"\nLog lines captured: {len(filtered)} -> {log_path}")
    print("\n--- Last 30 log lines ---")
    for ln in filtered[-30:]:
        print(ln)

    print("\n=== Summary ===")
    for name, xml_file in [
        ("detail", OUT / "02-detail.xml"),
        ("+400ms", OUT / "03-400ms.xml"),
        ("+1.6s", OUT / "04-1600ms.xml"),
        ("+4.6s", OUT / "05-4600ms.xml"),
    ]:
        if xml_file.exists():
            xml = xml_file.read_text(encoding="utf-8", errors="ignore")
            print(
                f"{name}: Play={'Play' in xml} Back={'Back' in xml} Loading={'Loading' in xml or 'Buffering' in xml} Movies={'Movies' in xml and 'Thousands' in xml}"
            )


if __name__ == "__main__":
    main()
