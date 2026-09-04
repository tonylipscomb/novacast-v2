import { isNovaCastTraceLoggingEnabled, novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { isSyntheticLiveFavoritesCategoryId } from '../providers/liveCategoryIdSafety.ts';

export type LiveStartupEvent =
  | 'screen-mounted'
  | 'categories-ready'
  | 'initial-category-selected'
  | 'first-channel-list-ready'
  | 'interactive';

export type LiveCategoryEvent =
  | 'selection-requested'
  | 'selection-accepted'
  | 'selection-rejected'
  | 'load-started'
  | 'load-completed';

export type LivePerformanceSource = 'cache' | 'sqlite' | 'memory' | 'network' | 'repository' | 'unknown';

function safeCategoryId(categoryId: string | null | undefined) {
  const value = String(categoryId ?? '').trim();
  return value || null;
}

export function logLiveStartup(
  event: LiveStartupEvent,
  fields: {
    elapsedMs: number;
    categoryCount?: number;
    channelCount?: number;
    selectedCategoryId?: string | null;
    providerIdPresent?: boolean;
    source?: string;
  } = { elapsedMs: 0 },
) {
  novacastTrace('[NovaCast Live Startup]', {
    event,
    elapsedMs: fields.elapsedMs,
    categoryCount: fields.categoryCount ?? null,
    channelCount: fields.channelCount ?? null,
    selectedCategoryIdPresent: Boolean(fields.selectedCategoryId),
    isSynthetic: isSyntheticLiveFavoritesCategoryId(fields.selectedCategoryId),
    providerIdPresent: fields.providerIdPresent ?? null,
  });
}

export function logLiveCategory(
  event: LiveCategoryEvent,
  fields: {
    categoryId?: string | null;
    channelCount?: number;
    elapsedMs?: number;
    reason?: string;
    source?: string;
  } = {},
) {
  if (event !== 'selection-rejected' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  const categoryId = safeCategoryId(fields.categoryId);
  novacastTrace('[NovaCast Live Category]', {
    event,
    categoryId,
    isSynthetic: isSyntheticLiveFavoritesCategoryId(categoryId),
    channelCount: fields.channelCount ?? null,
    elapsedMs: fields.elapsedMs ?? null,
    ...(fields.reason ? { reason: fields.reason } : {}),
  });
}

export function logLiveFavorites(fields: {
  savedFavoriteCount: number;
  canonicalResolvedCount: number;
  unresolvedCount: number;
  hydrationElapsedMs: number;
  surfQueueCount: number;
  scannedLoadedCount?: number;
  indexLookupCount?: number;
}) {
  novacastTrace('[NovaCast Live Favorites]', {
    savedFavoriteCount: fields.savedFavoriteCount,
    canonicalResolvedCount: fields.canonicalResolvedCount,
    unresolvedCount: fields.unresolvedCount,
    hydrationElapsedMs: fields.hydrationElapsedMs,
    surfQueueCount: fields.surfQueueCount,
    scannedLoadedCount: fields.scannedLoadedCount ?? null,
    indexLookupCount: fields.indexLookupCount ?? null,
  });
}

export function logLiveEpgTrigger(fields: {
  caller: string;
  reason: string;
  categoryId?: string | null;
  channelCount?: number;
}) {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  novacastTrace('[NovaCast Live EPG Trigger]', {
    caller: fields.caller,
    reason: fields.reason,
    categoryId: safeCategoryId(fields.categoryId),
    channelCount: fields.channelCount ?? null,
  });
}

export function logLivePerformance(fields: {
  event: string;
  elapsedMs: number;
  providerIdPresent?: boolean;
  categoryCount?: number;
  channelCount?: number;
  selectedCategoryIdPresent?: boolean;
  source?: LivePerformanceSource;
  epgPending?: boolean;
  discoverPending?: boolean;
}) {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  novacastTrace('[NovaCast Live Performance]', {
    event: fields.event,
    elapsedMs: fields.elapsedMs,
    providerIdPresent: fields.providerIdPresent ?? null,
    categoryCount: fields.categoryCount ?? null,
    channelCount: fields.channelCount ?? null,
    selectedCategoryIdPresent: fields.selectedCategoryIdPresent ?? null,
    source: fields.source ?? 'unknown',
    epgPending: fields.epgPending ?? false,
    discoverPending: fields.discoverPending ?? false,
  });
}

export type LiveCategoryOrderAuditEvent =
  | 'raw-categories-ready'
  | 'sorted-categories-ready'
  | 'categories-state-committed'
  | 'initial-category-resolved'
  | 'category-focus-target-chosen'
  | 'first-category-focus-received';

export type LiveCategorySelectionSource = 'route' | 'persisted-user' | 'auto-default' | 'provisional';

export type LiveCategoryNameSource = 'published-category-name' | 'provider-category-name' | 'synthetic-fallback';

export type LiveCategoryOrderAuditSampleItem = {
  id: string;
  name?: string | null;
  categoryNameUsedForSort?: string | null;
  categoryNameSource?: LiveCategoryNameSource | null;
  regionBucket?: string | null;
  sortLabel?: string | null;
};

declare const __DEV__: boolean | undefined;

// TEMP DEV-only category ordering/selection/focus race audit. Caps the sample
// so a 913-category catalog never floods logs.
export function logLiveCategoryOrderAudit(
  event: LiveCategoryOrderAuditEvent,
  fields: {
    providerId?: string | null;
    generation?: number | null;
    categoryCount?: number | null;
    sample?: ReadonlyArray<LiveCategoryOrderAuditSampleItem>;
    finalSortedNames?: readonly string[];
    selectedCategoryId?: string | null;
    selectedCategoryName?: string | null;
    selectionSource?: LiveCategorySelectionSource | null;
    orderReady?: boolean;
    orderToken?: string | number | null;
  } = {},
) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.info('[NovaCast Live Category Order Audit]', {
    event,
    providerId: fields.providerId ?? null,
    generation: fields.generation ?? null,
    categoryCount: fields.categoryCount ?? null,
    first10: (fields.sample ?? []).slice(0, 10).map((category) => ({
      categoryId: category.id,
      name: category.name ?? null,
      categoryNameUsedForSort: category.categoryNameUsedForSort ?? category.name ?? null,
      categoryNameSource: category.categoryNameSource ?? null,
      regionBucket: category.regionBucket ?? null,
      sortLabel: category.sortLabel ?? null,
    })),
    ...(fields.finalSortedNames ? { finalSortedNames: fields.finalSortedNames.slice(0, 20) } : {}),
    selectedCategoryId: fields.selectedCategoryId ?? null,
    selectedCategoryName: fields.selectedCategoryName ?? null,
    selectionSource: fields.selectionSource ?? null,
    orderReady: fields.orderReady ?? null,
    orderToken: fields.orderToken ?? null,
  });
}

export type LiveStabilityLoaderEvent =
  | 'shown'
  | 'categories-named'
  | 'categories-sorted'
  | 'selection-resolved'
  | 'focus-target-ready'
  | 'hidden';

// TEMP DEV-only Live startup stability-loader lifecycle audit.
export function logLiveStabilityLoader(
  event: LiveStabilityLoaderEvent,
  fields: {
    elapsedMs?: number | null;
    namesResolved?: boolean;
    categoryOrderReady?: boolean;
    selectionResolved?: boolean;
    focusTargetReady?: boolean;
    categoryCount?: number | null;
    selectedCategoryId?: string | null;
  } = {},
) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.info('[NovaCast Live Stability Loader]', {
    event,
    elapsedMs: fields.elapsedMs ?? null,
    readiness: {
      namesResolved: fields.namesResolved ?? null,
      categoryOrderReady: fields.categoryOrderReady ?? null,
      selectionResolved: fields.selectionResolved ?? null,
      focusTargetReady: fields.focusTargetReady ?? null,
    },
    categoryCount: fields.categoryCount ?? null,
    selectedCategoryId: fields.selectedCategoryId ?? null,
  });
}

export function logLiveStallAudit(operation: string, inputCount: number, startedAt: number) {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < 50) {
    return elapsedMs;
  }

  const bucket = elapsedMs >= 1000 ? '>1000' : elapsedMs >= 500 ? '>500' : elapsedMs >= 250 ? '>250' : elapsedMs >= 100 ? '>100' : '>50';
  if (elapsedMs < 1000 && !isNovaCastTraceLoggingEnabled()) {
    return elapsedMs;
  }
  novacastTrace('[NovaCast Live Stall Audit]', {
    operation,
    inputCount,
    elapsedMs,
    bucket,
  });
  return elapsedMs;
}
