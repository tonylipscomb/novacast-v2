import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DEVICE = 'emulator-5554'


def adb(*args, timeout=40):
    result = subprocess.run(
        ['adb', '-s', DEVICE] + list(args),
        capture_output=True,
        timeout=timeout,
    )
    return result.stdout, result.stderr


def key(code):
    adb('shell', 'input', 'keyevent', code)


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/wd.xml')
    out, _ = adb('shell', 'cat', '/sdcard/wd.xml')
    return out.decode('utf-8', errors='ignore')


def focused_desc(xml):
    nodes = re.findall(r'<node[^>]*focused="true"[^>]*/?>', xml)
    for n in nodes:
        m = re.search(r'content-desc="([^"]*)"', n)
        if m:
            return m.group(1)
    return None


def has_text(xml, needle):
    return needle in xml


def run_cycle(cycle_num, launch_source):
    xml = dump()
    start_focus = focused_desc(xml)
    print(f'[cycle {cycle_num}] ({launch_source}) start focus: {start_focus}')

    if launch_source == 'button':
        # Assume focus already on a channel row; move right twice to reach
        # the Watch Full Screen button (first Right re-syncs to active row,
        # second Right reaches the button).
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.6)
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.6)
        xml = dump()
        pre_launch_focus = focused_desc(xml)
        if 'Watch Full Screen' not in (pre_launch_focus or ''):
            print(f'  WARN: expected Watch Full Screen focus, got: {pre_launch_focus}')
        key('KEYCODE_DPAD_CENTER')
        time.sleep(1.5)
    else:
        pre_launch_focus = start_focus
        key('KEYCODE_DPAD_CENTER')
        time.sleep(0.8)
        xml = dump()
        if 'Back to Live TV' not in xml:
            key('KEYCODE_DPAD_CENTER')
            time.sleep(1.5)

    xml = dump()
    fullscreen_opened = 'Back to Live TV' in xml
    fs_focus = focused_desc(xml)
    print(f'  fullscreen opened: {fullscreen_opened}, focus on open: {fs_focus}')
    if not fullscreen_opened:
        print('  FAIL: fullscreen did not open')
        return False

    key('KEYCODE_BACK')
    time.sleep(1.2)

    xml = dump()
    closed = 'Back to Live TV' not in xml
    restored_focus = focused_desc(xml)
    print(f'  fullscreen closed: {closed}, focus after close: {restored_focus}')

    ok = closed and restored_focus is not None and (
        pre_launch_focus in (restored_focus, restored_focus)
        or (launch_source == 'button' and 'Watch Full Screen' in restored_focus)
        or (launch_source == 'channel' and restored_focus == pre_launch_focus)
    )

    key('KEYCODE_DPAD_DOWN')
    time.sleep(0.8)
    xml = dump()
    content_hub_opened = has_text(xml, 'Manage your providers and settings') or has_text(xml, 'Choose Your Provider')
    still_live_tv = has_text(xml, 'Browse channels without losing the picture') or has_text(xml, 'Channels')
    after_down_focus = focused_desc(xml)
    print(f'  after Down -> content hub opened: {content_hub_opened}, still Live TV: {still_live_tv}, focus: {after_down_focus}')

    success = ok and not content_hub_opened and still_live_tv
    print(f'  CYCLE RESULT: {"PASS" if success else "FAIL"}')
    return success


def main():
    results = []
    for i in range(1, 11):
        source = 'channel' if i % 2 == 1 else 'button'
        try:
            results.append(run_cycle(i, source))
        except Exception as e:
            print(f'[cycle {i}] EXCEPTION: {e}')
            results.append(False)
        time.sleep(0.5)

    passed = sum(1 for r in results if r)
    print(f'\n=== SUMMARY: {passed}/{len(results)} cycles passed ===')


if __name__ == '__main__':
    main()
