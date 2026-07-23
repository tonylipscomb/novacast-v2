import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args):
    subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def dump_focus(label):
    adb('shell', 'uiautomator', 'dump', '/sdcard/lt2.xml')
    xml = subprocess.run(['adb', '-s', DEVICE, 'shell', 'cat', '/sdcard/lt2.xml'], capture_output=True).stdout.decode('utf-8', 'ignore')
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        bounds = re.search(r'bounds="([^"]*)"', part)
        desc_val = re.sub(r'&#\d+;', '', desc.group(1) if desc else '')
        text_val = text.group(1) if text else ''
        print(label, 'DESC', desc_val[:160])
        print(label, 'TEXT', text_val[:160])
        print(label, 'BOUNDS', bounds.group(1) if bounds else '')
        print(label, 'IS_CATEGORY', 'channels' in desc_val.lower())
        return desc_val
    print(label, 'NO_FOCUSED_NODE')
    return None


adb('shell', 'am', 'force-stop', PACKAGE)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
time.sleep(18)
dump_focus('LAUNCH')

for step in range(1, 5):
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
    dump_focus(f'RIGHT_{step}')

adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN')
time.sleep(0.2)
start = dump_focus('DOWN_1')

for i in range(29):
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN')
    time.sleep(0.08)

end = dump_focus('DOWN_30_TOTAL')
print('SUMMARY category_escape', 'channels' in (end or '').lower())
