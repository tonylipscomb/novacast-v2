import re, subprocess, time

DEVICE = 'emulator-5554'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=90)


adb('reverse', 'tcp:8081', 'tcp:8081')
adb('shell', 'am', 'force-stop', 'com.novacast.novacastv2')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
time.sleep(18)
adb('shell', 'uiautomator', 'dump', '/sdcard/debug.xml')
xml = adb('shell', 'cat', '/sdcard/debug.xml').stdout.decode('utf-8', 'ignore')
print('xml_len', len(xml))
for token in ['Loading Live TV', 'Channels', 'Categories', 'Live TV unavailable', 'No channels', 'Provider']:
    print(token, token in xml)
nums = re.findall(r'text="(\d{1,3})"', xml)
print('nums_sample', nums[:15])
