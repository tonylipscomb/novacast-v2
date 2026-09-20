import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RecommendationEvent } from './recommendationContract.ts';

export const RECOMMENDATION_QUEUE_VERSION = 1;
export const RECOMMENDATION_QUEUE_MAX_EVENTS = 500;

const QUEUE_KEY = '@novacast/recommendation-events-v1';
const STATE_KEY = '@novacast/recommendation-state-v1';

type StoredQueue = { version: number; events: RecommendationEvent[] };
type StoredState = { version: number; meaningfulSessions: Array<[string, string]> };

let queueCache: RecommendationEvent[] | null = null;
let stateCache: Set<string> | null = null;
let storageOverride: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> | null = null;

function storage() {
  return storageOverride ?? AsyncStorage;
}

function isEvent(value: unknown): value is RecommendationEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<RecommendationEvent>;
  return typeof event.idempotencyKey === 'string' &&
    typeof event.eventType === 'string' &&
    typeof event.contentType === 'string' &&
    typeof event.fingerprint === 'string' &&
    typeof event.providerId === 'string' &&
    typeof event.providerContentId === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.occurredAt === 'string';
}

function logLocal(eventType: string, fields: Record<string, string | number | boolean>) {
  console.info('[NOVAPULSE_RECS_LOCAL]', JSON.stringify({ eventType, ...fields }));
}

async function loadQueue() {
  if (queueCache) return queueCache;
  try {
    const raw = await storage().getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<StoredQueue> : null;
    queueCache = parsed?.version === RECOMMENDATION_QUEUE_VERSION && Array.isArray(parsed.events)
      ? parsed.events.filter(isEvent).slice(-RECOMMENDATION_QUEUE_MAX_EVENTS)
      : [];
  } catch {
    queueCache = [];
  }
  return queueCache;
}

async function persistQueue(events: RecommendationEvent[]) {
  const previous = queueCache;
  queueCache = events.slice(-RECOMMENDATION_QUEUE_MAX_EVENTS);
  try {
    await storage().setItem(QUEUE_KEY, JSON.stringify({ version: RECOMMENDATION_QUEUE_VERSION, events: queueCache } satisfies StoredQueue));
    return true;
  } catch {
    queueCache = previous;
    return false;
  }
}

async function loadState() {
  if (stateCache) return stateCache;
  try {
    const raw = await storage().getItem(STATE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<StoredState> : null;
    stateCache = parsed?.version === RECOMMENDATION_QUEUE_VERSION && Array.isArray(parsed.meaningfulSessions)
      ? new Set(parsed.meaningfulSessions.filter((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((part) => typeof part === 'string')).map(([fingerprint, sessionId]) => `${fingerprint}\u0000${sessionId}`).slice(-RECOMMENDATION_QUEUE_MAX_EVENTS))
      : new Set();
  } catch {
    stateCache = new Set();
  }
  return stateCache;
}

async function persistState(state: Set<string>) {
  stateCache = state;
  try {
    const meaningfulSessions: Array<[string, string]> = [...state].slice(-RECOMMENDATION_QUEUE_MAX_EVENTS).flatMap((value) => {
      const [fingerprint, sessionId] = value.split('\u0000', 2);
      return fingerprint && sessionId ? [[fingerprint, sessionId] as [string, string]] : [];
    });
    await storage().setItem(STATE_KEY, JSON.stringify({ version: RECOMMENDATION_QUEUE_VERSION, meaningfulSessions } satisfies StoredState));
  } catch {
    // Recommendation state is best effort and must never affect playback.
  }
}

export async function enqueueRecommendationEvent(event: RecommendationEvent) {
  try {
    const queue = await loadQueue();
    if (queue.some((item) => item.idempotencyKey === event.idempotencyKey)) {
      logLocal(event.eventType, { queued: false, deduped: true, queueSize: queue.length, reason: 'duplicate' });
      return false;
    }
    const next = [...queue, event].slice(-RECOMMENDATION_QUEUE_MAX_EVENTS);
    const persisted = await persistQueue(next);
    logLocal(event.eventType, { queued: persisted, deduped: false, queueSize: next.length, reason: persisted ? 'enqueued' : 'storage-unavailable' });
    return persisted;
  } catch {
    return false;
  }
}

export async function listPendingRecommendationEvents(limit = RECOMMENDATION_QUEUE_MAX_EVENTS) {
  return (await loadQueue()).slice(0, Math.max(0, limit));
}

export async function ackRecommendationEvents(idempotencyKeys: readonly string[]) {
  try {
    const keys = new Set(idempotencyKeys);
    const queue = await loadQueue();
    return persistQueue(queue.filter((event) => !keys.has(event.idempotencyKey)));
  } catch {
    return false;
  }
}

export async function clearInvalidRecommendationEvents() {
  const queue = await loadQueue();
  return persistQueue(queue.filter(isEvent));
}

export async function recordMeaningfulRecommendationSession(fingerprint: string, sessionId: string) {
  const state = await loadState();
  const key = `${fingerprint}\u0000${sessionId}`;
  if (state.has(key)) return;
  state.add(key);
  if (state.size > RECOMMENDATION_QUEUE_MAX_EVENTS) {
    const trimmed = [...state].slice(-RECOMMENDATION_QUEUE_MAX_EVENTS);
    state.clear();
    trimmed.forEach((entry) => state.add(entry));
  }
  await persistState(state);
}

export async function hasMeaningfulRecommendationSession(fingerprint: string, excludingSessionId: string) {
  const state = await loadState();
  return [...state].some((entry) => entry.startsWith(`${fingerprint}\u0000`) && entry !== `${fingerprint}\u0000${excludingSessionId}`);
}

export function resetRecommendationQueueForTests() {
  queueCache = null;
  stateCache = null;
}

export function setRecommendationStorageForTests(value: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> | null) {
  storageOverride = value;
  resetRecommendationQueueForTests();
}
