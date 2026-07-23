import subprocess, time, re
time.sleep(3)
subprocess.run(['adb','-s','emulator-5554','shell','uiautomator','dump','/sdcard/movies.xml'])
xml = subprocess.run(['adb','-s','emulator-5554','shell','cat','/sdcard/movies.xml'], capture_output=True).stdout.decode('utf-8','ignore')
print('has Movies', 'Movies' in xml)
print('has Play', 'Play' in xml)
print('has Walkthrough', 'Walkthrough' in xml)
texts = [m for m in re.findall(r'text="([^"]+)"', xml) if m and m[0].isalnum()][:30]
print('sample texts:', texts)
