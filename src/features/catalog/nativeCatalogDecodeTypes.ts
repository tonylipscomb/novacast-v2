export type CatalogDecodeMediaType = 'movie' | 'series';

export type NativeCatalogRecord = {
  mediaType: CatalogDecodeMediaType;
  contentId: string;
  categoryId?: string | null;
  /** Series dump only. Present when the provider row includes a category label. */
  categoryName?: string | null;
  title: string;
  artworkUrl?: string | null;
  backdropUrl?: string | null;
  rating?: string | number | null;
  addedAt?: number | null;
  popularity?: number | null;
  releaseDate?: string | null;
  releaseYear?: number | null;
  streamExtension?: string | null;
  /** Live dump only. Exact provider direct_source when present. Never log. */
  directSource?: string | null;
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
  responseTopLevelType?: string;
  responseKeys?: string[];
  arrayLength?: number;
  errorReason?: string;
  sanitizerRepairCount?: number;
  firstItemKeys?: string[];
  firstItemPlaybackHint?: {
    fieldNames?: string[];
    directSourcePresent?: boolean;
    containerExtensionKeyPresent?: boolean;
    containerExtension?: string | null;
    streamType?: string | null;
    customSidPresent?: boolean;
    urlLikeFieldPresent?: boolean;
    streamId?: string | null;
    categoryId?: string | null;
  };
  seriesCategoryNameFieldPresentCount?: number;
  httpStatus?: number;
  contentLengthHeader?: number;
  bytesRead?: number;
  decoderStage?: string;
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

export type CatalogNetworkGateDecodeFields = {
  runId?: string | null;
  catalogNetworkMediaType?: 'movie' | 'series' | 'live';
  catalogNetworkOperation?: string;
  /** Set only when the caller already holds `withProviderCatalogNetworkGate`. */
  skipCatalogNetworkGate?: boolean;
};

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
  generation?: number;
  categoryIndex?: number;
  categoryPosition?: number;
  totalCategoryCount?: number;
  requestAttempt?: number;
} & CatalogNetworkGateDecodeFields;

export type StreamXtreamCategoryDecodeResult = {
  matched: number;
  batches: number;
  maxBatchSize: number;
  cancelled: boolean;
  usedNative: true;
  stats: CatalogDecodeBatchStats;
};
