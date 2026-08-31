import { processTimeBudgeted, type TimeBudgetResult } from '../catalog/jsChunkBudget.ts';
import type { NativeCatalogRecord } from '../catalog/nativeCatalogDecodeTypes.ts';
import {
  LIVE_UNKNOWN_CATEGORY_ID,
  nativeRecordToLiveChannel,
} from './liveCatalogCompletion.ts';

export type LiveNormalizationResult = {
  channels: Array<ReturnType<typeof nativeRecordToLiveChannel>>;
  unknownCategoryAssignedCount: number;
  timing: TimeBudgetResult;
};

export async function normalizeLiveDumpChannelsCooperatively(input: {
  records: readonly NativeCatalogRecord[];
  metadataCategoryIds: Iterable<string>;
  isCancelled?: () => boolean;
}): Promise<LiveNormalizationResult> {
  const metadataIds = new Set(
    Array.from(input.metadataCategoryIds)
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  const channels: Array<ReturnType<typeof nativeRecordToLiveChannel>> = [];
  let unknownCategoryAssignedCount = 0;

  console.info('[NovaCast Live Normalization]', JSON.stringify({
    event: 'live-normalization-start',
    timestamp: Date.now(),
    totalRows: input.records.length,
    dedupeStrategy: 'native-decode-Map-by-canonical-id',
    categoryIndexStrategy: 'precomputed-Set',
    sortStrategy: 'provider-order-no-sort',
  }));

  let yieldMs = 0;
  const timing = await processTimeBudgeted(
    input.records,
    (record, index) => {
      const channel = nativeRecordToLiveChannel(record, index);
      if (!channel.id) {
        return;
      }
      channels.push(channel);
      if (!metadataIds.has(channel.categoryId) || channel.categoryId === LIVE_UNKNOWN_CATEGORY_ID) {
        unknownCategoryAssignedCount += 1;
      }
    },
    {
      kind: 'liveNormalization',
      targetMs: 8,
      softMs: 50,
      hardMs: 100,
      minItems: 16,
      maxItems: 300,
      isCancelled: input.isCancelled,
      onYield: (elapsedMs) => {
        yieldMs = elapsedMs;
      },
      onChunk: (info) => {
        console.info('[NovaCast Live Normalization]', JSON.stringify({
          event: 'live-normalization-segment',
          timestamp: Date.now(),
          processedRows: info.processed,
          totalRows: input.records.length,
          segmentMs: Math.round(info.chunkMs),
          yieldMs: Math.round(yieldMs),
          remainingRows: Math.max(0, input.records.length - info.processed),
        }));
        if (info.chunkMs > 50) {
          console.warn('[NovaCast Live Normalization]', JSON.stringify({
            event: 'live-normalization-pressure',
            timestamp: Date.now(),
            processedRows: info.processed,
            segmentMs: Math.round(info.chunkMs),
          }));
        }
        yieldMs = 0;
      },
    },
  );

  console.info('[NovaCast Live Normalization]', JSON.stringify({
    event: 'live-normalization-complete',
    timestamp: Date.now(),
    processedRows: timing.processed,
    totalRows: input.records.length,
    totalNormalizeMs: Math.round(timing.totalMs),
    maxSegmentMs: Math.round(timing.maxChunkMs),
    yieldCount: Math.max(0, timing.chunks - 1),
    outputRows: channels.length,
  }));

  return { channels, unknownCategoryAssignedCount, timing };
}
