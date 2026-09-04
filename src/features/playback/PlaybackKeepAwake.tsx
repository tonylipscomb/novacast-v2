import { useKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import {
  isPlaybackActivityActive,
  subscribePlaybackActivity,
} from './playbackActivityStore.ts';

const NOVACAST_PLAYBACK_KEEP_AWAKE_TAG = 'novacast-playback';

/**
 * Leaf lease: holds the screen awake for exactly as long as it stays mounted.
 * Mounted only while a real playback session is active, so normal Android /
 * Fire TV screensaver behavior returns the moment the lease unmounts.
 */
function PlaybackKeepAwakeLease() {
  useKeepAwake(NOVACAST_PLAYBACK_KEEP_AWAKE_TAG, {
    suppressDeactivateWarnings: true,
  });
  return null;
}

function usePlaybackSessionActive() {
  return useSyncExternalStore(
    subscribePlaybackActivity,
    isPlaybackActivityActive,
    () => false,
  );
}

/**
 * Single shared keep-awake owner for every NovaCast playback surface
 * (Live preview, Live fullscreen, movie, series). Driven purely by the shared
 * playbackActivityStore session count, so a preview -> fullscreen handoff keeps
 * one continuous lease instead of leaking duplicate owners.
 */
export function PlaybackKeepAwake() {
  const playbackSessionActive = usePlaybackSessionActive();
  return playbackSessionActive ? <PlaybackKeepAwakeLease /> : null;
}
