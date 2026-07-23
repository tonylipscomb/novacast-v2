"""Verify unified player D-pad reveal on Fire TV during movie playback."""
import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = '10.0.0.179:5555'
PACKAGE = 'com.novacast.novacastv2'
APK = r'C:\Users\tonyl\Desktop\novacast-v2\android\app\build\outputs\apk\release\app-release.apk'


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code: str) -> None:
    adb('shell', 'input', 'keyevent', code)


def dump_xml() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/unified-dpad.xml')
    return adb('shell', 'cat', '/sdcard/unified-dpad.xml').stdout.decode('utf-8', 'ignore')


def has_controls(xml: str) -> bool:
    markers = ('Rewind 10s', 'Forward 30s', 'Pause', 'Play', 'Playback controls')
    return any(marker in xml for marker in markers)


def focused_label(xml: str) -> str:
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        return (desc.group(1) if desc else '') or (text.group(1) if text else '')
    return ''


print('=== install release apk ===')
install = adb('install', '-r', APK)
print(install.stdout.decode('utf-8', 'ignore') or install.stderr.decode('utf-8', 'ignore'))

print('=== launch movies ===')
adb('shell', 'am', 'force-stop', PACKAGE)
time.sleep(1)
adb('logcat', '-c')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(12)

print('=== navigate to movie and start playback ===')
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
for _ in range(3):
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(1.2)
for _ in range(6):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(8)

xml_playing = dump_xml()
print('playback_started_controls_visible=', has_controls(xml_playing))
print('focused=', focused_label(xml_playing))

print('=== wait for chrome auto-hide ===')
time.sleep(5)
xml_hidden = dump_xml()
print('controls_hidden=', not has_controls(xml_hidden))
print('focused_after_hide=', focused_label(xml_hidden))

print('=== d-pad up should reveal controls ===')
key('KEYCODE_DPAD_UP')
time.sleep(1.2)
xml_after_up = dump_xml()
print('controls_after_dpad_up=', has_controls(xml_after_up))
print('focused_after_dpad_up=', focused_label(xml_after_up))

print('=== d-pad center should toggle play/pause ===')
key('KEYCODE_DPAD_CENTER')
time.sleep(1.0)
xml_after_center = dump_xml()
print('controls_after_center=', has_controls(xml_after_center))
print('has_pause_or_play=', ('Pause' in xml_after_center) or ('Play' in xml_after_center))

print('=== d-pad left/right navigate controls ===')
key('KEYCODE_DPAD_LEFT')
time.sleep(0.8)
print('focused_after_left=', focused_label(dump_xml()))
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.8)
print('focused_after_right=', focused_label(dump_xml()))

print('=== back exits playback ===')
key('KEYCODE_BACK')
time.sleep(1.5)
xml_back = dump_xml()
print('returned_to_movies=', 'Movies' in xml_back or 'Play' in xml_back)

logs = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
react_lines = [line for line in logs.splitlines() if 'ReactNativeJS' in line and ('UnifiedRemoteDebug' in line or 'Error' in line)]
print('react_log_lines=', len(react_lines))
for line in react_lines[-8:]:
    print(line)

passed = (
    has_controls(xml_after_up)
    and has_controls(xml_after_center)
    and ('Movies' in xml_back or 'Play' in xml_back)
)
print('RESULT=', 'PASS' if passed else 'FAIL')
sys.exit(0 if passed else 1)
