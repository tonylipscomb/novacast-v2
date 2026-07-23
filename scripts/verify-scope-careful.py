import io
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DEVICE = 'emulator-5554'
PKG = 'com.novacast.novacastv2'


def adb(*args):
    return subprocess.run(['adb', '-s', DEVICE] + list(args), capture_output=True, timeout=45)


def key(code):
    adb('shell', 'input', 'keyevent', code)


def current_package():
    out = adb('shell', 'dumpsys', 'window').stdout.decode('utf-8', errors='ignore')
    m = re.search(r'mCurrentFocus=Window\{[^}]+\s+[^/]+/([^}\s]+)', out)
    if not m:
        m = re.search(r'mFocusedApp=ActivityRecord\{[^}]+\s+' + PKG, out)
    return PKG if PKG in out else out[:200]


def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/vq.xml')
    return adb('shell', 'cat', '/sdcard/vq.xml').stdout.decode('utf-8', errors='ignore')


def focused_texts(xml):
    texts = []
    for node in re.findall(r'<node[^>]*focused="true"[^>]*/?>', xml):
        for attr in ('text', 'content-desc'):
            m = re.search(rf'{attr}="([^"]*)"', node)
            if m and m.group(1) and not m.group(1).startswith('&#'):
                texts.append(m.group(1))
    return texts


def shot(name):
    data = adb('exec-out', 'screencap', '-p').stdout
    open(name, 'wb').write(data)


def wait_until(pred, timeout=120, step=2, label='ready'):
    end = time.time() + timeout
    while time.time() < end:
        if PKG not in current_package():
            adb('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')
            time.sleep(3)
        xml = dump()
        if pred(xml):
            return xml
        time.sleep(step)
    raise TimeoutError(label)


def dismiss_overlays():
    for _ in range(3):
        xml = dump()
        if 'Loading Live TV' in xml:
            time.sleep(3)
            continue
        if 'Dismiss' in xml or 'Skip' in xml or 'Got it' in xml:
            if 'Skip' in xml:
                # try focus skip
                for _ in range(6):
                    if 'Skip' in focused_texts(dump()):
                        key('KEYCODE_DPAD_CENTER')
                        time.sleep(1)
                        break
                    key('KEYCODE_DPAD_RIGHT')
                    time.sleep(0.3)
            else:
                key('KEYCODE_BACK')
                time.sleep(0.8)
        else:
            break


def goto_live_tv():
    xml = wait_until(lambda x: 'Live TV' in x or 'Content Hub' in x or 'Loading Live TV' in x, label='app home')
    dismiss_overlays()
    if 'Categories' in xml and 'Channels' in xml:
        return xml
    # from home: down to content hub tile
    for _ in range(4):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.25)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(2)
    # pick Live TV tile
    for _ in range(10):
        xml = dump()
        if 'Categories' in xml and 'Channels' in xml:
            return xml
        if 'Live TV' in focused_texts(xml):
            key('KEYCODE_DPAD_CENTER')
            time.sleep(2)
            break
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    return wait_until(lambda x: 'Categories' in x and 'Channels' in x and 'Loading Live TV' not in x, label='live tv loaded')


def goto_movies():
    key('KEYCODE_BACK')
    time.sleep(1.2)
    for _ in range(10):
        xml = dump()
        if 'Movies' in focused_texts(xml):
            key('KEYCODE_DPAD_CENTER')
            time.sleep(2.5)
            break
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    return wait_until(lambda x: 'Movies' in x and 'Play' in x, label='movies loaded')


def main():
    adb('reverse', 'tcp:8081', 'tcp:8081')
    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(0.5)
    adb('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')
    time.sleep(4)

    print('PACKAGE', current_package())

    print('\n[LIVE TV FULLSCREEN]')
    goto_live_tv()
    dismiss_overlays()
    # focus channels column
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.6)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(3)
    xml_fs = dump()
    opened = 'Back to Live TV' in xml_fs
    shot('verify_livetv_fullscreen2.png')
    print('opened:', opened)
    if opened:
        time.sleep(4.5)
        xml_hide = dump()
        chrome_hidden = 'Back to Live TV' not in xml_hide
        shot('verify_livetv_fullscreen_chrome_hidden.png')
        print('chrome_auto_hides:', chrome_hidden)
        key('KEYCODE_BACK')
        time.sleep(1.5)
        xml_back = dump()
        print('back_focus:', focused_texts(xml_back))
    else:
        print('chrome_auto_hides: n/a')

    print('\n[LIVE TV RAPID NAV]')
    goto_live_tv()
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.5)
    start = focused_texts(dump())
    adb('logcat', '-c')
    for _ in range(20):
        key('KEYCODE_DPAD_DOWN')
        time.sleep(0.05)
    time.sleep(1.0)
    end = focused_texts(dump())
    log = adb('logcat', '-d').stdout.decode('utf-8', errors='ignore')
    movie_logs = [l for l in log.splitlines() if 'preview' in l.lower() or 'NovaCast' in l]
    shot('verify_livetv_rapid2.png')
    print('start_focus:', start)
    print('end_focus:', end)
    print('focus_retained:', bool(end))
    print('log_hits:', len(movie_logs))

    print('\n[MOVIES SELECTION + FULLSCREEN]')
    goto_movies()
    adb('logcat', '-c')
    # commit first poster
    key('KEYCODE_DPAD_CENTER')
    time.sleep(0.8)
    xml_a = dump()
    selected_title = None
    for t in re.findall(r'text="([^"]{3,80})"', xml_a):
        if 'Movies' not in t and 'Play' not in t and 'Sort' not in t and 'Popular' not in t:
            selected_title = t
            break
    print('selected_title_guess:', selected_title)
    # move focus across posters without OK
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.4)
    key('KEYCODE_DPAD_RIGHT')
    time.sleep(0.4)
    # move to play
    for _ in range(8):
        xml = dump()
        if 'Play' in focused_texts(xml):
            break
        key('KEYCODE_DPAD_RIGHT')
        time.sleep(0.35)
    play_focused = 'Play' in focused_texts(dump())
    print('play_focused:', play_focused)
    key('KEYCODE_DPAD_CENTER')
    time.sleep(3)
    xml_pb = dump()
    playback = 'Back' in xml_pb
    shot('verify_movies_fullscreen2.png')
    print('playback_opened:', playback)
    logs = adb('logcat', '-d').stdout.decode('utf-8', errors='ignore')
    for line in [l for l in logs.splitlines() if 'NovaCast Movies UI' in l]:
        print(' ', line[line.find('{'):])
    if playback:
        time.sleep(4.5)
        xml_hide = dump()
        print('movies_chrome_hidden:', 'Back' not in focused_texts(xml_hide) and xml_hide.count('Back') < 2)
        key('KEYCODE_BACK')
        time.sleep(1.2)
        print('after_back_focus:', focused_texts(dump()))


if __name__ == '__main__':
    main()
