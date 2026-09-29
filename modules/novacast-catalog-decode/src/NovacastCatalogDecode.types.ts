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

export type CatalogDecodeJobStart = {
  jobId: string;
  batchSize: number;
  marker: string;
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

export type CatalogDecodeBatch = {
  jobId: string;
  items: NativeCatalogRecord[];
  done: boolean;
  cancelled?: boolean;
  error?: string | null;
  stats?: CatalogDecodeBatchStats;
};

export type StartCatalogDecodeOptions = {
  requestUrl: string;
  mediaType: CatalogDecodeMediaType;
  filterCategoryId?: string | null;
  batchSize?: number;
  timeoutMs?: number;
  providerId?: string;
  expectedProviderId?: string;
  generation?: number;
  categoryIndex?: number;
  categoryPosition?: number;
  totalCategoryCount?: number;
  requestAttempt?: number;
};
