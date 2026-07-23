"""Fire TV memory and long-session stability audit for NovaCast v2."""
import io
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = os.environ.get('NOVACAST_DEVICE', '10.0.0.179:5555')
PACKAGE = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'
STRESS_MINUTES = int(os.environ.get('NOVACAST_STRESS_MINUTES', '18'))
NAV_LOOPS = int(os.environ.get('NOVACAST_NAV_LOOPS', '8'))


@dataclass
class MemSnapshot:
    stage: str
    timestamp: str
    total_pss_kb: Optional[int] = None
    native_heap_kb: Optional[int] = None
    dalvik_heap_kb: Optional[int] = None
    graphics_kb: Optional[int] = None
    views: Optional[int] = None
    activities: Optional[int] = None
    process_exists: bool = True
    raw_note: str = ''


@dataclass
class AuditReport:
    device: str
    package: str
    started_at: str
    ended_at: str = ''
    duration_seconds: float = 0
    snapshots: list = field(default_factory=list)
    peak_pss_kb: Optional[int] = None
    oom_events: list = field(default_factory=list)
    crash_events: list = field(default_factory=list)
    nav_notes: list = field(default_factory=list)
    automated_stages: list = field(default_factory=list)
    manual_gaps: list = field(default_factory=list)


def adb(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['adb', '-s', DEVICE] + list(args),
        capture_output=True,
        timeout=timeout,
    )


def key(code: str) -> None:
    adb('shell', 'input', 'keyevent', code)


def parse_meminfo(raw: str) -> dict:
    out: dict = {}
    m = re.search(r'TOTAL\s+(\d+)', raw)
    if m:
        out['total_pss_kb'] = int(m.group(1))
    m = re.search(r'Native Heap:\s+(\d+)', raw)
    if m:
        out['native_heap_kb'] = int(m.group(1))
    m = re.search(r'Dalvik Heap:\s+(\d+)', raw)
    if m:
        out['dalvik_heap_kb'] = int(m.group(1))
    m = re.search(r'Graphics:\s+(\d+)', raw)
    if m:
        out['graphics_kb'] = int(m.group(1))
    m = re.search(r'Views:\s+(\d+)', raw)
    if m:
        out['views'] = int(m.group(1))
    m = re.search(r'Activities:\s+(\d+)', raw)
    if m:
        out['activities'] = int(m.group(1))
    return out


def capture_mem(stage: str) -> MemSnapshot:
    ts = datetime.now().isoformat(timespec='seconds')
    proc = adb('shell', 'pidof', PACKAGE)
    pid = proc.stdout.decode('utf-8', 'ignore').strip()
    if not pid:
        return MemSnapshot(stage=stage, timestamp=ts, process_exists=False, raw_note='process not running')

    raw = adb('shell', 'dumpsys', 'meminfo', PACKAGE).stdout.decode('utf-8', 'ignore')
    parsed = parse_meminfo(raw)
    return MemSnapshot(
        stage=stage,
        timestamp=ts,
        process_exists=True,
        raw_note=f'pid={pid.split()[0]}',
        **parsed,
    )


def dump_xml() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/mem-audit.xml')
    return adb('shell', 'cat', '/sdcard/mem-audit.xml').stdout.decode('utf-8', 'ignore')


def dismiss_blockers(max_attempts: int = 8) -> None:
    for _ in range(max_attempts):
        xml = dump_xml().lower()
        if 'content hub' in xml and 'manage your providers' in xml:
            key('KEYCODE_BACK')
            time.sleep(1.0)
            continue
        if 'allow android tv core services' in xml or 'allow one-time access' in xml:
            key('KEYCODE_DPAD_CENTER')
            time.sleep(1.0)
            continue
        if 'provide feedback' in xml or 'click to type' in xml:
            key('KEYCODE_BACK')
            time.sleep(1.0)
            continue
        if 'open debugger to view warnings' in xml:
            key('KEYCODE_DPAD_DOWN')
            time.sleep(0.2)
            key('KEYCODE_DPAD_RIGHT')
            time.sleep(0.2)
            key('KEYCODE_DPAD_CENTER')
            time.sleep(0.5)
            continue
        break


def force_stop() -> None:
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(2)


def cold_launch() -> None:
    force_stop()
    adb('shell', 'am', 'start', '-n', f'{PACKAGE}/.MainActivity')
    time.sleep(3)


def deep_link(route: str) -> None:
    adb(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        f'novacastv2://{route.lstrip("/")}',
        PACKAGE,
    )
    time.sleep(4)


def wait_settle(seconds: float = 20) -> None:
    dismiss_blockers()
    time.sleep(seconds)


def nav_to_hub_from_anywhere() -> None:
    for _ in range(6):
        xml = dump_xml().lower()
        if 'main menu' in xml or 'live tv' in xml and 'movies' in xml:
            return
        key('KEYCODE_BACK')
        time.sleep(1.2)
    dismiss_blockers()


def select_nav_item(label: str, max_steps: int = 12) -> bool:
    target = label.lower()
    for _ in range(max_steps):
        xml = dump_xml()
        low = xml.lower()
        if target in low:
            for part in xml.split('><'):
                if f'content-desc="{label}"' in part or f'text="{label}"' in part:
                    if 'focused="true"' in part:
                        key('KEYCODE_DPAD_CENTER')
                        time.sleep(3)
                        return True
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    return False


def movies_playback_cycle(report: AuditReport) -> None:
    deep_link('movies')
    wait_settle(12)
    report.snapshots.append(asdict(capture_mem('movies_loaded')))
    report.automated_stages.append('movies_loaded')

    dismiss_blockers()
    for _ in range(4):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.3)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(3)
    report.snapshots.append(asdict(capture_mem('movie_detail_open')))
    report.automated_stages.append('movie_detail_open')

    for _ in range(6):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.25)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(8)
    report.snapshots.append(asdict(capture_mem('movie_playback')))
    report.automated_stages.append('movie_playback')

    key('KEYCODE_BACK')
    time.sleep(2)
    key('KEYCODE_BACK')
    time.sleep(2)
    report.snapshots.append(asdict(capture_mem('after_movie_playback_close')))
    report.automated_stages.append('after_movie_playback_close')


def series_cycle(report: AuditReport) -> None:
    deep_link('series')
    wait_settle(12)
    report.snapshots.append(asdict(capture_mem('series_loaded')))
    report.automated_stages.append('series_loaded')

    for _ in range(3):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.3)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(3)
    report.snapshots.append(asdict(capture_mem('series_detail_open')))
    report.automated_stages.append('series_detail_open')

    key('KEYCODE_BACK')
    time.sleep(2)
    report.snapshots.append(asdict(capture_mem('after_series_detail_close')))
    report.automated_stages.append('after_series_detail_close')


def live_tv_cycle(report: AuditReport) -> None:
    deep_link('live')
    wait_settle(12)
    report.snapshots.append(asdict(capture_mem('live_tv_loaded')))
    report.automated_stages.append('live_tv_loaded')

    for _ in range(5):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.25)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(6)
    report.snapshots.append(asdict(capture_mem('live_tv_preview_playing')))
    report.automated_stages.append('live_tv_preview_playing')

    key('KEYCODE_BACK')
    time.sleep(2)
    report.snapshots.append(asdict(capture_mem('after_live_tv_back')))
    report.automated_stages.append('after_live_tv_back')


def dpad_stress_loop(report: AuditReport, loops: int) -> None:
    routes = ['movies', 'series', 'live', 'main-menu']
    for i in range(loops):
        route = routes[i % len(routes)]
        deep_link(route)
        wait_settle(6)
        for _ in range(8):
            key('KEYCODE_DPAD_DOWN')
            time.sleep(0.15)
        for _ in range(4):
            key('KEYCODE_DPAD_RIGHT')
            time.sleep(0.15)
        snap = capture_mem(f'stress_loop_{i + 1}_{route}')
        report.snapshots.append(asdict(snap))
        report.automated_stages.append(snap.stage)
        if i % 2 == 1:
            report.nav_notes.append(f'loop {i + 1}: route={route} pss={snap.total_pss_kb}')


def scan_logcat(log_path: str) -> tuple[list, list]:
    if not os.path.exists(log_path):
        return [], []
    text = open(log_path, encoding='utf-8', errors='ignore').read().lower()
    oom = []
    crash = []
    for pat, bucket in [
        (r'outofmemoryerror[^\n]*', oom),
        (r'failed to allocate[^\n]*', oom),
        (r'low memory killer[^\n]*', oom),
        (r'fatal exception[^\n]*', crash),
        (r'androidruntime[^\n]*fatal[^\n]*', crash),
        (r'process com\.novacast\.novacastv2[^\n]*died', crash),
    ]:
        for m in re.finditer(pat, text):
            line = m.group(0).strip()
            if line not in bucket:
                bucket.append(line[:240])
    return oom, crash


def main() -> int:
    started = time.time()
    report = AuditReport(
        device=DEVICE,
        package=PACKAGE,
        started_at=datetime.now().isoformat(timespec='seconds'),
    )
    report.manual_gaps = [
        '30-min fully manual couch session not automated',
        'Extended EPG scroll across all channels requires manual verification',
        'Multi-provider switching requires manual verification',
    ]

    log_path = os.path.join(OUT, 'firetv-memory-audit.log')
    log_proc = subprocess.Popen(
        [
            'adb', '-s', DEVICE, 'logcat', '-v', 'threadtime',
            'ReactNativeJS:I', 'AndroidRuntime:E', '*:S',
        ],
        stdout=open(log_path, 'w', encoding='utf-8'),
        stderr=subprocess.DEVNULL,
    )

    try:
        adb('logcat', '-c')
        print('[audit] before launch meminfo')
        report.snapshots.append(asdict(capture_mem('before_launch')))
        report.automated_stages.append('before_launch')

        print('[audit] cold launch')
        cold_launch()
        report.snapshots.append(asdict(capture_mem('cold_launch_immediate')))
        report.automated_stages.append('cold_launch_immediate')

        wait_settle(25)
        report.snapshots.append(asdict(capture_mem('after_settle_25s')))
        report.automated_stages.append('after_settle_25s')

        print('[audit] movies cycle')
        movies_playback_cycle(report)

        print('[audit] series cycle')
        series_cycle(report)

        print('[audit] live tv cycle')
        live_tv_cycle(report)

        print(f'[audit] stress loops ({NAV_LOOPS}) for ~{STRESS_MINUTES} min target')
        stress_start = time.time()
        loop = 0
        while (time.time() - stress_start) < (STRESS_MINUTES * 60):
            dpad_stress_loop(report, 1)
            loop += 1
            elapsed = time.time() - stress_start
            print(f'[audit] stress loop {loop} elapsed={elapsed:.0f}s')
            if loop >= NAV_LOOPS and elapsed >= 15 * 60:
                break

        report.snapshots.append(asdict(capture_mem('final_after_stress')))
        report.automated_stages.append('final_after_stress')

        print('[audit] restart test for legacy blob behavior')
        force_stop()
        time.sleep(3)
        cold_launch()
        wait_settle(20)
        report.snapshots.append(asdict(capture_mem('after_cold_restart')))
        report.automated_stages.append('after_cold_restart')

    finally:
        time.sleep(1)
        log_proc.terminate()
        try:
            log_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            log_proc.kill()

    report.ended_at = datetime.now().isoformat(timespec='seconds')
    report.duration_seconds = round(time.time() - started, 1)

    pss_values = [
        s['total_pss_kb']
        for s in report.snapshots
        if s.get('total_pss_kb') is not None
    ]
    report.peak_pss_kb = max(pss_values) if pss_values else None

    report.oom_events, report.crash_events = scan_logcat(log_path)

    out_json = os.path.join(OUT, 'firetv-memory-audit-report.json')
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(asdict(report), f, indent=2)

    print(f'[audit] complete duration={report.duration_seconds}s peak_pss={report.peak_pss_kb}KB')
    print(f'[audit] report={out_json}')
    print(f'[audit] log={log_path}')
    print(f'[audit] oom={len(report.oom_events)} crash={len(report.crash_events)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
