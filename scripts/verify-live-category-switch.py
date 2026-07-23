import io, re, subprocess, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DEVICE = 'emulator-5554'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/cat_switch.xml')
    return adb('shell', 'cat', '/sdcard/cat_switch.xml').stdout.decode('utf-8', 'ignore')


def has_loading_screen(xml):
    return 'Loading Live TV' in xml


def has_channels(xml):
    return bool(re.search(r'text="Channels"', xml)) and bool(re.search(r'text="(\d{1,3})"', xml))


adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
adb('reverse', 'tcp:8081', 'tcp:8081')
time.sleep(18)
for _ in range(3):
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.25)

xml_before = dump()
assert has_channels(xml_before), 'expected channel list before category switch'

# Move to second category and select
key('KEYCODE_DPAD_LEFT')
time.sleep(0.3)
key('KEYCODE_DPAD_DOWN')
time.sleep(0.3)
t0 = time.time()
key('KEYCODE_DPAD_CENTER')
time.sleep(0.35)
xml_immediate = dump()
immediate_loading = has_loading_screen(xml_immediate)
immediate_channels = has_channels(xml_immediate)
time.sleep(2.5)
xml_settled = dump()
settled_loading = has_loading_screen(xml_settled)
settled_channels = has_channels(xml_settled)
elapsed = round(time.time() - t0, 2)

print('immediate_full_page_loading', immediate_loading)
print('immediate_channels_visible', immediate_channels)
print('settled_full_page_loading', settled_loading)
print('settled_channels_visible', settled_channels)
print('category_switch_elapsed_sec', elapsed)
