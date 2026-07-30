import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v3soak.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

print("=== interBatch / ColdCategory / long_task context ===")
for i, line in enumerate(lines):
    hit = any(
        k in line
        for k in (
            "long_task_candidate",
            "interBatch",
            "batchTotal",
            "batchBreakdown",
            "sqlite-categories-streamed",
        )
    )
    if not hit:
        continue
    if "batchTotal" in line or "batchBreakdown" in line:
        # only print if wall high
        block = "\n".join(lines[i : i + 12])
        if not re.search(r"wallMs: ([1-9]\d{2,}|[5-9]\d)", block) and "689" not in block and "maxChunk" not in block:
            # check wallMs >= 100
            m = re.search(r"wallMs: ([0-9.]+)", block)
            if m and float(m.group(1)) < 100:
                continue
    print("@" + str(i))
    for j in range(max(0, i - 5), min(len(lines), i + 18)):
        if "ReactNativeJS" not in lines[j]:
            continue
        s = lines[j]
        print(" ", s[s.find("I ReactNativeJS") :][:170])
    print("====")

# Find all batchTotal wallMs
walls = []
for i, line in enumerate(lines):
    if "phase: 'batchTotal'" in line or 'phase: "batchTotal"' in line or "phase: 'batchTotal'" in line:
        block = "\n".join(lines[i : i + 8])
        m = re.search(r"wallMs: ([0-9.]+)", block)
        bi = re.search(r"batchIndex: (\d+)", block)
        if m:
            walls.append((int(bi.group(1)) if bi else -1, float(m.group(1))))
walls.sort(key=lambda x: -x[1])
print("\nTop batchTotal walls:", walls[:10])
print("batchTotal count", len(walls))

# sync completed?
print("\nsync completed count", text.count("sqlite-sync-completed"))
for i, line in enumerate(lines):
    if "sqlite-sync-completed" in line:
        print("\n".join(lines[i : i + 8]))
