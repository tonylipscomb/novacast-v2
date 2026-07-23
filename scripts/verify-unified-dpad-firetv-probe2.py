"""Continue from successful probe path and test hidden chrome D-pad reveal."""
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
    adb('shell', 'uiautomator', 'dump', '/sdcard/up2.xml')
    return adb('shell', 'cat', '/sdcard/up2.xml').stdout.decode('utf-8', 'ignore')


def focused(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        text = re.search(r'text="([^"]*)"', part)
        return text.group(1) if text else ''
    return ''


def shot(name):
    path = f'{OUT}\\{name}.png'
    open(path, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
    return path


adb('shell', 'am', 'force-stop', PACKAGE)
time.sleep(1)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(12)
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
key('KEYCODE_DPAD_DOWN')
time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
for i in range(10):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.45)
    if focused(dump()) == 'Play':
        print('focused Play after', i + 1, 'rights')
        break
key('KEYCODE_DPAD_CENTER')
time.sleep(10)
shot('ftv_player_visible')
print('player screenshot saved')

print('wait 5s auto-hide')
time.sleep(5)
shot('ftv_player_hidden')
print('hidden screenshot saved')

key('KEYCODE_DPAD_DOWN')
time.sleep(1.2)
shot('ftv_player_after_dpad')
print('after dpad screenshot saved')

key('KEYCODE_DPAD_CENTER')
time.sleep(1)
shot('ftv_player_after_center')

key('KEYCODE_BACK')
time.sleep(1.5)
shot('ftv_player_after_back')
print('done')
