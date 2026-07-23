"""Adaptive D-pad manual verification for Live TV + Movies fullscreen on emulator-5554."""
import io
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'
OUT = r'C:\Users\tonyl\Desktop\novacast-v2'
BUNDLE_MARKER = 'NC-BUNDLE-VERIFY-20260714A'
MAX_STEPS = 24


@dataclass
class FocusNode:
    desc: str
    text: str
    bounds: str
    raw: str

    @property
    def label(self) -> str:
        return self.desc or self.text

    def bounds_tuple(self) -> tuple[int, int, int, int]:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', self.bounds)
        if not m:
            return (0, 0, 0, 0)
        return tuple(int(g) for g in m.groups())


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=120)


def key(code: str) -> None:
    adb('shell', 'input', 'keyevent', code)


def dump_xml() -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/manual-verify.xml')
    return adb('shell', 'cat', '/sdcard/manual-verify.xml').stdout.decode('utf-8', 'ignore')


def focused(xml: str) -> Optional[FocusNode]:
    for part in xml.split('><'):
        if 'focused="true"' not in part:
            continue
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        bounds = re.search(r'bounds="([^"]*)"', part)
        return FocusNode(
            desc=re.sub(r'&#\d+;', '', desc.group(1) if desc else ''),
            text=text.group(1) if text else '',
            bounds=bounds.group(1) if bounds else '',
            raw=part,
        )
    return None


def all_nodes(xml: str) -> list[FocusNode]:
    nodes = []
    for part in xml.split('><'):
        desc = re.search(r'content-desc="([^"]*)"', part)
        text = re.search(r'text="([^"]*)"', part)
        bounds = re.search(r'bounds="([^"]*)"', part)
        if not desc and not text:
            continue
        nodes.append(
            FocusNode(
                desc=re.sub(r'&#\d+;', '', desc.group(1) if desc else ''),
                text=text.group(1) if text else '',
                bounds=bounds.group(1) if bounds else '',
                raw=part,
            )
        )
    return nodes


def shot(name: str) -> str:
    path = f'{OUT}/{name}.png'
    open(path, 'wb').write(adb('exec-out', 'screencap', '-p').stdout)
    print(f'screenshot {path}', flush=True)
    return path


def logcat_lines() -> list[str]:
    return adb('shell', 'logcat', '-d').stdout.decode('utf-8', 'ignore').splitlines()


def movie_logs() -> list[str]:
    return [l for l in logcat_lines() if 'NovaCast Movies UI' in l or 'NovaCast BundleVerify' in l]


def shell_visible(xml: str) -> dict[str, bool]:
    blob = xml.lower()
    return {
        'live_tv_title': 'live tv' in blob,
        'categories': 'categories' in blob,
        'channels': 'channels' in blob,
        'movies_title': blob.count('movies') > 0 and 'thousands of movies' in blob,
        'movies_categories': 'categories' in blob and 'movies' in blob,
        'nav_home': 'home' in blob and 'live tv' in blob,
    }


def is_channel_row(node: FocusNode) -> bool:
    label = node.label.lower()
    return bool(re.search(r'^\d+,', node.desc)) or ('▎' in node.desc and 'channels' not in label)


def is_category_row(node: FocusNode) -> bool:
    label = node.label.lower()
    return 'channels' in label and not is_channel_row(node)


def is_watch_fullscreen(node: FocusNode) -> bool:
    blob = f'{node.label} {node.text}'.lower()
    return 'watch full screen' in blob


def is_live_fullscreen(xml: str, node: Optional[FocusNode]) -> bool:
    blob = xml.lower()
    if 'back to live tv' in blob:
        return True
    if node and 'back to live tv' in node.label.lower():
        return True
    vis = shell_visible(xml)
    return not vis['live_tv_title'] and not vis['categories'] and not vis['channels'] and 'watching live' in blob


def is_play_button(node: FocusNode) -> bool:
    label = node.label.lower().strip(' ,')
    text = node.text.lower().strip()
    return text == 'play' or label == 'play' or label.endswith('play')


def is_movie_poster(node: FocusNode) -> bool:
    label = node.label
    return 'feature' in label.lower() or 'multi' in label.lower() or re.search(r'\b\d{4}\b', label) is not None


def print_focus(tag: str, node: Optional[FocusNode]) -> None:
    if not node:
        print(f'{tag} NO_FOCUS', flush=True)
        return
    print(f'{tag} desc={node.desc[:120]!r} text={node.text[:80]!r} bounds={node.bounds}', flush=True)


def move_until(
    tag: str,
    predicate,
    keys=('KEYCODE_DPAD_RIGHT',),
    max_steps: int = MAX_STEPS,
    pause: float = 0.35,
) -> Optional[FocusNode]:
    xml = dump_xml()
    node = focused(xml)
    print_focus(f'{tag}_start', node)
    if node and predicate(node, xml):
        return node
    for step in range(1, max_steps + 1):
        key(keys[step % len(keys)] if len(keys) > 1 else keys[0])
        time.sleep(pause)
        xml = dump_xml()
        node = focused(xml)
        print_focus(f'{tag}_step{step}', node)
        if node and predicate(node, xml):
            return node
    return focused(dump_xml())


def confirm_bundle() -> bool:
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://')
    time.sleep(12)
    adb('shell', 'am', 'broadcast', '-a', 'react.native.RELOAD')
    time.sleep(15)
    hits = [l for l in logcat_lines() if BUNDLE_MARKER in l or 'BundleVerify' in l]
    print('bundle_marker_hits', len(hits), flush=True)
    for line in hits[-5:]:
        print(line, flush=True)
    return len(hits) > 0


def navigate_live_channel() -> Optional[FocusNode]:
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://live')
    time.sleep(16)
    print_focus('live_launch', focused(dump_xml()))

    cat = move_until('to_category', lambda n, _x: is_category_row(n), ('KEYCODE_DPAD_RIGHT',), 8)
    print('category_reached', bool(cat and is_category_row(cat)), flush=True)

    ch = move_until('to_channel', lambda n, _x: is_channel_row(n), ('KEYCODE_DPAD_RIGHT',), 8)
    print('channel_reached', bool(ch and is_channel_row(ch)), flush=True)
    return ch


def test_live_fullscreen() -> dict:
    result = {
        'preview_reached': False,
        'watch_fs_reached': False,
        'shell_hidden': False,
        'video_fullscreen': False,
        'back_restored': False,
        'screenshots': [],
    }
    ch = navigate_live_channel()
    if not ch:
        print('live_blocker no_channel_focus', flush=True)
        return result

    key('KEYCODE_DPAD_CENTER')
    time.sleep(4)
    xml = dump_xml()
    node = focused(xml)
    already_fs = is_live_fullscreen(xml, node)
    result['preview_reached'] = not already_fs and ('watch full screen' in xml.lower() or bool(node and is_channel_row(node)))
    print('preview_only_after_first_ok', result['preview_reached'], 'already_fs', already_fs, flush=True)
    result['screenshots'].append(shot('manual_live_preview'))

    if already_fs:
        result['watch_fs_reached'] = True
        vis = shell_visible(xml)
        result['shell_hidden'] = not vis['live_tv_title'] and not vis['categories'] and not vis['channels']
        result['video_fullscreen'] = result['shell_hidden']
        result['screenshots'].append(shot('manual_live_fullscreen'))
        key('KEYCODE_BACK')
        time.sleep(2)
        result['screenshots'].append(shot('manual_live_after_back'))
        return result

    key('KEYCODE_DPAD_CENTER')
    time.sleep(4)
    xml = dump_xml()
    already_fs = is_live_fullscreen(xml, focused(xml))
    result['watch_fs_reached'] = already_fs
    vis = shell_visible(xml)
    result['shell_hidden'] = already_fs and not vis['live_tv_title']
    result['video_fullscreen'] = result['shell_hidden']
    print('after_second_ok_fs', result['watch_fs_reached'], flush=True)
    result['screenshots'].append(shot('manual_live_fullscreen'))

    if result['watch_fs_reached']:
        time.sleep(5)
        result['screenshots'].append(shot('manual_live_fs_chrome_hidden'))
        key('KEYCODE_DPAD_CENTER')
        time.sleep(1)
        result['screenshots'].append(shot('manual_live_fs_chrome_show'))
        key('KEYCODE_BACK')
        time.sleep(2)
        xml = dump_xml()
        post = focused(xml)
        print_focus('live_after_back', post)
        vis_after = shell_visible(xml)
        result['back_restored'] = vis_after['live_tv_title'] or (post is not None and (is_channel_row(post) or is_watch_fullscreen(post)))
        result['screenshots'].append(shot('manual_live_after_back'))
        print('live_back_restored', result['back_restored'], vis_after, flush=True)
    return result


def detail_title(xml: str) -> Optional[str]:
    for node in all_nodes(xml):
        if 'feature film' in node.label.lower() or 'tba' in node.label.lower():
            if 'multi' in node.label.lower() and len(node.label) > 20:
                return node.label
    for node in all_nodes(xml):
        if node.bounds_tuple()[0] > 1200 and 'multi' in node.label.lower():
            return node.label
    return None


def test_movies_playback() -> dict:
    result = {
        'movie_a': None,
        'play_reached': False,
        'movie_a_launched': False,
        'shell_hidden': False,
        'true_fullscreen': False,
        'back_restored_movie_a': False,
        'screenshots': [],
    }
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
    for _ in range(30):
        xml = dump_xml()
        if 'Categories' in xml and 'Loading' not in xml:
            break
        time.sleep(1.5)
    result['screenshots'].append(shot('manual_movies_start'))
    vis = shell_visible(xml)
    print('movies_categories_visible', vis['movies_categories'] or vis['categories'], flush=True)

    poster = move_until('to_poster', lambda n, _x: is_movie_poster(n) and n.bounds_tuple()[0] > 400, ('KEYCODE_DPAD_RIGHT', 'KEYCODE_DPAD_DOWN'), 12, 0.35)
    if not poster:
        print('movies_blocker no_poster', flush=True)
        return result
    result['movie_a'] = poster.label[:160]
    print('movie_a_focus', result['movie_a'], flush=True)

    key('KEYCODE_DPAD_CENTER')
    time.sleep(1.5)
    xml = dump_xml()
    detail = detail_title(xml)
    sel_logs = movie_logs()
    movie_a_id = None
    for line in sel_logs:
        if 'movie-selected' in line:
            m = re.search(r"movieId: '(\d+)'", line) or re.search(r'movieId: (\d+)', line)
            if m:
                movie_a_id = m.group(1)
    print('movie_a_detail_after_ok', detail, flush=True)
    print('movie_a_selected_id', movie_a_id, flush=True)
    print('movie_selected_logs', sel_logs[-2:], flush=True)

    play = move_until(
        'to_play',
        lambda n, _x: is_play_button(n),
        ('KEYCODE_DPAD_RIGHT',),
        6,
        0.4,
    )
    result['play_reached'] = bool(play and is_play_button(play))
    xml = dump_xml()
    detail_at_play = detail_title(xml)
    print('detail_at_play', detail_at_play, flush=True)
    print('play_reached', result['play_reached'], flush=True)
    result['screenshots'].append(shot('manual_movies_play_focus'))

    adb('shell', 'logcat', '-c')
    if result['play_reached']:
        key('KEYCODE_DPAD_CENTER')
        time.sleep(6)
        xml = dump_xml()
        logs = movie_logs()
        playback_logs = [l for l in logs if 'play-pressed' in l or 'movie-selected' in l]
        print('playback_logs', playback_logs[-4:], flush=True)
        result['movie_a_launched'] = any('play-pressed' in l for l in playback_logs)
        if result['movie_a_launched'] and movie_a_id:
            for line in playback_logs:
                if 'play-pressed' in line and movie_a_id in line:
                    result['movie_a_launched'] = True
                    break
        vis = shell_visible(xml)
        result['shell_hidden'] = not vis['movies_title'] and not vis['movies_categories']
        result['true_fullscreen'] = result['shell_hidden']
        print('movies_playback_shell', vis, flush=True)
        result['screenshots'].append(shot('manual_movies_fullscreen'))

        key('KEYCODE_BACK')
        time.sleep(2)
        xml = dump_xml()
        detail_after = detail_title(xml)
        post = focused(dump_xml())
        print('movies_detail_after_back', detail_after, flush=True)
        print_focus('movies_focus_after_back', post)
        result['back_restored_movie_a'] = bool(
            detail_after
            and result['movie_a']
            and 'Operation Nation' in detail_after
            and shell_visible(xml)['movies_categories']
        )
        result['screenshots'].append(shot('manual_movies_after_back'))
    return result


def main() -> None:
    print('=== BUNDLE CHECK ===', flush=True)
    bundle_ok = confirm_bundle()
    print('bundle_confirmed', bundle_ok, flush=True)
    if not bundle_ok:
        print('BLOCKER stale_or_missing_bundle', flush=True)

    print('=== LIVE TV FULLSCREEN ===', flush=True)
    live = test_live_fullscreen()
    print('live_results', live, flush=True)

    print('=== MOVIES PLAY/FULLSCREEN ===', flush=True)
    movies = test_movies_playback()
    print('movies_results', movies, flush=True)

    print('=== SUMMARY ===', flush=True)
    print('bundle', bundle_ok, flush=True)
    for k, v in live.items():
        if k != 'screenshots':
            print(f'live_{k}', v, flush=True)
    for k, v in movies.items():
        if k != 'screenshots':
            print(f'movies_{k}', v, flush=True)


if __name__ == '__main__':
    main()
