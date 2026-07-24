import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  getTvPerfSnapshot,
  isTvPerfHudEnabled,
  subscribeTvPerf,
  type TvPerfSnapshot,
} from './tvPerfStore';
import { getTvImageObservability } from './tvImageObservability';

/**
 * Development-only TV performance overlay.
 * Enable with EXPO_PUBLIC_TV_PERF_HUD=1. Never mounts in production.
 */
export function TvPerfHud() {
  const enabled = isTvPerfHudEnabled();
  const [snapshot, setSnapshot] = useState<TvPerfSnapshot>(() => getTvPerfSnapshot());
  const [imageStats, setImageStats] = useState(() => getTvImageObservability());
  const [uiFps, setUiFps] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribeTvPerf(() => {
      setSnapshot(getTvPerfSnapshot());
      setImageStats(getTvImageObservability());
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let frames = 0;
    let last = Date.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = Date.now();
      if (now - last >= 1000) {
        setUiFps(frames);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled || !__DEV__) {
    return null;
  }

  const latest = snapshot.latestFocusRequest;

  return (
    <View pointerEvents="none" style={styles.hud} accessibilityElementsHidden>
      <Text style={styles.title}>TV PERF</Text>
      <Text style={styles.line}>UI FPS {uiFps || 'n/a'}</Text>
      <Text style={styles.line}>JS budget {snapshot.jsFrameBudgetMs.toFixed(1)}ms (target)</Text>
      <Text style={styles.line}>JS FPS n/a</Text>
      <Text style={styles.line}>Memory n/a</Text>
      <Text style={styles.line}>Screen {snapshot.screen}</Text>
      <Text style={styles.line}>Focus {snapshot.focusedComponent}</Text>
      <Text style={styles.line}>Item {snapshot.focusedItem}</Text>
      <Text style={styles.line}>
        Latest focus {latest ? `${latest.source}/${latest.region}` : '—'}
      </Text>
      <Text style={styles.line}>Focus reason {latest?.reason ?? '—'}</Text>
      <Text style={styles.line}>Focus gen {latest?.generation ?? '—'}</Text>
      <Text style={styles.line}>Focus req/s {snapshot.focusRequestsPerSec}</Text>
      <Text style={styles.line}>Visible posters {snapshot.visiblePosters}</Text>
      <Text style={styles.line}>Poster renders/s {snapshot.posterRendersPerSec}</Text>
      <Text style={styles.line}>Guide cell renders/s {snapshot.guideCellRendersPerSec}</Text>
      <Text style={styles.line}>Focus requests {snapshot.focusRequests}</Text>
      <Text style={styles.line}>Preview queue {snapshot.previewQueue}</Text>
      <Text style={styles.line}>Pending images {imageStats.pending}</Text>
      <Text style={styles.line}>Image fails {imageStats.failed}</Text>
      <Text style={styles.line}>Image mounts {imageStats.mounts}</Text>
      <Text style={styles.line}>Dup image hits {imageStats.duplicateHits}</Text>
      <Text style={styles.line}>Last render {snapshot.lastRenderMs}ms</Text>
      <Text style={styles.hint}>{Platform.OS} · DEV ONLY · throttled 250ms</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    top: 48,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
    minWidth: 230,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(131, 180, 255, 0.45)',
    gap: 2,
  },
  title: {
    color: '#83B4FF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  line: {
    color: '#E8EEF8',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  hint: {
    marginTop: 4,
    color: 'rgba(232, 238, 248, 0.55)',
    fontSize: 9,
    fontWeight: '700',
  },
});
