"""Probe movies navigation to start unified playback on Fire TV."""
import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
DEVICE = '10.0.0.179:5555'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/probe.xml')
    return adb('shell', 'cat', '/sdcard/probe.xml').stdout.decode('utf-8', 'ignore')


def focused(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        text = re.search(r'text="([^"]*)"', part)
        desc = re.search(r'content-desc="([^"]*)"', part)
        return (text.group(1) if text else '') or (desc.group(1) if desc else '')
    return ''


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
print('after select focused=', focused(dump()))
for i in range(10):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.45)
    f = focused(dump())
    print(f'right {i+1}: focused={f}')
    if f == 'Play':
        break
key('KEYCODE_DPAD_CENTER')
time.sleep(12)
xml = dump()
open(r'C:\Users\tonyl\Desktop\novacast-v2\up_probe_playback.xml', 'w', encoding='utf-8').write(xml)
open(r'C:\Users\tonyl\Desktop\novacast-v2\up_probe_playback.png', 'wb').write(
    adb('exec-out', 'screencap', '-p').stdout
)
print('after play focused=', focused(xml))
print('rewind=', 'Rewind 10s' in xml)
print('back=', bool(re.search(r'text="Back"', xml)))
print('playback layer=', 'Playback controls' in xml)
