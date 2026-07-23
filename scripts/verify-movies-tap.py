import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/tap.xml')
    return adb('shell','cat','/sdcard/tap.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

def find_play_bounds(xml):
    # find node with text Play inside clickable
    for m in re.finditer(r'<node[^>]*clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>.*?<node[^>]*text="Play"', xml, re.S):
        x1,y1,x2,y2=map(int,m.groups())
        return (x1+x2)//2,(y1+y2)//2
    for m in re.finditer(r'text="Play"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        x1,y1,x2,y2=map(int,m.groups())
        return (x1+x2)//2,(y1+y2)//2
    return None

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(8)
adb('logcat','-c')
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
xml=dump(); shot('tap_play_ready.png')
pt=find_play_bounds(xml)
print('play center', pt)
if pt:
    adb('shell','input','tap',str(pt[0]),str(pt[1]))
time.sleep(8)
shot('tap_playback.png')
xml2=dump()
print('logs', logs()[-6:])
print('playback', 'Back' in xml2)
