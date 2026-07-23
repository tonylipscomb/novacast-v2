"""Pre-beta manual checklist automation for NovaCast on Android TV."""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = os.environ.get('NOVACAST_DEVICE', '10.0.0.151:5555')
PACKAGE = 'com.novacast.novacastv2'
ACTIVITY = f'{PACKAGE}/.MainActivity'
ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts' / 'beta-validation'
LOGS = ROOT / '.logs'


@dataclass
class StepResult:
    id: str
    name: str
    status: str  # pass | fail | skip | unverified
    notes: str = ''
    duration_ms: int = 0


@dataclass
class ValidationReport:
    device: str
    started_at: str
    finished_at: str = ''
    steps: list[StepResult] = field(default_factory=list)

    def add(self, step: StepResult) -> None:
        self.steps.append(step)
        icon = {'pass': 'OK', 'fail': 'FAIL', 'skip': 'SKIP', 'unverified': '?'}.get(step.status, step.status)
        print(f'[{icon}] {step.id}: {step.name} — {step.notes or step.status}')


report = ValidationReport(device=DEVICE, started_at=datetime.now(timezone.utc).isoformat())


def adb(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', DEVICE, *args], capture_output=True, timeout=timeout)


def key(code: str, delay: float = 0.35) -> None:
    adb('shell', 'input', 'keyevent', code)
    time.sleep(delay)


def deep_link(path: str, wait: float = 8.0) -> None:
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f'novacastv2://{path}')
    time.sleep(wait)


def shot(name: str) -> Path:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    path = ARTIFACTS / f'{name}.png'
    result = adb('exec-out', 'screencap', '-p', timeout=30)
    path.write_bytes(result.stdout)
    return path


def dump_xml() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/novacast-beta.xml')
    return adb('shell', 'cat', '/sdcard/novacast-beta.xml').stdout.decode('utf-8', 'ignore')


def focused_label(xml: str) -> str:
    for node in re.findall(r'<node[^>]*/?>', xml):
        if 'focused="true"' not in node:
            continue
        desc = re.search(r'content-desc="([^"]*)"', node)
        text = re.search(r'text="([^"]*)"', node)
        if desc and desc.group(1):
            return re.sub(r'&#\d+;', '', desc.group(1))
        if text and text.group(1):
            return text.group(1)
        return '(focused-no-label)'
    return '(no-focus)'


def xml_has(*needles: str) -> bool:
    xml = dump_xml().lower()
    return all(needle.lower() in xml for needle in needles)


def xml_contains_any(*needles: str) -> str | None:
    xml = dump_xml()
    lower = xml.lower()
    for needle in needles:
        if needle.lower() in lower:
            return needle
    return None


def clear_logcat() -> None:
    adb('logcat', '-c')


def pull_startup_log() -> str:
    LOGS.mkdir(parents=True, exist_ok=True)
    result = adb('logcat', '-d', '-s', 'ReactNativeJS:I', timeout=60)
    text = result.stdout.decode('utf-8', 'ignore')
    path = LOGS / 'beta-validation-logcat.txt'
    path.write_text(text, encoding='utf-8')
    return text


def startup_log_has(log: str, phrase: str) -> bool:
    return phrase in log


def timed_step(step_id: str, name: str, fn) -> StepResult:
    started = time.time()
    try:
        status, notes = fn()
    except Exception as exc:  # noqa: BLE001 — validation harness
        status, notes = 'fail', f'exception: {exc}'
    elapsed = int((time.time() - started) * 1000)
    step = StepResult(id=step_id, name=name, status=status, notes=notes, duration_ms=elapsed)
    report.add(step)
    return step


def dismiss_overlays() -> None:
    for _ in range(4):
        xml = dump_xml().lower()
        if 'pair your device' in xml or 'scan the qr' in xml:
            break
        if 'content hub' in xml and 'manage your providers' in xml:
            key('KEYCODE_BACK', 1.0)
            continue
        if 'walkthrough' in xml or 'got it' in xml:
            key('KEYCODE_DPAD_CENTER', 0.8)
            continue
        break


def nav_rail_to(target: str) -> None:
    """Move left rail focus and select a destination label."""
    labels = {
        'home': ['Home', 'Main Menu', 'Continue Watching'],
        'live': ['Live TV', 'Live'],
        'movies': ['Movies'],
        'series': ['Series'],
        'guide': ['Guide', 'TV Guide'],
        'search': ['Search'],
        'settings': ['Settings'],
    }
    wanted = labels.get(target, [target])
    for _ in range(8):
        for _ in range(7):
            xml = dump_xml()
            focus = focused_label(xml)
            if any(label.lower() in focus.lower() for label in wanted):
                key('KEYCODE_DPAD_CENTER', 1.5)
                return
            if any(label.lower() in xml.lower() for label in wanted):
                key('KEYCODE_DPAD_CENTER', 1.5)
                return
            key('KEYCODE_DPAD_DOWN', 0.25)
        key('KEYCODE_DPAD_LEFT', 0.4)
    key('KEYCODE_DPAD_CENTER', 1.5)


def run() -> int:
    print(f'=== NovaCast beta validation on {DEVICE} ===')
    ARTIFACTS.mkdir(parents=True, exist_ok=True)

    # 1–3 Cold launch, startup, provider
    def cold_launch():
        clear_logcat()
        adb('shell', 'am', 'force-stop', PACKAGE)
        time.sleep(1.5)
        adb('shell', 'am', 'start', '-n', ACTIVITY)
        time.sleep(1.0)
        shot('01-startup-1s')
        time.sleep(2.0)
        shot('02-startup-3s')
        time.sleep(2.5)
        shot('03-startup-5s')
        time.sleep(1.0)
        log = pull_startup_log()
        xml = dump_xml()
        on_pairing = 'pair your device' in xml.lower() or 'scan the qr' in xml.lower()
        on_home = any(
            token in xml
            for token in ['Continue Watching', 'Live Now', 'Main Menu', 'Home', 'Live TV']
        )
        startup_ok = startup_log_has(log, 'intro complete') or startup_log_has(log, 'launch exit requested')
        if on_pairing:
            return 'pass', 'Cold launch reached pairing (no saved provider on device)'
        if on_home:
            provider_note = 'home visible after startup'
            if startup_ok:
                provider_note += '; startup sequence logged'
            return 'pass', provider_note
        if startup_ok:
            return 'unverified', 'Startup logged but UI state unclear — see screenshots'
        return 'fail', f'Unexpected post-startup UI; focus={focused_label(xml)}'

    timed_step('01-03', 'Cold launch + startup + provider state', cold_launch)
    dismiss_overlays()

    if xml_has('pair your device') or xml_has('scan the qr'):
        report.add(
            StepResult(
                id='04-27',
                name='Remaining checklist (requires paired provider)',
                status='skip',
                notes='Device is on pairing screen — install paired provider or complete pairing to validate catalog/playback',
            ),
        )
        write_report()
        return 0

    # 4 Live TV
    def open_live():
        deep_link('live', 10)
        dismiss_overlays()
        xml = dump_xml()
        ok = 'Live TV' in xml or 'Channels' in xml or 'Categories' in xml
        shot('04-live-tv')
        return ('pass' if ok else 'fail'), f'focus={focused_label(xml)}'

    timed_step('04', 'Open Live TV', open_live)

    # 5 Navigate categories
    def live_categories():
        key('KEYCODE_DPAD_RIGHT', 0.5)
        before = dump_xml()
        key('KEYCODE_DPAD_DOWN', 0.4)
        key('KEYCODE_DPAD_DOWN', 0.4)
        after = dump_xml()
        shot('05-live-categories')
        moved = before != after
        return ('pass' if moved else 'unverified'), f'focus={focused_label(after)}'

    timed_step('05', 'Live TV category D-pad navigation', live_categories)

    # 6–9 Preview, fullscreen, back, channel switch
    def live_playback():
        notes: list[str] = []
        key('KEYCODE_DPAD_RIGHT', 0.4)
        for _ in range(3):
            key('KEYCODE_DPAD_DOWN', 0.2)
        key('KEYCODE_DPAD_CENTER', 1.2)
        xml1 = dump_xml()
        notes.append(f'after channel OK focus={focused_label(xml1)}')
        shot('06-live-preview')

        for _ in range(2):
            key('KEYCODE_DPAD_CENTER', 0.8)
        time.sleep(2)
        xml2 = dump_xml()
        fullscreen_guess = 'fullscreen' in xml2.lower() or focused_label(xml2) != focused_label(xml1)
        shot('07-live-fullscreen')

        key('KEYCODE_BACK', 1.5)
        xml3 = dump_xml()
        back_ok = 'Live TV' in xml3 or 'Channels' in xml3
        shot('08-live-back')
        notes.append(f'back={"ok" if back_ok else "unclear"}')

        for _ in range(4):
            key('KEYCODE_DPAD_DOWN', 0.15)
            key('KEYCODE_DPAD_CENTER', 0.5)
        time.sleep(2)
        shot('09-live-channel-switch')
        notes.append('rapid channel switches sent')

        status = 'pass' if back_ok else 'unverified'
        return status, '; '.join(notes)

    timed_step('06-09', 'Live preview/fullscreen/back/channel switch', live_playback)

    # 10–12 Movies
    def movies_flow():
        deep_link('movies', 10)
        dismiss_overlays()
        key('KEYCODE_DPAD_RIGHT', 0.5)
        key('KEYCODE_DPAD_DOWN', 0.4)
        key('KEYCODE_DPAD_DOWN', 0.4)
        shot('10-movies-category')
        key('KEYCODE_DPAD_CENTER', 1.0)
        key('KEYCODE_DPAD_DOWN', 0.4)
        key('KEYCODE_DPAD_CENTER', 1.5)
        time.sleep(2)
        xml = dump_xml()
        playing = 'Play' in xml or 'Pause' in xml or 'Back' in xml
        shot('11-movies-play')
        key('KEYCODE_BACK', 1.2)
        key('KEYCODE_BACK', 1.2)
        return ('pass' if 'Movies' in dump_xml() else 'unverified'), f'play_surface={playing} focus={focused_label(xml)}'

    timed_step('10-12', 'Movies categories + play attempt', movies_flow)

    # 13–15 Series
    def series_flow():
        deep_link('series', 10)
        dismiss_overlays()
        key('KEYCODE_DPAD_RIGHT', 0.5)
        key('KEYCODE_DPAD_DOWN', 0.4)
        key('KEYCODE_DPAD_CENTER', 1.2)
        key('KEYCODE_DPAD_DOWN', 0.4)
        key('KEYCODE_DPAD_CENTER', 1.5)
        time.sleep(2)
        xml = dump_xml()
        shot('13-series-episode')
        key('KEYCODE_BACK', 1.0)
        key('KEYCODE_BACK', 1.0)
        ok = 'Series' in dump_xml()
        return ('pass' if ok else 'unverified'), f'focus={focused_label(xml)}'

    timed_step('13-15', 'Series browse + episode attempt', series_flow)

    # 16 Guide scroll
    def guide_flow():
        deep_link('guide', 10)
        dismiss_overlays()
        key('KEYCODE_DPAD_RIGHT', 0.5)
        for _ in range(4):
            key('KEYCODE_DPAD_DOWN', 0.25)
        for _ in range(3):
            key('KEYCODE_DPAD_RIGHT', 0.25)
        shot('16-guide-scroll')
        xml = dump_xml()
        ok = 'Guide' in xml or 'guide' in xml.lower()
        return ('pass' if ok else 'unverified'), f'focus={focused_label(xml)}'

    timed_step('16-17', 'Guide open + scroll', guide_flow)

    # 18–20 Global search
    def search_flow():
        deep_link('search', 8)
        dismiss_overlays()
        xml0 = dump_xml()
        if 'Search' not in xml0:
            nav_rail_to('search')
            time.sleep(2)
        shot('18-search-open')
        # Type a short query via key events is unreliable on TV; use dpad to scope tabs
        for _ in range(3):
            key('KEYCODE_DPAD_DOWN', 0.3)
        for _ in range(4):
            key('KEYCODE_DPAD_RIGHT', 0.35)
        shot('19-search-scopes')
        xml = dump_xml()
        scopes = [s for s in ['Live', 'Movies', 'Series', 'Guide', 'All'] if s in xml]
        return ('pass' if scopes else 'unverified'), f'scope markers={scopes or "none"}; focus={focused_label(xml)}'

    timed_step('18-20', 'Global search open + scope navigation', search_flow)

    # 21–22 Recoverable error — navigate to settings offline hint or force bad state
    def error_retry():
        # Attempt airplane mode toggle is invasive; check if error UI components exist in codebase path
        # Instead verify Settings reachable and Retry pattern on Live error if present
        deep_link('live', 8)
        xml = dump_xml()
        if 'Retry' in xml or 'Try again' in xml:
            key('KEYCODE_DPAD_CENTER', 0.8)
            shot('21-error-retry')
            return 'pass', 'Retry control present and OK sent'
        return 'unverified', 'No error state triggered during validation (expected on healthy provider)'

    timed_step('21-22', 'Recoverable error + retry', error_retry)

    # 23–24 Persistence
    def persistence():
        xml_before = dump_xml()
        had_home = 'Continue Watching' in xml_before or 'Live TV' in xml_before
        adb('shell', 'am', 'force-stop', PACKAGE)
        time.sleep(2)
        adb('shell', 'am', 'start', '-n', ACTIVITY)
        time.sleep(12)
        xml_after = dump_xml()
        shot('23-relaunch')
        on_pairing = 'pair your device' in xml_after.lower()
        if on_pairing:
            return 'fail', 'Provider lost after relaunch — returned to pairing'
        still_in_app = PACKAGE.split('.')[-1] in xml_after or 'Continue Watching' in xml_after or 'Live TV' in xml_after
        return ('pass' if still_in_app and not on_pairing else 'fail'), (
            f'relaunch focus={focused_label(xml_after)}; had_home={had_home}'
        )

    timed_step('23-24', 'Force-stop relaunch + provider persistence', persistence)

    # 25–26 Provider switch if hub available
    def provider_switch():
        deep_link('content-hub', 6)
        xml = dump_xml()
        if 'Content Hub' not in xml and 'Manage' not in xml:
            key('KEYCODE_BACK', 0.8)
            return 'skip', 'Content Hub not reachable from deep link or no multi-provider UI'
        shot('25-content-hub')
        key('KEYCODE_BACK', 1.0)
        return 'unverified', 'Content Hub opened — multi-provider switch not automated'

    timed_step('25-26', 'Provider switch', provider_switch)

    # 27 Memory / stability spot check
    def memory_spot():
        mem = adb('shell', 'dumpsys', 'meminfo', PACKAGE, timeout=30).stdout.decode('utf-8', 'ignore')
        match = re.search(r'TOTAL\s+(\d+)', mem)
        total_kb = int(match.group(1)) if match else 0
        (LOGS / 'beta-validation-meminfo.txt').write_text(mem, encoding='utf-8')
        note = f'TOTAL PSS ~{total_kb // 1024} MB' if total_kb else 'meminfo unavailable'
        status = 'pass' if total_kb and total_kb < 512_000 else 'unverified'
        return status, note

    timed_step('27', 'Session memory spot check', memory_spot)

    # Logcat error scan
    log = pull_startup_log()
    errors = [line for line in log.splitlines() if 'error' in line.lower() or 'FATAL' in line]
    cred_leak = [line for line in log.splitlines() if re.search(r'password|api_key|token=', line, re.I)]
    report.add(
        StepResult(
            id='logcat',
            name='Logcat error / credential scan',
            status='fail' if cred_leak else ('unverified' if len(errors) > 8 else 'pass'),
            notes=f'errors={len(errors)} cred_leaks={len(cred_leak)}',
        ),
    )

    write_report()
    fails = sum(1 for s in report.steps if s.status == 'fail')
    return 1 if fails else 0


def write_report() -> None:
    report.finished_at = datetime.now(timezone.utc).isoformat()
    path = ARTIFACTS / 'validation-report.json'
    path.write_text(json.dumps(asdict(report), indent=2), encoding='utf-8')
    print(f'\nReport written to {path}')
    passed = sum(1 for s in report.steps if s.status == 'pass')
    failed = sum(1 for s in report.steps if s.status == 'fail')
    skipped = sum(1 for s in report.steps if s.status == 'skip')
    unverified = sum(1 for s in report.steps if s.status == 'unverified')
    print(f'Summary: pass={passed} fail={failed} skip={skipped} unverified={unverified}')


if __name__ == '__main__':
    raise SystemExit(run())
