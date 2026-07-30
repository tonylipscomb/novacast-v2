import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn29.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

print("bytes lines", len(lines))
print("marker29", "stage29-native-catalog-decode-v1" in text)
print("marker28", "stage28-cold-category-spike" in text)
print("NativeCatalogDecode", "NativeCatalogDecode" in text)
print("native-decode", "native-decode" in text)
print("category-decode-complete", "category-decode-complete" in text)

lags = [(int(t), int(l)) for t, l in re.findall(r"long_task_candidate'.*?\bt: (\d+).*?lagMs: (\d+)", text)]
if not lags:
    lags = []
    for line in lines:
        if "long_task_candidate" in line:
            tm = re.search(r"t: (\d+)", line)
            lm = re.search(r"lagMs: (\d+)", line)
            if tm and lm:
                lags.append((int(tm.group(1)), int(lm.group(1))))
print("long_tasks", len(lags), "top", sorted(lags, key=lambda x: -x[1])[:12])

print("\n=== key events ===")
for line in lines:
    if any(
        k in line
        for k in (
            "stage29",
            "native-decode",
            "NativeCatalogDecode",
            "category-decode-complete",
            "sqlite-categories-streamed",
            "sqlite-sync-completed",
            "movie-sync-completed",
            "series-sync-completed",
            "long_task_candidate",
            "get_series",
            "movie-category-native",
            "series-category-native",
        )
    ):
        idx = line.find("I ReactNativeJS")
        print((line[idx:] if idx >= 0 else line)[:220])

print("\n=== sample longest ===")
for m in re.finditer(
    r"elapsedMs: (\d+),[\s\S]{0,240}?longestObservedBlockMs: (\d+),\s+avgEventLoopLagMs: ([0-9.]+)",
    text,
):
    print(m.groups())
