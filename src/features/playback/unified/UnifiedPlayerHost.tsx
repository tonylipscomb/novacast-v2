import { useEffect, useSyncExternalStore } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';

import { noteMoviePlaybackPlayerMounted } from '@/features/movies/moviesPlaybackAudit';

import { PlaybackKeepAwake } from '../PlaybackKeepAwake.tsx';
import { isUnifiedPlaybackActive } from './unifiedPlayerLogic.ts';
import {
  closeUnifiedPlayback,
  getUnifiedPlayerState,
  subscribeUnifiedPlayer,
} from './unifiedPlayerStore.ts';
import { PlaybackResumeDialog } from '../continuity/PlaybackResumeDialog.tsx';
import { UnifiedPlayerController } from './UnifiedPlayerController.tsx';

function useUnifiedPlayerHostMounted() {
  return useSyncExternalStore(
    subscribeUnifiedPlayer,
    () => {
      const snapshot = getUnifiedPlayerState();
      return (
        isUnifiedPlaybackActive(snapshot.machineState, snapshot.item) ||
        snapshot.machineState === 'closing'
      );
    },
    () => false,
  );
}

/**
 * App-wide native playback host.
 *
 * This must render in a native Modal rather than as a sibling above Expo Router.
 * Android react-native-screens can keep the active route's native screen above
 * a normal React sibling even when zIndex/elevation are higher. In that state,
 * playback audio starts but VideoView and React controls remain hidden behind
 * the dashboard or catalog screen.
 */
export function UnifiedPlayerHost() {
  const mounted = useUnifiedPlayerHostMounted();
  const item = useSyncExternalStore(
    subscribeUnifiedPlayer,
    () => getUnifiedPlayerState().item,
    () => null,
  );

  // Diagnostics-only: observe when the movie player host mounts.
  useEffect(() => {
    if (!mounted || !item || item.mediaType !== 'movie') {
      return;
    }
    noteMoviePlaybackPlayerMounted(item.id);
  }, [item, mounted]);

  if (!mounted) {
    return (
      <>
        <PlaybackKeepAwake />
        <PlaybackResumeDialog />
      </>
    );
  }

  return (
    <>
    <PlaybackKeepAwake />
    <PlaybackResumeDialog />
    <Modal
      visible
      transparent
      animationType="none"
      hardwareAccelerated
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={closeUnifiedPlayback}>
      <View style={styles.modalRoot}>
        <View style={styles.host} pointerEvents="box-none" focusable={false}>
          <UnifiedPlayerController />
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 400,
    elevation: Platform.OS === 'android' ? 100 : 40,
    backgroundColor: '#000000',
  },
});