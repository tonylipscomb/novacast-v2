import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type FullscreenSurfOverlaySnapshot = {
  channelId: string;
  channelName: string;
  channelNumber?: string;
};

let snapshot: FullscreenSurfOverlaySnapshot | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function publishFullscreenSurfOverlay(next: FullscreenSurfOverlaySnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function clearFullscreenSurfOverlay(channelId?: string) {
  if (channelId && snapshot?.channelId !== channelId) {
    return;
  }
  if (snapshot === null) {
    return;
  }
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function FullscreenSurfOverlay() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!current) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>
          {current.channelNumber ? `Channel ${current.channelNumber}` : 'Live'}
        </Text>
        <Text numberOfLines={1} style={styles.title}>{current.channelName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  panel: {
    maxWidth: '78%',
    minWidth: 260,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(177,154,255,0.72)',
    backgroundColor: 'rgba(3,7,18,0.86)',
    shadowColor: '#8064FF',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
});
