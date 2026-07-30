import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v2.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

for i, line in enumerate(lines):
    if "long_task_candidate" not in line:
        continue
    print("LAG", line[line.find("[NovaCast") :][:140])
    for j in range(max(0, i - 10), min(len(lines), i + 20)):
        if "ReactNativeJS" not in lines[j]:
            continue
        s = lines[j]
        idx = s.find("I ReactNativeJS")
        print(" ", s[idx:][:190] if idx >= 0 else s[:190])
    print("====")

print("\nLast sample_5s blocks:")
count = 0
for i, line in enumerate(lines):
    if "sample_5s" in line:
        print("\n".join(lines[i : i + 14]))
        print("---")
        count += 1
        if count >= 4:
            break

print("\nmovie-sync / series-sync / items-streamed:")
for line in lines:
    if any(
        k in line
        for k in (
            "movie-sync-completed",
            "series-sync-completed",
            "sqlite-items-streamed",
            "sqlite-sync-completed",
            "get_live_categories",
        )
    ):
        idx = line.find("I ReactNativeJS")
        print(line[idx:][:200] if idx >= 0 else line[:200])
