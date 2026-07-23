"""Verify unified player D-pad reveal after chrome hide on Fire TV."""
import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
DEVICE = '10.0.0.179:5555'
PACKAGE = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/up-final.xml')
    return adb('shell', 'cat', '/sdcard/up-final.xml').stdout.decode('utf-8', 'ignore')


def shot(name):
    path = f'{OUT}\\{name}.png'
    open(path, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
    return path


def pixel_is_control_chrome(path):
    """Detect player chrome via bottom gradient panel color sampling."""
    try:
        from PIL import Image
    except ImportError:
        return None
    img = Image.open(path).convert('RGB')
    w, h = img.size
    # sample bottom-left panel area where chrome renders
    samples = [img.getpixel((x, h - 80)) for x in range(40, 240, 40)]
    # chrome panel is dark bluish; pure black video is ~0,0,0
    non_black = sum(1 for r, g, b in samples if r + g + b > 24)
    return non_black >= 2


def start_playback():
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
    time.sleep(12)
    for _ in range(2):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.35)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(1)
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(8)


start_playback()
visible = shot('firetv_up_visible')
print('visible_chrome=', pixel_is_control_chrome(visible))

print('waiting 5s for auto-hide')
time.sleep(5)
hidden = shot('firetv_up_hidden')
hidden_chrome = pixel_is_control_chrome(hidden)
print('hidden_chrome=', hidden_chrome)

for direction, code in [('UP', 'KEYCODE_DPAD_UP'), ('DOWN', 'KEYCODE_DPAD_DOWN'), ('LEFT', 'KEYCODE_DPAD_LEFT'), ('RIGHT', 'KEYCODE_DPAD_RIGHT')]:
    key(code)
    time.sleep(1.0)
    after = shot(f'firetv_up_after_{direction.lower()}')
    chrome = pixel_is_control_chrome(after)
    print(f'after_{direction.lower()}_chrome=', chrome)
    if chrome:
        break

key('KEYCODE_DPAD_CENTER')
time.sleep(0.8)
after_center = shot('firetv_up_after_center')
print('after_center_chrome=', pixel_is_control_chrome(after_center))

key('KEYCODE_BACK')
time.sleep(1.5)
after_back = shot('firetv_up_after_back')
print('after_back_is_browse=', 'Movies' in dump() or pixel_is_control_chrome(after_back) is False)

passed = hidden_chrome is False and pixel_is_control_chrome(after) is True
print('RESULT=', 'PASS' if passed else 'FAIL')
sys.exit(0 if passed else 1)
