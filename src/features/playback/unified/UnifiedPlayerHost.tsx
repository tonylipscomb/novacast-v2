import { useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { isUnifiedPlaybackActive } from './unifiedPlayerLogic.ts';
import { getUnifiedPlayerState, subscribeUnifiedPlayer } from './unifiedPlayerStore.ts';
import { UnifiedPlayerController } from './UnifiedPlayerController.tsx';

function useUnifiedPlayerHostMounted() {
  return useSyncExternalStore(
    subscribeUnifiedPlayer,
    () => {
      const snapshot = getUnifiedPlayerState();
      return isUnifiedPlaybackActive(snapshot.machineState, snapshot.item) || snapshot.machineState === 'closing';
    },
    () => false,
  );
}

/**
 * Single app-wide host for the unified native player.
 * Series and Live TV will launch through the same controller in later stages.
 */
export function UnifiedPlayerHost() {
  const mounted = useUnifiedPlayerHostMounted();

  if (!mounted) {
    return null;
  }

  return (
    <View style={styles.host} pointerEvents="box-none" focusable={false}>
      <UnifiedPlayerController />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 400,
    elevation: Platform.OS === 'android' ? 100 : 40,
  },
});
