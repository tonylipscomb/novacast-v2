import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DEVICE = 'emulator-5554'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=30)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/rt.xml')
    out = adb('shell', 'cat', '/sdcard/rt.xml').stdout.decode('utf-8', errors='ignore')
    return out


def focused_texts(xml):
    texts = []
    for node in re.findall(r'<node[^>]*focused="true"[^>]*/?>', xml):
        for attr in ('text', 'content-desc'):
            m = re.search(rf'{attr}="([^"]*)"', node)
            if m and m.group(1) and not m.group(1).startswith('&#'):
                texts.append(m.group(1))
    return texts


def channel_rows(xml):
    # Channel numbers are short numeric text in channel list
    return re.findall(r'text="(\d{1,4})"', xml)


print('=== LIVE TV RAPID NAV ===')
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.5)
xml0 = dump()
print('start focus:', focused_texts(xml0))
adb('logcat', '-c')
for i in range(20):
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.05)
time.sleep(1.0)
xml1 = dump()
print('end focus:', focused_texts(xml1))
print('focus retained:', bool(focused_texts(xml1)))
log = adb('logcat', '-d').stdout.decode('utf-8', errors='ignore')
preview_req = [line for line in log.splitlines() if 'page-requested' in line or 'preview' in line.lower() or 'chooseLiveChannel' in line]
print('log lines with preview-ish:', len(preview_req))
for line in preview_req[-8:]:
    print(' ', line[-180:])

print('=== LIVE TV FULLSCREEN ===')
key('KEYCODE_DPAD_CENTER')
time.sleep(2.5)
xml2 = dump()
print('fullscreen markers:', 'Back to Live TV' in xml2, 'WATCHING LIVE' in xml2)
adb('exec-out', 'screencap', '-p').stdout
open('verify_livetv_fs.png', 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
time.sleep(4.5)
xml3 = dump()
print('chrome hidden after 4.5s:', 'Back to Live TV' not in xml3)
key('KEYCODE_BACK')
time.sleep(1.2)
xml4 = dump()
print('back focus:', focused_texts(xml4))

print('=== MOVIES SELECTION ===')
# go hub then movies via back and nav
for _ in range(2):
    key('KEYCODE_BACK')
    time.sleep(0.8)
for _ in range(8):
    xml = dump()
    if 'Movies' in focused_texts(xml):
        break
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(2.5)
xmlm = dump()
print('movies screen:', 'Movies' in xmlm, 'Play' in xmlm)
adb('logcat', '-c')
# select first poster
key('KEYCODE_DPAD_CENTER')
time.sleep(0.8)
xml_sel = dump()
# capture detail title - first long title in panel area
titles = re.findall(r'text="([A-Za-z][^"]{4,80})"', xml_sel)
print('visible titles sample:', titles[:6])
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.4)
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.4)
for _ in range(6):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.3)
xml_play = dump()
print('play focused:', 'Play' in focused_texts(xml_play))
key('KEYCODE_DPAD_CENTER')
time.sleep(2.5)
xml_pb = dump()
print('playback:', 'Back' in xml_pb)
open('verify_movies_fs.png', 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
logm = adb('logcat', '-d').stdout.decode('utf-8', errors='ignore')
for line in [l for l in logm.splitlines() if 'NovaCast Movies UI' in l][-10:]:
    print(line[line.find('{'):])
key('KEYCODE_BACK')
time.sleep(1.2)
xml_back = dump()
print('after back focus:', focused_texts(xml_back))
