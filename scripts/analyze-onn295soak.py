from pathlib import Path
import re
from collections import defaultdict

paths = [
    Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295soak2.log"),
    Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295soak.log"),
    Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295boot3.log"),
]


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xff\xfe") or (len(raw) > 3 and raw[1] == 0):
        return raw.decode("utf-16", errors="replace")
    return raw.decode("utf-8", errors="replace")


text = "\n".join(read_text(p) for p in paths if p.exists())
print("combined_chars", len(text))

print("\n=== native decode ===")
print("movie completes", text.count("mediaType: 'movie'") and text.count("category-decode-complete"))
# crude aggregates from category-decode-complete blocks
movie_matched = [int(x) for x in re.findall(r"mediaType: 'movie'[\s\S]{0,200}?matched: (\d+)", text)]
series_matched = [int(x) for x in re.findall(r"mediaType: 'series'[\s\S]{0,200}?matched: (\d+)", text)]
print("movie matched sum (approx from logs)", sum(movie_matched), "n", len(movie_matched))
print("series matched sum (approx)", sum(series_matched), "n", len(series_matched))

print("\n=== sync lifecycle ===")
for key in [
    "movie-sync-started",
    "movie-sync-completed",
    "series-sync-started",
    "series-sync-completed",
    "sqlite-sync-completed",
    "movie-smart-cache-built",
    "series-smart-cache-built",
    "movie-smart-query",
    "series-smart-query",
    "smart-building",
]:
    print(f"{key}: {text.count(key)}")

print("\n=== lag candidates max ===")
lags = [int(x) for x in re.findall(r"lagMs: (\d+)", text)]
print("count", len(lags), "max", max(lags) if lags else None, "over500", sum(1 for x in lags if x >= 500), "over250", sum(1 for x in lags if x >= 250))

print("\n=== focus summaries ===")
for m in re.finditer(r"FocusLatency[\s\S]{0,40}'summary'[\s\S]{0,400}", text):
    snippet = m.group(0).replace("\n", " ")[:350]
    print(snippet)
    print("---")

print("\n=== registry / cancel ===")
for key in ["provider-jobs-cancelled", "getJobRegistrySnapshot", "activeJobCount", "cancellationCount"]:
    print(key, text.count(key))
