import { useEffect } from 'react';

import {
  registerPlaybackActivity,
  unregisterPlaybackActivity,
  type PlaybackActivityType,
} from './playbackActivityStore.ts';

export function usePlaybackActivity(type: PlaybackActivityType, active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    registerPlaybackActivity(type);
    return () => {
      unregisterPlaybackActivity();
    };
  }, [active, type]);
}
