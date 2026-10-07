/**
 * Event-driven Live playback stall recovery.
 *
 * The watchdog observes player progress and schedules a bounded observation
 * deadline. It is deliberately not a repeating timer: progress, playback,
 * and lifecycle events re-arm or cancel the next deadline.
 */

export const LIVE_PLAYBACK_WATCHDOG_STALL_MS = 10_000;
export const LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS = 25_000;
export const LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS = 2;
export const LIVE_PLAYBACK_WATCHDOG_LOG_INTERVAL_MS = 2_000;
const WATCHDOG_LOG_TAG = '[NOVACAST_WATCHDOG]';

export type LivePlaybackWatchdogEvent =
  | 'live_watchdog_stall_detected'
  | 'live_watchdog_recovery_attempt'
  | 'live_watchdog_recovered'
  | 'live_watchdog_exhausted';

export type LivePlaybackWatchdogContext = {
  channelId: string | null;
  playerGeneration: number;
  streamKey: string | null;
  streamPresent: boolean;
  expectedActive: boolean;
  channelChanging: boolean;
  userPaused: boolean;
  playbackState?: string;
  isPlaying?: boolean;
  isBuffering?: boolean;
  firstFrameSeen?: boolean;
};

export type LivePlaybackProgress = {
  currentLiveTimestamp?: number | null;
  bufferedPosition?: number | null;
};

export type LivePlaybackWatchdog = {
  setContext: (context: LivePlaybackWatchdogContext) => void;
  markPlayable: () => void;
  onStatus: (status: string) => void;
  onPlaying: (isPlaying: boolean) => void;
  onTimeUpdate: (currentTime: number, progress?: LivePlaybackProgress) => void;
  setUserPaused: (paused: boolean) => void;
  reset: (reason: string) => void;
  dispose: () => void;
};

type Timer = ReturnType<typeof setTimeout>;

type WatchdogInput = {
  recover: (attempt: 1 | 2) => void | Promise<void>;
  emit?: (event: LivePlaybackWatchdogEvent, fields: Record<string, unknown>) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  cancel?: (timer: Timer) => void;
};

const EMPTY_CONTEXT: LivePlaybackWatchdogContext = {
  channelId: null,
  playerGeneration: 0,
  streamKey: null,
  streamPresent: false,
  expectedActive: false,
  channelChanging: false,
  userPaused: false,
};

function sameContext(a: LivePlaybackWatchdogContext, b: LivePlaybackWatchdogContext) {
  return a.channelId === b.channelId &&
    a.playerGeneration === b.playerGeneration &&
    a.streamKey === b.streamKey &&
    a.streamPresent === b.streamPresent;
}

export function createLivePlaybackWatchdog(input: WatchdogInput): LivePlaybackWatchdog {
  const now = input.now ?? (() => Date.now());
  const schedule = input.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = input.cancel ?? ((timer) => clearTimeout(timer));
  const emit = input.emit ?? (() => {});

  let context = EMPTY_CONTEXT;
  let timer: Timer | null = null;
  let disposed = false;
  let playable = false;
  let playbackStarted = false;
  let lastPosition: number | null = null;
  let lastLiveTimestamp: number | null = null;
  let lastBufferedPosition: number | null = null;
  let lastRealProgressAt: number | null = null;
  let lastProgressSignalType: 'frame-render' | 'position' | 'live-timestamp' | 'buffered-position' | null = null;
  let firstFrameAt: number | null = null;
  let consecutiveFailedSamples = 0;
  let attempts = 0;
  let recoveryInFlight = false;
  let exhausted = false;
  let cooldownUntil = 0;
  let lastHealthLogAt = -Infinity;

  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  const diagnostic = (event: string, fields: Record<string, unknown> = {}) => {
    const isHighFrequency = event === 'health-sample' || event === 'watchdog-armed';
    const currentTime = now();
    if (isHighFrequency && currentTime - lastHealthLogAt < LIVE_PLAYBACK_WATCHDOG_LOG_INTERVAL_MS) return;
    if (isHighFrequency) lastHealthLogAt = currentTime;
    const payload = {
      channelId: context.channelId,
      playerGenerationId: context.playerGeneration,
      playbackState: context.playbackState ?? null,
      isPlaying: context.isPlaying ?? null,
      isBuffering: context.isBuffering ?? null,
      firstFrameSeen: context.firstFrameSeen ?? playable,
      elapsedSinceHealthyMs: lastRealProgressAt == null ? null : Math.max(0, Math.round(now() - lastRealProgressAt)),
      lastRealProgressAt,
      elapsedSinceRealProgressMs: lastRealProgressAt == null ? null : Math.max(0, Math.round(now() - lastRealProgressAt)),
      progressSignalType: lastProgressSignalType,
      progressObserved: lastRealProgressAt !== null,
      playerStateHealthy: context.playbackState === 'readyToPlay' && context.isPlaying === true && context.isBuffering !== true,
      renderProgressHealthy: lastRealProgressAt !== null && now() - lastRealProgressAt < LIVE_PLAYBACK_WATCHDOG_STALL_MS,
      elapsedSinceFirstFrameMs: firstFrameAt == null ? null : Math.max(0, Math.round(now() - firstFrameAt)),
      consecutiveFailedSamples,
      ...fields,
    };
    // console.warn is intentionally used for this release-safe operational tag:
    // React Native release builds may suppress console.info, while warn remains
    // visible in Android logcat. Payload is bounded and contains no credentials.
    console.warn(WATCHDOG_LOG_TAG, event, JSON.stringify(payload));
  };

  const eligible = () => Boolean(
    !disposed &&
      context.channelId &&
      context.playerGeneration > 0 &&
      context.streamPresent &&
      context.expectedActive &&
      !context.channelChanging &&
      !context.userPaused &&
      playable &&
      playbackStarted &&
      lastRealProgressAt !== null,
  );

  const arm = () => {
    clearTimer();
    if (!eligible() || recoveryInFlight || exhausted) return;
    const remaining = Math.max(0, LIVE_PLAYBACK_WATCHDOG_STALL_MS - (now() - (lastRealProgressAt ?? now())));
    diagnostic('watchdog-armed', { triggerReason: 'eligible-health-observation' });
    timer = schedule(() => {
      timer = null;
      if (!eligible() || recoveryInFlight || exhausted) return;
      const stalledForMs = now() - (lastRealProgressAt ?? now());
      if (stalledForMs < LIVE_PLAYBACK_WATCHDOG_STALL_MS) {
        arm();
        return;
      }
      diagnostic('stall-suspected', {
        elapsedSinceHealthyMs: Math.max(0, Math.round(stalledForMs)),
        stalledSignal: lastProgressSignalType,
        triggerReason: 'health-deadline-reached',
      });
      if (now() < cooldownUntil) {
        diagnostic('cooldown-start', { triggerReason: 'recovery-cooldown-active' });
        timer = schedule(() => {
          timer = null;
          diagnostic('cooldown-complete', { triggerReason: 'recovery-cooldown-expired' });
          arm();
        }, cooldownUntil - now());
        return;
      }
      if (attempts >= LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS) {
        exhausted = true;
        const elapsedSinceProgressMs = Math.max(0, Math.round(stalledForMs));
        diagnostic('recovery-failed', {
          recoveryAttempt: attempts,
          elapsedSinceProgressMs,
          triggerReason: 'recovery-attempts-exhausted',
        });
        emit('live_watchdog_exhausted', {
          attempts,
          elapsedSinceProgressMs,
          stallDurationMs: elapsedSinceProgressMs,
          playerGenerationId: context.playerGeneration,
          channelId: context.channelId,
          sourceIdentitySame: true,
          reason: 'recovery-attempts-exhausted',
        });
        return;
      }
      const attempt = (attempts + 1) as 1 | 2;
      attempts = attempt;
      recoveryInFlight = true;
      const recoveryGeneration = context.playerGeneration;
      const recoveryFields = {
        attempt,
        elapsedSinceProgressMs: Math.max(0, Math.round(stalledForMs)),
        stallDurationMs: Math.max(0, Math.round(stalledForMs)),
        playerGenerationId: context.playerGeneration,
        channelId: context.channelId,
        sourceIdentitySame: true,
      };
      diagnostic('stall-confirmed', {
        ...recoveryFields,
        stalledSignal: lastProgressSignalType,
        triggerReason: 'no-real-progress',
      });
      diagnostic('recovery-start', { ...recoveryFields, triggerReason: 'sustained-stall' });
      diagnostic('recovery-player-reload', { ...recoveryFields, triggerReason: 'same-player-recovery' });
      emit('live_watchdog_stall_detected', {
        ...recoveryFields,
        reason: 'no-playback-progress',
      });
      emit('live_watchdog_recovery_attempt', {
        ...recoveryFields,
        recoveryMethod: attempt === 1 ? 'same-channel-retry' : 'same-channel-rebind',
      });
      Promise.resolve(input.recover(attempt)).catch(() => {
        diagnostic('recovery-failed', { recoveryAttempt: attempt, triggerReason: 'recovery-rejected' });
      }).finally(() => {
        if (disposed || !recoveryInFlight) return;
        recoveryInFlight = false;
        if (context.playerGeneration !== recoveryGeneration) {
          diagnostic('generation-invalidated', {
            triggerReason: 'recovery-completed-on-stale-generation',
            recoveryAttempt: attempt,
          });
          return;
        }
        if (attempt >= LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS) {
          exhausted = true;
          const elapsedSinceProgressMs = Math.max(0, Math.round(now() - (lastRealProgressAt ?? now())));
          diagnostic('recovery-failed', {
            recoveryAttempt: attempt,
            elapsedSinceProgressMs,
            triggerReason: 'recovery-attempts-exhausted',
          });
          emit('live_watchdog_exhausted', {
            attempts: attempt,
            elapsedSinceProgressMs,
            stallDurationMs: elapsedSinceProgressMs,
            playerGenerationId: context.playerGeneration,
            channelId: context.channelId,
            sourceIdentitySame: true,
            reason: 'recovery-attempts-exhausted',
          });
          return;
        }
        arm();
      });
    }, remaining);
  };

  const reset = (reason: string) => {
    clearTimer();
    playable = false;
    playbackStarted = false;
    lastPosition = null;
    lastRealProgressAt = null;
    lastLiveTimestamp = null;
    lastBufferedPosition = null;
    lastProgressSignalType = null;
    firstFrameAt = null;
    consecutiveFailedSamples = 0;
    lastHealthLogAt = -Infinity;
    attempts = 0;
    recoveryInFlight = false;
    exhausted = false;
    cooldownUntil = 0;
    diagnostic('watchdog-disarmed', { triggerReason: reason });
    if (reason === 'channel-change' || reason === 'source-change' || reason === 'player-teardown') return;
    if (context.expectedActive) arm();
  };

  const markRecovered = () => {
    const recoveredAttempt = attempts;
    if (recoveredAttempt > 0) {
      diagnostic('recovery-success', {
        attempt: recoveredAttempt,
        recoveryAttempt: recoveredAttempt,
        triggerReason: 'playback-progress-resumed',
      });
      emit('live_watchdog_recovered', {
        attempt: recoveredAttempt,
        elapsedSinceProgressMs: Math.max(0, Math.round(now() - (lastRealProgressAt ?? now()))),
        playerGenerationId: context.playerGeneration,
        channelId: context.channelId,
        sourceIdentitySame: true,
        reason: 'playback-progress-resumed',
        recoveryMethod: recoveredAttempt === 1 ? 'same-channel-retry' : 'same-channel-rebind',
        success: true,
      });
      cooldownUntil = now() + LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS;
      diagnostic('cooldown-start', { recoveryAttempt: recoveredAttempt, triggerReason: 'recovery-success' });
    }
    attempts = 0;
    recoveryInFlight = false;
    exhausted = false;
  };

  return {
    setContext(nextContext) {
      if (disposed) return;
      const identityChanged = !sameContext(context, nextContext);
      context = { ...nextContext };
      if (identityChanged) {
        diagnostic('generation-invalidated', { triggerReason: 'context-identity-changed' });
        reset('source-change');
      } else if (!context.expectedActive || context.channelChanging || context.userPaused) {
        clearTimer();
      } else {
        arm();
      }
    },
    markPlayable() {
      if (disposed || !context.expectedActive) return;
      playable = true;
      firstFrameAt ??= now();
      lastRealProgressAt = now();
      lastProgressSignalType = 'frame-render';
      consecutiveFailedSamples = 0;
      diagnostic('health-sample', { triggerReason: 'first-frame-rendered' });
      arm();
    },
    onStatus(status) {
      if (status === 'error') {
        reset('player-error');
        return;
      }
      if (status === 'readyToPlay') {
        playable = true;
        diagnostic('health-sample', { triggerReason: 'player-ready' });
        arm();
      }
    },
    onPlaying(isPlaying) {
      if (isPlaying) {
        playbackStarted = true;
        playable = true;
        diagnostic('health-sample', { triggerReason: 'playing-state' });
        arm();
      } else if (!context.userPaused) {
        arm();
      }
    },
    onTimeUpdate(currentTime, progress = {}) {
      if (disposed || !Number.isFinite(currentTime)) return;
      const positionAvailable = currentTime >= 0;
      const positionProgressed = positionAvailable && (lastPosition === null || currentTime > lastPosition + 0.01);
      const liveTimestamp = progress.currentLiveTimestamp;
      const liveTimestampProgressed = Number.isFinite(liveTimestamp) &&
        (lastLiveTimestamp === null || liveTimestamp! > lastLiveTimestamp);
      const bufferedPosition = progress.bufferedPosition;
      const bufferedPositionProgressed = !positionAvailable && !liveTimestampProgressed &&
        Number.isFinite(bufferedPosition) && bufferedPosition! >= 0 &&
        (lastBufferedPosition === null || bufferedPosition! > lastBufferedPosition + 0.01);

      if (positionAvailable) lastPosition = currentTime;
      if (Number.isFinite(liveTimestamp)) lastLiveTimestamp = liveTimestamp!;
      if (Number.isFinite(bufferedPosition)) lastBufferedPosition = bufferedPosition!;

      if (!positionProgressed && !liveTimestampProgressed && !bufferedPositionProgressed) {
        consecutiveFailedSamples += 1;
        diagnostic('health-sample', {
          triggerReason: positionAvailable ? 'position-not-advanced' : 'progress-not-observed',
        });
        return;
      }

      playable = true;
      playbackStarted = true;
      lastRealProgressAt = now();
      lastProgressSignalType = positionProgressed ? 'position' : liveTimestampProgressed ? 'live-timestamp' : 'buffered-position';
      consecutiveFailedSamples = 0;
      diagnostic('health-sample', { triggerReason: `${lastProgressSignalType}-advanced` });
      if (attempts > 0) markRecovered();
      arm();
    },
    setUserPaused(paused) {
      context = { ...context, userPaused: paused };
      if (paused) clearTimer();
      else arm();
    },
    reset,
    dispose() {
      disposed = true;
      reset('player-teardown');
    },
  };
}
