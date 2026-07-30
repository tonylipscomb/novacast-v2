import re
from datetime import datetime

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28a.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()
print("lines", len(lines))
print("batchTotal", sum(1 for l in lines if "batchTotal" in l))
print("ColdCategory", sum(1 for l in lines if "ColdCategorySpike" in l))

batches = []
i = 0
while i < len(lines):
    if "batchTotal" in lines[i]:
        block = "\n".join(lines[i : i + 12])
        if "movie" not in block:
            i += 1
            continue
        m_idx = re.search(r"batchIndex: (\d+)", block)
        m_wall = re.search(r"wallMs: ([0-9.]+)", block)
        m_ts = re.search(r"(\d{2}:\d{2}:\d{2}\.\d{3})", lines[i])
        if m_idx and m_wall and m_ts:
            batches.append((m_ts.group(1), int(m_idx.group(1)), float(m_wall.group(1))))
    i += 1

print("parsed batches", len(batches))
for b in batches:
    if b[1] >= 30:
        print(b)

for a, b in zip(batches, batches[1:]):
    t0 = datetime.strptime(a[0], "%H:%M:%S.%f")
    t1 = datetime.strptime(b[0], "%H:%M:%S.%f")
    gap = (t1 - t0).total_seconds() * 1000
    if gap > 200:
        print(f"GAP {a[1]}->{b[1]}: {gap:.0f}ms")

print("\nRN 00:58:09.5-12.7:")
for line in lines:
    if "ReactNativeJS" not in line:
        continue
    m = re.search(r"00:58:(\d{2}\.\d{3})", line)
    if not m:
        continue
    sec = float(m.group(1))
    if 9.5 <= sec <= 12.7:
        print(line[line.find("I ReactNativeJS") :][:200] if "I ReactNativeJS" in line else line[:200])
