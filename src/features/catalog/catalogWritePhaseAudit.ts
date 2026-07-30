/**
 * Stage 2.75 Phase A — post-sync-start SQLite/write path phase timings.
 * Enabled only when EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT=1.
 */

const LOG_TAG = '[NovaCast CatalogWritePhase]';
const REPORT_THRESHOLD_MS = 20;

export type CatalogWritePhaseName =
  | 'sqlite.initialize'
  | 'sqlite.migration'
  | 'sqlite.beginCatalogSync'
  | 'category.normalize'
  | 'category.serialize'
  | 'category.prepare'
  | 'category.write'
  | 'category.commit'
  | 'item.normalize'
  | 'item.allocate'
  | 'item.params'
  | 'item.prepare'
  | 'item.write'
  | 'item.commit'
  | 'counts.aggregate'
  | 'counts.update'
  | 'stale.delete'
  | 'mutex.wait'
  | 'native.overrun'
  | 'chunk.overrun';

type PhaseSample = {
  phase: CatalogWritePhaseName;
  itemCount: number;
  wallMs: number;
  syncMs: number;
  yieldedBefore: boolean;
  yieldedAfter: boolean;
  meta?: Record<string, unknown>;
};

let enabled = false;
let samples: PhaseSample[] = [];
const MAX_SAMPLES = 400;

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

export function recordCatalogWritePhase(
  phase: CatalogWritePhaseName,
  input: {
    itemCount?: number;
    wallMs: number;
    syncMs?: number;
    yieldedBefore?: boolean;
    yieldedAfter?: boolean;
    meta?: Record<string, unknown>;
  },
) {
  if (!isAuditEnabled()) {
    return;
  }
  if (input.wallMs < REPORT_THRESHOLD_MS && phase !== 'native.overrun' && phase !== 'chunk.overrun') {
    return;
  }
  const sample: PhaseSample = {
    phase,
    itemCount: input.itemCount ?? 0,
    wallMs: Math.round(input.wallMs * 10) / 10,
    syncMs: Math.round((input.syncMs ?? input.wallMs) * 10) / 10,
    yieldedBefore: Boolean(input.yieldedBefore),
    yieldedAfter: Boolean(input.yieldedAfter),
    meta: input.meta,
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(-MAX_SAMPLES);
  }
  console.info(LOG_TAG, sample);
}

export async function timedCatalogWritePhase<T>(
  phase: CatalogWritePhaseName,
  work: () => Promise<T> | T,
  meta: {
    itemCount?: number;
    yieldedBefore?: boolean;
    yieldedAfter?: boolean;
    extra?: Record<string, unknown>;
  } = {},
): Promise<T> {
  if (!isAuditEnabled()) {
    return await work();
  }
  const start = nowMs();
  try {
    return await work();
  } finally {
    recordCatalogWritePhase(phase, {
      itemCount: meta.itemCount,
      wallMs: nowMs() - start,
      yieldedBefore: meta.yieldedBefore,
      yieldedAfter: meta.yieldedAfter,
      meta: meta.extra,
    });
  }
}

export function getCatalogWritePhaseSamplesForTests(): PhaseSample[] {
  return samples.slice();
}

export function clearCatalogWritePhaseAuditForTests() {
  samples = [];
  enabled = false;
}
