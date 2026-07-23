#!/usr/bin/env python3
"""Emulator verification for Live TV fullscreen, Movies fullscreen/selection, and rapid D-pad."""

import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DEVICE = 'emulator-5554'
PACKAGE = 'com.novacast.novacastv2'


def adb(*args, timeout=60):
    result = subprocess.run(
        ['adb', '-s', DEVICE] + list(args),
        capture_output=True,
        timeout=timeout,
    )
    return result.stdout.decode('utf-8', errors='ignore'), result.stderr.decode('utf-8', errors='ignore')


def key(code):
    adb('shell', 'input', 'keyevent', code)


def screenshot(path):
    adb('shell', 'screencap', '-p', f'/sdcard/{path}')
    adb('pull', f'/sdcard/{path}', path)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/verify_scope.xml')
    out, _ = adb('shell', 'cat', '/sdcard/verify_scope.xml')
    return out


def focused_nodes(xml):
    return re.findall(r'<node[^>]*focused="true"[^>]*/?>', xml)


def focused_text(xml):
    texts = []
    for node in focused_nodes(xml):
        for attr in ('text', 'content-desc'):
            match = re.search(rf'{attr}="([^"]*)"', node)
            if match and match.group(1):
                texts.append(match.group(1))
    return texts


def wait_for(predicate, timeout_s=90, interval_s=1.5, label='condition'):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        if predicate(xml):
            return xml
        time.sleep(interval_s)
    raise TimeoutError(f'Timed out waiting for {label}')


def launch_app():
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(0.5)
    adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1')
    time.sleep(2)


def navigate_to_live_tv():
    xml = wait_for(
        lambda x: 'Content Hub' in x or 'Live TV' in x or 'Movies' in x or 'Provider connection failed' in x,
        label='home or hub',
    )
    if 'Provider connection failed' in xml:
        raise RuntimeError('App stuck on provider connection failed')

    if 'Live TV' not in xml:
        # Open content hub from home if needed
        if 'Content Hub' not in xml:
            for _ in range(4):
                key('KEYCODE_DPAD_DOWN')
                time.sleep(0.25)
            key('KEYCODE_DPAD_CENTER')
            time.sleep(1.5)
            xml = dump()

        # Focus Live TV tile
        for _ in range(12):
            xml = dump()
            if 'Live TV' in focused_text(xml) or 'Live TV' in xml:
                break
            key('KEYCODE_DPAD_RIGHT')
            time.sleep(0.35)
        key('KEYCODE_DPAD_CENTER')
        time.sleep(2)

    return wait_for(lambda x: 'Categories' in x and 'Channels' in x, label='Live TV screen')


def navigate_to_movies():
    key('KEYCODE_BACK')
    time.sleep(1.2)
    xml = dump()
    if 'Content Hub' not in xml and 'Movies' not in xml:
        key('KEYCODE_BACK')
        time.sleep(1.2)
        xml = dump()

    for _ in range(12):
        xml = dump()
        if 'Movies' in focused_text(xml):
            break
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.5)
    return wait_for(lambda x: 'Movies' in x and 'Play' in x, label='Movies screen')


def test_live_tv_fullscreen():
    xml = navigate_to_live_tv()
    # Move to channel list center
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.5)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.5)
    xml = dump()
    opened = 'Back to Live TV' in xml or 'WATCHING LIVE' in xml
    screenshot('verify_livetv_fullscreen.png')
    if opened:
        time.sleep(4.5)
        xml_after_hide = dump()
        chrome_hidden = 'Back to Live TV' not in xml_after_hide and 'WATCHING LIVE' not in xml_after_hide
        key('KEYCODE_BACK')
        time.sleep(1.5)
        return {
            'opened': True,
            'chrome_auto_hides': chrome_hidden,
            'shell_absent_hint': 'NovaTvShell' not in xml_after_hide,
        }
    return {'opened': False, 'chrome_auto_hides': False, 'shell_absent_hint': False}


def test_live_tv_rapid_nav():
    xml = navigate_to_live_tv()
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.4)
    start_focus = focused_text(xml)
    adb('logcat', '-c')
    for _ in range(20):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.05)
    time.sleep(0.8)
    xml_end = dump()
    end_focus = focused_text(xml_end)
    logcat, _ = adb('logcat', '-d', '-s', 'ReactNativeJS:I')
    preview_lines = [line for line in logcat.splitlines() if 'preview' in line.lower() or 'chooseLiveChannel' in line]
    screenshot('verify_livetv_rapid.png')
    return {
        'start_focus': start_focus,
        'end_focus': end_focus,
        'focus_retained': len(end_focus) > 0,
        'log_preview_hits': len(preview_lines),
    }


def test_movies_selection_and_fullscreen():
    xml = navigate_to_movies()
    # Select first visible movie with OK
    key('KEYCODE_DPAD_CENTER')
    time.sleep(0.8)
    xml_sel = dump()
    selected_title_match = re.search(r'content-desc="([^"]+)"[^>]*focused="true"', xml_sel)
    # Move focus to another poster without OK
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.5)
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.5)
    # Move to Play button
    for _ in range(6):
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    xml_play_focus = dump()
    play_focused = any('Play' in t for t in focused_text(xml_play_focus))
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2.5)
    xml_playback = dump()
    playback_open = 'Back' in xml_playback
    screenshot('verify_movies_fullscreen.png')
    if playback_open:
        time.sleep(4.5)
        xml_after_hide = dump()
        chrome_hidden = 'Back' not in focused_text(xml_after_hide)
        key('KEYCODE_BACK')
        time.sleep(1.5)
        xml_after_back = dump()
        restored = len(focused_text(xml_after_back)) > 0
        return {
            'play_focused': play_focused,
            'playback_opened': True,
            'chrome_auto_hides': chrome_hidden,
            'focus_restored_after_back': restored,
            'detail_still_has_play': 'Play' in xml_after_back,
        }
    return {
        'play_focused': play_focused,
        'playback_opened': False,
        'chrome_auto_hides': False,
        'focus_restored_after_back': False,
        'detail_still_has_play': False,
    }


def main():
    results = {}
    launch_app()
    try:
        results['live_tv_fullscreen'] = test_live_tv_fullscreen()
    except Exception as exc:
        results['live_tv_fullscreen'] = {'error': str(exc)}

    try:
        results['live_tv_rapid'] = test_live_tv_rapid_nav()
    except Exception as exc:
        results['live_tv_rapid'] = {'error': str(exc)}

    try:
        results['movies'] = test_movies_selection_and_fullscreen()
    except Exception as exc:
        results['movies'] = {'error': str(exc)}

    print('VERIFICATION_RESULTS')
    for section, payload in results.items():
        print(f'[{section}]')
        if isinstance(payload, dict):
            for key, value in payload.items():
                print(f'  {key}: {value}')
        else:
            print(f'  {payload}')


if __name__ == '__main__':
    main()
