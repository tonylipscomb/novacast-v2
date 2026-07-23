import io, json, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'; PKG='com.novacast.novacastv2'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/manual.xml')
    return adb('shell','cat','/sdcard/manual.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def texts(xml):
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()][:40]
def focused(xml):
    return re.findall(r'focused="true"[^>]*(?:text|content-desc)="([^"]*)"', xml)

# MOVIES
adb('shell','am','force-stop',PKG); time.sleep(1)
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(12)
adb('logcat','-c')
xml=dump(); shot('manual_movies_loaded.png')
print('MOVIES loaded texts:', texts(xml))
for _ in range(25):
    xml=dump()
    if 'Loading' not in xml and 'FEATURE' in xml:
        break
    time.sleep(2)
print('MOVIES ready texts:', texts(xml))
# move to grid
for _ in range(5):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('manual_movies_grid.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(1)
sel=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-selected' in l]
print('selected logs', sel[-1:] if sel else 'NONE')
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
foc=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-focused' in l]
print('focus logs', foc[-2:] if foc else 'NONE')
xml=dump(); shot('manual_movies_after_focus.png')
print('detail texts:', [t for t in texts(xml) if t not in ('Movies','Search','Filter')])
for _ in range(10):
    xml=dump()
    if 'Play' in xml: break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('manual_movies_play_btn.png')
print('before play texts:', texts(xml))
key('KEYCODE_DPAD_CENTER'); time.sleep(6)
xml=dump(); shot('manual_movies_playback.png')
print('playback texts:', texts(xml))
print('playback focused:', focused(xml))
print('shell gone', 'NOVACAST' not in xml and 'Categories' not in xml)
time.sleep(4.5)
xml2=dump(); shot('manual_movies_chrome_hide.png')
print('chrome hide texts:', texts(xml2))
key('KEYCODE_BACK'); time.sleep(1.5)
xml3=dump(); shot('manual_movies_back.png')
print('back texts:', texts(xml3))

# LIVE TV
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://live')
time.sleep(15)
xml=dump(); shot('manual_live_loaded.png')
print('LIVE texts:', texts(xml))
for _ in range(30):
    xml=dump()
    if 'Categories' in xml and 'Channels' in xml and 'Loading Live TV' not in xml:
        break
    time.sleep(2)
print('LIVE ready texts:', texts(xml))
for _ in range(3):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
start=focused(dump())
for _ in range(8):
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.08)
time.sleep(0.6)
xml=dump(); shot('manual_live_rapid.png')
end=focused(xml)
print('rapid start', start)
print('rapid end', end)
for _ in range(6):
    xml=dump()
    if 'Watch Full Screen' in xml: break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
key('KEYCODE_DPAD_CENTER'); time.sleep(1)
key('KEYCODE_DPAD_CENTER'); time.sleep(6)
xml=dump(); shot('manual_live_fullscreen.png')
print('fullscreen texts:', texts(xml))
print('fullscreen focused:', focused(xml))
