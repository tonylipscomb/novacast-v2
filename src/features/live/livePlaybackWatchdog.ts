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
};

export type LivePlaybackWatchdog = {
  setContext: (context: LivePlaybackWatchdogContext) => void;
  markPlayable: () => void;
  onStatus: (status: string) => void;
  onPlaying: (isPlaying: boolean) => void;
  onTimeUpdate: (currentTime: number) => void;
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
  let lastProgressAt: number | null = null;
  let attempts = 0;
  let recoveryInFlight = false;
  let exhausted = false;
  let cooldownUntil = 0;

  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
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
      lastProgressAt !== null,
  );

  const arm = () => {
    clearTimer();
    if (!eligible() || recoveryInFlight || exhausted) return;
    const remaining = Math.max(0, LIVE_PLAYBACK_WATCHDOG_STALL_MS - (now() - (lastProgressAt ?? now())));
    timer = schedule(() => {
      timer = null;
      if (!eligible() || recoveryInFlight || exhausted) return;
      const stalledForMs = now() - (lastProgressAt ?? now());
      if (stalledForMs < LIVE_PLAYBACK_WATCHDOG_STALL_MS) {
        arm();
        return;
      }
      if (now() < cooldownUntil) {
        timer = schedule(() => {
          timer = null;
          arm();
        }, cooldownUntil - now());
        return;
      }
      if (attempts >= LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS) {
        exhausted = true;
        const elapsedSinceProgressMs = Math.max(0, Math.round(stalledForMs));
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
      const recoveryFields = {
        attempt,
        elapsedSinceProgressMs: Math.max(0, Math.round(stalledForMs)),
        stallDurationMs: Math.max(0, Math.round(stalledForMs)),
        playerGenerationId: context.playerGeneration,
        channelId: context.channelId,
        sourceIdentitySame: true,
      };
      emit('live_watchdog_stall_detected', {
        ...recoveryFields,
        reason: 'no-playback-progress',
      });
      emit('live_watchdog_recovery_attempt', {
        ...recoveryFields,
        recoveryMethod: attempt === 1 ? 'same-channel-retry' : 'same-channel-rebind',
      });
      Promise.resolve(input.recover(attempt)).catch(() => {}).finally(() => {
        if (disposed || !recoveryInFlight) return;
        recoveryInFlight = false;
        if (attempt >= LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS) {
          exhausted = true;
          const elapsedSinceProgressMs = Math.max(0, Math.round(now() - (lastProgressAt ?? now())));
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
    lastProgressAt = null;
    attempts = 0;
    recoveryInFlight = false;
    exhausted = false;
    cooldownUntil = 0;
    if (reason === 'channel-change' || reason === 'source-change' || reason === 'player-teardown') return;
    if (context.expectedActive) arm();
  };

  const markRecovered = () => {
    const recoveredAttempt = attempts;
    if (recoveredAttempt > 0) {
      emit('live_watchdog_recovered', {
        attempt: recoveredAttempt,
        elapsedSinceProgressMs: Math.max(0, Math.round(now() - (lastProgressAt ?? now()))),
        playerGenerationId: context.playerGeneration,
        channelId: context.channelId,
        sourceIdentitySame: true,
        reason: 'playback-progress-resumed',
        recoveryMethod: recoveredAttempt === 1 ? 'same-channel-retry' : 'same-channel-rebind',
        success: true,
      });
      cooldownUntil = now() + LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS;
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
      lastProgressAt ??= now();
      arm();
    },
    onStatus(status) {
      if (status === 'error') {
        reset('player-error');
        return;
      }
      if (status === 'readyToPlay') {
        playable = true;
        lastProgressAt ??= now();
        arm();
      }
    },
    onPlaying(isPlaying) {
      if (isPlaying) {
        playbackStarted = true;
        playable = true;
        lastProgressAt ??= now();
        arm();
      } else if (!context.userPaused) {
        arm();
      }
    },
    onTimeUpdate(currentTime) {
      if (disposed || !Number.isFinite(currentTime)) return;
      const progressed = lastPosition === null || currentTime > lastPosition + 0.01;
      lastPosition = currentTime;
      if (!progressed) return;
      playable = true;
      playbackStarted = true;
      lastProgressAt = now();
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
