import io, re, subprocess, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/scroll.xml')
    return adb('shell', 'cat', '/sdcard/scroll.xml').stdout.decode('utf-8', 'ignore')


def focused_channel_desc(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc_match = re.search(r'content-desc="([^"]*)"', part)
        if not desc_match:
            return None
        return re.sub(r'&#\d+;', '', desc_match.group(1))
    return None


def focused_channel_number(xml):
    desc = focused_channel_desc(xml)
    if not desc:
        return None
    number_match = re.match(r'^(\d{1,3}),', desc)
    return number_match.group(1) if number_match else None


def focus_channel_list():
    for _ in range(2):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    return focused_channel_number(dump())


def launch_live():
    adb('reverse', 'tcp:8081', 'tcp:8081')
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(20)
    return focus_channel_list()


def perf_snapshots(log):
    return re.findall(r"\[LiveTvPerf\]', (\{.*?\})", log)


def run_dpad_focus_burst(label):
    focus1 = launch_live()
    print(f'[{label}] landed_on_channel', focus1)
    adb('logcat', '-c')
    t0 = time.time()
    for _ in range(30):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.06)
    elapsed = time.time() - t0
    time.sleep(0.5)
    focus2 = focused_channel_number(dump())
    log = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
    snaps = perf_snapshots(log)
    print(f'[{label}] focus_before', focus1, 'focus_after30', focus2)
    print(f'[{label}] focus_delta', (int(focus2) - int(focus1)) if focus1 and focus2 and focus1.isdigit() and focus2.isdigit() else 'n/a')
    print(f'[{label}] rapid30_dpad_elapsed_sec', round(elapsed, 2))
    print(f'[{label}] perf_snapshots', len(snaps))
    if snaps:
        print(f'[{label}] perf_last', snaps[-1])
    return elapsed


run_dpad_focus_burst('normal')
