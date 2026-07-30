import re
from datetime import datetime

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28a.log"
raw = open(path, "rb").read()
if raw.startswith(b"\xff\xfe") or (len(raw) > 2 and raw[1] == 0):
    text = raw.decode("utf-16-le", errors="replace")
else:
    text = raw.decode("utf-8", errors="replace")
lines = text.splitlines()
print("lines", len(lines))
print("cold hits", sum(1 for l in lines if "ColdCategorySpike" in l))

batches = []
i = 0
while i < len(lines):
    if "phase: 'batchTotal'" in lines[i]:
        block = "\n".join(lines[i : i + 12])
        if "mediaType: 'movie'" not in block:
            i += 1
            continue
        m_idx = re.search(r"batchIndex: (\d+)", block)
        m_wall = re.search(r"wallMs: ([0-9.]+)", block)
        m_ts = re.search(r"(\d{2}:\d{2}:\d{2}\.\d{3})", lines[i])
        if m_idx and m_wall and m_ts:
            batches.append((m_ts.group(1), int(m_idx.group(1)), float(m_wall.group(1))))
    i += 1

print("movie batchTotals", len(batches))
if batches:
    print("max wall", max(b[2] for b in batches))
    print("first", batches[0], "last", batches[-1])

for a, b in zip(batches, batches[1:]):
    t0 = datetime.strptime(a[0], "%H:%M:%S.%f")
    t1 = datetime.strptime(b[0], "%H:%M:%S.%f")
    gap = (t1 - t0).total_seconds() * 1000
    if gap > 200:
        print(f"GAP {a[1]}->{b[1]}: {gap:.0f}ms (walls {a[2]} -> {b[2]})")

for i, line in enumerate(lines):
    if "batchBreakdown" in line:
        print("BREAKDOWN", "\n".join(lines[i : i + 14]))
        print("---")

for i, line in enumerate(lines):
    if "sqlite-categories-streamed" in line:
        print("STREAM", "\n".join(lines[i : i + 10]))
        print("---")

for line in lines:
    if "long_task_candidate" in line:
        print("LAG", line[line.find("[NovaCast") :])
