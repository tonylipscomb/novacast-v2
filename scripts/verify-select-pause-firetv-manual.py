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
    adb('shell', 'uiautomator', 'dump', '/sdcard/v.xml')
    return adb('shell', 'cat', '/sdcard/v.xml').stdout.decode('utf-8', 'ignore')


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
time.sleep(25)

for code in ['22', '22', '20', '23', '22', '22', '22']:
    key(code)
    time.sleep(0.35)

play_center = find_play_bounds(dump())
print('play center', play_center)
if not play_center:
    sys.exit(1)

adb('shell', 'input', 'tap', str(play_center[0]), str(play_center[1]))
time.sleep(20)
shot('v_start.png')
xml2 = dump()
print('started', {'Back': 'Back' in xml2, 'Pause': 'Pause' in xml2, 'controls': 'Playback controls' in xml2})
time.sleep(6)
shot('v_hidden.png')
key('23')
time.sleep(2)
shot('v_sel1.png')
xml3 = dump()
print('after select 1', {'Back': 'Back' in xml3, 'Pause': 'Pause' in xml3, 'Play': 'Play' in xml3})
key('23')
time.sleep(2)
shot('v_sel2.png')
print('done')
