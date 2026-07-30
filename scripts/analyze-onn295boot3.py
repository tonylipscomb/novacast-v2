from pathlib import Path

path = Path(r"C:/Users/tonyl/AppData/Local/Temp/onn295boot2.log")
raw = path.read_bytes()
if raw.startswith(b"\xff\xfe") or (len(raw) > 3 and raw[1] == 0):
    text = raw.decode("utf-16", errors="replace")
else:
    text = raw.decode("utf-8", errors="replace")
lines = text.splitlines()
print("bytes", len(raw), "lines", len(lines))
print("marker", text.count("stage295-native-completion-v1"))

print("=== long_task_candidate ===")
for line in lines:
    if "long_task_candidate" in line and "ReactNativeJS" in line:
        print(line[line.find("I ReactNativeJS") :][:260])

print("=== EarlyBoot ===")
for line in lines:
    if "EarlyBoot" in line and "ReactNativeJS" in line:
        print(line[line.find("I ReactNativeJS") :][:260])

print("=== first sample_5s ===")
for i, line in enumerate(lines):
    if "sample_5s" in line and "CatalogAudit" in line:
        for j in range(i, min(i + 14, len(lines))):
            if "ReactNativeJS" in lines[j]:
                print(lines[j][lines[j].find("I ReactNativeJS") :][:220])
        break
