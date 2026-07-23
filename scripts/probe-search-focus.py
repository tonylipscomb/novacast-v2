import re
import subprocess
import time

DEVICE = '10.0.0.151:5555'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args: str) -> None:
    subprocess.run(['adb', '-s', DEVICE, *args], capture_output=True)


def key(code: str) -> None:
    adb('shell', 'input', 'keyevent', code)
    time.sleep(0.45)


def dump() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/ps.xml')
    subprocess.run(['adb', '-s', DEVICE, 'pull', '/sdcard/ps.xml', '.logs/ps.xml'], capture_output=True)
    return open('.logs/ps.xml', encoding='utf-8', errors='ignore').read()


def focused_label(xml: str) -> str:
    for node in re.findall(r'<node[^>]*/?>', xml):
        if 'focused="true"' not in node:
            continue
        desc = re.search(r'content-desc="([^"]*)"', node)
        text = re.search(r'text="([^"]*)"', node)
        if desc and desc.group(1):
            return desc.group(1)
        if text and text.group(1):
            return text.group(1)
        return '?'
    return '(none)'


adb('shell', 'am', 'force-stop', PACKAGE)
time.sleep(1)
adb('shell', 'am', 'start', '-n', f'{PACKAGE}/.MainActivity')
time.sleep(7)

key('KEYCODE_DPAD_LEFT')
key('KEYCODE_DPAD_LEFT')
print('start', focused_label(dump())[:70])

for step in range(4):
    key('KEYCODE_DPAD_DOWN')
    print(f'down {step + 1}', focused_label(dump())[:70])

key('KEYCODE_DPAD_CENTER')
time.sleep(2)
xml = dump()
print('entered search screen', 'Search movies' in xml, '| focus', focused_label(xml)[:70])

key('KEYCODE_DPAD_RIGHT')
time.sleep(0.6)
print('right +0.6s', focused_label(dump())[:70])
time.sleep(1.0)
print('right +1.6s', focused_label(dump())[:70])

key('KEYCODE_DPAD_DOWN')
time.sleep(0.6)
print('on tab', focused_label(dump())[:70])

key('KEYCODE_DPAD_UP')
time.sleep(0.6)
print('up +0.6s', focused_label(dump())[:70])
time.sleep(1.0)
print('up +1.6s', focused_label(dump())[:70])

key('KEYCODE_DPAD_LEFT')
time.sleep(0.6)
print('left from search/tab', focused_label(dump())[:70])
