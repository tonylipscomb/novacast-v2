"""Capture UI + logcat while triggering Movies Play on Android TV."""
from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

DEVICE = os.environ.get('NOVACAST_DEVICE', '10.0.0.151:5555')
PACKAGE = 'com.novacast.novacastv2'
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'movies-play-diag'
LOG = ROOT / '.logs' / 'movies-play-diag.log'


def adb(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(['adb', '-s', DEVICE, *args], capture_output=True, timeout=timeout)


def key(code: str, delay: float = 0.4) -> None:
    adb('shell', 'input', 'keyevent', code)
    time.sleep(delay)


def dump_xml(tag: str) -> str:
    adb('shell', 'uiautomator', 'dump', '/sdcard/novacast-play.xml', timeout=60)
    xml = adb('shell', 'cat', '/sdcard/novacast-play.xml', timeout=30).stdout.decode('utf-8', 'ignore')
    (OUT / f'{tag}.xml').write_text(xml, encoding='utf-8')
    return xml


def focused_labels(xml: str) -> list[str]:
    labels: list[str] = []
    for node in re.findall(r'<node[^>]*/?>', xml):
        if 'focused="true"' not in node:
            continue
        for attr in ('content-desc', 'text'):
            match = re.search(rf'{attr}="([^"]*)"', node)
            if match and match.group(1):
                labels.append(match.group(1))
                break
    return labels


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)

    adb('connect', DEVICE)
    adb('logcat', '-c')
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(0.5)
    adb('shell', 'am', 'start', '-n', f'{PACKAGE}/.MainActivity')
    time.sleep(10)

    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'novacastv2://movies')
    time.sleep(8)

    dump_xml('01-movies-browse')
    print('Focused browse:', focused_labels(dump_xml('01-movies-browse')))

    # Move to poster grid and open detail
    for _ in range(4):
        key('22')  # DPAD_RIGHT
    key('20')  # DPAD_DOWN
    key('23')  # ENTER select movie
    time.sleep(1.5)
    dump_xml('02-detail-open')
    print('Focused detail:', focused_labels(dump_xml('02-detail-open')))

    # Play is the default focused action on movie detail
    time.sleep(0.3)
    dump_xml('03-before-play')
    print('Focused pre-play:', focused_labels(dump_xml('03-before-play')))

    key('23')  # ENTER on Play

    checkpoints = [0.5, 1.0, 1.5, 2.5, 4.0, 6.0]
    elapsed = 0.0
    last = 0.0
    for sec in checkpoints:
        time.sleep(sec - last)
        last = sec
        tag = f'04-play-{sec:.1f}s'
        xml = dump_xml(tag)
        (OUT / f'{tag}.png').write_bytes(adb('exec-out', 'screencap', '-p', timeout=30).stdout)
        labels = focused_labels(xml)
        lower = xml.lower()
        has_play = 'play' in lower
        has_back = 'back' in lower or 'rewind' in lower
        has_movies_heading = 'thousands of movies' in lower
        print(f'[{sec:.1f}s] focus={labels!r} play_btn={has_play} player_chrome={has_back} browse={has_movies_heading}')

    log = adb('logcat', '-d', '-t', '1200', timeout=30).stdout.decode('utf-8', 'ignore')
    filtered = []
    for line in log.splitlines():
        lower = line.lower()
        if any(token in lower for token in (
            'novacast movies playback',
            'store-launch',
            'unified',
            'exoplayer',
            'expovideo',
            'reactnativejs',
        )):
            filtered.append(line)
    LOG.write_text('\n'.join(filtered), encoding='utf-8')
    print(f'Wrote log: {LOG}')
    print(f'Artifacts: {OUT}')


if __name__ == '__main__':
    main()
