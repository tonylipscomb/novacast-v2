import re
import subprocess
import sys
import time
from pathlib import Path

DEVICE = sys.argv[1] if len(sys.argv) > 1 else "10.0.0.151:5555"
OUT = Path(__file__).resolve().parents[1] / "artifacts" / "movies-play-diagnose"


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", DEVICE, *args], capture_output=True, timeout=120)


def play_center(xml_path: Path) -> tuple[int, int] | None:
    xml = xml_path.read_text(encoding="utf-8")
    for node in re.findall(r'<node[^>]*content-desc="Play"[^>]*>', xml):
        match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if match:
            x1, y1, x2, y2 = map(int, match.groups())
            return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def dump(tag: str) -> None:
    adb("shell", "uiautomator", "dump", "/sdcard/nc-tap.xml")
    xml = adb("shell", "cat", "/sdcard/nc-tap.xml").stdout.decode("utf-8", "ignore")
    (OUT / f"{tag}.xml").write_text(xml, encoding="utf-8")
    labels = re.findall(r'text="([^"]+)"', xml)
    interesting = [t for t in labels if t and any(k in t.lower() for k in ("play", "loading", "buffer", "retry", "dismiss", "playback"))]
    print(tag, interesting[:20])


def main() -> None:
    center = play_center(OUT / "02c-focus-play.xml")
    if not center:
        print("Play button not found in dump")
        sys.exit(1)

    x, y = center
    print(f"Tapping Play at {x},{y}")
    adb("logcat", "-c")
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(0.5)
    dump("tap-500ms")
    time.sleep(2)
    dump("tap-2500ms")

    log = adb("logcat", "-d").stdout.decode("utf-8", "ignore")
    hits = [ln for ln in log.splitlines() if "NovaCast" in ln or "ReactNativeJS" in ln]
    (OUT / "tap-logcat.txt").write_text("\n".join(hits[-80:]), encoding="utf-8")
    print(f"log hits: {len(hits)}")
    for ln in hits[-25:]:
        print(ln)


if __name__ == "__main__":
    main()
