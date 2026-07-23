import subprocess, time, sys, re

ADB = ['adb', '-s', 'emulator-5554']

def sh(*args, timeout=20):
    return subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)

def key(code):
    sh(*ADB, 'shell', 'input', 'keyevent', code)

def dump_focused():
    sh(*ADB, 'shell', 'uiautomator', 'dump', '/sdcard/cyc.xml')
    sh(*ADB, 'pull', '/sdcard/cyc.xml', 'C:/nc/cyc.xml')
    data = open('C:/nc/cyc.xml', encoding='utf-8').read()
    for m in re.finditer(r'<node[^>]*>', data):
        g = m.group()
        if 'focused="true"' in g:
            desc = re.search(r'content-desc="([^"]*)"', g)
            bounds = re.search(r'bounds="([^"]*)"', g)
            return (desc.group(1) if desc else '', bounds.group(1) if bounds else '')
    return None

def is_content_hub(focused):
    if focused is None:
        return False
    desc, _ = focused
    return 'content' in desc.lower() or 'hub' in desc.lower() or 'provider' in desc.lower()

results = []
CYCLES = int(sys.argv[1]) if len(sys.argv) > 1 else 10

for i in range(CYCLES):
    # Assume focus is currently on a channel row (index 0 or wherever last left).
    # Press OK to select/preview (no-op if already selected+ready -> may enter fullscreen directly)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.5)
    f1 = dump_focused()
    # Press OK again in case first press only tuned (didn't enter fullscreen yet)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.5)
    f2 = dump_focused()

    entered_fullscreen = (f2 is not None and 'Back to Live TV' in (f2[0] or ''))
    if not entered_fullscreen and f1 is not None and 'Back to Live TV' in (f1[0] or ''):
        entered_fullscreen = True

    # Close fullscreen via hardware Back.
    key('KEYCODE_BACK')
    time.sleep(2.0)
    after_back = dump_focused()

    # The stray input that previously escaped to Content Hub.
    key('KEYCODE_DPAD_DOWN')
    time.sleep(1.5)
    after_down = dump_focused()

    hub_opened = is_content_hub(after_down)

    results.append({
        'cycle': i + 1,
        'entered_fullscreen': entered_fullscreen,
        'after_back': after_back,
        'after_down': after_down,
        'hub_opened': hub_opened,
    })

    print(f"Cycle {i+1}: fullscreen_entered={entered_fullscreen} after_back={after_back} after_down={after_down} HUB_OPENED={hub_opened}")

    # Move focus back up to row 1 for a clean repeat (Up a few times is safe/no-op at top).
    key('KEYCODE_DPAD_UP')
    time.sleep(0.5)
    key('KEYCODE_DPAD_UP')
    time.sleep(0.8)

print()
print('SUMMARY: hub_opened count =', sum(1 for r in results if r['hub_opened']))
print('SUMMARY: fullscreen_entered count =', sum(1 for r in results if r['entered_fullscreen']))
