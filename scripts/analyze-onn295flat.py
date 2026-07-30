from pathlib import Path
import re

text = (
    Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295boot3.log").read_text(encoding="utf-8", errors="replace")
    + "\n"
    + Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295soak2.log").read_text(encoding="utf-8", errors="replace")
)

# RN logs split across lines — flatten CatalogAudit/Native lines roughly
flat = re.sub(r"\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+I ReactNativeJS:\s*", "", text)

samples = list(re.finditer(r"sample_5s',\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", flat))
print("samples", len(samples))
if samples:
    body = samples[-1].group(0)
    print("last", re.sub(r"\s+", " ", body)[:600])

print("syncJobsCompleted markers", flat.count("syncJobsCompleted: 1"), flat.count("syncJobsCompleted: 2"))
print("sync_completed", flat.count("'sync_completed'"))
print("sqlite-sync-completed", flat.count("sqlite-sync-completed"))

# Native decode completes
for media in ("movie", "series"):
    matched = [int(x) for x in re.findall(rf"mediaType: '{media}',\s*matched: (\d+)", flat)]
    batches = [int(x) for x in re.findall(rf"mediaType: '{media}',\s*matched: \d+,\s*batches: (\d+)", flat)]
    print(media, "events", len(matched), "matched_sum", sum(matched), "batch_sum", sum(batches))

lags = [int(x) for x in re.findall(r"lagMs:\s*(\d+)", flat)]
print("maxLag", max(lags) if lags else None, "ge500", sum(1 for x in lags if x >= 500), "ge250", sum(1 for x in lags if x >= 250))

# focus latency samples (individual)
for kind in ("navbar", "homeCard", "home-card"):
    pass
print("FocusLatency sample lines with latencyMs", flat.count("latencyMs"))
for m in re.finditer(r"'summary',\s*\{([^}]*)\}", flat):
    if "FocusLatency" in flat[max(0, m.start() - 80) : m.start()]:
        print("summary", re.sub(r"\s+", " ", m.group(1))[:350])
