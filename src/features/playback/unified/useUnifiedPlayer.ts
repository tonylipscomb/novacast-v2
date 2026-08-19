import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { LaunchPlaybackOptions, PlaybackItem, UnifiedPlayerState } from './types.ts';
import { didUnifiedPlaybackJustClose, isUnifiedPlaybackActive } from './unifiedPlayerLogic.ts';
import {
  closeUnifiedPlayback,
  getUnifiedPlayerState,
  launchUnifiedPlayback,
  subscribeUnifiedPlayer,
} from './unifiedPlayerStore.ts';
import { buildProgressKey, getSavedProgress, resetPlaybackProgress } from './playbackProgressStore.ts';
import { resolveLaunchResumePosition } from '../continuity/playbackResumeGate.ts';
import { getAppSettingsSync } from '@/features/settings/appSettingsStore.ts';

/**
 * Activity-only snapshot — excludes positionMs/durationMs so browse screens
 * do not re-render on playback progress ticks (~1 Hz).
 */
type UnifiedPlayerActivitySnapshot = {
  machineState: UnifiedPlayerState['machineState'];
  isActive: boolean;
  launchSource: UnifiedPlayerState['launchSource'];
};

let cachedActivity: UnifiedPlayerActivitySnapshot | null = null;

export function getUnifiedPlayerActivitySnapshot(): UnifiedPlayerActivitySnapshot {
  const state = getUnifiedPlayerState();
  const isActive = isUnifiedPlaybackActive(state.machineState, state.item);
  if (
    cachedActivity &&
    cachedActivity.machineState === state.machineState &&
    cachedActivity.isActive === isActive &&
    cachedActivity.launchSource === state.launchSource
  ) {
    return cachedActivity;
  }

  cachedActivity = {
    machineState: state.machineState,
    isActive,
    launchSource: state.launchSource,
  };
  return cachedActivity;
}

function useUnifiedPlayerActivitySnapshot() {
  return useSyncExternalStore(subscribeUnifiedPlayer, getUnifiedPlayerActivitySnapshot, getUnifiedPlayerActivitySnapshot);
}

/**
 * Browse/screen hook: activity flags + launch/close only.
 * Does not subscribe to progress ticks. Controllers that need the full
 * snapshot should use getUnifiedPlayerState / subscribeUnifiedPlayer directly.
 */
export function useUnifiedPlayer() {
  const snapshot = useUnifiedPlayerActivitySnapshot();
  const previousActiveRef = useRef(false);
  const isActive = snapshot.isActive;
  // The external store can transition between renders; this ref is the
  // deliberately persistent edge detector for the close transition.
  // eslint-disable-next-line react-hooks/refs -- read the previous external-store snapshot during render.
  const previousActive = previousActiveRef.current;
  const didJustClose = didUnifiedPlaybackJustClose(previousActive, isActive);
  // eslint-disable-next-line react-hooks/refs -- persist the external-store transition for the next render.
  previousActiveRef.current = isActive;

  const launchPlayback = useCallback(async (item: PlaybackItem, options?: LaunchPlaybackOptions) => {
    if (item.mediaType === 'live' || !item.providerId) {
      launchUnifiedPlayback(item, options);
      return;
    }

    if (!getAppSettingsSync().resumePlayback) {
      launchUnifiedPlayback({ ...item, resumePositionMs: 0 }, options);
      return;
    }

    const policy = options?.resumePolicy ?? (item.resumePositionMs != null && item.resumePositionMs > 0 ? 'silent' : 'prompt');
    const saved = await getSavedProgress(buildProgressKey(item.providerId, item.mediaType, item.id));
    if (policy === 'silent') {
      launchUnifiedPlayback(
        {
          ...item,
          resumePositionMs: item.resumePositionMs ?? saved?.positionMs ?? 0,
        },
        options,
      );
      return;
    }
    const decision = await resolveLaunchResumePosition({
      policy,
      contentId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      positionMs: item.resumePositionMs ?? saved?.positionMs ?? 0,
      durationMs: saved?.durationMs ?? 0,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
    });

    if (decision.action === 'cancel') {
      return;
    }

    if (decision.resetProgress) {
      await resetPlaybackProgress(buildProgressKey(item.providerId, item.mediaType, item.id));
    }

    launchUnifiedPlayback(
      {
        ...item,
        resumePositionMs: decision.resumePositionMs,
      },
      options,
    );
  }, []);

  const closePlayback = useCallback(() => {
    closeUnifiedPlayback();
  }, []);

  return {
    isActive,
    isClosing: snapshot.machineState === 'closing',
    didJustClose,
    launchSource: snapshot.launchSource,
    launchPlayback,
    closePlayback,
  };
}
