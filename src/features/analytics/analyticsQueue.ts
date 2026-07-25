import { analyticsConfig } from './analyticsConfig';
import { readAnalyticsQueue, writeAnalyticsQueue } from './analyticsStorage';
import type { AnalyticsBatch } from './analyticsTypes';

let queue: AnalyticsBatch[] | null = null;
let loadPromise: Promise<AnalyticsBatch[]> | null = null;

async function getQueue() {
  if (queue) return queue;
  if (!loadPromise) {
    loadPromise = readAnalyticsQueue<AnalyticsBatch>().then((value) => {
      queue = value.slice(-analyticsConfig.maxQueueItems);
      return queue;
    }).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

function queueSize(value: AnalyticsBatch[]) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export async function enqueueAnalyticsBatch(batch: AnalyticsBatch) {
  const current = await getQueue();
  current.push(batch);
  while (current.length > analyticsConfig.maxQueueItems || queueSize(current) > analyticsConfig.maxQueueBytes) {
    current.shift();
  }
  return writeAnalyticsQueue(current);
}

export async function peekAnalyticsBatches(limit = analyticsConfig.batchSize) {
  const current = await getQueue();
  return current.slice(0, Math.max(1, limit));
}

export async function removeAnalyticsBatches(count: number) {
  const current = await getQueue();
  current.splice(0, Math.max(0, count));
  return writeAnalyticsQueue(current);
}

export async function flushAnalyticsQueue(
  send: (batch: AnalyticsBatch) => Promise<unknown>,
  session: AnalyticsBatch['session'],
  state: AnalyticsBatch['state'],
  retryDelay: (attempt: number) => number,
) {
  let attempt = 0;
  while (true) {
    const pending = await peekAnalyticsBatches();
    if (!pending.length) {
      if (state) await send({ session, events: [], state });
      return;
    }

    const sessionUuid = pending[0].session.sessionUuid;
    const grouped: AnalyticsBatch[] = [];
    const events = [] as AnalyticsBatch['events'];
    for (const item of pending) {
      if (item.session.sessionUuid !== sessionUuid || events.length + item.events.length > 50) break;
      grouped.push(item);
      events.push(...item.events);
    }

    try {
      await send({ session: grouped[0].session, events, state: state ?? grouped[0].state });
      await removeAnalyticsBatches(grouped.length);
      attempt = 0;
    } catch (error) {
      const retryable = Boolean(error && typeof error === 'object' && 'retryable' in error && (error as { retryable?: unknown }).retryable);
      if (!retryable) {
        await removeAnalyticsBatches(grouped.length);
        continue;
      }
      attempt += 1;
      if (attempt >= analyticsConfig.maxAttempts) return;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
}

export async function getAnalyticsQueueSize() {
  return (await getQueue()).length;
}

export function resetAnalyticsQueueForTests() {
  queue = null;
  loadPromise = null;
}
