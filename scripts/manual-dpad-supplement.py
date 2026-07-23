"""Supplementary Live TV chrome/back + Movies back restore checks."""
import io
import re
import subprocess
import sys
import time
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
D = 'emulator-5554'
P = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'


def adb(*a):
    return subprocess.run(['adb', '-s', D] + list(a), capture_output=True, timeout=120)


def key(c):
    adb('shell', 'input', 'keyevent', c)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/su.xml')
    return adb('shell', 'cat', '/sdcard/su.xml').stdout.decode('utf-8', 'ignore')


def focus(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        d = re.search(r'content-desc="([^"]*)"', part)
        return re.sub(r'&#\d+;', '', d.group(1) if d else '')
    return None


def shot(name):
    p = f'{OUT}/{name}.png'
    open(p, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
    print('shot', p, flush=True)


def nav_channel():
    adb('shell', 'am', 'force-stop', P)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(16)
    for _ in range(8):
        xml = dump()
        f = focus(xml) or ''
        if re.search(r'^\d+,', f) or '▎' in f:
            return f
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    return focus(dump())


print('=== LIVE TV CHROME/BACK ===', flush=True)
ch = nav_channel()
print('channel', (ch or '')[:80], flush=True)
key('KEYCODE_DPAD_CENTER')
time.sleep(4)
xml = dump()
if 'back to live tv' not in xml.lower():
    for _ in range(6):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.3)
        if 'back to live tv' in dump().lower():
            break
    key('KEYCODE_DPAD_CENTER')
    time.sleep(4)
shot('manual_live_fs_confirm')
time.sleep(6)
shot('manual_live_fs_chrome_autohide')
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
shot('manual_live_fs_chrome_ok')
key('KEYCODE_BACK')
time.sleep(2)
xml = dump()
f = focus(xml)
print('after_back_focus', (f or '')[:100], flush=True)
print('shell_back', 'Live TV' in xml, 'Categories' in xml, flush=True)
shot('manual_live_back_restore')

print('=== MOVIES BACK RESTORE ===', flush=True)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(12)
for _ in range(8):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
    f = focus(dump()) or ''
    if ', Play' in f or f.strip().endswith('Play'):
        break
key('KEYCODE_DPAD_CENTER')
time.sleep(6)
shot('manual_movies_playing2')
key('KEYCODE_BACK')
time.sleep(2)
xml = dump()
print('movies_after_back1', 'Operation Nation' in xml, 'Categories' in xml, 'Movies' in xml, flush=True)
shot('manual_movies_back1')
if 'Categories' not in xml:
    key('KEYCODE_BACK')
    time.sleep(2)
    xml = dump()
    print('movies_after_back2', 'Operation Nation' in xml, 'Categories' in xml, flush=True)
    shot('manual_movies_back2')
