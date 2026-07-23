import re, subprocess, sys, time
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)

adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(10)
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
adb('shell','uiautomator','dump','/sdcard/b.xml')
xml=adb('shell','cat','/sdcard/b.xml').stdout.decode('utf-8','ignore')
for m in re.finditer(r'clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
    x1,y1,x2,y2=map(int,m.groups())
    if 1350<x1<1550 and 960<y1<1040:
        print('clickable', x1,y1,x2,y2, 'center', (x1+x2)//2,(y1+y2)//2)
adb('logcat','-c')
# tap play text area
adb('shell','input','tap','1485','1018')
time.sleep(8)
adb('shell','uiautomator','dump','/sdcard/p.xml')
xml2=adb('shell','cat','/sdcard/p.xml').stdout.decode('utf-8','ignore')
logs=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]
print('logs', logs[-5:])
print('playback', 'Back' in xml2)
open('coord2_playback.png','wb').write(adb('exec-out','screencap','-p').stdout)
