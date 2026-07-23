import io,re,subprocess,sys,time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=45)
def key(c):
    adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/fv.xml')
    return adb('shell','cat','/sdcard/fv.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def movie_titles(xml):
    return [t for t in re.findall(r'text="(MULTI[^"]{0,60})"',xml)]

# assume on movies grid first poster focused
xml0=dump(); titles0=movie_titles(xml0)
selected_guess=titles0[0] if titles0 else None
print('initial titles', titles0[:4])
adb('logcat','-c')
key('KEYCODE_DPAD_CENTER'); time.sleep(0.7)
xml1=dump(); print('after select titles', movie_titles(xml1)[:4])
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
xml2=dump(); print('after move focus titles', movie_titles(xml2)[:4])
# from poster row move to detail panel play: usually keep going right
for i in range(10):
    xml=dump()
    if 'Play' in xml and 'movie-selected' in adb('logcat','-d').stdout.decode('utf-8','ignore'):
        pass
    key('KEYCODE_DPAD_RIGHT'); time.sleep(0.35)
xml3=dump(); shot('verify_movies_before_play.png')
print('before play titles', movie_titles(xml3)[:4])
key('KEYCODE_DPAD_CENTER'); time.sleep(4)
xml4=dump(); shot('verify_movies_playback_final.png')
print('playback', 'Back' in xml4)
for line in adb('logcat','-d').stdout.decode('utf-8','ignore').splitlines():
    if 'NovaCast Movies UI' in line: print(line[line.find('{'):])
if 'Back' in xml4:
    time.sleep(4.5); shot('verify_movies_chrome_hidden.png')
    key('KEYCODE_BACK'); time.sleep(1.5); shot('verify_movies_after_back.png')
    print('after back titles', movie_titles(dump())[:4])
