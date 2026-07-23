"""Short Fire TV validation: catalog sync vs Live TV preview (5 min hold)."""
import io
import json
import re
import subprocess
import sys
import time
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = '10.0.0.179:5555'
PACKAGE = 'com.novacast.novacastv2'
HOLD_SECONDS = 300


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def pid():
    p = adb('shell', 'pidof', PACKAGE)
    return p.stdout.decode().strip() or None


def mem_total_pss():
    raw = adb('shell', 'dumpsys', 'meminfo', PACKAGE).stdout.decode('utf-8', 'ignore')
    m = re.search(r'TOTAL:\s+(\d+)', raw)
    return int(m.group(1)) if m else None


def sync_logs():
    raw = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
    return [line for line in raw.splitlines() if 'CatalogSync' in line or 'sync-yielded' in line or 'sync-deferred' in line]


def launch(route=''):
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1)
    adb('logcat', '-c')
    uri = f'novacastv2://{route}' if route else 'novacastv2://'
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', uri)


def wait_loaded(timeout=90):
    for _ in range(timeout):
        if pid():
            xml = adb('shell', 'uiautomator', 'dump', '/sdcard/syncval.xml').stdout.decode('utf-8', 'ignore')
            body = adb('shell', 'cat', '/sdcard/syncval.xml').stdout.decode('utf-8', 'ignore')
            if 'Loading' not in body and ('Content Hub' in body or 'Live TV' in body or 'Movies' in body):
                return body
        time.sleep(1)
    return ''


report = {
    'started_at': datetime.now().isoformat(),
    'device': DEVICE,
    'snapshots': [],
    'sync_log_lines': [],
    'process_deaths': [],
    'oom_events': [],
}


def snap(stage):
    p = pid()
    pss = mem_total_pss() if p else None
    report['snapshots'].append({'stage': stage, 'timestamp': datetime.now().isoformat(), 'pid': p, 'total_pss_kb': pss})
    print(f'[{stage}] pid={p} pss_kb={pss}')


print('=== cold launch hub (sync should start) ===')
launch('')
time.sleep(15)
wait_loaded()
snap('after_hub_launch_sync_window')

print('=== open Live TV preview ===')
launch('live')
time.sleep(20)
wait_loaded()
# tune first channel preview
for _ in range(3):
    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.4)
key('KEYCODE_DPAD_CENTER')
time.sleep(3)
snap('live_preview_active')

report['sync_log_lines'] = sync_logs()[-40:]
print('sync log lines:', len(report['sync_log_lines']))

print(f'=== hold preview {HOLD_SECONDS}s ===')
start = time.time()
last_pid = pid()
while time.time() - start < HOLD_SECONDS:
    time.sleep(30)
    current = pid()
    if not current:
        report['process_deaths'].append({'at_sec': round(time.time() - start, 1), 'note': 'process missing'})
        print('PROCESS DEATH detected')
        break
    if current != last_pid:
        report['process_deaths'].append({'at_sec': round(time.time() - start, 1), 'note': f'pid changed {last_pid}->{current}'})
        last_pid = current
    snap(f'hold_{int(time.time()-start)}s')

raw = adb('logcat', '-d').stdout.decode('utf-8', 'ignore')
report['oom_events'] = [line for line in raw.splitlines() if 'OutOfMemory' in line or 'lowmemorykiller' in line.lower() or 'Failed to allocate' in line]

key('KEYCODE_BACK')
time.sleep(2)
snap('after_preview_closed')
time.sleep(5)
snap('after_idle_5s')

report['ended_at'] = datetime.now().isoformat()
out_path = r'C:\Users\tonyl\Desktop\novacast-v2\firetv-sync-playback-report.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
print('report written', out_path)
