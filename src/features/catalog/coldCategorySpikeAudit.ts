/**
 * Stage 2.8 — cold Movies category-write spike audit.
 * Enabled when EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT=1.
 * Logs counts/timings only — never full category arrays.
 * Quiet by default: first cold batch + phases/gaps >= 100ms only.
 */

const LOG_TAG = '[NovaCast ColdCategorySpike]';

export type ColdCategorySubPhase =
  | 'getDb'
  | 'prepare'
  | 'mutexWait'
  | 'txnBegin'
  | 'bindExecute'
  | 'txnCommit'
  | 'finalize'
  | 'batchTotal'
  | 'streamTotal'
  | 'prewarm'
  | 'interBatchGap';

type SubPhaseSample = {
  phase: ColdCategorySubPhase;
  mediaType?: string;
  batchIndex: number;
  itemCount: number;
  wallMs: number;
  yieldedBefore?: boolean;
  yieldedAfter?: boolean;
  cold: boolean;
};

let enabled = false;
let movieBatchIndex = 0;
let seriesBatchIndex = 0;
let firstMovieBatchLogged = false;
let lastMovieBatchEndMs = 0;
const samples: SubPhaseSample[] = [];
const MAX_SAMPLES = 80;

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isAuditEnabled(): boolean {
  if (enabled) {
    return true;
  }
  enabled =
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1';
  return enabled;
}

export function resetColdCategorySpikeAuditForTests() {
  enabled = false;
  movieBatchIndex = 0;
  seriesBatchIndex = 0;
  firstMovieBatchLogged = false;
  lastMovieBatchEndMs = 0;
  samples.length = 0;
}

export function nextCategoryBatchIndex(mediaType: string): number {
  if (mediaType === 'movie') {
    movieBatchIndex += 1;
    return movieBatchIndex;
  }
  seriesBatchIndex += 1;
  return seriesBatchIndex;
}

export function isColdMovieCategoryBatch(batchIndex: number): boolean {
  return batchIndex === 1;
}

export function noteCategoryBatchBoundary(mediaType: string | undefined, batchIndex: number) {
  if (!isAuditEnabled() || mediaType !== 'movie') {
    return;
  }
  const now = nowMs();
  if (lastMovieBatchEndMs > 0 && batchIndex > 1) {
    const gapMs = now - lastMovieBatchEndMs;
    if (gapMs >= 100) {
      recordColdCategorySubPhase({
        phase: 'interBatchGap',
        mediaType,
        batchIndex,
        itemCount: 0,
        wallMs: gapMs,
        cold: false,
      });
    }
  }
}

export function markCategoryBatchFinished(mediaType: string | undefined) {
  if (mediaType === 'movie') {
    lastMovieBatchEndMs = nowMs();
  }
}

export function recordColdCategorySubPhase(sample: SubPhaseSample) {
  if (!isAuditEnabled()) {
    return;
  }
  const isFirstMovie = sample.mediaType === 'movie' && sample.batchIndex === 1;
  const interesting =
    isFirstMovie ||
    sample.wallMs >= 100 ||
    sample.phase === 'interBatchGap' ||
    (sample.phase === 'batchTotal' && sample.cold);

  if (!interesting) {
    return;
  }

  if (isFirstMovie && sample.phase === 'batchTotal') {
    firstMovieBatchLogged = true;
  }

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
  console.info(LOG_TAG, {
    phase: sample.phase,
    mediaType: sample.mediaType ?? null,
    batchIndex: sample.batchIndex,
    itemCount: sample.itemCount,
    wallMs: Math.round(sample.wallMs * 10) / 10,
    cold: sample.cold,
  });
  void firstMovieBatchLogged;
}

export async function timedColdCategorySubPhase<T>(
  phase: ColdCategorySubPhase,
  meta: {
    mediaType?: string;
    batchIndex: number;
    itemCount?: number;
    cold?: boolean;
    yieldedBefore?: boolean;
    yieldedAfter?: boolean;
  },
  work: () => Promise<T> | T,
): Promise<T> {
  if (!isAuditEnabled()) {
    return await work();
  }
  const start = nowMs();
  try {
    return await work();
  } finally {
    recordColdCategorySubPhase({
      phase,
      mediaType: meta.mediaType,
      batchIndex: meta.batchIndex,
      itemCount: meta.itemCount ?? 0,
      wallMs: nowMs() - start,
      cold: Boolean(meta.cold),
      yieldedBefore: meta.yieldedBefore,
      yieldedAfter: meta.yieldedAfter,
    });
  }
}

export function getColdCategorySpikeSamplesForTests(): SubPhaseSample[] {
  return samples.slice();
}

export function summarizeColdSpikeForTests(): {
  firstMovieBatchMs: number;
  dominantPhase: string | null;
  dominantShare: number;
} {
  const first = samples.filter((s) => s.mediaType === 'movie' && s.batchIndex === 1);
  const total = first.find((s) => s.phase === 'batchTotal');
  if (!total || total.wallMs <= 0) {
    return { firstMovieBatchMs: 0, dominantPhase: null, dominantShare: 0 };
  }
  const parts = first.filter((s) => s.phase !== 'batchTotal' && s.phase !== 'streamTotal');
  let dominantPhase: string | null = null;
  let dominantMs = 0;
  for (const part of parts) {
    if (part.wallMs > dominantMs) {
      dominantMs = part.wallMs;
      dominantPhase = part.phase;
    }
  }
  return {
    firstMovieBatchMs: total.wallMs,
    dominantPhase,
    dominantShare: dominantMs / total.wallMs,
  };
}
