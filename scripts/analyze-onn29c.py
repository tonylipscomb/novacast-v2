import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn29c.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

print("=== long tasks ===")
for line in lines:
    if "long_task_candidate" in line:
        print(line[line.find("[NovaCast") :][:160])

print("\n=== native decode samples (first 3 + stats aggregate) ===")
matched_total = 0
batches_total = 0
max_batch = 0
raw_seen = 0
download_ms = []
i = 0
count = 0
while i < len(lines):
    if "category-decode-complete" in lines[i]:
        block = "\n".join(lines[i : i + 20])
        count += 1
        m = re.search(r"matched: (\d+)", block)
        b = re.search(r"batches: (\d+)", block)
        mb = re.search(r"maxBatchSize: (\d+)", block)
        rs = re.search(r"rawSeen: (\d+)", block)
        dp = re.search(r"downloadParseMs: (\d+)", block)
        mt = re.search(r"mediaType: '(\w+)'", block)
        if m:
            matched_total += int(m.group(1))
        if b:
            batches_total += int(b.group(1))
        if mb:
            max_batch = max(max_batch, int(mb.group(1)))
        if rs:
            raw_seen += int(rs.group(1))
        if dp:
            download_ms.append(int(dp.group(1)))
        if count <= 3:
            print(block[:500])
            print("---")
    i += 1

print(
    "decodeCompletes",
    count,
    "matchedSum",
    matched_total,
    "batchesSum",
    batches_total,
    "maxBatch",
    max_batch,
    "rawSeenSum",
    raw_seen,
)
if download_ms:
    print("downloadParseMs max/avg", max(download_ms), sum(download_ms) / len(download_ms))

print("\nJS get_series http_start count", text.count("action: 'get_series'"))
print("JS get_vod_streams http_start count", text.count("action: 'get_vod_streams'"))
print("movie-category-native-decode count", text.count("movie-category-native-decode"))
print("series-category-native-decode count", text.count("series-category-native-decode"))

print("\nsqlite sync completed:")
for i, line in enumerate(lines):
    if "sqlite-sync-completed" in line or "movie-sync-completed" in line or "series-sync-completed" in line:
        print("\n".join(lines[i : i + 8])[:400])
        print("---")

print("\nsamples longest:")
for m in re.finditer(r"longestObservedBlockMs: (\d+)", text):
    pass
vals = [int(x) for x in re.findall(r"longestObservedBlockMs: (\d+)", text)]
avgs = re.findall(r"avgEventLoopLagMs: ([0-9.]+)", text)
print("longestObserved max", max(vals) if vals else None, "last", vals[-1] if vals else None)
print("avg lag first/last", avgs[:2], avgs[-2:])
