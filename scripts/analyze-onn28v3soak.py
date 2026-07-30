import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v3soak.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()

print("marker v3 boot:", "stage28-cold-category-spike-v3" in text and "[NovaCast Catalog] stage28" in text)
print("marker lines:")
for line in text.splitlines():
    if "stage28-cold-category-spike" in line:
        print(" ", line[line.find("NovaCast") :][:120] if "NovaCast" in line else line[:120])

print("\nlong_task_candidate:")
lags = []
for line in text.splitlines():
    if "long_task_candidate" in line:
        m = re.search(r"lagMs: (\d+)", line)
        t = re.search(r"t: (\d+)", line)
        lag = int(m.group(1)) if m else None
        tt = int(t.group(1)) if t else None
        lags.append((tt, lag))
        print(f"  t={tt} lagMs={lag}")
print("max lag:", max((l for _, l in lags), default=0))

print("\nstreams:")
for line in text.splitlines():
    if any(
        k in line
        for k in (
            "sqlite-categories-streamed",
            "sqlite-sync-completed",
            "sqlite-items-streamed",
            "interBatch",
        )
    ):
        # grab following fields from nearby lines by searching object
        pass

# multiline extract for streamed/completed
pat = re.compile(
    r"message: '(sqlite-[^']+)'[\s\S]{0,500}?\}",
    re.M,
)
# simpler line-walk
lines = text.splitlines()
i = 0
while i < len(lines):
    if "sqlite-categories-streamed" in lines[i] or "sqlite-sync-completed" in lines[i] or "sqlite-items-streamed" in lines[i]:
        block = []
        for j in range(i, min(i + 15, len(lines))):
            if "ReactNativeJS" in lines[j]:
                block.append(lines[j][lines[j].find("I ReactNativeJS") :])
            if lines[j].rstrip().endswith("}") and j > i:
                break
        print("\n".join(block[:12]))
        print("---")
    i += 1

print("\nsample longest / avg (first+last):")
samples = re.findall(
    r"elapsedMs: (\d+),\s+syncJobsStarted: (\d+),\s+syncJobsCompleted: (\d+),\s+catalogItemsProcessed: (\d+),[\s\S]{0,200}?longestObservedBlockMs: (\d+),\s+avgEventLoopLagMs: ([0-9.]+)",
    text,
)
for s in samples[:3]:
    print(" early", s)
for s in samples[-3:]:
    print(" late", s)

print("\nget_live:")
for line in text.splitlines():
    if "get_live_categories" in line:
        print(" ", line[line.find("I ReactNative") :][:160] if "I ReactNative" in line else line[:160])

print("\nFocusLatency summary:")
for i, line in enumerate(lines):
    if "FocusLatency" in line and ("summary" in line or "phase" in line):
        block = [line]
        for j in range(i + 1, min(i + 12, len(lines))):
            if "ReactNativeJS" in lines[j]:
                block.append(lines[j])
            if lines[j].rstrip().endswith("}"):
                break
        print("\n".join(b[b.find("I ReactNative") :][:140] if "I ReactNative" in b else b[:140] for b in block))
        print("---")
