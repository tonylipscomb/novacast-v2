import io, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/f.xml')
    return adb('shell','cat','/sdcard/f.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
for _ in range(30):
    if 'Loading' not in dump() and 'FEATURE' in dump(): break
    time.sleep(1.5)
adb('logcat','-c')
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)  # select movie A
sel_id = logs()[-1] if logs() else ''
# move to another poster in same row (movie B focus)
for _ in range(3): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
shot('final_sel_focus.png')
# one more right into detail play from rightmost poster
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
shot('final_play_focus.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(8)
shot('final_playback.png')
xml=dump()
print('selected', sel_id)
print('logs', logs()[-6:])
print('playback', 'Back' in xml and 'Movies' not in xml)
time.sleep(4.5); shot('final_chrome_hide.png')
key('KEYCODE_BACK'); time.sleep(1.5); shot('final_back.png')
print('back', 'Movies' in dump())
