"""Step-by-step Fire TV unified player D-pad verification."""
import io
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
DEVICE = '10.0.0.179:5555'
PACKAGE = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def shot(name):
    path = f'{OUT}\\{name}.png'
    open(path, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
    print('saved', name)


adb('shell', 'am', 'force-stop', PACKAGE)
time.sleep(1)
adb('logcat', '-c')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
time.sleep(12)

for _ in range(2):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.35)
key('KEYCODE_DPAD_DOWN')
time.sleep(0.35)
key('KEYCODE_DPAD_CENTER')
time.sleep(1.2)
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.45)
key('KEYCODE_DPAD_RIGHT')
time.sleep(0.45)
shot('ftv_step_pre_play')
key('KEYCODE_DPAD_CENTER')
time.sleep(10)
shot('ftv_step_in_player')

print('waiting 5s for chrome hide')
time.sleep(5)
shot('ftv_step_hidden')

print('sending DPAD_DOWN')
key('KEYCODE_DPAD_DOWN')
time.sleep(1.2)
shot('ftv_step_after_dpad')

print('sending DPAD_CENTER toggle')
key('KEYCODE_DPAD_CENTER')
time.sleep(1.0)
shot('ftv_step_after_center')

print('sending BACK')
key('KEYCODE_BACK')
time.sleep(1.5)
shot('ftv_step_after_back')

logs = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
for line in logs.splitlines():
    if 'ReactNativeJS' in line and ('Error' in line or 'FATAL' in line or 'UnifiedRemoteDebug' in line):
        print(line)

print('done')
