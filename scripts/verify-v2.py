import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'; PKG='com.novacast.novacastv2'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/v2.xml')
    return adb('shell','cat','/sdcard/v2.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def texts(xml, limit=50):
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip() and not t.startswith('&#')][:limit]

# Warm start through main menu so provider bundle activates
adb('shell','am','force-stop',PKG); time.sleep(1)
adb('shell','am','start','-n',f'{PKG}/.MainActivity')
for _ in range(40):
    xml=dump()
    if 'WELCOME BACK' in xml or 'Open Live TV' in xml:
        break
    time.sleep(2)
print('WARM START OK')

# MOVIES
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
for _ in range(30):
    xml=dump()
    if 'Movies unavailable' in xml:
        time.sleep(2); continue
    if 'Movies' in xml and 'Loading' not in xml and ('FEATURE' in xml or 'Sort: Popular' in xml):
        break
    time.sleep(2)
shot('v2_movies_ready.png')
print('MOVIES texts:', texts(xml))
movies_ok = 'Movies unavailable' not in xml
adb('logcat','-c')
for _ in range(4):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_CENTER'); time.sleep(1)
sel=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-selected' in l]
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
foc=[l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'movie-focused' in l]
xml=dump(); shot('v2_movies_selected.png')
detail_title=[t for t in texts(xml) if len(t)>8 and t not in ('Sort: Popular','All Movies','Categories','Movies')]
print('SELECT', sel[-1] if sel else 'NONE')
print('FOCUS', foc[-1] if foc else 'NONE')
print('DETAIL', detail_title[:3])
for _ in range(10):
    xml=dump()
    if 'Play' in xml: break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('v2_movies_play_focus.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(6)
xml_pb=dump(); shot('v2_movies_playback.png')
pb_ok='Back' in xml_pb and 'Movies' not in xml_pb and 'Content Hub' not in xml_pb
shell_gone='NOVACAST' not in xml_pb or pb_ok
print('PLAYBACK', pb_ok, 'shell_gone', shell_gone, texts(xml_pb)[:8])
if pb_ok:
    time.sleep(4.5); xml_hide=dump(); shot('v2_movies_hide.png')
    hide_ok=xml_hide.count('Back')<2
    key('KEYCODE_BACK'); time.sleep(1.5); xml_back=dump(); shot('v2_movies_back.png')
    back_ok='Movies' in xml_back and 'Play' in xml_back
    print('CHROME_HIDE', hide_ok, 'BACK_OK', back_ok)
else:
    hide_ok=False; back_ok=False

# LIVE TV
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://live')
for _ in range(30):
    xml=dump()
    if 'Categories' in xml and 'Channels' in xml and 'Loading Live TV' not in xml:
        break
    time.sleep(2)
shot('v2_live_ready.png')
for _ in range(3):
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
xml_before=dump(); shot('v2_live_before_rapid.png')
before_ch=[t for t in texts(xml_before) if 'RELAX' in t or 'UHD' in t or 'WC' in t][:3]
for _ in range(10):
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.08)
time.sleep(0.8)
xml_after=dump(); shot('v2_live_after_rapid.png')
after_ch=[t for t in texts(xml_after) if 'RELAX' in t or 'UHD' in t or 'WC' in t][:3]
rapid_ok = before_ch != after_ch
print('RAPID before', before_ch, 'after', after_ch, 'moved', rapid_ok)
# fullscreen: navigate to Watch Full Screen
for _ in range(8):
    xml=dump()
    if 'Watch Full Screen' in xml:
        break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('v2_live_watch_btn.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(7)
xml_fs=dump(); shot('v2_live_fullscreen.png')
fs_ok='Back to Live TV' in xml_fs or 'WATCHING LIVE' in xml_fs
fs_shell='Categories' not in xml_fs
print('FULLSCREEN', fs_ok, 'shell_gone', fs_shell, texts(xml_fs)[:10])

print('\nSUMMARY')
print('movies_data', movies_ok)
print('movies_selection', bool(sel) and bool(foc) and pb_ok and back_ok)
print('movies_fullscreen', pb_ok and shell_gone and hide_ok)
print('live_rapid', rapid_ok)
print('live_fullscreen', fs_ok and fs_shell)
