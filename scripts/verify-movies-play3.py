import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/pf.xml')
    return adb('shell','cat','/sdcard/pf.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
for _ in range(30):
    if 'Loading' not in dump() and 'FEATURE' in dump(): break
    time.sleep(1.5)
adb('logcat','-c')
# select first poster in all movies category
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
print('select', [l for l in logs() if 'movie-selected' in l])
# move focus on grid
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
print('focus moved', [l for l in logs() if 'movie-focused' in l][-1:])
# go to play
for _ in range(6):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
shot('pf_play_ready.png')
xml=dump()
if 'Play' not in xml:
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_CENTER')
time.sleep(1)
print('immediate logs', logs()[-5:])
time.sleep(7)
shot('pf_playback.png')
xml2=dump()
print('playback back', 'Back' in xml2, 'novacast shell', 'Movies' in xml2)
