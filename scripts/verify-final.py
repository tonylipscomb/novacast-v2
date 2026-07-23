import io,re,subprocess,sys,time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
PKG='com.novacast.novacastv2'; D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=60)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/final.xml')
    return adb('shell','cat','/sdcard/final.xml').stdout.decode('utf-8','ignore')
def shot(p): open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def has(xml,*needles):
    return all(n in xml for n in needles)
def movie_logs():
    return [l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'NovaCast Movies UI' in l]

def open_movies():
    adb('shell','am','start','-n',f'{PKG}/.MainActivity')
    time.sleep(4)
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.4)
    key('KEYCODE_DPAD_CENTER'); time.sleep(2)
    for _ in range(8):
        xml=dump()
        if has(xml,'Movies','Play'):
            return xml
        key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
    return dump()

def open_live_tv():
    adb('shell','am','start','-n',f'{PKG}/.MainActivity')
    time.sleep(4)
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.4)
    key('KEYCODE_DPAD_CENTER'); time.sleep(2)
    for _ in range(8):
        xml=dump()
        if 'Live TV' in xml and 'Open Live TV' in xml:
            # focus Open Live TV in hero
            for _ in range(6):
                x=dump()
                if 'Open Live TV' in x:
                    key('KEYCODE_DPAD_CENTER'); time.sleep(10)
                    break
                key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
            break
        key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
    for _ in range(30):
        xml=dump()
        if has(xml,'Categories','Channels') and 'Loading Live TV' not in xml:
            return xml
        time.sleep(2)
    return dump()

results={}

print('=== MOVIES ===')
xml=open_movies(); shot('final_movies_start.png')
adb('logcat','-c')
# select first poster
key('KEYCODE_DPAD_CENTER'); time.sleep(0.7)
sel_logs=[l for l in movie_logs() if 'movie-selected' in l]
# move focus across two more posters
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
focus_logs=[l for l in movie_logs() if 'movie-focused' in l]
# reach play: 6 more rights max
for _ in range(6):
    xml=dump()
    if 'Play' in xml: break
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
shot('final_movies_play_focus.png')
key('KEYCODE_DPAD_CENTER'); time.sleep(4)
xml_pb=dump(); shot('final_movies_playback.png')
results['movies_selection_logs']=sel_logs[-1:] + focus_logs[-2:]
results['movies_playback_opened']='Back' in xml_pb
if results['movies_playback_opened']:
    time.sleep(4.5); xml_hide=dump(); shot('final_movies_chrome_hide.png')
    results['movies_chrome_hidden']=xml_hide.count('Back')<2
    key('KEYCODE_BACK'); time.sleep(1.5); shot('final_movies_back.png')
    results['movies_back_on_movies']=has(dump(),'Movies','Play')
else:
    results['movies_chrome_hidden']=False
    results['movies_back_on_movies']=False

print('=== LIVE TV ===')
xml=open_live_tv(); shot('final_livetv_loaded.png')
results['live_tv_loaded']=has(xml,'Categories','Channels') and 'Loading Live TV' not in xml
if results['live_tv_loaded']:
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.5)
    adb('logcat','-c')
    for _ in range(20):
        key('KEYCODE_DPAD_DOWN'); time.sleep(0.05)
    time.sleep(1); shot('final_livetv_rapid.png')
    results['live_tv_rapid_logs']=len([l for l in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines() if 'preview' in l.lower()])
    key('KEYCODE_DPAD_CENTER'); time.sleep(3)
    xml_fs=dump(); shot('final_livetv_fullscreen.png')
    results['live_tv_fullscreen_opened']='Back to Live TV' in xml_fs
    if results['live_tv_fullscreen_opened']:
        time.sleep(4.5); xml_h=dump(); shot('final_livetv_chrome_hide.png')
        results['live_tv_chrome_hidden']='Back to Live TV' not in xml_h
        key('KEYCODE_BACK'); time.sleep(1.2)
    else:
        results['live_tv_chrome_hidden']=False
else:
    results['live_tv_fullscreen_opened']=False
    results['live_tv_chrome_hidden']=False
    results['live_tv_rapid_logs']=0

print('RESULTS')
for k,v in results.items(): print(k,':',v)
