import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/pb.xml')
    return adb('shell','cat','/sdcard/pb.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def focused(xml):
    return re.findall(r'focused="true"[^>]*(?:text|content-desc)="([^"]*)"', xml)
def logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
for _ in range(40):
    xml=dump()
    if 'Loading' not in xml and 'FEATURE' in xml:
        break
    time.sleep(1.5)
adb('logcat','-c')
# focus first poster
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
for _ in range(2): key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
shot('pb1.png'); print('focus1', focused(dump()))
key('KEYCODE_DPAD_CENTER'); time.sleep(1)
print('after select', logs()[-3:])
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
shot('pb2.png'); print('focus2', focused(dump()), logs()[-3:])
for _ in range(5):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
xml=dump(); shot('pb3.png')
print('focus3', focused(xml), 'Play' in xml)
time.sleep(0.5)
key('KEYCODE_DPAD_CENTER'); time.sleep(8)
print('after play press', logs()[-5:])
xml2=dump(); shot('pb4.png')
print('playback', focused(xml2), 'Back' in xml2)
