export type CatalogDecodeMediaType = 'movie' | 'series';

export type NativeCatalogRecord = {
  mediaType: CatalogDecodeMediaType;
  contentId: string;
  categoryId?: string | null;
  title: string;
  artworkUrl?: string | null;
  backdropUrl?: string | null;
  rating?: string | number | null;
  releaseDate?: string | null;
  streamExtension?: string | null;
  providerSortOrder?: number | null;
  seriesId?: string | null;
};

export type CatalogDecodeBatchStats = {
  headersMs?: number;
  downloadParseMs?: number;
  responseBytes?: number;
  rawSeen?: number;
  matched?: number;
  emptyCategoryIdCount?: number;
  batchesEmitted?: number;
  maxBatchSize?: number;
  batchSize?: number;
  mediaType?: string;
};

/** Panels that ignore category_id= return nearly the full dump for every category request. */
export function isLikelyUnfilteredCategoryDump(stats: {
  rawSeen?: number;
  matched?: number;
  emptyCategoryIdCount?: number;
}): boolean {
  const rawSeen = Number(stats.rawSeen ?? 0);
  const matched = Number(stats.matched ?? 0);
  if (rawSeen < 1500 || matched < 1500) {
    return false;
  }
  return matched >= Math.floor(rawSeen * 0.9);
}

export type StreamXtreamCategoryDecodeInput = {
  requestUrl: string;
  mediaType: CatalogDecodeMediaType;
  filterCategoryId: string;
  providerId: string;
  expectedProviderId?: string;
  batchSize?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
};

export type StreamXtreamCategoryDecodeResult = {
  matched: number;
  batches: number;
  maxBatchSize: number;
  cancelled: boolean;
  usedNative: true;
  stats: CatalogDecodeBatchStats;
};
