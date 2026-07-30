path = r"C:\Users\tonyl\AppData\Local\Temp\onn28v2.log"
text = open(path, "r", encoding="utf-16", errors="replace").read()
lines = text.splitlines()

# Print multi-line RN blocks for http_end live and sqlite-categories-streamed
i = 0
while i < len(lines):
    line = lines[i]
    if "ReactNativeJS" not in line:
        i += 1
        continue
    interesting = any(
        k in line
        for k in (
            "sqlite-categories-streamed",
            "sqlite-sync-completed",
            "sqlite-items",
            "http_end",
            "durationMs",
            "get_live_categories",
            "long_task_candidate",
            "marker",
        )
    )
    if interesting or ("action:" in line and "live" in line):
        # print this and following indented RN lines
        block = [line]
        j = i + 1
        while j < len(lines) and "ReactNativeJS" in lines[j] and (
            lines[j].strip().endswith(",")
            or "  " in lines[j][lines[j].find("ReactNativeJS") :]
            or lines[j].rstrip().endswith("}")
            or lines[j].rstrip().endswith("},")
        ):
            # continuation of object literal
            if "'[NovaCast" in lines[j] and j > i:
                break
            block.append(lines[j])
            j += 1
            if len(block) > 25:
                break
        joined = "\n".join(b[b.find("I ReactNativeJS") :] if "I ReactNativeJS" in b else b for b in block)
        if any(
            k in joined
            for k in (
                "sqlite-categories-streamed",
                "sqlite-sync-completed",
                "get_live",
                "long_task",
                "http_end",
            )
        ):
            print(joined[:500])
            print("---")
        i = j
        continue
    i += 1
