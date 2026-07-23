import io, re, subprocess, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DEVICE = 'emulator-5554'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/nav.xml')
    return adb('shell', 'cat', '/sdcard/nav.xml').stdout.decode('utf-8', 'ignore')


def focused_desc(xml):
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        return {
            'text': text.group(1) if text else '',
            'desc': desc.group(1) if desc else '',
            'snippet': re.sub(r'[^\x20-\x7E]', '?', part)[:200],
        }
    return None


adb('reverse', 'tcp:8081', 'tcp:8081')
adb('shell', 'am', 'force-stop', 'com.novacast.novacastv2')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
time.sleep(18)

for right_count in range(4):
    xml = dump()
    print('after', right_count, 'RIGHT ->', focused_desc(xml))
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)

# try channel down from 1 RIGHT position
adb('shell', 'am', 'force-stop', 'com.novacast.novacastv2')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
time.sleep(18)
adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_RIGHT')
time.sleep(0.35)
adb('logcat', '-c')
for i in range(5):
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN')
    time.sleep(0.25)
    xml = dump()
    print('down', i + 1, '->', focused_desc(xml))
log = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
perf = [line for line in log.splitlines() if 'LiveTvPerf' in line]
print('perf_lines', len(perf))
if perf:
    print('perf_last', perf[-1][-220:])
