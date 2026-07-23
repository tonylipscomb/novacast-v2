import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { LaunchPlaybackOptions, PlaybackItem } from './types.ts';
import { didUnifiedPlaybackJustClose, isUnifiedPlaybackActive } from './unifiedPlayerLogic.ts';
import {
  closeUnifiedPlayback,
  getUnifiedPlayerState,
  launchUnifiedPlayback,
  subscribeUnifiedPlayer,
} from './unifiedPlayerStore.ts';
import { prepareUnifiedPlaybackLaunch } from './UnifiedPlayerController.tsx';

function useUnifiedPlayerSnapshot() {
  return useSyncExternalStore(subscribeUnifiedPlayer, getUnifiedPlayerState, getUnifiedPlayerState);
}

export function useUnifiedPlayer() {
  const snapshot = useUnifiedPlayerSnapshot();
  const previousActiveRef = useRef(false);
  const isActive = isUnifiedPlaybackActive(snapshot.machineState, snapshot.item);
  // The external store can transition between renders; this ref is the
  // deliberately persistent edge detector for the close transition.
  // eslint-disable-next-line react-hooks/refs -- read the previous external-store snapshot during render.
  const previousActive = previousActiveRef.current;
  const didJustClose = didUnifiedPlaybackJustClose(previousActive, isActive);
  // eslint-disable-next-line react-hooks/refs -- persist the external-store transition for the next render.
  previousActiveRef.current = isActive;

  const launchPlayback = useCallback(async (item: PlaybackItem, options?: LaunchPlaybackOptions) => {
    const prepared = await prepareUnifiedPlaybackLaunch(item);
    launchUnifiedPlayback(prepared, options);
  }, []);

  const closePlayback = useCallback(() => {
    closeUnifiedPlayback();
  }, []);

  return {
    state: snapshot,
    isActive,
    isClosing: snapshot.machineState === 'closing',
    didJustClose,
    launchSource: snapshot.launchSource,
    launchPlayback,
    closePlayback,
  };
}
