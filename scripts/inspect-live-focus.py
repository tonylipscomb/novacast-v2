import io, re, subprocess, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DEVICE = 'emulator-5554'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


adb('reverse', 'tcp:8081', 'tcp:8081')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
time.sleep(18)
for _ in range(2):
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_RIGHT')
    time.sleep(0.25)

adb('shell', 'uiautomator', 'dump', '/sdcard/f.xml')
xml = adb('shell', 'cat', '/sdcard/f.xml').stdout.decode('utf-8', 'ignore')
focused = [part for part in xml.split('><') if 'focused="true"' in part]
print('focused_count', len(focused))
for part in focused[:10]:
    safe = re.sub(r'[^\x20-\x7E]', '?', part)
    print(safe[:240])

adb('logcat', '-c')
for _ in range(5):
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN')
    time.sleep(0.2)
time.sleep(0.5)
log = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
perf = [line for line in log.splitlines() if 'LiveTvPerf' in line]
print('perf_lines', len(perf))
for line in perf[-3:]:
    print(line[-220:])
