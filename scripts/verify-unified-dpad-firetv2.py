"""Focused Fire TV unified player D-pad test with chrome hide wait."""
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
    adb('shell', 'uiautomator', 'dump', '/sdcard/up.xml')
    return adb('shell', 'cat', '/sdcard/up.xml').stdout.decode('utf-8', 'ignore')


def shot(path):
    open(path, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)


def focused(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        return (desc.group(1) if desc else '') or (text.group(1) if text else '')
    return ''


def start_playback():
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
    for _ in range(40):
        body = dump()
        if 'Loading' not in body and ('Movies' in body or 'FEATURE' in body):
            break
        time.sleep(1)
    for _ in range(2):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.3)
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.3)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(1)
    for _ in range(7):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.3)
    shot(r'C:\Users\tonyl\Desktop\novacast-v2\up_before_play.png')
    key('KEYCODE_DPAD_CENTER')
    time.sleep(10)


start_playback()
xml1 = dump()
shot(r'C:\Users\tonyl\Desktop\novacast-v2\up_playing_visible.png')
print('stage=playing_visible')
print('has_rewind=', 'Rewind 10s' in xml1)
print('has_back_btn=', bool(re.search(r'text="Back"', xml1)))
print('focused=', focused(xml1))

print('waiting 5s for auto-hide...')
time.sleep(5)
xml2 = dump()
shot(r'C:\Users\tonyl\Desktop\novacast-v2\up_playing_hidden.png')
print('stage=playing_hidden')
print('has_rewind=', 'Rewind 10s' in xml2)
print('has_playback_layer=', 'Playback controls' in xml2)
print('focused=', focused(xml2))

print('send DPAD_DOWN')
key('KEYCODE_DPAD_DOWN')
time.sleep(1.2)
xml3 = dump()
shot(r'C:\Users\tonyl\Desktop\novacast-v2\up_after_dpad_down.png')
print('stage=after_dpad_down')
print('has_rewind=', 'Rewind 10s' in xml3)
print('focused=', focused(xml3))

print('send DPAD_CENTER')
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
xml4 = dump()
print('stage=after_dpad_center')
print('has_pause=', 'Pause' in xml4)
print('has_play=', 'Play' in xml4)
print('focused=', focused(xml4))

print('send BACK')
key('KEYCODE_BACK')
time.sleep(1.5)
xml5 = dump()
shot(r'C:\Users\tonyl\Desktop\novacast-v2\up_after_back.png')
print('stage=after_back')
print('has_movies=', 'Movies' in xml5)
print('has_detail_play=', bool(re.search(r'text="Play"', xml5)))

passed = ('Rewind 10s' not in xml2 or 'Playback controls' in xml2) and 'Rewind 10s' in xml3
print('RESULT=', 'PASS' if passed else 'FAIL')
