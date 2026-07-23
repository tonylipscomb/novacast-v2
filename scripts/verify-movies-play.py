import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'; PKG='com.novacast.novacastv2'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/mv.xml')
    return adb('shell','cat','/sdcard/mv.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(10)
adb('logcat','-c')
# from nav/home focus: right x2 into categories, down into posters
for _ in range(2):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
for _ in range(3):
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.35)
shot('mv_step1_poster.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(1)
sel=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-selected' in l]
print('SELECT', sel[-1] if sel else 'NONE')
# move focus to another poster
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
shot('mv_step2_focus_moved.png')
foc=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-focused' in l]
print('FOCUS', foc[-1] if foc else 'NONE')
# move to play button in detail panel
for _ in range(6):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('mv_step3_play.png')
xml=dump()
print('HAS PLAY', 'Play' in xml)
key('KEYCODE_DPAD_CENTER'); time.sleep(6)
xml2=dump(); shot('mv_step4_playback.png')
print('PLAYBACK', 'Back' in xml2, 'shell', 'NOVACAST' in xml2)
time.sleep(4.5); shot('mv_step5_hide.png')
key('KEYCODE_BACK'); time.sleep(1.5); shot('mv_step6_back.png')
xml3=dump()
print('BACK', 'Movies' in xml3, 'Play' in xml3)
