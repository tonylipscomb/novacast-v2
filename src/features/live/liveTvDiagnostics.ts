import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';
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
  } = { elapsedMs: 0 },
) {
  console.info('[NovaCast Live Startup]', {
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
  } = {},
) {
  if (event !== 'selection-rejected' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  const categoryId = safeCategoryId(fields.categoryId);
  console.info('[NovaCast Live Category]', {
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
  console.info('[NovaCast Live Favorites]', {
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
  console.info('[NovaCast Live EPG Trigger]', {
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
  console.info('[NovaCast Live Performance]', {
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

export function logLiveStallAudit(operation: string, inputCount: number, startedAt: number) {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < 50) {
    return elapsedMs;
  }

  const bucket = elapsedMs >= 1000 ? '>1000' : elapsedMs >= 500 ? '>500' : elapsedMs >= 250 ? '>250' : elapsedMs >= 100 ? '>100' : '>50';
  if (elapsedMs < 1000 && !isNovaCastTraceLoggingEnabled()) {
    return elapsedMs;
  }
  console.info('[NovaCast Live Stall Audit]', {
    operation,
    inputCount,
    elapsedMs,
    bucket,
  });
  return elapsedMs;
}
