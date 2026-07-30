path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v3.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

print("=== long_task_candidate ===")
for line in lines:
    if "long_task_candidate" in line:
        print(line[line.find("[NovaCast") :][:160])

print("\n=== category streams / sync / live http ===")
for i, line in enumerate(lines):
    if not any(
        k in line
        for k in (
            "sqlite-categories-streamed",
            "sqlite-sync-completed",
            "sqlite-sync-started",
            "get_live",
            "interBatch",
            "ColdCategorySpike",
            "sample_5s",
            "marker",
        )
    ):
        continue
    # print compact block
    block = [line]
    j = i + 1
    while j < len(lines) and "ReactNativeJS" in lines[j]:
        s = lines[j]
        body = s[s.find("ReactNativeJS") :]
        if "'[NovaCast" in s or "[NovaCast" in s[s.find(":") :]:
            # new top-level log
            if j > i and ("'[NovaCast" in s or s.rstrip().endswith("}'") is False):
                # if looks like new message start
                if "I ReactNativeJS: '" in s or "I ReactNativeJS: [" in s:
                    break
        block.append(s)
        j += 1
        if len(block) > 20:
            break
    joined = " | ".join(
        (b[b.find("I ReactNativeJS") :] if "I ReactNativeJS" in b else b)[:120] for b in block[:12]
    )
    print(joined[:400])
    print("---")

print("\n=== max lag from samples ===")
import re

lags = [int(x) for x in re.findall(r"longestObservedBlockMs: (\d+)", text)]
print("longestObserved samples:", lags)
avgs = re.findall(r"avgEventLoopLagMs: ([0-9.]+)", text)
print("avg lags:", avgs[:8], "...", avgs[-3:] if len(avgs) > 3 else avgs)

# PSS
print("\n=== looking for memory ===")
for line in lines:
    if "PSS" in line or "pss" in line.lower() and "NovaCast" in line:
        print(line[:160])
