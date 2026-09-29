/**
 * Stage 2.75 adaptive time-budget scheduler.
 * Preferred 35–50 ms, soft 75 ms, hard 100 ms. Separate learned sizes per work kind.
 * Tuning state is process-local only (not persisted across launches).
 */

import { getCatalogBackgroundWriteYield } from './catalogForegroundPriority.ts';
import { recordCatalogWritePhase } from './catalogWritePhaseAudit.ts';

export const CATALOG_CHUNK_PREFERRED_MS = 45;
export const CATALOG_CHUNK_TARGET_MS = CATALOG_CHUNK_PREFERRED_MS;
export const CATALOG_CHUNK_SOFT_MS = 75;
export const CATALOG_CHUNK_HARD_MS = 100;
export const CATALOG_CHUNK_MAX_ITEMS = 80;
export const CATALOG_CHUNK_MIN_ITEMS = 4;

export type ChunkWorkKind =
  | 'categories'
  | 'movieMapping'
  | 'seriesMapping'
  | 'movieItemWrites'
  | 'itemWrites'
  | 'liveNormalization'
  | 'regionRanking'
  | 'generic';

export type TimeBudgetOptions = {
  targetMs?: number;
  softMs?: number;
  hardMs?: number;
  maxItems?: number;
  minItems?: number;
  kind?: ChunkWorkKind;
  diagnostic?: boolean;
  isCancelled?: () => boolean;
  /** Called immediately before each buffered write batch begins. */
  beforeFlush?: () => void | Promise<void>;
  /** Optional native timing supplied by a bounded writer; queue wait is excluded. */
  getFlushBusyMs?: () => number | undefined;
  onChunk?: (info: {
    processed: number;
    chunkMs: number;
    chunkItems: number;
    batchSize: number;
    sqliteWriteMs?: number;
    effectiveBusyMs?: number;
    measuredMacrotaskLagMs?: number;
    derivedEventLoopLagMs?: number;
    nextBatchSize?: number;
    pressureLagMs?: number;
    pauseReason?: string;
    overrun: boolean;
    eventLoopLagMs?: number;
    pauseMs?: number;
  }) => void;
  onYield?: (yieldMs: number) => void;
  onBatchSizeChange?: (previousSize: number, nextSize: number) => void;
  pressureMode?: boolean;
};

export type TimeBudgetResult = {
  processed: number;
  chunks: number;
  maxChunkMs: number;
  totalMs: number;
  overruns: number;
  singleItemOverruns: number;
  peakBatchMs: number;
  pressurePauseCount: number;
};

const DEFAULT_BATCH: Record<ChunkWorkKind, number> = {
  categories: 8,
  movieMapping: 32,
  seriesMapping: 32,
  movieItemWrites: 10,
  itemWrites: 16,
  liveNormalization: 128,
  regionRanking: 64,
  generic: 24,
};

const learnedBatchSizes: Record<ChunkWorkKind, number> = { ...DEFAULT_BATCH };
const safeStreak: Record<ChunkWorkKind, number> = {
  categories: 0,
  movieMapping: 0,
  seriesMapping: 0,
  movieItemWrites: 0,
  itemWrites: 0,
  liveNormalization: 0,
  regionRanking: 0,
  generic: 0,
};

export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function yieldMacrotaskMeasured(): Promise<number> {
  const startedAt = nowMs();
  return new Promise((resolve) => {
    setTimeout(() => resolve(Math.max(0, nowMs() - startedAt)), 0);
  });
}

export function getLearnedBatchSize(kind: ChunkWorkKind): number {
  return learnedBatchSizes[kind];
}

export function resetChunkBudgetLearningForTests() {
  (Object.keys(DEFAULT_BATCH) as ChunkWorkKind[]).forEach((kind) => {
    learnedBatchSizes[kind] = DEFAULT_BATCH[kind];
    safeStreak[kind] = 0;
  });
}

function adjustBatchSize(
  kind: ChunkWorkKind,
  chunkMs: number,
  targetMs: number,
  softMs: number,
  hardMs: number,
  minItems: number,
  maxItems: number,
  diagnostic: boolean,
): void {
  let next = learnedBatchSizes[kind];
  if (chunkMs >= hardMs) {
    next = Math.max(minItems, Math.floor(next * 0.5));
    safeStreak[kind] = 0;
    if (diagnostic) {
      recordCatalogWritePhase('chunk.overrun', {
        wallMs: chunkMs,
        itemCount: next,
        meta: { kind, severity: 'hard' },
      });
    }
  } else if (chunkMs >= softMs) {
    next = Math.max(minItems, Math.floor(next * 0.75));
    safeStreak[kind] = 0;
    if (diagnostic) {
      recordCatalogWritePhase('chunk.overrun', {
        wallMs: chunkMs,
        itemCount: next,
        meta: { kind, severity: 'soft' },
      });
    }
  } else if (chunkMs <= targetMs * 0.6) {
    safeStreak[kind] += 1;
    if (safeStreak[kind] >= 3) {
      next = Math.min(maxItems, next + 2);
      safeStreak[kind] = 0;
    }
  } else if (chunkMs <= targetMs) {
    safeStreak[kind] += 1;
    if (safeStreak[kind] >= 5) {
      next = Math.min(maxItems, next + 1);
      safeStreak[kind] = 0;
    }
  } else {
    safeStreak[kind] = 0;
  }
  learnedBatchSizes[kind] = Math.max(minItems, Math.min(maxItems, next));
}

export async function processTimeBudgeted<T>(
  items: readonly T[],
  processItem: (item: T, index: number) => void | Promise<void>,
  options?: TimeBudgetOptions,
): Promise<TimeBudgetResult> {
  const targetMs = options?.targetMs ?? CATALOG_CHUNK_PREFERRED_MS;
  const softMs = options?.softMs ?? CATALOG_CHUNK_SOFT_MS;
  const hardMs = options?.hardMs ?? CATALOG_CHUNK_HARD_MS;
  const maxItems = options?.maxItems ?? CATALOG_CHUNK_MAX_ITEMS;
  const minItems = options?.minItems ?? CATALOG_CHUNK_MIN_ITEMS;
  const kind = options?.kind ?? 'generic';
  const diagnostic =
    options?.diagnostic === true ||
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1');

  let batchMaxItems = Math.max(
    minItems,
    Math.min(maxItems, options?.maxItems ? Math.min(maxItems, learnedBatchSizes[kind]) : learnedBatchSizes[kind]),
  );
  learnedBatchSizes[kind] = batchMaxItems;

  let processed = 0;
  let chunks = 0;
  let maxChunkMs = 0;
  let overruns = 0;
  let singleItemOverruns = 0;
  const totalStart = nowMs();

  let chunkStart = nowMs();
  let chunkItems = 0;
  let yieldedBeforeChunk = true;

  const finishChunk = (yieldAfter: boolean) => {
    const chunkMs = nowMs() - chunkStart;
    maxChunkMs = Math.max(maxChunkMs, chunkMs);
    chunks += 1;
    const overrun = chunkMs >= softMs;
    if (overrun) {
      overruns += 1;
    }
    options?.onChunk?.({
      processed,
      chunkMs,
      chunkItems,
      batchSize: batchMaxItems,
      overrun,
    });
    adjustBatchSize(kind, chunkMs, targetMs, softMs, hardMs, minItems, maxItems, diagnostic);
    const previousBatchSize = batchMaxItems;
    batchMaxItems = learnedBatchSizes[kind];
    if (batchMaxItems !== previousBatchSize) {
      options?.onBatchSizeChange?.(previousBatchSize, batchMaxItems);
    }
    if (yieldAfter) {
      // caller awaits yieldMacrotask after finishChunk
    }
  };

  for (let index = 0; index < items.length; index += 1) {
    if (options?.isCancelled?.()) {
      break;
    }

    const itemStart = nowMs();
    await processItem(items[index], index);
    const itemMs = nowMs() - itemStart;
    processed += 1;
    chunkItems += 1;

    if (itemMs >= hardMs) {
      singleItemOverruns += 1;
      if (diagnostic) {
        recordCatalogWritePhase('native.overrun', {
          wallMs: itemMs,
          itemCount: 1,
          meta: { kind, index },
        });
      }
      finishChunk(true);
      const yieldStarted = nowMs();
      await yieldMacrotask();
      options?.onYield?.(nowMs() - yieldStarted);
      chunkStart = nowMs();
      chunkItems = 0;
      yieldedBeforeChunk = true;
      continue;
    }

    const elapsed = nowMs() - chunkStart;
    const isLastItem = index === items.length - 1;
    const shouldYield =
      !isLastItem && (elapsed >= targetMs || chunkItems >= batchMaxItems || elapsed >= softMs);

    if (shouldYield) {
      finishChunk(true);
      const yieldStarted = nowMs();
      await yieldMacrotask();
      options?.onYield?.(nowMs() - yieldStarted);
      chunkStart = nowMs();
      chunkItems = 0;
      yieldedBeforeChunk = true;
    } else if (isLastItem) {
      void yieldedBeforeChunk;
    }
  }

  if (chunkItems > 0) {
    finishChunk(false);
  }

  return {
    processed,
    chunks,
    maxChunkMs,
    totalMs: nowMs() - totalStart,
    overruns,
    singleItemOverruns,
    peakBatchMs: 0,
    pressurePauseCount: 0,
  };
}

/**
 * Stream items through a bounded buffer: map → buffer → flush → release → yield.
 * Never builds a full-size mapped array or parameter array.
 */
export async function processStreamingBatches<T, R>(
  items: readonly T[],
  mapItem: (item: T, index: number) => R | Promise<R>,
  flushBatch: (batch: R[]) => void | Promise<void>,
  options?: TimeBudgetOptions & { writeKind?: ChunkWorkKind },
): Promise<TimeBudgetResult> {
  const writeKind = options?.writeKind ?? 'itemWrites';
  const mapKind = options?.kind ?? 'generic';
  const targetMs = options?.targetMs ?? CATALOG_CHUNK_PREFERRED_MS;
  const softMs = options?.softMs ?? CATALOG_CHUNK_SOFT_MS;
  const hardMs = options?.hardMs ?? CATALOG_CHUNK_HARD_MS;
  const maxItems = options?.maxItems ?? CATALOG_CHUNK_MAX_ITEMS;
  const minItems = options?.minItems ?? CATALOG_CHUNK_MIN_ITEMS;
  const diagnostic =
    options?.diagnostic === true ||
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1');

  let writeBatchSize = Math.max(minItems, Math.min(maxItems, learnedBatchSizes[writeKind]));
  learnedBatchSizes[writeKind] = writeBatchSize;

  let processed = 0;
  let chunks = 0;
  let maxChunkMs = 0;
  let overruns = 0;
  let singleItemOverruns = 0;
  let peakBatchMs = 0;
  let pressurePauseCount = 0;
  const totalStart = nowMs();
  let buffer: R[] = [];
  let chunkStart = nowMs();

  const flush = async () => {
    if (!buffer.length) {
      return;
    }
    const batch = buffer;
    const batchLen = batch.length;
    buffer = [];
    await options?.beforeFlush?.();
    const writeStart = nowMs();
    await flushBatch(batch);
    const writeMs = nowMs() - writeStart;
    // Drop references promptly after the write returns.
    batch.length = 0;

    const chunkMs = nowMs() - chunkStart;
    const suppliedBusyMs = options?.getFlushBusyMs?.();
    const effectiveBusyMs = suppliedBusyMs === undefined ? writeMs : suppliedBusyMs;
    peakBatchMs = Math.max(peakBatchMs, effectiveBusyMs);
    maxChunkMs = Math.max(maxChunkMs, effectiveBusyMs);
    chunks += 1;
    if (effectiveBusyMs >= softMs) {
      overruns += 1;
    }
    if (effectiveBusyMs >= hardMs) {
      if (diagnostic) {
        recordCatalogWritePhase('native.overrun', {
          wallMs: effectiveBusyMs,
          itemCount: batchLen,
          meta: { kind: writeKind, includesMutexWait: suppliedBusyMs === undefined },
        });
      }
      singleItemOverruns += 1;
      // Collapse batch size hard — a single native/mutex span exceeded budget.
      learnedBatchSizes[writeKind] = minItems;
      writeBatchSize = minItems;
    } else if (options?.pressureMode && effectiveBusyMs >= softMs) {
      learnedBatchSizes[writeKind] = Math.max(minItems, Math.floor(writeBatchSize / 2));
    } else {
      adjustBatchSize(writeKind, effectiveBusyMs, targetMs, softMs, hardMs, minItems, maxItems, diagnostic);
    }
    writeBatchSize = learnedBatchSizes[writeKind];
    const measuredMacrotaskLagMs = await yieldMacrotaskMeasured();
    options?.onYield?.(measuredMacrotaskLagMs);
    const eventLoopLagMs = Math.max(effectiveBusyMs, measuredMacrotaskLagMs);
    const pressureLagMs = measuredMacrotaskLagMs;
    let pauseMs = 0;
    let pauseReason = 'none';
    if (measuredMacrotaskLagMs >= 1000) {
      pauseMs = 150;
      pauseReason = 'js-lag-1000';
    } else if (measuredMacrotaskLagMs >= 250) {
      pauseMs = 35;
      pauseReason = 'js-lag-250';
    } else if (effectiveBusyMs >= 100) {
      pauseMs = 12;
      pauseReason = 'sqlite-busy-100';
    }
    const foregroundYield = getCatalogBackgroundWriteYield();
    if (foregroundYield.pauseMs > pauseMs) {
      pauseMs = foregroundYield.pauseMs;
      pauseReason = foregroundYield.reason;
    }
    if (pauseMs > 0) {
      pressurePauseCount += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, pauseMs));
    }
    options?.onChunk?.({
      processed,
      chunkMs: effectiveBusyMs,
      chunkItems: batchLen,
      batchSize: writeBatchSize,
      sqliteWriteMs: writeMs,
      effectiveBusyMs,
      measuredMacrotaskLagMs,
      derivedEventLoopLagMs: eventLoopLagMs,
      pressureLagMs,
      pauseReason,
      nextBatchSize: writeBatchSize,
      overrun: effectiveBusyMs >= softMs,
      eventLoopLagMs,
      pauseMs,
    });
    if (effectiveBusyMs >= 100) {
      await yieldMacrotaskMeasured();
    }
    if (diagnostic && (effectiveBusyMs >= 100 || measuredMacrotaskLagMs >= 100)) {
      console.info('[NovaCast Catalog Pressure Audit]', {
        kind: writeKind,
        chunkItems: batchLen,
        sqliteWriteMs: Math.round(writeMs),
        effectiveBusyMs: Math.round(effectiveBusyMs),
        measuredMacrotaskLagMs: Math.round(measuredMacrotaskLagMs),
        derivedEventLoopLagMs: Math.round(eventLoopLagMs),
        pressureLagMs: Math.round(pressureLagMs),
        pauseReason,
        pauseMs,
        batchSize: writeBatchSize,
        nextBatchSize: writeBatchSize,
      });
    }
    chunkStart = nowMs();
  };

  for (let index = 0; index < items.length; index += 1) {
    if (options?.isCancelled?.()) {
      break;
    }

    const mapStart = nowMs();
    const mapped = await mapItem(items[index], index);
    const mapMs = nowMs() - mapStart;
    buffer.push(mapped);
    processed += 1;

    if (mapMs >= hardMs) {
      singleItemOverruns += 1;
      if (diagnostic) {
        recordCatalogWritePhase('native.overrun', {
          wallMs: mapMs,
          itemCount: 1,
          meta: { kind: mapKind, index },
        });
      }
      await flush();
      continue;
    }

    const elapsed = nowMs() - chunkStart;
    const shouldFlush =
      buffer.length >= writeBatchSize || elapsed >= targetMs || elapsed >= softMs;

    if (shouldFlush) {
      await flush();
    }
  }

  if (buffer.length) {
    await flush();
  }

  return {
    processed,
    chunks,
    maxChunkMs,
    totalMs: nowMs() - totalStart,
    overruns,
    singleItemOverruns,
    peakBatchMs,
    pressurePauseCount,
  };
}

export async function mapTimeBudgeted<T, R>(
  items: readonly T[],
  mapFn: (item: T, index: number) => R | Promise<R>,
  options?: TimeBudgetOptions,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  await processTimeBudgeted(
    items,
    async (item, index) => {
      results[index] = await mapFn(item, index);
    },
    options,
  );
  return results;
}
