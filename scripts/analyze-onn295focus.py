from pathlib import Path
import re

for name in ["onn295boot3.log", "onn295soak2.log"]:
    path = Path(r"C:/Users/tonyl/AppData/Local/Temp") / name
    if not path.exists():
        print(name, "missing")
        continue
    raw = path.read_bytes()
    enc = "utf-16" if raw.startswith(b"\xff\xfe") or (len(raw) > 3 and raw[1] == 0) else "utf-8"
    text = raw.decode(enc, errors="replace")
    print(name, "enc", enc, "bytes", len(raw))
    for key in [
        "category-decode-complete",
        "movie-sync-started",
        "movie-sync-completed",
        "series-sync-started",
        "series-sync-completed",
        "sqlite-sync-completed",
        "smart-building",
        "series-smart-query",
        "movie-smart-query",
        "FocusLatency",
    ]:
        print(f"  {key}: {text.count(key)}")
    lags = [int(x) for x in re.findall(r"lagMs:\s*(\d+)", text)]
    print("  lags", len(lags), "max", max(lags) if lags else None)
    for match in re.finditer(r"FocusLatency[\s\S]{0,30}'summary'[\s\S]{0,450}", text):
        print("  SUMMARY", re.sub(r"\s+", " ", match.group(0))[:420])
    print()
