"""10-cycle stability validation for Live TV and Movies on emulator-5554. Validation only."""
import io
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'
LIVE_CYCLES = 10
MOVIE_CYCLES = 10
CHANNEL_HINT = 'SAFARI'
MOVIE_A_HINT = 'Operation Nation'
MOVIE_A_ID = '848644'


@dataclass
class LiveCycleResult:
    cycle: int
    preview: str = 'fail'
    fullscreen: str = 'fail'
    stream_preview: str = 'unknown'
    stream_fullscreen: str = 'unknown'
    chrome_hide: str = 'skip'
    chrome_show: str = 'skip'
    back: str = 'fail'
    focus_restore: str = 'fail'
    content_hub: str = 'no'
    nav_notes: str = ''
    stream_notes: str = ''


@dataclass
class MovieCycleResult:
    cycle: int
    movie_selected: str = 'fail'
    play_reached: str = 'fail'
    launched: str = 'fail'
    fullscreen: str = 'fail'
    stream: str = 'unknown'
    back: str = 'fail'
    movie_a_preserved: str = 'fail'
    focus_play: str = 'fail'
    content_hub: str = 'no'
    nav_notes: str = ''
    stream_notes: str = ''


@dataclass
class FocusNode:
    desc: str
    text: str
    bounds: str

    @property
    def label(self) -> str:
        return self.desc or self.text


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code: str) -> None:
    adb('shell', 'input', 'keyevent', code)


def dump_xml() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/stab-cycle.xml')
    return adb('shell', 'cat', '/sdcard/stab-cycle.xml').stdout.decode('utf-8', 'ignore')


def focused(xml: str) -> Optional[FocusNode]:
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        d = re.search(r'content-desc="([^"]*)"', part)
        t = re.search(r'text="([^"]*)"', part)
        b = re.search(r'bounds="([^"]*)"', part)
        return FocusNode(
            re.sub(r'&#\d+;', '', d.group(1) if d else ''),
            t.group(1) if t else '',
            b.group(1) if b else '',
        )
    return None


def dismiss_blockers(max_attempts: int = 6) -> None:
    for _ in range(max_attempts):
        xml = dump_xml().lower()
        if 'content hub' in xml and 'manage your providers' in xml:
            key('KEYCODE_BACK')
            time.sleep(1.2)
            continue
        if 'allow android tv core services' in xml or 'allow one-time access' in xml:
            key('KEYCODE_DPAD_CENTER')
            time.sleep(1.2)
            continue
        if 'provide feedback' in xml or 'click to type' in xml:
            key('KEYCODE_BACK')
            time.sleep(1.2)
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


def is_content_hub(xml: str) -> bool:
    b = xml.lower()
    return 'content hub' in b and 'manage your providers' in b


def is_preview_browse(xml: str) -> bool:
    b = xml.lower()
    return 'live tv' in b and 'categories' in b and 'watch full screen' in b


def is_live_fullscreen(xml: str) -> bool:
    b = xml.lower()
    return 'back to live tv' in b and 'categories' not in b


def has_playback_error(xml: str) -> bool:
    b = xml.lower()
    return 'playback error' in b or ('retry' in b and 'back to live tv' in b)


def is_channel_row(node: Optional[FocusNode]) -> bool:
    if not node:
        return False
    return bool(re.search(r'^\d+,', node.desc)) or ('▎' in node.desc and 'channels' not in node.label.lower())


def is_play_focus(node: Optional[FocusNode]) -> bool:
    if not node:
        return False
    blob = f'{node.label} {node.text}'.lower()
    return blob.strip() == 'play' or blob.endswith('play') or ', play' in blob


def is_movies_browse(xml: str) -> bool:
    b = xml.lower()
    return 'thousands of movies' in b and 'categories' in b


def is_movies_fullscreen(xml: str) -> bool:
    b = xml.lower()
    return not is_movies_browse(xml) and not is_content_hub(xml) and PACKAGE in xml


def nav_to_reliable_channel() -> bool:
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(16)
    dismiss_blockers()
    for step in range(12):
        xml = dump_xml()
        node = focused(xml)
        if node and CHANNEL_HINT.upper() in node.desc.upper() and is_channel_row(node):
            return True
        if node and is_channel_row(node) and '1,' in node.desc:
            return True
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    xml = dump_xml()
    node = focused(xml)
    return bool(node and is_channel_row(node))


def nav_movies_to_play() -> tuple[bool, bool]:
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
    for _ in range(25):
        xml = dump_xml()
        if is_movies_browse(xml) and 'Loading' not in xml:
            break
        time.sleep(1.2)
    dismiss_blockers()
    for _ in range(8):
        xml = dump_xml()
        node = focused(xml)
        if node and MOVIE_A_HINT.lower() in node.label.lower():
            key('KEYCODE_DPAD_CENTER')
            time.sleep(1.2)
            break
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.3)
    for _ in range(6):
        xml = dump_xml()
        node = focused(xml)
        if node and is_play_focus(node):
            return True, MOVIE_A_HINT.lower() in xml.lower()
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    xml = dump_xml()
    return is_play_focus(focused(xml)), MOVIE_A_HINT.lower() in xml.lower()


def player_error_from_logcat() -> Optional[str]:
    for line in adb('shell', 'logcat', '-d', '-s', 'ReactNativeJS:I').stdout.decode('utf-8', 'ignore').splitlines():
        if 'Playback error' in line or 'Unable to play' in line:
            return line[:200]
        if 'MediaSession' in line and 'ERROR' in line:
            return 'MediaSession ERROR (native playback)'
    return None


def run_live_cycle(n: int) -> LiveCycleResult:
    r = LiveCycleResult(cycle=n)
    if not nav_to_reliable_channel():
        r.nav_notes = 'could not focus reliable channel'
        return r

    adb('shell', 'logcat', '-c')
    key('KEYCODE_DPAD_CENTER')
    time.sleep(4)
    xml = dump_xml()
    dismiss_blockers()

    if is_live_fullscreen(xml):
        r.nav_notes = 'first OK jumped to fullscreen (duplicate OK bug)'
        r.preview = 'fail'
        key('KEYCODE_BACK')
        time.sleep(2)
        return r

    if is_preview_browse(xml):
        r.preview = 'pass'
    else:
        r.nav_notes = 'not preview browse after first OK'
        return r

    if has_playback_error(xml):
        r.stream_preview = 'fail'
        r.stream_notes = 'playback error in preview'
    else:
        r.stream_preview = 'pass'

    time.sleep(2)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(5)
    xml = dump_xml()
    dismiss_blockers()

    if is_live_fullscreen(xml):
        r.fullscreen = 'pass'
    else:
        r.nav_notes = 'second OK did not enter fullscreen'
        return r

    if has_playback_error(xml):
        r.stream_fullscreen = 'fail'
        err = player_error_from_logcat()
        if err:
            r.stream_notes = err
    else:
        r.stream_fullscreen = 'pass'

    time.sleep(5)
    xml_before_chrome = dump_xml()
    if is_live_fullscreen(xml_before_chrome) and not has_playback_error(xml_before_chrome):
        r.chrome_hide = 'pass' if 'back to live tv' not in xml_before_chrome.lower() or focused(xml_before_chrome) is None else 'partial'

    key('KEYCODE_DPAD_CENTER')
    time.sleep(1)
    xml = dump_xml()
    node = focused(xml)
    if is_live_fullscreen(xml) and (node and 'back to live tv' in node.label.lower()):
        r.chrome_show = 'pass'
    elif is_live_fullscreen(xml):
        r.chrome_show = 'partial'

    key('KEYCODE_BACK')
    time.sleep(2.5)
    xml = dump_xml()
    dismiss_blockers()

    if is_content_hub(xml):
        r.content_hub = 'yes'
        r.back = 'fail'
        r.nav_notes = 'Content Hub after Back'
        return r

    if is_preview_browse(xml):
        r.back = 'pass'
    else:
        r.nav_notes = f'after Back not preview: hub={is_content_hub(xml)}'

    node = focused(xml)
    if is_channel_row(node) or (node and CHANNEL_HINT.upper() in node.label.upper()):
        r.focus_restore = 'pass'
    elif node and 'watch full screen' in node.label.lower():
        r.focus_restore = 'partial'
    else:
        r.focus_restore = 'fail'
        r.nav_notes += f'; focus={(node.label if node else None)[:60]}'

    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.5)
    if is_content_hub(dump_xml()):
        r.content_hub = 'yes'

    return r


def run_movie_cycle(n: int) -> MovieCycleResult:
    r = MovieCycleResult(cycle=n)
    play_ok, movie_ok = nav_movies_to_play()
    r.play_reached = 'pass' if play_ok else 'fail'
    r.movie_selected = 'pass' if movie_ok else 'fail'

    if not play_ok:
        r.nav_notes = 'could not reach Play'
        return r

    adb('shell', 'logcat', '-c')
    key('KEYCODE_DPAD_CENTER')
    time.sleep(6)
    xml = dump_xml()
    dismiss_blockers()

    logs = adb('shell', 'logcat', '-d', '-s', 'ReactNativeJS:I').stdout.decode('utf-8', 'ignore')
    if f"movieId: '{MOVIE_A_ID}'" in logs or f'movieId: {MOVIE_A_ID}' in logs:
        if 'play-pressed' in logs:
            r.launched = 'pass'

    if is_movies_fullscreen(xml) and not is_movies_browse(xml):
        r.fullscreen = 'pass'
    elif is_content_hub(xml):
        r.content_hub = 'yes'
        r.nav_notes = 'Content Hub during playback'
        return r
    else:
        r.nav_notes = 'not fullscreen after Play'

    if has_playback_error(xml):
        r.stream = 'fail'
    else:
        r.stream = 'pass'

    key('KEYCODE_BACK')
    time.sleep(2.5)
    xml = dump_xml()
    dismiss_blockers()

    if is_content_hub(xml):
        r.content_hub = 'yes'
        r.back = 'fail'
        r.nav_notes = 'Content Hub after Back'
        return r

    if is_movies_browse(xml):
        r.back = 'pass'
    else:
        r.nav_notes = 'browse not restored after Back'
        return r

    if MOVIE_A_HINT.lower() in xml.lower():
        r.movie_a_preserved = 'pass'

    node = focused(xml)
    if is_play_focus(node):
        r.focus_play = 'pass'
    elif node and MOVIE_A_HINT.lower() in node.label.lower():
        r.focus_play = 'partial'

    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.5)
    if is_content_hub(dump_xml()):
        r.content_hub = 'yes'

    return r


def prep_environment() -> dict:
    info = {'metro_project': 'C:\\Users\\tonyl\\Desktop\\novacast-v2', 'adb_reverse': False, 'reload': False}
    rev = adb('shell', 'echo', 'ok').stdout  # dummy
    reverse_list = subprocess.run(['adb', '-s', DEVICE, 'reverse', '--list'], capture_output=True, text=True).stdout
    info['adb_reverse'] = 'tcp:8081 tcp:8081' in reverse_list
    adb('shell', 'am', 'broadcast', '-a', 'react.native.RELOAD')
    time.sleep(10)
    info['reload'] = True
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://')
    time.sleep(8)
    dismiss_blockers()
    return info


def main() -> None:
    print('=== PREP ===', flush=True)
    prep = prep_environment()
    print(json.dumps(prep), flush=True)

    live_results: list[LiveCycleResult] = []
    print('=== LIVE TV 10 CYCLES ===', flush=True)
    for i in range(1, LIVE_CYCLES + 1):
        print(f'--- live cycle {i} ---', flush=True)
        result = run_live_cycle(i)
        live_results.append(result)
        print(json.dumps(asdict(result)), flush=True)

    movie_results: list[MovieCycleResult] = []
    print('=== MOVIES 10 CYCLES ===', flush=True)
    for i in range(1, MOVIE_CYCLES + 1):
        print(f'--- movies cycle {i} ---', flush=True)
        result = run_movie_cycle(i)
        movie_results.append(result)
        print(json.dumps(asdict(result)), flush=True)

    def count(results, field, val='pass') -> int:
        return sum(1 for r in results if getattr(r, field) == val)

    summary = {
        'live_preview_pass': count(live_results, 'preview'),
        'live_fullscreen_pass': count(live_results, 'fullscreen'),
        'live_back_pass': count(live_results, 'back'),
        'live_focus_pass': count(live_results, 'focus_restore'),
        'live_content_hub': sum(1 for r in live_results if r.content_hub == 'yes'),
        'live_stream_preview_fail': sum(1 for r in live_results if r.stream_preview == 'fail'),
        'live_stream_fullscreen_fail': sum(1 for r in live_results if r.stream_fullscreen == 'fail'),
        'movies_back_pass': count(movie_results, 'back'),
        'movies_fullscreen_pass': count(movie_results, 'fullscreen'),
        'movies_focus_play_pass': count(movie_results, 'focus_play'),
        'movies_movie_a_pass': count(movie_results, 'movie_a_preserved'),
        'movies_content_hub': sum(1 for r in movie_results if r.content_hub == 'yes'),
        'movies_launched_pass': count(movie_results, 'launched'),
    }
    print('=== SUMMARY ===', flush=True)
    print(json.dumps(summary, indent=2), flush=True)

    out_path = f'{OUT}/stability-cycle-results.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'prep': prep, 'live': [asdict(r) for r in live_results], 'movies': [asdict(r) for r in movie_results], 'summary': summary}, f, indent=2)
    print(f'wrote {out_path}', flush=True)


if __name__ == '__main__':
    main()
