import subprocess, sys, time
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(8)
adb('logcat','-c')
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
# try down then right path to play
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
for i in range(6):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
    shot(f'nav_r{i}.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(8)
shot('nav_playback.png')
print(logs()[-8:])
