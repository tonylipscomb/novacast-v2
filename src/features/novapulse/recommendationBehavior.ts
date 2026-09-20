import {
  buildRecommendationIdempotencyKey,
  classifyRecommendationAbandonment,
  createRecommendationEvent,
  createRecommendationFingerprint,
  isMeaningfulWatch,
  isRecommendationComplete,
  type RecommendationContentType,
  type RecommendationEvent,
  type RecommendationEventType,
  type RecommendationProgressBucket,
} from './recommendationContract.ts';
import {
  enqueueRecommendationEvent,
  hasMeaningfulRecommendationSession,
  recordMeaningfulRecommendationSession,
} from './recommendationEventQueue.ts';

type PlaybackContext = {
  providerId?: string;
  contentId: string;
  contentType: 'live' | 'movie' | 'episode';
  title: string;
  seriesTitle?: string;
  year?: unknown;
  seriesYear?: unknown;
  seriesId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
};

type ActiveContext = PlaybackContext & { fingerprint: string; started: boolean; meaningful: boolean; complete: boolean; sessionId: string };

function progressBucket(positionMs: number, durationMs: number, contentType: 'movie' | 'episode'): RecommendationProgressBucket {
  if (isRecommendationComplete(positionMs, durationMs)) return 'complete';
  if (isMeaningfulWatch(contentType, positionMs, durationMs)) return 'meaningful';
  if (durationMs > 0 && positionMs / durationMs >= 0.9) return 'near_complete';
  if (durationMs > 0 && positionMs / durationMs >= 0.5) return 'half';
  return 'started';
}

function contentType(context: PlaybackContext): RecommendationContentType {
  return context.contentType;
}

export function createRecommendationBehaviorTracker(
  enqueue: (event: RecommendationEvent) => Promise<boolean> = enqueueRecommendationEvent,
  now: () => number = Date.now,
) {
  let active: ActiveContext | null = null;
  const emitted = new Set<string>();

  const emitOnce = (context: ActiveContext, eventType: RecommendationEventType, extra: Partial<RecommendationEvent> = {}) => {
    const key = buildRecommendationIdempotencyKey({ sessionId: context.sessionId, fingerprint: context.fingerprint, eventType, milestone: extra.progressBucket });
    if (emitted.has(key)) return false;
    emitted.add(key);
    void enqueue(createRecommendationEvent({
      eventType,
      contentType: contentType(context),
      fingerprint: context.fingerprint,
      providerId: context.providerId ?? '',
      providerContentId: context.contentId,
      sessionId: context.sessionId,
      occurredAt: new Date(now()).toISOString(),
      ...extra,
    })).catch(() => undefined);
    return true;
  };

  return {
    begin(context: PlaybackContext, sessionId: string, force = false) {
      const fingerprint = createRecommendationFingerprint({
        contentType: context.contentType,
        title: context.title,
        year: context.year,
        seriesTitle: context.seriesTitle ?? context.title,
        seriesYear: context.seriesYear ?? context.year,
        seasonNumber: context.seasonNumber,
        episodeNumber: context.episodeNumber,
      });
      if (!fingerprint || !context.providerId) return null;
      if (force && active && active.contentId === context.contentId && active.fingerprint === fingerprint) return active.sessionId;
      active = { ...context, fingerprint, sessionId, started: false, meaningful: false, complete: false };
      emitOnce(active, 'play_start', { progressBucket: 'started' });
      return sessionId;
    },
    started(sessionId: string) {
      if (!active || active.sessionId !== sessionId) return;
      active.started = true;
    },
    progress(sessionId: string, positionMs: number, durationMs: number) {
      if (!active || active.sessionId !== sessionId || !active.started || !Number.isFinite(durationMs) || durationMs <= 0) return;
      const bucket = progressBucket(positionMs, durationMs, active.contentType === 'movie' || active.contentType === 'episode' ? active.contentType : 'movie');
      if (active.contentType !== 'live' && !active.meaningful && isMeaningfulWatch(active.contentType, positionMs, durationMs)) {
        active.meaningful = true;
        void recordMeaningfulRecommendationSession(active.fingerprint, sessionId).catch(() => undefined);
        emitOnce(active, 'meaningful_watch', { watchDurationMs: positionMs, contentDurationMs: durationMs, progressBucket: bucket });
        void hasMeaningfulRecommendationSession(active.fingerprint, sessionId).then((repeat) => {
          if (repeat) emitOnce(active!, 'repeat_watch', { watchDurationMs: positionMs, contentDurationMs: durationMs, progressBucket: 'meaningful' });
        }).catch(() => undefined);
      }
      if (active.contentType !== 'live' && !active.complete && isRecommendationComplete(positionMs, durationMs)) {
        active.complete = true;
        emitOnce(active, 'complete', { watchDurationMs: positionMs, contentDurationMs: durationMs, progressBucket: 'complete' });
      }
    },
    stop(sessionId: string, positionMs: number, durationMs: number) {
      if (!active || active.sessionId !== sessionId) return;
      if (active.contentType !== 'live' && !active.complete && classifyRecommendationAbandonment({
        contentType: active.contentType === 'episode' ? 'episode' : 'movie',
        started: active.started,
        stopped: true,
        positionMs,
        durationMs,
      })) {
        emitOnce(active, 'abandon', { watchDurationMs: positionMs, contentDurationMs: durationMs, progressBucket: 'started' });
      }
      active = null;
    },
    resetForTests() {
      active = null;
      emitted.clear();
    },
  };
}

export const recommendationBehaviorTracker = createRecommendationBehaviorTracker();

export async function emitRecommendationTransition(input: {
  eventType: 'favorite_add' | 'favorite_remove' | 'watchlist_add' | 'watchlist_remove';
  providerId: string;
  providerContentId: string;
  contentType: 'movie' | 'series';
  title: string;
  year?: unknown;
}) {
  const fingerprint = createRecommendationFingerprint({ contentType: input.contentType, title: input.title, year: input.year });
  if (!fingerprint || !input.providerId || !input.providerContentId) return false;
  return enqueueRecommendationEvent(createRecommendationEvent({
    eventType: input.eventType,
    contentType: input.contentType,
    fingerprint,
    providerId: input.providerId,
    providerContentId: input.providerContentId,
    sessionId: 'state-transition',
    occurredAt: new Date().toISOString(),
  }));
}
