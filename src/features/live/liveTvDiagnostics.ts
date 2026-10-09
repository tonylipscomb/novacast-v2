import { isNovaCastTraceLoggingEnabled, novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { isSyntheticLiveFavoritesCategoryId } from '../providers/liveCategoryIdSafety.ts';
import { recordLivePerformanceEvent } from '../diagnostics/livePerformanceTelemetry';

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

type LiveNavigationSummary = {
  startedAt: number;
  verticalKeyDownCount: number;
  channelFocusCount: number;
  directionChanges: number;
  maxNativeKeyGapMs: number | null;
  visibleZeroCount: number;
  unexpectedRegionTransitionCount: number;
  nativeRefMissCount: number;
  restoreCount: number;
  lastDirection: string | null;
  lastSummaryAt: number;
};

const liveNavigationSummary: LiveNavigationSummary = {
  startedAt: Date.now(),
  verticalKeyDownCount: 0,
  channelFocusCount: 0,
  directionChanges: 0,
  maxNativeKeyGapMs: null,
  visibleZeroCount: 0,
  unexpectedRegionTransitionCount: 0,
  nativeRefMissCount: 0,
  restoreCount: 0,
  lastDirection: null,
  lastSummaryAt: 0,
};

export function recordLiveNavigationMetric(
  metric: 'vertical-key-down' | 'channel-focus' | 'visible-zero' | 'unexpected-region-transition' | 'native-ref-miss' | 'restore',
  fields: { direction?: string | null; nativeDeltaMs?: number | null } = {},
) {
  if (metric === 'vertical-key-down') {
    liveNavigationSummary.verticalKeyDownCount += 1;
    if (fields.direction && liveNavigationSummary.lastDirection && fields.direction !== liveNavigationSummary.lastDirection) {
      liveNavigationSummary.directionChanges += 1;
    }
    if (fields.direction) liveNavigationSummary.lastDirection = fields.direction;
    if (fields.nativeDeltaMs != null && fields.nativeDeltaMs >= 0) {
      liveNavigationSummary.maxNativeKeyGapMs = Math.max(liveNavigationSummary.maxNativeKeyGapMs ?? 0, fields.nativeDeltaMs);
    }
  } else if (metric === 'channel-focus') {
    liveNavigationSummary.channelFocusCount += 1;
  } else if (metric === 'visible-zero') {
    liveNavigationSummary.visibleZeroCount += 1;
  } else if (metric === 'unexpected-region-transition') {
    liveNavigationSummary.unexpectedRegionTransitionCount += 1;
  } else if (metric === 'native-ref-miss') {
    liveNavigationSummary.nativeRefMissCount += 1;
  } else if (metric === 'restore') {
    liveNavigationSummary.restoreCount += 1;
  }

  const totalHotEvents = liveNavigationSummary.verticalKeyDownCount + liveNavigationSummary.channelFocusCount;
  const now = Date.now();
  if (totalHotEvents >= 50 && now - liveNavigationSummary.lastSummaryAt >= 2_000) {
    liveNavigationSummary.lastSummaryAt = now;
    console.info('[NOVACAST_PERF] live_navigation_summary', {
      durationMs: now - liveNavigationSummary.startedAt,
      verticalKeyDownCount: liveNavigationSummary.verticalKeyDownCount,
      channelFocusCount: liveNavigationSummary.channelFocusCount,
      directionChanges: liveNavigationSummary.directionChanges,
      maxNativeKeyGapMs: liveNavigationSummary.maxNativeKeyGapMs,
      visibleZeroCount: liveNavigationSummary.visibleZeroCount,
      unexpectedRegionTransitionCount: liveNavigationSummary.unexpectedRegionTransitionCount,
      nativeRefMissCount: liveNavigationSummary.nativeRefMissCount,
      restoreCount: liveNavigationSummary.restoreCount,
    });
  }
}

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
  recordLivePerformanceEvent('live_entry_milestone', {
    milestone: event,
    elapsedMs: fields.elapsedMs,
    categoryCount: fields.categoryCount ?? null,
    channelCount: fields.channelCount ?? null,
  });
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

export function logLiveNavPerf(
  event: string,
  fields: {
    categoryId?: string | null;
    channelCount?: number | null;
    visibleRowCount?: number | null;
    elapsedMs?: number | null;
    renderVersion?: number | null;
    focusedChannelId?: string | null;
    requestedChannelId?: string | null;
    generation?: number | null;
    focusedIndex?: number | null;
    currentVisibleRange?: { first: number; last: number } | null;
    trustedVisibleRange?: { first: number; last: number } | null;
    lastValidVisibleRange?: { first: number; last: number } | null;
    bandFirst?: number | null;
    bandLast?: number | null;
    totalChannelCount?: number | null;
    channelId?: string | null;
    index?: number | null;
    distanceFromFocusedIndex?: number | null;
    previousHandlePresent?: boolean;
    nextHandlePresent?: boolean;
    action?: string | null;
    selectedChannelId?: string | null;
    rowMounted?: boolean;
    nativeRefPresent?: boolean;
    listKey?: string | null;
    lastNavigationIntent?: string | null;
    timestamp?: number | null;
    currentVisibleCount?: number | null;
    ageOfLastValidRangeMs?: number | null;
    shouldScroll?: boolean;
    reason?: string | null;
  } = {},
) {
  if (event === 'channel-focus') {
    recordLiveNavigationMetric('channel-focus');
    return;
  }
  if (event === 'native-focus-scroll-owned') return;
  if (event === 'visible-channel-list-change') {
    if (fields.visibleRowCount === 0) {
      recordLiveNavigationMetric('visible-zero');
    } else {
      return;
    }
  }
  if (event === 'channel-native-ref') {
    const isFailure =
      (fields.action === 'unmount' && fields.index === fields.focusedIndex) ||
      fields.nativeRefPresent === false ||
      fields.previousHandlePresent === false ||
      fields.nextHandlePresent === false;
    if (!isFailure) return;
    if (fields.nativeRefPresent === false || fields.previousHandlePresent === false || fields.nextHandlePresent === false) {
      recordLiveNavigationMetric('native-ref-miss');
    }
  }
  console.info('[NovaCast Live Nav Perf]', event, {
    categoryId: safeCategoryId(fields.categoryId),
    channelCount: fields.channelCount ?? null,
    visibleRowCount: fields.visibleRowCount ?? null,
    elapsedMs: fields.elapsedMs ?? null,
    renderVersion: fields.renderVersion ?? null,
    focusedChannelId: fields.focusedChannelId ?? null,
    requestedChannelId: fields.requestedChannelId ?? null,
    generation: fields.generation ?? null,
    focusedIndex: fields.focusedIndex ?? null,
    currentVisibleRange: fields.currentVisibleRange ?? null,
    trustedVisibleRange: fields.trustedVisibleRange ?? null,
    lastValidVisibleRange: fields.lastValidVisibleRange ?? null,
    bandFirst: fields.bandFirst ?? null,
    bandLast: fields.bandLast ?? null,
    totalChannelCount: fields.totalChannelCount ?? null,
    channelId: fields.channelId ?? null,
    index: fields.index ?? null,
    distanceFromFocusedIndex: fields.distanceFromFocusedIndex ?? null,
    previousHandlePresent: fields.previousHandlePresent ?? null,
    nextHandlePresent: fields.nextHandlePresent ?? null,
    action: fields.action ?? null,
    selectedChannelId: fields.selectedChannelId ?? null,
    rowMounted: fields.rowMounted ?? null,
    nativeRefPresent: fields.nativeRefPresent ?? null,
    listKey: fields.listKey ?? null,
    lastNavigationIntent: fields.lastNavigationIntent ?? null,
    timestamp: fields.timestamp ?? null,
    currentVisibleCount: fields.currentVisibleCount ?? null,
    ageOfLastValidRangeMs: fields.ageOfLastValidRangeMs ?? null,
    shouldScroll: fields.shouldScroll ?? null,
    reason: fields.reason ?? null,
  });
}

export function logLiveFocusPerf(fields: {
  channelId: string | null;
  previousChannelId: string | null;
  categoryId?: string | null;
  deltaMs?: number | null;
  sameLogicalTarget: boolean;
  source: string;
  navigationActive?: boolean;
}) {
  if (fields.source === 'channel-row-onFocus') {
    return;
  }
  console.info('[NovaCast Live Focus Perf]', {
    channelId: fields.channelId,
    previousChannelId: fields.previousChannelId,
    categoryId: safeCategoryId(fields.categoryId),
    deltaMs: fields.deltaMs ?? null,
    sameLogicalTarget: fields.sameLogicalTarget,
    source: fields.source,
    navigationActive: fields.navigationActive ?? null,
  });
}

export function logLiveDerivePerf(fields: {
  categoryId: string;
  totalProviderChannels: number | null;
  categoryChannelCount: number;
  categoryLookupMs: number;
  filterMs: number;
  sortMs: number;
  normalizeMs: number;
  decorationMs: number;
  modelBuildMs: number;
  totalMs: number;
  cacheHit: boolean;
}) {
  console.info('[NovaCast Live Derive Perf]', fields);
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
