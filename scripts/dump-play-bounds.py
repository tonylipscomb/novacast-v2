import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/b.xml')
    return adb('shell','cat','/sdcard/b.xml').stdout.decode('utf-8','ignore')

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(10)
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
xml=dump()
for line in xml.split('><'):
    if 'text="Play"' in line or 'Play</node>' in line or '>Play<' in line:
        print(line[:500])
