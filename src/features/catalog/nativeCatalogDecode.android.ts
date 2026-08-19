/**
 * Android implementation — static Expo native module import (release-safe).
 */
import { requireNativeModule } from 'expo';

import type {
  CatalogDecodeBatchStats,
  CatalogDecodeMediaType,
  NativeCatalogRecord,
  StreamXtreamCategoryDecodeInput,
  StreamXtreamCategoryDecodeResult,
} from './nativeCatalogDecodeTypes.ts';

export type {
  CatalogDecodeBatchStats,
  CatalogDecodeMediaType,
  NativeCatalogRecord,
  StreamXtreamCategoryDecodeInput,
  StreamXtreamCategoryDecodeResult,
} from './nativeCatalogDecodeTypes.ts';

export { isLikelyUnfilteredCategoryDump } from './nativeCatalogDecodeTypes.ts';

export {
  isCatalogSqliteWriterOnlyDiagnosticEnabled,
  nativeRecordToMovieSummary,
  nativeRecordToSeriesSummary,
} from './nativeCatalogDecodeShared.ts';

const LOG_TAG = '[NovaCast NativeCatalogDecode]';

type NativeModuleShape = {
  startDecodeJob: (options: Record<string, unknown>) => Promise<{ jobId: string; batchSize: number; marker: string }>;
  pullDecodeBatch: (jobId: string) => Promise<{
    jobId: string;
    items: NativeCatalogRecord[];
    done: boolean;
    cancelled?: boolean;
    error?: string | null;
    stats?: CatalogDecodeBatchStats;
  }>;
  cancelDecodeJob: (jobId: string) => Promise<{ cancelled: boolean; jobId: string }>;
  cancelDecodeJobsForProvider?: (providerId: string) => Promise<{ cancelled: number; providerId: string }>;
  getJobRegistrySnapshot?: () => Promise<{
    activeJobCount: number;
    queuedBatchCount: number;
    oldestJobAgeMs: number;
    cancellationCount: number;
    completedJobCleanupCount: number;
  }>;
};

let cached: NativeModuleShape | null | undefined;

function getModule(): NativeModuleShape | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    cached = requireNativeModule<NativeModuleShape>('NovacastCatalogDecode');
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function isNativeCatalogDecodeAvailable(): boolean {
  return getModule() != null;
}

export async function streamXtreamCategoryDecode(
  input: StreamXtreamCategoryDecodeInput,
): Promise<StreamXtreamCategoryDecodeResult> {
  const mod = getModule();
  if (!mod) {
    throw new Error('native_catalog_decode_unavailable');
  }

  const start = await mod.startDecodeJob({
    requestUrl: input.requestUrl,
    mediaType: input.mediaType,
    filterCategoryId: input.filterCategoryId,
    batchSize: input.batchSize ?? 100,
    timeoutMs: input.timeoutMs ?? 90_000,
    providerId: input.providerId,
    expectedProviderId: input.expectedProviderId ?? input.providerId,
    generation: input.generation,
    categoryIndex: input.categoryIndex,
    categoryPosition: input.categoryPosition,
    totalCategoryCount: input.totalCategoryCount,
    requestAttempt: input.requestAttempt ?? 1,
  });

  let matched = 0;
  let batches = 0;
  let maxBatchSize = 0;
  let lastStats: CatalogDecodeBatchStats = {};
  let cancelled = false;
  const startedAt = Date.now();

  try {
    while (true) {
      if (input.isCancelled?.()) {
        await mod.cancelDecodeJob(start.jobId);
        cancelled = true;
        break;
      }

      const batch = await mod.pullDecodeBatch(start.jobId);
      lastStats = batch.stats ?? lastStats;

      if (batch.error && batch.error !== 'job_missing') {
        if (input.mediaType === 'movie') {
          console.info('[NovaCast Movie Decode Audit]', {
            generation: input.generation ?? null,
            categoryIndex: input.categoryIndex ?? null,
            categoryId: input.filterCategoryId,
            categoryPosition: input.categoryPosition ?? null,
            totalCategoryCount: input.totalCategoryCount ?? null,
            requestAttempt: input.requestAttempt ?? 1,
            responseTopLevelType: batch.stats?.responseTopLevelType ?? null,
            arrayLength: batch.stats?.arrayLength ?? null,
            objectKeyNames: batch.stats?.responseKeys ?? [],
            decoderResult: batch.error,
            errorCode: batch.error,
            errorReason: batch.stats?.errorReason ?? null,
            durationMs: Date.now() - startedAt,
          });
        } else if (input.mediaType === 'series') {
          console.info('[NovaCast Series Decoder Audit]', {
            event: 'decoder-failed',
            generation: input.generation ?? null,
            categoryIndex: input.categoryIndex ?? null,
            categoryId: input.filterCategoryId,
            categoryPosition: input.categoryPosition ?? null,
            totalCategoryCount: input.totalCategoryCount ?? null,
            requestAttempt: input.requestAttempt ?? 1,
            decoderStage: 'native-pull-batch',
            exceptionClass: 'NativeCatalogDecodeError',
            exceptionMessage: batch.error,
            sanitizerRepairCount: batch.stats?.sanitizerRepairCount ?? 0,
            fieldName: null,
            valueLength: null,
            valuePreviewSanitized: null,
            durationMs: Date.now() - startedAt,
          });
        }
        await mod.cancelDecodeJob(start.jobId).catch(() => undefined);
        throw new Error(batch.error);
      }

      if (batch.cancelled) {
        cancelled = true;
      }

      const items = Array.isArray(batch.items) ? batch.items : [];
      if (items.length) {
        batches += 1;
        maxBatchSize = Math.max(maxBatchSize, items.length);
        matched += items.length;
        await input.onBatch(items);
      }

      if (batch.done) {
        break;
      }
    }
  } catch (error) {
    await mod.cancelDecodeJob(start.jobId).catch(() => undefined);
    throw error;
  }

  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1') {
    console.info(LOG_TAG, 'category-decode-complete', {
      mediaType: input.mediaType,
      matched,
      batches,
      maxBatchSize,
      cancelled,
      headersMs: lastStats.headersMs,
      downloadParseMs: lastStats.downloadParseMs,
      rawSeen: lastStats.rawSeen,
      responseBytes: lastStats.responseBytes,
    });
  }

  return {
    matched,
    batches,
    maxBatchSize,
    cancelled,
    usedNative: true,
    stats: lastStats,
  };
}

export async function cancelNativeDecodeJobsForProvider(providerId: string): Promise<number> {
  const mod = getModule();
  if (!mod?.cancelDecodeJobsForProvider) {
    return 0;
  }
  const result = await mod.cancelDecodeJobsForProvider(providerId);
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1') {
    console.info(LOG_TAG, 'provider-jobs-cancelled', {
      providerId,
      cancelled: result.cancelled,
    });
  }
  return result.cancelled;
}

export async function getNativeDecodeJobRegistrySnapshot() {
  const mod = getModule();
  if (!mod?.getJobRegistrySnapshot) {
    return {
      activeJobCount: 0,
      queuedBatchCount: 0,
      oldestJobAgeMs: 0,
      cancellationCount: 0,
      completedJobCleanupCount: 0,
    };
  }
  return mod.getJobRegistrySnapshot();
}
