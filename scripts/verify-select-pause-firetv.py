import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D = '10.0.0.179:5555'


def adb(*args):
    return subprocess.run(['adb', '-s', D, *args], capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/selectfix.xml')
    return adb('shell', 'cat', '/sdcard/selectfix.xml').stdout.decode('utf-8', 'ignore')


def shot(path):
    with open(path, 'wb') as handle:
        handle.write(adb('exec-out', 'screencap', '-p').stdout)


def find_play_bounds(xml):
    for chunk in xml.split('><'):
        if 'text="Play"' in chunk:
            match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
            if match:
                x1, y1, x2, y2 = map(int, match.groups())
                return (x1 + x2) // 2, (y1 + y2) // 2
    return None


adb('shell', 'am', 'force-stop', 'com.novacast.novacastv2')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(14)

for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.3)
key('KEYCODE_DPAD_DOWN')
time.sleep(0.3)
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
for _ in range(3):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.3)

xml = dump()
play_center = find_play_bounds(xml)
print('play center', play_center)
if not play_center:
    print('PLAY_NOT_FOUND')
    sys.exit(1)

adb('shell', 'input', 'tap', str(play_center[0]), str(play_center[1]))
time.sleep(18)

xml2 = dump()
shot('select_fix_pb_start.png')
in_playback = 'Back' in xml2 or 'Pause' in xml2 or 'Playback controls' in xml2
print('started playback', {'Back': 'Back' in xml2, 'Pause': 'Pause' in xml2, 'Play': 'Play' in xml2, 'in_playback': in_playback})
focused = [chunk for chunk in xml2.split('><') if 'focused="true"' in chunk]
print('focused during playback', len(focused))
for chunk in focused[:5]:
    print(chunk[:240])

if not in_playback:
    print('PLAYBACK_NOT_STARTED')
    sys.exit(2)

time.sleep(5)
shot('select_fix_pb_hidden.png')

key('23')
time.sleep(2)
xml3 = dump()
shot('select_fix_pb_after23a.png')
paused = 'Pause' in xml3
print('after first select', {'Pause': 'Pause' in xml3, 'Back': 'Back' in xml3})

key('23')
time.sleep(2)
xml4 = dump()
shot('select_fix_pb_after23b.png')
print('after second select', {'Pause': 'Pause' in xml4, 'Play': 'Play' in xml4})
print('RESULT paused_on_first_select=', paused)
