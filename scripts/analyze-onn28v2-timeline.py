import re

path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v2.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

# Extract RN lines with audit t: around 12000-16000
for line in lines:
    if "ReactNativeJS" not in line:
        continue
    if any(
        k in line
        for k in (
            "get_live",
            "long_task",
            "http_",
            "sqlite-",
            "ColdCategory",
            "interBatch",
            "sample_5s",
            "FocusLatency",
            "accent",
        )
    ) or ("'t':" in line and False):
        idx = line.find("I ReactNativeJS")
        print(line[idx:][:220] if idx >= 0 else line[:220])
