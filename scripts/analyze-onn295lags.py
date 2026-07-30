from pathlib import Path
import re

text = Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295soak2.log").read_text(encoding="utf-8", errors="replace")
flat = re.sub(r"\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+I ReactNativeJS:\s*", "", text)

print("=== large lags ===")
for m in re.finditer(r"long_task_candidate',\s*\{([^}]*)\}", flat):
    body = m.group(1)
    lag = re.search(r"lagMs:\s*(\d+)", body)
    if lag and int(lag.group(1)) >= 200:
        start = max(0, m.start() - 200)
        ctx = flat[start : m.end() + 120]
        print(re.sub(r"\s+", " ", ctx)[:500])
        print("---")

print("=== sync lifecycle ===")
for m in re.finditer(r"sync_(started|completed|failed)',\s*\{([^}]*)\}", flat):
    print(m.group(1), re.sub(r"\s+", " ", m.group(2))[:260])

print("=== sqlite completed ===")
for m in re.finditer(r"sqlite-sync-completed'[\s\S]{0,220}", flat):
    print(re.sub(r"\s+", " ", m.group(0))[:280])

print("=== smart ===")
for key in ["smart-building", "movie-smart-query", "series-smart-query", "movie-smart-cache-built", "series-smart-cache-built"]:
    print(key, flat.count(key))

samples = list(re.finditer(r"sample_5s',\s*\{([^}]*)\}", flat))
print("last sample", re.sub(r"\s+", " ", samples[-1].group(0))[:500] if samples else None)
