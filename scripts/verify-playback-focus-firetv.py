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
    adb('shell', 'uiautomator', 'dump', '/sdcard/focus.xml')
    return adb('shell', 'cat', '/sdcard/focus.xml').stdout.decode('utf-8', 'ignore')


def find_play_bounds(xml):
    for chunk in xml.split('><'):
        if 'text="Play"' in chunk:
            match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
            if match:
                x1, y1, x2, y2 = map(int, match.groups())
                return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def print_focused(xml):
    focused = [chunk for chunk in xml.split('><') if 'focused="true"' in chunk]
    print('FOCUSED COUNT', len(focused))
    for chunk in focused[:8]:
        text = re.search(r'text="([^"]*)"', chunk)
        desc = re.search(r'content-desc="([^"]*)"', chunk)
        cls = re.search(r'class="([^"]*)"', chunk)
        print({
            'text': text.group(1) if text else '',
            'desc': desc.group(1) if desc else '',
            'class': cls.group(1) if cls else '',
        })


adb('shell', 'am', 'force-stop', 'com.novacast.novacastv2')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(14)
for code in ['22', '22', '20', '23', '22', '22', '22']:
    key(code)
    time.sleep(0.3)

xml = dump()
play_center = find_play_bounds(xml)
print('play center', play_center)
if play_center:
    adb('shell', 'input', 'tap', str(play_center[0]), str(play_center[1]))
time.sleep(12)
xml2 = dump()
print('--- during playback ---')
print_focused(xml2)
time.sleep(5)
xml3 = dump()
print('--- after hide wait ---')
print_focused(xml3)
