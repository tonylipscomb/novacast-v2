import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  getOfflineSnapshot,
  isConfirmedOfflineTransition,
  OFFLINE_TOAST_DURATION_MS,
  subscribeOfflineStatus,
} from './offlineStatus';

/** Passive transient offline toast — never focusable or blocking. */
export function OfflineStatusBanner() {
  const snapshot = useSyncExternalStore(subscribeOfflineStatus, getOfflineSnapshot, getOfflineSnapshot);
  const previousStatusRef = useRef(snapshot.status);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = snapshot.status;

    if (isConfirmedOfflineTransition(previousStatus, snapshot.status)) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setIsVisible(true);
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setIsVisible(false);
      }, OFFLINE_TOAST_DURATION_MS);
      return;
    }

    if (snapshot.status !== 'offline') {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setIsVisible(false);
    }
  }, [snapshot.status]);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  if (!isVisible) return null;

  return (
    <View pointerEvents="none" style={styles.toast} accessibilityElementsHidden accessible={false}>
      <MaterialCommunityIcons name="wifi-off" size={16} color="#D8CCFF" />
      <Text style={styles.text}>You're offline — cached content available</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
    zIndex: 9000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(10, 10, 28, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(216, 204, 255, 0.35)',
    borderRadius: 16,
  },
  text: {
    color: '#F1EDFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
