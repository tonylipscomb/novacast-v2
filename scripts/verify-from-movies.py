import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=45)
def key(c):
    adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/vs.xml')
    return adb('shell','cat','/sdcard/vs.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def focused(xml):
    out=[]
    for n in re.findall(r'<node[^>]*focused="true"[^>]*/?>',xml):
        for attr in ('text','content-desc'):
            m=re.search(rf'{attr}="([^"]*)"',n)
            if m and m.group(1) and not m.group(1).startswith('&#'): out.append(m.group(1))
    return out
def titles(xml):
    return [t for t in re.findall(r'text="([^"]{4,80})"',xml) if t not in ('Movies','Play','Sort: Popular','More available','Loading')]

print('STATE', dump()[:120])
print('MOVIES SELECTION TEST')
adb('logcat','-c')
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
xml=dump(); sel=titles(xml); print('after OK titles:', sel[:3])
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
for _ in range(8):
    xml=dump()
    if 'Play' in focused(xml): break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
print('play focused:', 'Play' in focused(xml))
key('KEYCODE_DPAD_CENTER'); time.sleep(3)
xml=dump(); shot('verify_movies_playback.png')
print('playback open:', 'Back' in xml)
logs=adb('logcat','-d').stdout.decode('utf-8','ignore')
for line in [l for l in logs.splitlines() if 'NovaCast Movies UI' in l]:
    print(' ', line[line.find('{'):])
if 'Back' in xml:
    time.sleep(4.5); xml2=dump(); print('chrome hidden:', xml2.count('Back')<2)
    key('KEYCODE_BACK'); time.sleep(1.2)
    print('after back focus:', focused(dump()))

print('LIVE TV TEST')
for _ in range(3):
    key('KEYCODE_BACK'); time.sleep(0.8)
for _ in range(10):
    xml=dump()
    if 'Live TV' in focused(xml): break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_CENTER'); time.sleep(8)
xml=dump(); print('live loaded:', 'Categories' in xml and 'Channels' in xml and 'Loading Live TV' not in xml)
if 'Loading Live TV' in xml:
    print('still loading, waiting more'); time.sleep(20); xml=dump(); print('after wait:', 'Loading Live TV' not in xml)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.5)
start=focused(dump()); adb('logcat','-c')
for _ in range(20):
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.05)
time.sleep(1); end=focused(dump()); shot('verify_livetv_rapid3.png')
print('rapid start/end focus:', start, end, 'retained:', bool(end))
key('KEYCODE_DPAD_CENTER'); time.sleep(3); xml=dump(); shot('verify_livetv_fullscreen3.png')
print('fullscreen:', 'Back to Live TV' in xml or 'WATCHING LIVE' in xml)
if 'Back to Live TV' in xml:
    time.sleep(4.5); xml3=dump(); print('chrome hidden:', 'Back to Live TV' not in xml3)
    key('KEYCODE_BACK'); time.sleep(1.2); print('back focus:', focused(dump()))
