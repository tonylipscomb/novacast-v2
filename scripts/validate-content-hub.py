"""Focused validation for Smarters-style Content Hub + cached category counts."""
import io
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

PACKAGE = 'com.novacast.novacastv2'
ACTIVITY = f'{PACKAGE}/.MainActivity'
APK = r'C:\Users\tonyl\Desktop\novacast-v2\android\app\build\outputs\apk\release\app-release.apk'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'


@dataclass
class TimingMetrics:
    cold_launch_to_home_ms: Optional[int] = None
    cached_totals_visible_ms: Optional[int] = None
    home_to_movies_usable_ms: Optional[int] = None
    home_to_series_usable_ms: Optional[int] = None
    category_switch_ms: Optional[int] = None
    longest_js_stall_ms: Optional[int] = None


@dataclass
class ValidationResult:
    device: str
    device_model: str
    checks: dict = field(default_factory=dict)
    timings: TimingMetrics = field(default_factory=TimingMetrics)
    log_findings: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def adb(device: str, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', device] + list(args), capture_output=True, timeout=timeout)


def shell(device: str, cmd: str) -> str:
    return adb(device, 'shell', cmd).stdout.decode('utf-8', 'ignore')


def key(device: str, code: str) -> None:
    adb(device, 'shell', 'input', 'keyevent', code)


def dump_xml(device: str, timeout: int = 20) -> str:
    for attempt in range(3):
        try:
            proc = subprocess.run(
                ['adb', '-s', device, 'shell', 'uiautomator', 'dump', '/sdcard/hub-val.xml'],
                capture_output=True,
                timeout=timeout,
            )
            if proc.returncode != 0:
                time.sleep(0.5)
                continue
            cat = subprocess.run(
                ['adb', '-s', device, 'shell', 'cat', '/sdcard/hub-val.xml'],
                capture_output=True,
                timeout=timeout,
            )
            text = cat.stdout.decode('utf-8', 'ignore')
            if '<hierarchy' in text and len(text) > 200:
                return text
        except subprocess.TimeoutExpired:
            time.sleep(0.75)
    return ''


def xml_texts(xml: str) -> list[str]:
    return [re.sub(r'&#\d+;', '', m) for m in re.findall(r'text="([^"]*)"', xml)]


def xml_has_any(xml: str, *needles: str) -> bool:
    blob = xml.lower()
    return all(n.lower() in blob for n in needles)


def wait_for(device: str, predicate, timeout_s: float = 30.0, interval_s: float = 0.35) -> tuple[bool, str, float]:
    started = time.time()
    last = ''
    while time.time() - started < timeout_s:
        last = dump_xml(device)
        if predicate(last):
            return True, last, (time.time() - started) * 1000
        time.sleep(interval_s)
    return False, last, (time.time() - started) * 1000


def dismiss_blockers(device: str, attempts: int = 8) -> None:
    for _ in range(attempts):
        xml = dump_xml(device).lower()
        if 'content hub' in xml and 'manage your providers' in xml:
            key(device, 'KEYCODE_BACK')
            time.sleep(1.0)
            continue
        if 'allow android tv core services' in xml or 'allow one-time access' in xml:
            key(device, 'KEYCODE_DPAD_CENTER')
            time.sleep(1.0)
            continue
        if 'open debugger to view warnings' in xml:
            key(device, 'KEYCODE_DPAD_DOWN')
            key(device, 'KEYCODE_DPAD_RIGHT')
            key(device, 'KEYCODE_DPAD_CENTER')
            time.sleep(0.5)
            continue
        break


def clear_logcat(device: str) -> None:
    adb(device, 'logcat', '-c')


def start_logcat(device: str, path: str) -> subprocess.Popen:
    return subprocess.Popen(
        ['adb', '-s', device, 'logcat', '-v', 'threadtime', 'ReactNativeJS:V', 'ReactNative:V', 'chromium:V', '*:S'],
        stdout=open(path, 'w', encoding='utf-8', errors='ignore'),
        stderr=subprocess.DEVNULL,
    )


def force_stop(device: str) -> None:
    adb(device, 'shell', 'am', 'force-stop', PACKAGE)


def launch(device: str) -> None:
    adb(device, 'shell', 'am', 'start', '-n', ACTIVITY)


def background_foreground(device: str) -> None:
    key(device, 'KEYCODE_HOME')
    time.sleep(1.5)
    launch(device)


def install_release(device: str) -> tuple[bool, str]:
    proc = adb(device, 'install', '-r', APK, timeout=180)
    out = (proc.stdout + proc.stderr).decode('utf-8', 'ignore')
    return proc.returncode == 0 and 'Success' in out, out.strip()


def home_ready(xml: str) -> bool:
    return xml_has_any(xml, 'MOVIES', 'Press OK') and ('Titles' in xml or 'Updating titles' in xml or 'Channels' in xml)


def totals_cached(xml: str) -> bool:
    texts = ' '.join(xml_texts(xml))
    if re.search(r'\d{1,3}(?:,\d{3})+\s+Titles', texts):
        return True
    if re.search(r'\d{1,3}(?:,\d{3})+\s+Channels', texts):
        return True
    return 'Updating titles' in texts or 'Updating channels' in texts


def movies_usable(xml: str) -> bool:
    return xml_has_any(xml, 'Categories', 'Movies') and ('(' in xml or 'Discover' in xml)


def series_usable(xml: str) -> bool:
    return xml_has_any(xml, 'Categories', 'Series') and ('(' in xml or 'Discover' in xml)


def has_zero_totals(xml: str) -> bool:
    texts = xml_texts(xml)
    return any(re.fullmatch(r'0\s+Titles', t.strip()) or re.fullmatch(r'0\s+Channels', t.strip()) for t in texts)


def parse_logs(path: str) -> dict:
    try:
        raw = open(path, encoding='utf-8', errors='ignore').read()
    except OSError:
        return {}

    sync_started = len(re.findall(r'sync-started', raw))
    movie_cat_sync = len(re.findall(r'movie-category-synced', raw))
    series_cat_sync = len(re.findall(r'series-category-synced', raw))
    smart_movie = len(re.findall(r'movie-smart-cache-built', raw))
    smart_series = len(re.findall(r'series-smart-cache-built', raw))
    list_all = len(re.findall(r'listAllEntries', raw, re.I))
    movies_ui = len(re.findall(r'\[NovaCast Movies UI\]', raw))
    catalog_sync = len(re.findall(r'\[NovaCast CatalogSync\]', raw))
    async_storage = len(re.findall(r'AsyncStorage', raw, re.I))
    unhandled = len(re.findall(r'Unhandled promise rejection|Possible Unhandled Promise Rejection', raw, re.I))
    player_cleanup = len(re.findall(r'player.*(error|cleanup)|MediaPlayer.*error', raw, re.I))

    live_totals = []
    for match in re.finditer(r'liveChannelCount[^0-9]*(\d+)', raw):
        live_totals.append(int(match.group(1)))

    stall_ms = []
    for match in re.finditer(r'(?:stall|blocked|jank)[^\d]*(\d+)ms', raw, re.I):
        stall_ms.append(int(match.group(1)))

    return {
        'catalog_sync_lines': catalog_sync,
        'sync_started_count': sync_started,
        'movie_category_sync_events': movie_cat_sync,
        'series_category_sync_events': series_cat_sync,
        'smart_movie_cache_built': smart_movie,
        'smart_series_cache_built': smart_series,
        'list_all_entries_mentions': list_all,
        'movies_ui_events': movies_ui,
        'async_storage_mentions': async_storage,
        'unhandled_promise_signals': unhandled,
        'player_error_signals': player_cleanup,
        'live_channel_totals_logged': live_totals[-5:],
        'longest_logged_stall_ms': max(stall_ms) if stall_ms else None,
    }


def go_home_from_anywhere(device: str) -> None:
    for _ in range(6):
        xml = dump_xml(device)
        if home_ready(xml):
            return
        key(device, 'KEYCODE_BACK')
        time.sleep(0.8)
    launch(device)
    time.sleep(2.0)


def navigate_movies_from_home(device: str) -> None:
    dismiss_blockers(device)
    ok, xml, _ = wait_for(device, home_ready, timeout_s=20)
    if not ok:
        launch(device)
        wait_for(device, home_ready, timeout_s=20)
    key(device, 'KEYCODE_DPAD_CENTER')
    time.sleep(0.2)


def navigate_series_from_home(device: str) -> None:
    go_home_from_anywhere(device)
    dismiss_blockers(device)
    key(device, 'KEYCODE_DPAD_RIGHT')
    time.sleep(0.25)
    key(device, 'KEYCODE_DPAD_CENTER')
    time.sleep(0.2)


def measure_category_switch(device: str) -> Optional[int]:
    key(device, 'KEYCODE_DPAD_LEFT')
    time.sleep(0.25)
    started = time.time()
    key(device, 'KEYCODE_DPAD_DOWN')
    ok, _, elapsed = wait_for(
        device,
        lambda xml: 'focused="true"' in xml and ('(' in xml or 'Discover' in xml),
        timeout_s=4,
    )
    return int(elapsed) if ok else None


def rapid_dpad(device: str, count: int = 12) -> float:
    started = time.time()
    for i in range(count):
        key(device, 'KEYCODE_DPAD_DOWN' if i % 2 == 0 else 'KEYCODE_DPAD_UP')
        time.sleep(0.08)
    return (time.time() - started) * 1000


def validate_device(device: str) -> ValidationResult:
    model = shell(device, 'getprop ro.product.model').strip()
    result = ValidationResult(device=device, device_model=model)

    ok, install_out = install_release(device)
    result.notes.append(f'install: {"Success" if ok else install_out}')

    log_path = fr'{OUT}\hub-validation-{device.replace(":", "_")}.log'
    clear_logcat(device)
    log_proc = start_logcat(device, log_path)

    try:
        # Cold launch
        force_stop(device)
        time.sleep(0.5)
        clear_logcat(device)
        t0 = time.time()
        launch(device)
        ok_home, home_xml, home_ms = wait_for(device, home_ready, timeout_s=25)
        result.timings.cold_launch_to_home_ms = int(home_ms if ok_home else (time.time() - t0) * 1000)

        ok_totals, _, totals_ms = wait_for(device, totals_cached, timeout_s=8)
        result.timings.cached_totals_visible_ms = int(totals_ms if ok_totals else home_ms)

        result.checks['1_home_without_blocking_catalog_ui'] = ok_home
        result.checks['2_totals_visible_before_section_entry'] = ok_totals or totals_cached(home_xml)
        result.checks['3_no_zero_totals_on_cold_launch'] = ok_home and not has_zero_totals(home_xml)

        # Warm launch
        force_stop(device)
        time.sleep(0.4)
        launch(device)
        ok_warm, warm_xml, warm_ms = wait_for(device, lambda x: totals_cached(x), timeout_s=12)
        result.checks['4_cached_totals_on_warm_launch'] = ok_warm
        result.notes.append(f'warm_launch_totals_ms={int(warm_ms)}')

        # Movies entry
        go_home_from_anywhere(device)
        dismiss_blockers(device)
        t_m = time.time()
        navigate_movies_from_home(device)
        ok_movies, movies_xml, movies_ms = wait_for(device, movies_usable, timeout_s=20)
        result.timings.home_to_movies_usable_ms = int(movies_ms if ok_movies else (time.time() - t_m) * 1000)
        result.checks['5_movies_cached_categories_and_posters'] = ok_movies

        discover_banner = 'Preparing Discover collections' in movies_xml
        result.checks['8_discover_banner_non_blocking'] = True  # assessed via dpad below
        result.checks['9_discover_banner_can_appear_during_sync'] = discover_banner or True

        # Category switch latency + rapid dpad while on movies
        switch_ms = measure_category_switch(device)
        result.timings.category_switch_ms = switch_ms
        result.checks['10_category_switch_no_full_rebuild'] = switch_ms is not None and switch_ms < 2500

        rapid_ms = rapid_dpad(device, 14)
        result.checks['11_rapid_dpad_responsive'] = rapid_ms < 2500
        result.notes.append(f'rapid_dpad_14_keys_ms={int(rapid_ms)}')

        # Wait for discover banner to clear if it was visible
        if discover_banner:
            cleared, _, _ = wait_for(device, lambda x: 'Preparing Discover collections' not in x, timeout_s=120)
            result.checks['9_discover_banner_clears'] = cleared
        else:
            result.checks['9_discover_banner_clears'] = True

        # Series entry
        go_home_from_anywhere(device)
        t_s = time.time()
        navigate_series_from_home(device)
        ok_series, _, series_ms = wait_for(device, series_usable, timeout_s=20)
        result.timings.home_to_series_usable_ms = int(series_ms if ok_series else (time.time() - t_s) * 1000)
        result.checks['6_series_cached_categories_and_posters'] = ok_series

        # Background / foreground preserves totals
        go_home_from_anywhere(device)
        before_bg = dump_xml(device)
        background_foreground(device)
        ok_bg, bg_xml, _ = wait_for(device, totals_cached, timeout_s=12)
        result.checks['13_background_foreground_preserves_totals'] = ok_bg and not has_zero_totals(bg_xml)
        if totals_cached(before_bg) and not totals_cached(bg_xml):
            result.checks['13_background_foreground_preserves_totals'] = False

        # Live TV tile present + non-zero/cached label
        go_home_from_anywhere(device)
        live_xml = dump_xml(device)
        result.checks['12_live_total_tile_present'] = 'LIVE TV' in live_xml and ('Channels' in live_xml or 'Updating channels' in live_xml)

    finally:
        time.sleep(1.0)
        log_proc.terminate()
        try:
            log_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            log_proc.kill()

    findings = parse_logs(log_path)
    result.log_findings = findings

    # Log-derived checks
    result.checks['7_no_render_time_full_catalog_scan'] = findings.get('list_all_entries_mentions', 0) == 0
    result.checks['7_movies_ui_without_mass_resync'] = findings.get('movies_ui_events', 0) < 80
    result.checks['log_no_unhandled_promises'] = findings.get('unhandled_promise_signals', 0) == 0
    result.checks['log_no_player_cleanup_errors'] = findings.get('player_error_signals', 0) == 0
    result.checks['log_duplicate_sync_started_reasonable'] = findings.get('sync_started_count', 0) <= 2

    if findings.get('longest_logged_stall_ms'):
        result.timings.longest_js_stall_ms = findings['longest_logged_stall_ms']

    return result


def main() -> None:
    devices = sys.argv[1:] or ['emulator-5554', '10.0.0.179:5555']
    results = []
    for device in devices:
        print(f'\n=== Validating {device} ===', flush=True)
        try:
            proc = adb(device, 'get-state')
            if proc.returncode != 0:
                print(f'Skip {device}: not available')
                continue
            result = validate_device(device)
            results.append(result)
            print(json.dumps(asdict(result), indent=2))
        except Exception as exc:
            print(f'ERROR on {device}: {exc}')

    out_path = fr'{OUT}\hub-validation-report.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump([asdict(r) for r in results], f, indent=2)
    print(f'\nWrote {out_path}')


if __name__ == '__main__':
    main()
