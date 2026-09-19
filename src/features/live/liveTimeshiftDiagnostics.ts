import type { VideoPlayer } from 'expo-video';

import { recordDiagnostic } from '../diagnostics/diagnosticsClient';

export const NOVASHIFT_PROBE_STAGES = [
  'source-ready', 'playing', '45s', 'near-window-end', 'paused-15s', 'resumed',
  'seek--10s', 'seek--20s', 'seek--30s', 'seek--45s', 'seek--55s',
  'player-error', 'cancelled-channel-change',
] as const;
export type NovaShiftProbeStage = (typeof NOVASHIFT_PROBE_STAGES)[number];

type ProbeInput = {
  player: VideoPlayer;
  channelKey: string;
  providerId?: string | null;
  productionPlayer?: VideoPlayer;
  sharedPlayerMode?: boolean;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
};

type ProbeObservation = {
  requestedDelta?: number;
  baselinePosition?: number | null;
  requestedTarget?: number | null;
  settledPosition?: number | null;
  settleTimeMs?: number | null;
  playbackRecovered?: boolean;
  settleTimedOut?: boolean;
  seekInvalid?: boolean;
};

function safeIdentity(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[:/?#&=\\]/.test(trimmed)) return null;
  return trimmed.slice(0, 120);
}

function safeErrorMessage(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').slice(0, 160);
}

function samplePlayer(player: VideoPlayer) {
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : null;
  const duration = Number.isFinite(player.duration) ? player.duration : null;
  return {
    currentTime,
    duration,
    bufferedPosition: null,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    isPlaying: Boolean(player.playing),
    status: player.status,
  };
}

export function createLiveTimeshiftProbe(input: ProbeInput) {
  const schedule = input.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = input.cancel ?? ((timer) => clearTimeout(timer));
  const now = input.now ?? (() => Date.now());
  const channelKey = safeIdentity(input.channelKey) ?? 'unknown';
  const providerId = safeIdentity(input.providerId);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const emitted = new Set<NovaShiftProbeStage>();
  const subscriptions: Array<{ remove: () => void }> = [];
  const waiters = new Set<() => void>();
  let disposed = false;
  let stopped = false;
  let started = false;

  const assertProbePlayer = () => {
    if (!input.sharedPlayerMode && input.productionPlayer && input.player === input.productionPlayer) {
      throw new Error('probe-player-identity-conflict');
    }
  };

  const emit = (stage: NovaShiftProbeStage, observation: ProbeObservation = {}, error?: { code?: unknown; message?: unknown }) => {
    if (disposed || (stopped && stage !== 'player-error') || emitted.has(stage)) return;
    emitted.add(stage);
    const payload = {
      stage,
      channelKey,
      streamType: 'live',
      isLive: true,
      providerId,
      sampledAt: now(),
      classification: 'capability-observation',
      ...samplePlayer(input.player),
      ...(input.sharedPlayerMode ? { playerMode: 'single-hls' } : {}),
      ...observation,
      ...(error ? {
        errorCode: typeof error.code === 'string' ? error.code.slice(0, 80) : null,
        errorMessage: safeErrorMessage(error.message),
      } : {}),
    };
    console.log('[NovaCast NovaShift Probe]', JSON.stringify(payload));
    recordDiagnostic({
      eventType: 'live_timeshift_capability',
      contentType: 'live',
      contentId: channelKey,
      managedProviderId: providerId ?? undefined,
      playbackState: stage,
      metadata: payload,
    });
  };

  const stopPendingWork = () => {
    stopped = true;
    for (const timer of timers) cancel(timer);
    timers.clear();
    for (const resolve of waiters) resolve();
    waiters.clear();
  };

  const waitForSettled = () => new Promise<{ ok: boolean; timedOut: boolean; status: string; currentTime: number | null; elapsedMs: number }>((resolve) => {
    const startedAt = now();
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean, timedOut = false) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      waiters.delete(cancelWait);
      resolve({
        ok,
        timedOut,
        status: String(input.player.status),
        currentTime: Number.isFinite(input.player.currentTime) ? input.player.currentTime : null,
        elapsedMs: now() - startedAt,
      });
    };
    const cancelWait = () => finish(false);
    waiters.add(cancelWait);
    const poll = () => {
      if (disposed || stopped) return finish(false);
      const status = String(input.player.status);
      const elapsedMs = now() - startedAt;
      if (status === 'error') return finish(false);
      if (elapsedMs >= 8_000) return finish(false, true);
      if (elapsedMs >= 100 && (status === 'readyToPlay' || status === 'playing')) return finish(true);
      pollTimer = setTimeout(poll, 100);
    };
    pollTimer = setTimeout(poll, 100);
  });

  const waitForWindowEnd = async () => {
    const duration = Number(input.player.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const target = Math.max(0, duration - 1);
    input.player.currentTime = target;
    const settled = await waitForSettled();
    return { target, settled };
  };

  const runSeek = async (stage: NovaShiftProbeStage, delta: number) => {
    const windowEnd = await waitForWindowEnd();
    if (!windowEnd || !windowEnd.settled.ok) {
      emit(stage, { settleTimedOut: windowEnd?.settled.timedOut ?? true, settleTimeMs: windowEnd?.settled.elapsedMs ?? null });
      return false;
    }
    const baselinePosition = Number(input.player.currentTime);
    const requestedTarget = baselinePosition + delta;
    input.player.currentTime = requestedTarget;
    const settled = await waitForSettled();
    const settledPosition = settled.currentTime;
    const validPosition = settledPosition !== null && settledPosition >= 0;
    emit(stage, {
      requestedDelta: delta,
      baselinePosition: Number.isFinite(baselinePosition) ? baselinePosition : null,
      requestedTarget,
      settledPosition,
      settleTimeMs: settled.elapsedMs,
      playbackRecovered: settled.ok && validPosition,
      settleTimedOut: settled.timedOut,
      seekInvalid: !validPosition,
    });
    if (!settled.ok || !validPosition) {
      const recovery = await waitForWindowEnd();
      return Boolean(recovery?.settled.ok && recovery.settled.currentTime !== null && recovery.settled.currentTime >= 0);
    }
    return true;
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    assertProbePlayer();
    emit('source-ready');
    subscriptions.push(
      input.player.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying) emit('playing');
      }),
    );
    subscriptions.push(
      input.player.addListener('statusChange', ({ status, error }) => {
        if (status !== 'error' || disposed) return;
        emit('player-error', {}, error as { code?: unknown; message?: unknown });
        stopPendingWork();
      }),
    );
    input.player.play();

    const sequence: Array<{ stage: NovaShiftProbeStage; delayMs: number; run: () => Promise<boolean> | boolean }> = [
      { stage: '45s', delayMs: 45_000, run: () => true },
      {
        stage: 'near-window-end',
        delayMs: 15_000,
        run: async () => {
          const result = await waitForWindowEnd();
          if (!result) {
            emit('near-window-end', { seekInvalid: true });
            return false;
          }
          emit('near-window-end', {
            requestedTarget: result.target,
            settledPosition: result.settled.currentTime,
            settleTimeMs: result.settled.elapsedMs,
            playbackRecovered: result.settled.ok && result.settled.currentTime !== null && result.settled.currentTime >= 0,
            settleTimedOut: result.settled.timedOut,
          });
          if (!result.settled.ok) return false;
          input.player.pause();
          return true;
        },
      },
      {
        stage: 'paused-15s',
        delayMs: 15_000,
        run: () => {
          emit('paused-15s');
          return true;
        },
      },
      {
        stage: 'resumed',
        delayMs: 0,
        run: async () => {
          input.player.play();
          return (await waitForSettled()).ok;
        },
      },
      { stage: 'seek--10s', delayMs: 0, run: () => runSeek('seek--10s', -10) },
      { stage: 'seek--20s', delayMs: 0, run: () => runSeek('seek--20s', -20) },
      { stage: 'seek--30s', delayMs: 0, run: () => runSeek('seek--30s', -30) },
      { stage: 'seek--45s', delayMs: 0, run: () => runSeek('seek--45s', -45) },
      { stage: 'seek--55s', delayMs: 0, run: () => runSeek('seek--55s', -55) },
    ];

    const runNext = (index: number) => {
      if (disposed || stopped || index >= sequence.length) return;
      const step = sequence[index];
      let timer: ReturnType<typeof setTimeout>;
      timer = schedule(() => {
        timers.delete(timer);
        if (disposed || stopped) return;
        void Promise.resolve(step.run()).then((ok) => {
          if (!ok) {
            stopPendingWork();
            return;
          }
          if (step.stage === 'resumed') emit('resumed');
          runNext(index + 1);
        }).catch(() => {
          stopPendingWork();
        });
      }, step.delayMs);
      timers.add(timer);
    };
    runNext(0);
  };

  return {
    start,
    markPlaying: () => emit('playing'),
    dispose: (reason: 'channel-change' | 'fullscreen-close' = 'channel-change') => {
      if (reason === 'channel-change' && !disposed) emit('cancelled-channel-change');
      disposed = true;
      stopPendingWork();
      subscriptions.splice(0).forEach((subscription) => subscription.remove());
      assertProbePlayer();
      input.player.pause();
      if (!input.sharedPlayerMode) {
        (input.player as VideoPlayer & { release?: () => void }).release?.();
      }
    },
    getEmittedStages: () => [...emitted],
  };
}

export type LiveTimeshiftProbe = ReturnType<typeof createLiveTimeshiftProbe>;
