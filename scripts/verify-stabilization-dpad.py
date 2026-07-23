"""Fast D-pad-only Live TV focus validation for emulator-5554."""
import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/stab-dpad.xml')
    return adb('shell', 'cat', '/sdcard/stab-dpad.xml').stdout.decode('utf-8', 'ignore')


def focused_desc(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        if desc:
            return re.sub(r'&#\d+;', '', desc.group(1))
    return None


def is_category(desc):
    return bool(desc and 'channels' in desc.lower())


def launch_live():
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(16)


def main():
    print('launching', flush=True)
    launch_live()
    for _ in range(2):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    start = focused_desc(dump())
    print('start_focus', start, flush=True)

    for i in range(30):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.08)

    mid = focused_desc(dump())
    print('after_30_down', mid, flush=True)
    print('escaped_to_category_after_down', is_category(mid), flush=True)

    for _ in range(10):
        key('KEYCODE_DPAD_UP')
        time.sleep(0.08)

    end = focused_desc(dump())
    print('after_10_up', end, flush=True)
    print('escaped_to_category_after_up', is_category(end), flush=True)

    key('KEYCODE_DPAD_LEFT')
    time.sleep(0.4)
    left = focused_desc(dump())
    print('after_left', left, flush=True)
    print('intentional_category_focus', is_category(left), flush=True)


if __name__ == '__main__':
    main()
