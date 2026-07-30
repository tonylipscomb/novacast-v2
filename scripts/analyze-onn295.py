import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn295dual.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

print("marker", "stage295-native-completion-v1" in text)
print("chars", len(text), "lines", len(lines))

print("\n=== long_task_candidate ===")
lags = []
for line in lines:
    if "long_task_candidate" in line:
        tm = re.search(r"t: (\d+)", line)
        lm = re.search(r"lagMs: (\d+)", line)
        if tm and lm:
            lags.append((int(tm.group(1)), int(lm.group(1))))
            print(f"  t={tm.group(1)} lagMs={lm.group(1)}")
print("max lag", max((l for _, l in lags), default=0))

print("\n=== early boot slow_op / marks (first 20) ===")
n = 0
for line in lines:
    if "EarlyBoot" in line and ("slow_op" in line or "'mark'" in line or "mark'," in line):
        print(line[line.find("[NovaCast") :][:180] if "[NovaCast" in line else line[:180])
        n += 1
        if n >= 25:
            break

print("\n=== analytics timing ===")
for line in lines:
    if "analytics" in line.lower() and ("EarlyBoot" in line or "app metadata" in line or "analytics_init" in line):
        print(line[line.find("I ReactNativeJS") :][:180] if "I ReactNativeJS" in line else line[:180])

print("\n=== native decode aggregates ===")
movie_m = series_m = movie_b = series_b = 0
max_batch = 0
max_dl = 0
completes = 0
for m in re.finditer(
    r"category-decode-complete', \{ mediaType: '(\w+)',[\s\S]{0,400}?matched: (\d+),[\s\S]{0,200}?batches: (\d+),[\s\S]{0,200}?maxBatchSize: (\d+),[\s\S]{0,350}?downloadParseMs: (\d+)",
    text,
):
    mt, matched, batches, mb, dl = m.groups()
    completes += 1
    max_batch = max(max_batch, int(mb))
    max_dl = max(max_dl, int(dl))
    if mt == "movie":
        movie_m += int(matched)
        movie_b += int(batches)
    else:
        series_m += int(matched)
        series_b += int(batches)
print(
    "completes",
    completes,
    "movieMatched",
    movie_m,
    "movieBatches",
    movie_b,
    "seriesMatched",
    series_m,
    "seriesBatches",
    series_b,
    "maxBatch",
    max_batch,
    "maxNativeDlMs",
    max_dl,
)
print("JS get_series", text.count("action: 'get_series'"), "JS get_vod", text.count("action: 'get_vod_streams'"))

print("\n=== sync completion ===")
for key in (
    "movie-sync-completed",
    "series-sync-completed",
    "sqlite-sync-completed",
    "movie-sync-started",
    "series-sync-started",
):
    print(key, text.count(key))

for i, line in enumerate(lines):
    if "sqlite-sync-completed" in line or "movie-sync-completed" in line or "series-sync-completed" in line:
        print("\n".join(x[x.find("I ReactNativeJS") :][:120] if "I ReactNativeJS" in x else x[:120] for x in lines[i : i + 8]))
        print("---")

print("\n=== focus latency ===")
for i, line in enumerate(lines):
    if "FocusLatency" in line and ("summary" in line or "physical_remote" in line or "phase" in line):
        block = [line]
        for j in range(i + 1, min(i + 15, len(lines))):
            if "ReactNativeJS" in lines[j]:
                block.append(lines[j])
            if lines[j].rstrip().endswith("}") and j > i:
                break
        print("\n".join(b[b.find("I ReactNativeJS") :][:140] if "I ReactNativeJS" in b else b[:140] for b in block[:12]))
        print("---")

print("\n=== sample longestObserved ===")
vals = [int(x) for x in re.findall(r"longestObservedBlockMs: (\d+)", text)]
avgs = re.findall(r"avgEventLoopLagMs: ([0-9.]+)", text)
print("longest max/last", max(vals) if vals else None, vals[-1] if vals else None)
print("avg first/last", avgs[:3], avgs[-3:])

print("\nAsyncStorage writes last sample:")
# find last sample
idx = text.rfind("sample_5s")
print(text[idx : idx + 400] if idx >= 0 else "none")
