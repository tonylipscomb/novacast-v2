export type PlaybackActivityType = 'live-preview' | 'live-fullscreen' | 'movie' | 'episode';

export type PlaybackActivityState = {
  isPlaybackActive: boolean;
  /** @deprecated Use playbackType */
  activePlaybackType: PlaybackActivityType | null;
  playbackType: PlaybackActivityType | null;
  playbackStartedAt: number | null;
  activeSessionCount: number;
};

let activeSessionCount = 0;
let activePlaybackType: PlaybackActivityType | null = null;
let playbackStartedAt: number | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getPlaybackActivityState(): PlaybackActivityState {
  return {
    isPlaybackActive: activeSessionCount > 0,
    activePlaybackType,
    playbackType: activePlaybackType,
    playbackStartedAt,
    activeSessionCount,
  };
}

export function isPlaybackActivityActive() {
  return activeSessionCount > 0;
}

export function registerPlaybackActivity(type: PlaybackActivityType) {
  activeSessionCount += 1;
  if (activeSessionCount === 1) {
    activePlaybackType = type;
    playbackStartedAt = Date.now();
  }
  notify();
}

export function unregisterPlaybackActivity() {
  activeSessionCount = Math.max(0, activeSessionCount - 1);
  if (activeSessionCount === 0) {
    activePlaybackType = null;
    playbackStartedAt = null;
  }
  notify();
}

export function subscribePlaybackActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPlaybackActivityForTests() {
  activeSessionCount = 0;
  activePlaybackType = null;
  playbackStartedAt = null;
  listeners.clear();
}
