import io, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(10)
adb('logcat','-c')
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
shot('coord_play_ready.png')
# Play button center from nav_r0 layout
adb('shell','input','tap','1670','695')
time.sleep(8)
shot('coord_playback.png')
print('logs', logs()[-8:])
xml=subprocess.run(['adb','-s',D,'shell','cat','/sdcard/tap.xml'],capture_output=True).stdout.decode('utf-8','ignore') if False else ''
# quick dump
subprocess.run(['adb','-s',D,'shell','uiautomator','dump','/sdcard/c.xml'])
xml=subprocess.run(['adb','-s',D,'shell','cat','/sdcard/c.xml'],capture_output=True).stdout.decode('utf-8','ignore')
print('playback', 'Back' in xml and 'Movies' not in xml)
