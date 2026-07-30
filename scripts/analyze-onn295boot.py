path = r"C:\Users\tonyl\AppData\Local\Temp\onn295boot.log"
lines = open(path, encoding="utf-16", errors="replace").read().splitlines()

print("=== EarlyBoot slow_op blocks ===")
i = 0
while i < len(lines):
    if "slow_op" in lines[i] and "EarlyBoot" in lines[i]:
        block = []
        for j in range(i, min(i + 14, len(lines))):
            if "ReactNativeJS" not in lines[j]:
                continue
            if j > i and "I ReactNativeJS: '" in lines[j] and "EarlyBoot" not in lines[j]:
                break
            if j > i and "I ReactNativeJS: [" in lines[j]:
                break
            block.append(lines[j])
        for b in block:
            print(b[b.find("I ReactNativeJS") :][:170])
        print("---")
        i += max(1, len(block))
        continue
    i += 1

print("\n=== lag context ===")
for i, line in enumerate(lines):
    if "long_task_candidate" not in line:
        continue
    for j in range(max(0, i - 15), min(len(lines), i + 10)):
        if "ReactNativeJS" in lines[j]:
            s = lines[j]
            print(s[s.find("I ReactNativeJS") :][:180])
    print("====")
