path = r"C:\Users\tonyl\AppData\Local\Temp\onn295boot.log"
lines = open(path, encoding="utf-16", errors="replace").read().splitlines()
for i, line in enumerate(lines):
    if "long_task_candidate" not in line:
        continue
    print("LAG", line.encode("ascii", "replace").decode("ascii")[:160])
    for j in range(max(0, i - 20), min(len(lines), i + 12)):
        if "ReactNativeJS" not in lines[j]:
            continue
        s = lines[j]
        out = s[s.find("I ReactNativeJS") :] if "I ReactNativeJS" in s else s
        print(" ", out.encode("ascii", "replace").decode("ascii")[:180])
    print("====")
