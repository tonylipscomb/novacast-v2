import io, re, subprocess, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D='emulator-5554'

def adb(*a):
    return subprocess.run(['adb','-s',D]+list(a),capture_output=True,timeout=90)
def key(c): adb('shell','input','keyevent',c)
def dump():
    adb('shell','uiautomator','dump','/sdcard/f.xml')
    return adb('shell','cat','/sdcard/f.xml').stdout.decode('utf-8','ignore')
def shot(p):
    open(p,'wb').write(adb('exec-out','screencap','-p').stdout)
def channel_nums(xml):
    return re.findall(r'text="(\d{1,3})"[^>]*bounds="\[3\d\d,', xml)

# movies back + chrome
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://movies')
time.sleep(8)
for _ in range(2): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.25)
key('KEYCODE_DPAD_CENTER'); time.sleep(0.8)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.3)
key('KEYCODE_DPAD_DOWN'); time.sleep(0.3)
key('KEYCODE_DPAD_RIGHT'); time.sleep(0.4)
adb('shell','input','tap','1466','1018')
time.sleep(3); shot('backtest_playing.png')
time.sleep(4.5); shot('backtest_hide.png')
xml_hide=dump(); hide_ok='Back' not in xml_hide
key('KEYCODE_BACK'); time.sleep(1.5); shot('backtest_return.png')
xml_back=dump(); back_ok='Movies' in xml_back and 'Play' in xml_back
print('chrome_hide', hide_ok)
print('back_ok', back_ok)

# live scroll/focus
adb('shell','am','start','-a','android.intent.action.VIEW','-d','novacastv2://live')
time.sleep(10)
for _ in range(3): key('KEYCODE_DPAD_RIGHT'); time.sleep(0.25)
xml1=dump(); nums1=channel_nums(xml1); shot('scroll_before.png')
for _ in range(12):
    key('KEYCODE_DPAD_DOWN'); time.sleep(0.08)
time.sleep(0.8)
xml2=dump(); nums2=channel_nums(xml2); shot('scroll_after.png')
print('channels_before', nums1[:6])
print('channels_after', nums2[:6])
print('scroll_moved', nums1!=nums2)
print('focus_ring_visible', 'focused=\"true\"' in xml2)
