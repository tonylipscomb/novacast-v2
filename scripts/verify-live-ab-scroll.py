import io, pathlib, re, subprocess, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'
ROOT = pathlib.Path(__file__).resolve().parents[1]
MODE_FILE = ROOT / 'src' / 'features' / 'live' / 'liveTvUiPerfMode.ts'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/ab_scroll.xml')
    return adb('shell', 'cat', '/sdcard/ab_scroll.xml').stdout.decode('utf-8', 'ignore')


def focused_channel_number(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc_match = re.search(r'content-desc="([^"]*)"', part)
        if desc_match:
            desc = re.sub(r'&#\d+;', '', desc_match.group(1))
            number_match = re.match(r'^(\d{1,3}),', desc)
            if number_match:
                return number_match.group(1)
        text_match = re.search(r'text="(\d{1,3})"', part)
        if text_match:
            return text_match.group(1)
    return None


def set_mode(mode):
    text = MODE_FILE.read_text(encoding='utf-8')
    updated = re.sub(
        r"export const LIVE_TV_ROW_AB_MODE: LiveTvRowAbMode = '[^']+';",
        f"export const LIVE_TV_ROW_AB_MODE: LiveTvRowAbMode = '{mode}';",
        text,
        count=1,
    )
    MODE_FILE.write_text(updated, encoding='utf-8')


def reload_live():
    adb('reverse', 'tcp:8081', 'tcp:8081')
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(18)
    for _ in range(2):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.25)


def run_mode(mode):
    set_mode(mode)
    reload_live()
    adb('logcat', '-c')
    focus_before = focused_channel_number(dump())
    t0 = time.time()
    for _ in range(30):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.06)
    elapsed = round(time.time() - t0, 2)
    time.sleep(0.5)
    focus_after = focused_channel_number(dump())
    log = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
    snaps = re.findall(r"\[LiveTvPerf\]', (\{.*?\})", log)
    return {
        'mode': mode,
        'elapsed_sec': elapsed,
        'focus_before': focus_before,
        'focus_after': focus_after,
        'focus_moved': focus_before != focus_after,
        'perf_last': snaps[-1] if snaps else None,
    }


def main():
    modes = sys.argv[1:] if len(sys.argv) > 1 else [
        'normal',
        'lightweight',
        'ab-restore-logos',
        'ab-restore-focus',
        'ab-restore-highlights',
        'ab-restore-detail',
    ]
    results = []
    for mode in modes:
        print(f'running {mode}...', flush=True)
        results.append(run_mode(mode))
    set_mode('normal')
    print('restored normal mode')
    for row in results:
        print(row)


if __name__ == '__main__':
    main()
