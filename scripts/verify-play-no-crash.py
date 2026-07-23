import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D = 'emulator-5554'
PKG = 'com.novacast.novacastv2'


def adb(*args):
    return subprocess.run(['adb', '-s', D, *args], capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/playfix.xml')
    return adb('shell', 'cat', '/sdcard/playfix.xml').stdout.decode('utf-8', 'ignore')


def find_play_bounds(xml):
    for chunk in xml.split('><'):
        if 'text="Play"' in chunk:
            match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
            if match:
                return tuple(map(int, match.groups()))
    return None


adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(10)
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
for _ in range(3):
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(1)

xml = dump()
bounds = find_play_bounds(xml)
if not bounds:
    print('PLAY_NOT_FOUND')
    sys.exit(1)

x1, y1, x2, y2 = bounds
cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
print('PLAY_BOUNDS', bounds, 'tap', cx, cy)

adb('logcat', '-c')
adb('shell', 'input', 'tap', str(cx), str(cy))
time.sleep(12)

xml2 = dump()
crash = adb('logcat', '-d', '-b', 'crash', '-t', '10').stdout.decode('utf-8', 'ignore')
logs = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
pid = adb('shell', 'pidof', PKG).stdout.decode().strip()

print('PID', pid or 'DEAD')
print('FATAL', 'FATAL EXCEPTION' in crash)
print('Back', 'Back' in xml2)
print('Movies', 'Movies' in xml2)
print('play-pressed', any('play-pressed' in line for line in logs.splitlines()))
