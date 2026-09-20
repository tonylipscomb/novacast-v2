import { isPlaybackComplete } from '../playback/continuity/playbackContinuity.ts';

export type RecommendationContentType = 'movie' | 'series' | 'episode' | 'live';

export type RecommendationEventType =
  | 'play_start'
  | 'meaningful_watch'
  | 'complete'
  | 'abandon'
  | 'repeat_watch'
  | 'favorite_add'
  | 'favorite_remove'
  | 'watchlist_add'
  | 'watchlist_remove';

export type RecommendationProgressBucket = 'started' | 'meaningful' | 'half' | 'near_complete' | 'complete';

export type RecommendationReason =
  | 'continue_watching'
  | 'continue_series'
  | 'because_you_watched'
  | 'favorite_affinity'
  | 'watchlist_affinity'
  | 'viewers_also_watched'
  | 'trending_novacast'
  | 'recently_added_match'
  | 'fallback_ranked';

export type RecommendationSignalInputs = {
  personalMeaningfulWatch: number;
  completionAffinity: number;
  repeatAffinity: number;
  favoriteAffinity: number;
  watchlistAffinity: number;
  coWatchAffinity: number;
  trendScore: number;
  freshnessScore: number;
  fallbackMetadataScore: number;
};

export type RecommendationIdentity = {
  fingerprint: string;
  providerId: string;
  providerContentId: string;
  contentType: RecommendationContentType;
};

export type RecommendationEvent = RecommendationIdentity & {
  eventType: RecommendationEventType;
  sessionId: string;
  occurredAt: string;
  watchDurationMs?: number;
  contentDurationMs?: number;
  progressBucket?: RecommendationProgressBucket;
  idempotencyKey: string;
};

export type RecommendationContentInput = {
  contentType: RecommendationContentType;
  title?: string | null;
  year?: unknown;
  seriesTitle?: string | null;
  seriesYear?: unknown;
  seasonNumber?: unknown;
  episodeNumber?: unknown;
};

export type RecommendationEventInput = RecommendationIdentity & {
  eventType: RecommendationEventType;
  sessionId: string;
  occurredAt: string;
  watchDurationMs?: number;
  contentDurationMs?: number;
  progressBucket?: RecommendationProgressBucket;
};

export const RECOMMENDATION_EVENT_VOLUME_TARGET = { min: 3, max: 6 } as const;

function normalizeIdentityText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[|\u2022\u00b7]+/g, ' ')
    .replace(/[\s_]+/g, ' ')
    .replace(/[\s]*([:;,/\\()[\]{}])+[\s]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeRecommendationTitle(value: unknown) {
  return normalizeIdentityText(value);
}

export function validateRecommendationYear(value: unknown, now = new Date()): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\s*\d{4}\s*$/.test(value)
      ? Number(value.trim())
      : null;
  if (numeric == null || !Number.isInteger(numeric)) return null;
  const currentYear = now.getFullYear();
  return numeric >= 1888 && numeric <= currentYear + 2 ? numeric : null;
}

function normalizedPart(value: unknown) {
  return normalizeIdentityText(value).replace(/\|/g, ' ');
}

function episodeNumber(value: unknown) {
  const text = String(value ?? '').trim();
  const match = text.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function paddedNumber(value: unknown) {
  const parsed = episodeNumber(value);
  return parsed == null ? null : String(parsed).padStart(2, '0');
}

export function createRecommendationFingerprint(input: RecommendationContentInput, now = new Date()): string | null {
  const title = normalizedPart(input.contentType === 'episode' ? input.seriesTitle : input.title);
  if (!title) return null;

  if (input.contentType === 'episode') {
    const season = paddedNumber(input.seasonNumber);
    const episode = paddedNumber(input.episodeNumber);
    if (!season || !episode) return null;
    const year = validateRecommendationYear(input.seriesYear ?? input.year, now);
    return ['episode', title, ...(year == null ? [] : [String(year)]), `s${season}`, `e${episode}`].join('|');
  }

  const year = validateRecommendationYear(input.year, now);
  return [input.contentType, title, ...(year == null ? [] : [String(year)])].join('|');
}

export function meaningfulWatchThresholdMs(contentType: 'movie' | 'episode', durationMs: number): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const baseMs = contentType === 'movie' ? 5 * 60_000 : 2 * 60_000;
  const capMs = contentType === 'movie' ? 10 * 60_000 : 5 * 60_000;
  // Short-form items use a 25% milestone instead of demanding the normal base.
  if (durationMs < baseMs) return Math.max(1_000, Math.ceil(durationMs * 0.25));
  return Math.min(capMs, Math.max(baseMs, Math.ceil(durationMs * 0.1)));
}

export function isMeaningfulWatch(contentType: 'movie' | 'episode', positionMs: number, durationMs: number) {
  const threshold = meaningfulWatchThresholdMs(contentType, durationMs);
  return threshold != null && Number.isFinite(positionMs) && positionMs >= threshold;
}

export function isRecommendationComplete(positionMs: number, durationMs: number) {
  return isPlaybackComplete(positionMs, durationMs);
}

export function classifyRecommendationAbandonment(input: {
  contentType: 'movie' | 'episode';
  started: boolean;
  stopped: boolean;
  positionMs: number;
  durationMs: number;
}) {
  return input.started && input.stopped && !isRecommendationComplete(input.positionMs, input.durationMs) &&
    !isMeaningfulWatch(input.contentType, input.positionMs, input.durationMs);
}

export function buildRecommendationIdempotencyKey(input: {
  sessionId: string;
  fingerprint: string;
  eventType: RecommendationEventType;
  milestone?: string;
}) {
  return [input.sessionId, input.fingerprint, input.eventType, input.milestone ?? 'default'].join('|');
}

export function createRecommendationEvent(input: RecommendationEventInput): RecommendationEvent {
  return {
    ...input,
    idempotencyKey: buildRecommendationIdempotencyKey({
      sessionId: input.sessionId,
      fingerprint: input.fingerprint,
      eventType: input.eventType,
      milestone: input.progressBucket,
    }),
  };
}

export function createRecommendationMilestoneTracker() {
  const emitted = new Set<string>();
  const meaningfulSessions = new Map<string, Set<string>>();

  return {
    canEmit(input: Pick<RecommendationEventInput, 'sessionId' | 'fingerprint' | 'eventType' | 'progressBucket'>) {
      const key = buildRecommendationIdempotencyKey({
        sessionId: input.sessionId,
        fingerprint: input.fingerprint,
        eventType: input.eventType,
        milestone: input.progressBucket,
      });
      if (emitted.has(key)) return false;
      emitted.add(key);
      if (input.eventType === 'meaningful_watch') {
        const sessions = meaningfulSessions.get(input.fingerprint) ?? new Set<string>();
        sessions.add(input.sessionId);
        meaningfulSessions.set(input.fingerprint, sessions);
      }
      return true;
    },
    isRepeatWatch(fingerprint: string, sessionId: string) {
      const sessions = meaningfulSessions.get(fingerprint);
      return Boolean(sessions && [...sessions].some((value) => value !== sessionId));
    },
  };
}

export function shouldEmitStateTransition(previous: boolean, next: boolean) {
  return previous !== next;
}

// The device may use the raw fingerprint for local correlation. The future
// transport boundary should canonicalize/validate it server-side, then HMAC
// fingerprint and provider references using the existing analytics utility.
// This phase intentionally does not introduce a second hashing scheme.
