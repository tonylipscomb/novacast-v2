import type { RecommendationEvent } from './recommendationContract.ts';
import { ackRecommendationEvents, listPendingRecommendationEvents } from './recommendationEventQueue.ts';
import { sendRecommendationEvents, type RecommendationSyncResult } from './recommendationEventTransport.ts';

const BATCH_SIZE = 50;
let flushPromise: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function logSync(fields: Record<string, number>) {
  console.info('[NOVAPULSE_RECS_SYNC]', JSON.stringify(fields));
}

export async function flushRecommendationEvents(
  send: (events: readonly RecommendationEvent[]) => Promise<RecommendationSyncResult> = sendRecommendationEvents,
) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    let attempted = 0;
    let accepted = 0;
    let duplicates = 0;
    let invalid = 0;
    let transientFailed = 0;
    while (true) {
      const pending = await listPendingRecommendationEvents(BATCH_SIZE);
      if (!pending.length) break;
      attempted += pending.length;
      let result: RecommendationSyncResult;
      try {
        result = await send(pending);
      } catch (error) {
        transientFailed += pending.length;
        logSync({ attempted, accepted, duplicates, invalid, transientFailed, remaining: pending.length, batchSize: pending.length });
        return;
      }

      accepted += result.accepted ?? 0;
      duplicates += result.duplicates ?? 0;
      invalid += result.invalid ?? 0;
      transientFailed += result.transientFailed ?? 0;
      const removeIndexes = new Set((result.results ?? [])
        .filter((entry) => entry.status === 'accepted' || entry.status === 'duplicate' || entry.status === 'invalid')
        .map((entry) => entry.index));
      if (removeIndexes.size) {
        await ackRecommendationEvents(pending.filter((_event, index) => removeIndexes.has(index)).map((event) => event.idempotencyKey));
      }
      logSync({ attempted, accepted, duplicates, invalid, transientFailed, remaining: Math.max(0, pending.length - removeIndexes.size), batchSize: pending.length });
      if (transientFailed > 0 || removeIndexes.size === 0) return;
    }
  })().catch(() => undefined).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export function scheduleRecommendationFlush() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushRecommendationEvents();
  }, 4_000);
}

export function resetRecommendationSyncForTests() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  flushPromise = null;
}
