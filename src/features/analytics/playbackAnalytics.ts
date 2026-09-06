import type { PlaybackItem, PlaybackLaunchSource, UnifiedPlayerMachineState } from '@/features/playback/unified/types';

import { enqueueAnalyticsEvent } from './novaAnalytics';
import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';

export type AnalyticsPlaybackType = 'live' | 'movie' | 'series';
export type PlaybackFailureCategory = 'network' | 'provider' | 'timeout' | 'decoder' | 'unsupported' | 'user_cancelled' | 'unknown';
export type PlaybackStopReason = 'user_back' | 'playback_error' | 'route_change' | 'channel_change' | 'unknown';

type PlaybackEventInput = {
  providerId?: string;
  contentId?: string;
  contentTitle?: string;
  contentType: AnalyticsPlaybackType;
  outcome?: string;
  durationMs?: number;
  countValue?: number;
  metadata?: Record<string, string | number | boolean | null>;
  sessionId?: string;
};

type PlaybackAttempt = {
  attemptId: number;
  item: PlaybackItem;
  contentType: AnalyticsPlaybackType;
  requestedAt: number;
  startedAt: number | null;
  bufferingStartedAt: number | null;
  bufferingCount: number;
  bufferingDurationMs: number;
  failed: boolean;
  recoveryPending: boolean;
  stopped: boolean;
  retryCount: number;
  sessionId: string;
  lastState: UnifiedPlayerMachineState;
};

export type PlaybackStartedSource = 'native_first_frame' | 'playing_transition' | 'current_time_progress';

export function logPlaybackAnalytics(event: string, fields: Record<string, unknown> = {}) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[NovaCast Playback Analytics]', event, fields);
  }
}

function playbackType(item: PlaybackItem): AnalyticsPlaybackType {
  if (item.mediaType === 'movie') return 'movie';
  if (item.mediaType === 'episode') return 'series';
  return 'live';
}

function eventInput(attempt: PlaybackAttempt): PlaybackEventInput {
  return {
    providerId: attempt.item.providerId,
    contentId: attempt.item.id,
    contentType: attempt.contentType,
    contentTitle: attempt.item.title,
    sessionId: attempt.sessionId,
  };
}

function createPlaybackSessionId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === 'function'
    ? randomUUID()
    : `playback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emit(eventName: 'playback_requested' | 'playback_started' | 'playback_failed' | 'playback_recovered' | 'playback_stopped', input: PlaybackEventInput) {
  void enqueueAnalyticsEvent(eventName, input).catch(() => undefined);
  const eventType = eventName === 'playback_requested'
    ? 'play_attempt'
    : eventName === 'playback_started'
      ? 'playback_started'
      : eventName === 'playback_failed'
        ? 'playback_error'
        : eventName === 'playback_stopped'
          ? 'playback_stopped'
          : 'playback_started';
  recordDiagnostic({
    eventType,
    sessionId: input.sessionId,
    contentType: input.contentType,
    contentId: input.contentId,
    contentTitle: input.contentTitle,
    managedProviderId: input.providerId,
    durationMs: input.durationMs,
    metadata: input.metadata,
    errorCode: input.outcome,
  });
}

export function extractPlaybackHttpStatus(error: unknown): number | null {
  const value =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.name} ${error.message}`
        : String(error ?? '');
  const match = value.match(
    /InvalidResponseCodeException[:\s]+(\d{3})|Response code[:\s]+(\d{3})|HTTP\s+(\d{3})|\b(401|403|404|429|458|5\d{2})\b/i,
  );
  if (!match) {
    return null;
  }
  const raw = match[1] || match[2] || match[3] || match[4];
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

export function normalizePlaybackFailure(error: unknown): PlaybackFailureCategory {
  const value =
    typeof error === 'string'
      ? error.toLowerCase()
      : error instanceof Error
        ? `${error.name} ${error.message}`.toLowerCase()
        : String(error ?? '').toLowerCase();

  // Stage 4.2L.1: classify HTTP response codes before broad keyword matching.
  // Never treat bare "playback" as user_cancelled (legacy /back/ matched it).
  const httpStatus = extractPlaybackHttpStatus(error);
  if (httpStatus === 401 || httpStatus === 403) return 'provider';
  if (httpStatus === 404) return 'provider';
  if (httpStatus === 429) return 'provider';
  if (httpStatus === 458) return 'provider';
  if (httpStatus != null && httpStatus >= 500 && httpStatus <= 599) return 'provider';
  if (httpStatus != null) return 'provider';

  if (/\b(cancel(?:led)?|abort(?:ed)?|user[_ -]?cancel(?:led)?)\b/.test(value)) {
    return 'user_cancelled';
  }
  if (/\b(user[_ -]?back|navigat(?:e|ed|ion)?[_ -]?back)\b/.test(value)) {
    return 'user_cancelled';
  }
  if (/timeout|timed out|stall/.test(value)) return 'timeout';
  if (/network|connection|offline|unreachable|dns/.test(value)) return 'network';
  if (/provider|authorization|forbidden|unauthorized|not found|458|rate.?limit/.test(value)) {
    return 'provider';
  }
  if (/decoder|decode|codec|format/.test(value)) return 'decoder';
  if (/unsupported|not supported/.test(value)) return 'unsupported';
  return 'unknown';
}

export function createPlaybackAnalyticsTracker(
  send: (eventName: Parameters<typeof emit>[0], input: PlaybackEventInput) => void = emit,
  now: () => number = Date.now,
) {
  let attempt: PlaybackAttempt | null = null;
  let nextAttemptId = 1;

  function request(item: PlaybackItem, launchSource: PlaybackLaunchSource = null, force = false) {
    if (!force && attempt && !attempt.stopped && attempt.item.id === item.id && attempt.item.providerId === item.providerId) return false;
    const priorAttempt = attempt;
    const next: PlaybackAttempt = {
      attemptId: nextAttemptId++,
      item,
      contentType: playbackType(item),
      requestedAt: now(),
      startedAt: null,
      bufferingStartedAt: null,
      bufferingCount: 0,
      bufferingDurationMs: 0,
      failed: false,
      recoveryPending: Boolean(priorAttempt?.failed || priorAttempt?.recoveryPending),
      stopped: false,
      retryCount: force ? (priorAttempt?.retryCount ?? 0) + 1 : 0,
      sessionId: createPlaybackSessionId(),
      lastState: 'loading',
    };
    attempt = next;
    send('playback_requested', {
      ...eventInput(next),
      metadata: {
        launch_source: launchSource,
        retry_count: next.retryCount,
      },
    });
    logPlaybackAnalytics('playback request', { attemptId: next.attemptId, retryCount: next.retryCount });
    for (const eventType of ['provider_request_started', 'stream_resolution_started'] as const) {
      recordDiagnostic({
        eventType,
        sessionId: next.sessionId,
        contentType: next.contentType,
        contentId: next.item.id,
        contentTitle: next.item.title,
        managedProviderId: next.item.providerId,
        metadata: { launch_source: launchSource, retry_count: next.retryCount },
      });
    }
    recordDiagnostic({
      eventType: 'player_preparing',
      sessionId: next.sessionId,
      contentType: next.contentType,
      contentId: next.item.id,
      contentTitle: next.item.title,
      managedProviderId: next.item.providerId,
      metadata: { launch_source: launchSource, retry_count: next.retryCount },
    });
    return true;
  }

  function firstFrame(source: PlaybackStartedSource = 'native_first_frame') {
    if (!attempt || attempt.stopped || attempt.startedAt !== null) return false;
    const timestamp = now();
    attempt.startedAt = timestamp;
    const startupDurationMs = Math.max(0, timestamp - attempt.requestedAt);
    send('playback_started', {
      ...eventInput(attempt),
      durationMs: startupDurationMs,
      metadata: {},
    });
    for (const eventType of ['provider_request_succeeded', 'stream_resolution_succeeded', 'player_ready'] as const) {
      recordDiagnostic({
        eventType,
        sessionId: attempt.sessionId,
        contentType: attempt.contentType,
        contentId: attempt.item.id,
        contentTitle: attempt.item.title,
        managedProviderId: attempt.item.providerId,
        durationMs: startupDurationMs,
      });
    }
    recordDiagnostic({
      eventType: 'first_frame',
      contentType: attempt.contentType,
      contentId: attempt.item.id,
      contentTitle: attempt.item.title,
      managedProviderId: attempt.item.providerId,
      durationMs: startupDurationMs,
      sessionId: attempt.sessionId,
      metadata: { source, buffer_count: attempt.bufferingCount, total_buffer_duration_ms: attempt.bufferingDurationMs },
    });
    logPlaybackAnalytics('playback started', {
      attemptId: attempt.attemptId,
      source,
      durationMs: startupDurationMs,
    });
    if (attempt.recoveryPending) {
      attempt.recoveryPending = false;
      attempt.failed = false;
      send('playback_recovered', {
        ...eventInput(attempt),
        outcome: 'success',
        durationMs: attempt.bufferingDurationMs,
        countValue: attempt.bufferingCount,
        metadata: {},
      });
      logPlaybackAnalytics('playback recovered', { attemptId: attempt.attemptId });
    }
    return true;
  }

  function failure(error: unknown) {
    if (!attempt || attempt.stopped || attempt.failed) return false;
    attempt.failed = true;
    attempt.recoveryPending = true;
    const category = normalizePlaybackFailure(error);
    send('playback_failed', {
      ...eventInput(attempt),
      outcome: category,
      metadata: { error_classification: category, retry_count: attempt.retryCount },
    });
    const failedStage = category === 'provider' ? 'provider_request_failed'
      : category === 'timeout' ? 'stream_resolution_failed'
        : category === 'network' ? 'network_request_failure'
          : null;
    if (failedStage) {
      recordDiagnostic({
        eventType: failedStage,
        sessionId: attempt.sessionId,
        contentType: attempt.contentType,
        contentId: attempt.item.id,
        contentTitle: attempt.item.title,
        managedProviderId: attempt.item.providerId,
        errorCode: category,
        metadata: { failure_category: category, retry_count: attempt.retryCount },
      });
    }
    logPlaybackAnalytics('playback failed', { attemptId: attempt.attemptId, category });
    return true;
  }

  function stateChanged(nextState: UnifiedPlayerMachineState) {
    if (!attempt || attempt.stopped) return;
    const timestamp = now();
    const previousState = attempt.lastState;
    if (nextState === 'buffering' && previousState !== 'buffering') {
      attempt.bufferingCount += 1;
      attempt.bufferingStartedAt = timestamp;
      if (attempt.startedAt !== null) attempt.recoveryPending = true;
      recordDiagnostic({ eventType: 'buffer_start', sessionId: attempt.sessionId, contentType: attempt.contentType, contentId: attempt.item.id, contentTitle: attempt.item.title, managedProviderId: attempt.item.providerId, bufferCount: attempt.bufferingCount });
    } else if (previousState === 'buffering' && nextState !== 'buffering') {
      if (attempt.bufferingStartedAt !== null) {
        const durationMs = Math.max(0, timestamp - attempt.bufferingStartedAt);
        attempt.bufferingDurationMs += durationMs;
        attempt.bufferingStartedAt = null;
        recordDiagnostic({ eventType: 'buffer_end', sessionId: attempt.sessionId, contentType: attempt.contentType, contentId: attempt.item.id, contentTitle: attempt.item.title, managedProviderId: attempt.item.providerId, durationMs, bufferCount: attempt.bufferingCount, totalBufferDurationMs: attempt.bufferingDurationMs });
      }
      if (attempt.startedAt !== null && attempt.recoveryPending && (nextState === 'ready' || nextState === 'playing' || nextState === 'paused')) {
        attempt.recoveryPending = false;
        attempt.failed = false;
        send('playback_recovered', {
          ...eventInput(attempt),
          outcome: 'success',
          durationMs: attempt.bufferingDurationMs,
          countValue: attempt.bufferingCount,
          metadata: {},
        });
        logPlaybackAnalytics('playback recovered', { attemptId: attempt.attemptId });
      }
    }
    if (nextState === 'error' && previousState !== 'error') failure('unknown');
    attempt.lastState = nextState;
  }

  function stop(reason: PlaybackStopReason = 'unknown') {
    if (!attempt || attempt.stopped) return false;
    const timestamp = now();
    if (attempt.bufferingStartedAt !== null) {
      attempt.bufferingDurationMs += Math.max(0, timestamp - attempt.bufferingStartedAt);
      attempt.bufferingStartedAt = null;
    }
    attempt.stopped = true;
    const playbackDurationMs = attempt.startedAt === null ? undefined : Math.max(0, timestamp - attempt.startedAt);
    send('playback_stopped', {
      ...eventInput(attempt),
      outcome: reason,
      durationMs: playbackDurationMs,
      countValue: attempt.bufferingCount,
      metadata: { exit_reason: reason },
    });
    logPlaybackAnalytics('playback stopped', {
      attemptId: attempt.attemptId,
      reason,
      durationMs: playbackDurationMs ?? null,
    });
    return true;
  }

  return { request, firstFrame, failure, stateChanged, stop };
}

export const playbackAnalyticsTracker = createPlaybackAnalyticsTracker();
