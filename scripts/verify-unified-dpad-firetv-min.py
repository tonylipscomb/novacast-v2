"""Minimal Fire TV unified player D-pad validation."""
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
    adb('shell', 'uiautomator', 'dump', '/sdcard/min.xml')
    return adb('shell', 'cat', '/sdcard/min.xml').stdout.decode('utf-8', 'ignore')


def focused():
    xml = dump()
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        text = re.search(r'text="([^"]*)"', part)
        return text.group(1) if text else ''
    return ''


def shot(name):
    path = f'{OUT}\\{name}.png'
    data = adb('exec-out', 'screencap', '-p').stdout
    open(path, 'wb').write(data)
    return path, len(data)


def in_player(xml: str) -> bool:
    return any(token in xml for token in ('Forward 30s', 'Rewind 10s', 'Pause', 'Playback controls'))


adb('shell', 'am', 'force-stop', PACKAGE)
time.sleep(1)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(12)

# categories -> poster -> play
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
key('KEYCODE_DPAD_DOWN')
time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.45)
print('pre_play_focus=', focused())
key('KEYCODE_DPAD_CENTER')
time.sleep(8)
xml = dump()
print('in_player=', in_player(xml), 'focus=', focused())
_, sz = shot('ftv_min_player')
print('player_png_bytes=', sz)

print('wait 5s hide')
time.sleep(5)
xml2 = dump()
print('in_player_after_hide=', in_player(xml2), 'focus=', focused())
_, sz2 = shot('ftv_min_hidden')
print('hidden_png_bytes=', sz2)

print('dpad down reveal')
key('KEYCODE_DPAD_DOWN')
time.sleep(1.2)
xml3 = dump()
print('in_player_after_dpad=', in_player(xml3), 'focus=', focused())
_, sz3 = shot('ftv_min_after_dpad')
print('after_dpad_png_bytes=', sz3)

key('KEYCODE_DPAD_CENTER')
time.sleep(0.8)
xml4 = dump()
print('after_center_focus=', focused(), 'pause=', 'Pause' in xml4, 'play=', 'Play' in xml4)

key('KEYCODE_BACK')
time.sleep(1.2)
print('after_back_focus=', focused())

passed = in_player(xml3) or in_player(xml4)
print('RESULT=', 'PASS' if passed else 'FAIL')
