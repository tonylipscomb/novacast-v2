# Stage 2.5 ONN acceptance helper.
# Drives D-pad input after launch so FocusLatency logs can be collected.
#
# Usage (after install):
#   python scripts/onn-stage25-focus-drive.py

import subprocess
import time

DEVICE = "10.0.0.151:5555"
PKG = "com.novacast.novacastv2"

UP, DOWN, LEFT, RIGHT = 19, 20, 21, 22


def adb(*args: str) -> None:
    subprocess.check_call(["adb", "-s", DEVICE, *args])


def key(code: int, repeats: int = 1, pause: float = 0.35) -> None:
    for _ in range(repeats):
        adb("shell", "input", "keyevent", str(code))
        time.sleep(pause)


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
    print("Launched. Waiting 12s for first focus...")
    time.sleep(12)

    print("Phase A: Home card <-> navbar + ten navbar + ten home-card moves")
    key(UP, 2, 0.45)
    key(RIGHT, 3, 0.4)
    key(LEFT, 3, 0.4)
    key(RIGHT, 5, 0.22)
    key(LEFT, 5, 0.22)
    key(DOWN, 2, 0.45)
    key(RIGHT, 5, 0.25)
    key(LEFT, 5, 0.25)

    print("Waiting 20s then Phase B burst while sync likely active...")
    time.sleep(20)
    key(UP, 1, 0.4)
    key(RIGHT, 5, 0.22)
    key(LEFT, 5, 0.22)
    key(DOWN, 1, 0.4)
    key(RIGHT, 5, 0.25)
    key(LEFT, 5, 0.25)

    print("Focus drive complete.")


if __name__ == "__main__":
    main()
