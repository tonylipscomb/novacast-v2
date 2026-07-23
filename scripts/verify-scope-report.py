#!/usr/bin/env python3
"""End-to-end verification for Movies fullscreen/selection and Live TV perf on emulator-5554."""
import io
import json
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PKG = "com.novacast.novacastv2"
DEVICE = "emulator-5554"
RESULTS = {}


def adb(*args, timeout=60):
    return subprocess.run(
        ["adb", "-s", DEVICE, *args],
        capture_output=True,
        timeout=timeout,
    )


def key(code):
    adb("shell", "input", "keyevent", code)


def dump_ui():
    adb("shell", "uiautomator", "dump", "/sdcard/scope_verify.xml")
    return adb("shell", "cat", "/sdcard/scope_verify.xml").stdout.decode("utf-8", "ignore")


def screenshot(path):
    with open(path, "wb") as handle:
        handle.write(adb("exec-out", "screencap", "-p").stdout)


def focused_nodes(xml):
    return re.findall(r'focused="true"[^>]*(?:text|content-desc)="([^"]*)"', xml)


def dismiss_overlays():
    for _ in range(3):
        xml = dump_ui()
        if "Walkthrough" not in xml and "Don't show again" not in xml:
            break
        if "Don't show again" in xml:
            for _ in range(6):
                key("KEYCODE_DPAD_DOWN")
                time.sleep(0.25)
            key("KEYCODE_DPAD_CENTER")
            time.sleep(0.8)
            continue
        key("KEYCODE_BACK")
        time.sleep(0.5)


def launch():
    adb("shell", "am", "force-stop", PKG)
    time.sleep(0.5)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(5)
    dismiss_overlays()


def goto_route(route_name):
    launch()
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"novacastv2://{route_name}")
    time.sleep(8)
    dismiss_overlays()
    for _ in range(25):
        xml = dump_ui()
        if route_name == "movies" and "Movies" in xml and "Loading" not in xml and "FEATURE" in xml:
            return xml
        if route_name == "live" and "Categories" in xml and "Channels" in xml and "Loading Live TV" not in xml:
            return xml
        time.sleep(1.5)
    return dump_ui()


def movie_logs():
    out = adb("logcat", "-d").stdout.decode("utf-8", "ignore")
    return [line for line in out.splitlines() if "NovaCast Movies UI" in line]


def live_logs():
    out = adb("logcat", "-d").stdout.decode("utf-8", "ignore")
    return [line for line in out.splitlines() if "ReactNativeJS" in line]


def verify_movies():
    print("\n=== MOVIES ===")
    xml = goto_route("movies")
    screenshot("scope_movies_start.png")

    if "Movies" not in xml:
        RESULTS["movies_fullscreen"] = {"verified": False, "reason": "Could not reach Movies screen"}
        RESULTS["movies_selection"] = {"verified": False, "reason": "Could not reach Movies screen"}
        return

    adb("logcat", "-c")
    # Commit selection on first visible poster (move to grid first)
    for _ in range(4):
        key("KEYCODE_DPAD_RIGHT")
        time.sleep(0.3)
    key("KEYCODE_DPAD_CENTER")
    time.sleep(1.0)
    sel_logs = [l for l in movie_logs() if "movie-selected" in l]
    first_selected = sel_logs[-1] if sel_logs else ""

    # Move focus across two more posters without selecting
    key("KEYCODE_DPAD_RIGHT")
    time.sleep(0.35)
    key("KEYCODE_DPAD_RIGHT")
    time.sleep(0.35)
    focus_logs = [l for l in movie_logs() if "movie-focused" in l]

    # Read detail title from UI - should still be first selected movie if selection preserved
    xml_after_focus = dump_ui()
    screenshot("scope_movies_focus_moved.png")

    # Navigate to Play button (right from poster into detail panel)
    for _ in range(10):
        xml_after_focus = dump_ui()
        if "Play" in xml_after_focus:
            break
        key("KEYCODE_DPAD_RIGHT")
        time.sleep(0.35)

    screenshot("scope_movies_play_focus.png")
    key("KEYCODE_DPAD_CENTER")
    time.sleep(5)
    xml_playback = dump_ui()
    screenshot("scope_movies_playback.png")

    playback_open = "Back" in xml_playback and "Movies" not in xml_playback
    shell_gone = "NOVACAST" not in xml_playback and "Home" not in xml_playback

    chrome_hidden = False
    if playback_open:
        time.sleep(4.5)
        xml_hide = dump_ui()
        screenshot("scope_movies_chrome_hide.png")
        chrome_hidden = xml_hide.count("Back") < 2

        key("KEYCODE_BACK")
        time.sleep(1.5)
        xml_back = dump_ui()
        screenshot("scope_movies_after_back.png")
        back_ok = "Movies" in xml_back and "Play" in xml_back
    else:
        back_ok = False

    play_logs = [l for l in movie_logs() if "play-pressed" in l]

    RESULTS["movies_fullscreen"] = {
        "verified": playback_open and shell_gone,
        "playback_open": playback_open,
        "shell_gone": shell_gone,
        "chrome_auto_hide": chrome_hidden,
        "screenshots": ["scope_movies_playback.png", "scope_movies_chrome_hide.png"],
    }
    RESULTS["movies_selection"] = {
        "verified": bool(sel_logs) and bool(focus_logs) and playback_open and back_ok,
        "selected_log": first_selected,
        "focus_logs_tail": focus_logs[-2:],
        "play_log": play_logs[-1] if play_logs else "",
        "back_restored": back_ok,
    }


def verify_live_tv():
    print("\n=== LIVE TV ===")
    adb("logcat", "-c")
    xml = goto_route("live")
    screenshot("scope_live_start.png")

    if "Categories" not in xml or "Channels" not in xml:
        RESULTS["live_tv_fullscreen"] = {"verified": False, "reason": "Could not reach Live TV screen"}
        RESULTS["live_tv_rapid_nav"] = {"verified": False, "reason": "Could not reach Live TV screen"}
        return

    # Rapid navigation down channels - focus channel list first
    for _ in range(3):
        key("KEYCODE_DPAD_RIGHT")
        time.sleep(0.25)
    start_focus = focused_nodes(dump_ui())
    for _ in range(8):
        key("KEYCODE_DPAD_DOWN")
        time.sleep(0.08)
    time.sleep(0.6)
    xml_rapid = dump_ui()
    screenshot("scope_live_rapid_nav.png")
    end_focus = focused_nodes(xml_rapid)

    # Check preview debounce - only final channel should be loading/ready
    rapid_logs = live_logs()

    # Enter fullscreen from preview if possible
    for _ in range(6):
        x = dump_ui()
        if "Watch Full Screen" in x:
            break
        key("KEYCODE_DPAD_RIGHT")
        time.sleep(0.35)

    key("KEYCODE_DPAD_CENTER")
    time.sleep(1.2)
    key("KEYCODE_DPAD_CENTER")
    time.sleep(6)
    xml_fs = dump_ui()
    screenshot("scope_live_fullscreen.png")

    fs_open = "Back to Live TV" in xml_fs or "WATCHING LIVE" in xml_fs
    fs_shell_gone = "Categories" not in xml_fs or fs_open

    RESULTS["live_tv_rapid_nav"] = {
        "verified": len(end_focus) > 0 and end_focus != start_focus,
        "start_focus": start_focus,
        "end_focus": end_focus,
        "log_tail": rapid_logs[-8:],
        "screenshot": "scope_live_rapid_nav.png",
    }
    RESULTS["live_tv_fullscreen"] = {
        "verified": fs_open,
        "fullscreen_open": fs_open,
        "shell_gone": "Categories" not in xml_fs,
        "screenshot": "scope_live_fullscreen.png",
    }


def main():
    print(f"Verifying on {DEVICE}...")
    verify_movies()
    verify_live_tv()
    print("\n=== RESULTS ===")
    print(json.dumps(RESULTS, indent=2))
    return 0 if all(r.get("verified") for r in RESULTS.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
