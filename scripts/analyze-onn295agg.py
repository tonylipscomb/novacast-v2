from pathlib import Path
import re

boot = Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295boot3.log").read_text(encoding="utf-8", errors="replace")
soak = Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295soak2.log").read_text(encoding="utf-8", errors="replace")
text = boot + "\n" + soak

keys = [
    "sync_started",
    "sync_completed",
    "sync_requested",
    "NativeCatalogDecode",
    "category-decode-complete",
    "CatalogSqlite",
    "sqlite-sync-completed",
    "smart-building",
    "movie-smart",
    "series-smart",
    "get_vod_streams",
    "get_series",
]
for key in keys:
    print(f"{key}: {text.count(key)}")

lags = [int(x) for x in re.findall(r"lagMs:\s*(\d+)", text)]
print("lags", len(lags), "max", max(lags) if lags else None)

samples = list(re.finditer(r"sample_5s',\s*\{[\s\S]{0,500}", text))
print("sample_5s count", len(samples))
if samples:
    print("last sample:", re.sub(r"\s+", " ", samples[-1].group(0))[:500])

# Parse decode completes with nearby mediaType/matched
blocks = list(re.finditer(r"category-decode-complete',\s*\{([\s\S]{0,350}?)\}", text))
movie_m = series_m = movie_b = series_b = 0
for block in blocks:
    body = block.group(1)
    media = re.search(r"mediaType:\s*'(\w+)'", body)
    matched = re.search(r"matched:\s*(\d+)", body)
    batches = re.search(r"batches:\s*(\d+)", body)
    if not media or not matched:
        continue
    m = int(matched.group(1))
    b = int(batches.group(1)) if batches else 0
    if media.group(1) == "movie":
        movie_m += m
        movie_b += b
    else:
        series_m += m
        series_b += b
print("decode blocks", len(blocks))
print("movie matched", movie_m, "batches", movie_b)
print("series matched", series_m, "batches", series_b)

# CatalogAudit sync_completed payloads
for match in re.finditer(r"sync_completed',\s*\{([\s\S]{0,300}?)\}", text):
    print("sync_completed", re.sub(r"\s+", " ", match.group(1))[:280])

for match in re.finditer(r"sqlite-sync-completed'[\s\S]{0,250}", text):
    print("sqlite", re.sub(r"\s+", " ", match.group(0))[:280])
