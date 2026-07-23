import subprocess, time, sys, re

ADB = ['adb', '-s', 'emulator-5554']

def sh(*args, timeout=40):
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

def is_close_button(f):
    return f is not None and 'Back to Live TV' in (f[0] or '')

def is_channel_row(f):
    return f is not None and ('RELAXTIME' in (f[0] or '') or re.match(r'^\d+, ', f[0] or ''))

def is_content_hub_ish(f):
    if f is None:
        return False
    d = (f[0] or '').lower()
    return 'provider' in d or 'manage' in d or 'content hub' in d

CYCLES = int(sys.argv[1]) if len(sys.argv) > 1 else 10
results = []

for i in range(CYCLES):
    f_before = dump_focused()
    if not is_channel_row(f_before):
        print(f"Cycle {i+1}: ABORT - not starting on a channel row: {f_before}")
        break

    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.2)
    f1 = dump_focused()

    if is_close_button(f1):
        entered = True
    else:
        # First press only tuned; second press should enter fullscreen now that it's ready.
        key('KEYCODE_DPAD_CENTER')
        time.sleep(2.2)
        f1 = dump_focused()
        entered = is_close_button(f1)

    key('KEYCODE_BACK')
    time.sleep(1.8)
    f_after_back = dump_focused()
    back_restored_channel_focus = is_channel_row(f_after_back)

    key('KEYCODE_DPAD_DOWN')
    time.sleep(1.3)
    f_after_down = dump_focused()
    hub_opened = is_content_hub_ish(f_after_down)

    print(f"Cycle {i+1}: entered_fullscreen={entered} focus_after_back={f_after_back} restored_ok={back_restored_channel_focus} focus_after_down={f_after_down} HUB_OPENED={hub_opened}")

    results.append(dict(entered=entered, restored_ok=back_restored_channel_focus, hub_opened=hub_opened))

    # Recenter: move focus back up to row 1 (bounded, small number of presses).
    for _ in range(3):
        key('KEYCODE_DPAD_UP')
        time.sleep(0.3)
    time.sleep(0.5)

print()
print('SUMMARY: cycles run =', len(results))
print('SUMMARY: fullscreen entered every cycle =', all(r['entered'] for r in results))
print('SUMMARY: focus restored to channel row every cycle =', all(r['restored_ok'] for r in results))
print('SUMMARY: hub opened count =', sum(1 for r in results if r['hub_opened']))
