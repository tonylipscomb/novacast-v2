/* eslint-disable react-hooks/set-state-in-effect -- Provider-backed screens load async repository data in effects. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getLiveTvMemory } from '@/features/live/liveTvMemory';
import { getLiveFavoriteEntries, usePersonalizationStore } from '@/features/personalization/personalizationStore';
import {
  fetchGuideRowsForChannels,
  XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
  XTREAM_GUIDE_EPG_LIMIT,
  XTREAM_GUIDE_MAX_LOADED_CHANNELS,
  type ProviderGuideRow,
  type ProviderLiveCategory,
  type ProviderLiveChannel,
} from '@/features/providers/providerRepositories';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import type { ProviderRepositoryBundle } from '@/features/providers/providerBundle';

import { applyGuideCategoryResult, GUIDE_FAVORITES_CATEGORY_ID, statusForRows, type GuideLoadStatus } from './guideLogic';
import { getGuideMemory, rememberGuideMemory } from './guideMemory';
import { getGuideWindow, normalizeGuideRows, type NormalizedGuideRow } from './guideTimeline';

/** Synthetic category prepended before provider categories, mirroring Live TV's category rail. */
export const GUIDE_ALL_CATEGORY_ID = 'all';
export { GUIDE_FAVORITES_CATEGORY_ID };
export type { GuideLoadStatus };

type GuideCacheEntry = {
  rows: NormalizedGuideRow[];
  hasMore: boolean;
  totalCount: number | null;
};

const guideCache = new Map<string, GuideCacheEntry>();

/** `guideCache` must be scoped per category, not just per provider. */
function cacheKey(providerId: string, categoryId: string) {
  return `${providerId}:${categoryId}`;
}

export function clearGuideScreenCache() {
  guideCache.clear();
}

function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * Resolve favorite channels via the shared live-stream cache (one catalog download),
 * then fetch EPG once for that list — not N full-catalog downloads.
 */
async function loadFavoriteGuideRows(bundle: ProviderRepositoryBundle, signal?: AbortSignal): Promise<ProviderGuideRow[]> {
  const entries = await getLiveFavoriteEntries(bundle.providerId);
  if (!entries.length || signal?.aborted) {
    return [];
  }

  // getChannel shares the all-streams cache, so parallel lookups only download the catalog once.
  const channels = (
    await Promise.all(entries.map((entry) => bundle.live.getChannel(entry.contentId, signal).catch(() => null)))
  ).filter((channel): channel is ProviderLiveChannel => Boolean(channel));

  if (!channels.length) {
    return [];
  }

  // Cap favorites so a huge favorites list cannot flood the Guide grid.
  const capped = channels.slice(0, XTREAM_GUIDE_MAX_LOADED_CHANNELS);
  return fetchGuideRowsForChannels(bundle.live, capped, XTREAM_GUIDE_EPG_LIMIT, signal);
}

export function useGuideScreenModel() {
  const { bundle } = useActiveProviderBundle();
  const providerId = bundle?.providerId ?? 'no-provider';
  const { state: personalizationState } = usePersonalizationStore(providerId);
  const favoritesAvailable = personalizationState.liveFavorites.length > 0;

  const [baseCategories, setBaseCategories] = useState<ProviderLiveCategory[]>([]);
  const [categoriesStatus, setCategoriesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedCategoryTotalCount, setSelectedCategoryTotalCount] = useState<number | null>(null);
  const [status, setStatus] = useState<GuideLoadStatus>('loading');
  const [rows, setRows] = useState<NormalizedGuideRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const rowsRef = useRef<NormalizedGuideRow[]>([]);
  const selectedCategoryIdRef = useRef('');
  const loadAbortRef = useRef<AbortController | null>(null);

  const categories = useMemo<ProviderLiveCategory[]>(() => {
    const countsKnown = baseCategories.length > 0 && baseCategories.every((category) => category.count != null);
    const allCategory: ProviderLiveCategory = {
      id: GUIDE_ALL_CATEGORY_ID,
      renderKey: GUIDE_ALL_CATEGORY_ID,
      name: 'All Channels',
      count: countsKnown ? baseCategories.reduce((total, category) => total + (category.count ?? 0), 0) : null,
      icon: 'earth',
    };
    const favoritesCategory: ProviderLiveCategory[] = favoritesAvailable
      ? [
          {
            id: GUIDE_FAVORITES_CATEGORY_ID,
            renderKey: GUIDE_FAVORITES_CATEGORY_ID,
            name: 'Favorites',
            count: personalizationState.liveFavorites.length,
            icon: 'star-outline' as const,
          },
        ]
      : [];

    return [allCategory, ...favoritesCategory, ...baseCategories];
  }, [baseCategories, favoritesAvailable, personalizationState.liveFavorites.length]);

  const applyResult = useCallback(
    (
      categoryId: string,
      requestId: number,
      nextRows: NormalizedGuideRow[],
      hasMoreLocal: boolean,
      totalCount: number | null,
      append: boolean,
    ) => {
      const result = applyGuideCategoryResult(rowsRef.current, {
        requestId,
        currentRequestId: requestRef.current,
        categoryId,
        nextRows,
        hasMore: hasMoreLocal,
        totalCount,
        append,
        favoritesAvailable,
      });

      if (!result.applied) {
        return;
      }

      rowsRef.current = result.rows;
      guideCache.set(cacheKey(providerId, categoryId), { rows: result.rows, hasMore: result.hasMore, totalCount: result.totalCount });
      setRows(result.rows);
      setHasMore(result.hasMore);
      setSelectedCategoryTotalCount(result.totalCount);
      setStatus(result.status);
      setErrorMessage(null);
      setIsRefreshing(false);
    },
    [favoritesAvailable, providerId],
  );

  const loadCategoryPage = useCallback(
    async (categoryId: string, offset: number, requestId: number, append: boolean, signal: AbortSignal) => {
      if (!bundle) {
        return;
      }

      try {
        if (categoryId === GUIDE_FAVORITES_CATEGORY_ID) {
          if (offset > 0) {
            return;
          }
          const favoriteRows = await loadFavoriteGuideRows(bundle, signal);
          if (requestId !== requestRef.current || signal.aborted) {
            return;
          }
          const normalized = normalizeGuideRows(favoriteRows);
          applyResult(categoryId, requestId, normalized, false, normalized.length, append);
          return;
        }

        const providerCategoryId = categoryId === GUIDE_ALL_CATEGORY_ID ? undefined : categoryId;
        const cachedTotal = guideCache.get(cacheKey(providerId, categoryId))?.totalCount ?? null;
        const alreadyLoaded = append ? rowsRef.current.length : 0;
        const remainingBudget = XTREAM_GUIDE_MAX_LOADED_CHANNELS - alreadyLoaded;
        if (remainingBudget <= 0) {
          applyResult(categoryId, requestId, [], false, cachedTotal, append);
          return;
        }

        const channelLimit = Math.min(XTREAM_GUIDE_CHANNEL_PAGE_SIZE, remainingBudget);
        // Channel count shares the live-stream cache with getRows — no second catalog download.
        // Skip on append; only needed for the first page (and __DEV__ progress hint).
        const countPromise = append
          ? Promise.resolve(cachedTotal)
          : (bundle.guide.getChannelCount?.(providerCategoryId, signal).catch(() => null) ?? Promise.resolve(null));

        const [pageRows, totalCount] = await Promise.all([
          bundle.guide.getRows(signal, {
            categoryId: providerCategoryId,
            channelOffset: offset,
            channelLimit,
          }),
          countPromise,
        ]);
        if (requestId !== requestRef.current || signal.aborted) {
          return;
        }

        const normalized = normalizeGuideRows(pageRows);
        const loadedAfter = alreadyLoaded + normalized.length;
        const hasMoreLocal =
          pageRows.length >= channelLimit && loadedAfter < XTREAM_GUIDE_MAX_LOADED_CHANNELS;
        applyResult(categoryId, requestId, normalized, hasMoreLocal, totalCount, append);
      } catch (error) {
        if (requestId !== requestRef.current || signal.aborted || isAbortError(error)) {
          return;
        }
        if (!append && !rowsRef.current.length) {
          rowsRef.current = [];
          setRows([]);
          setStatus('error');
          setErrorMessage('Unable to load guide data from your provider.');
          setIsRefreshing(false);
        } else if (!append) {
          setIsRefreshing(false);
        }
      }
    },
    [applyResult, bundle, providerId],
  );

  const beginCategoryLoad = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    return controller.signal;
  }, []);

  const selectCategory = useCallback(
    (categoryId: string) => {
      if (!categoryId || !bundle || categoryId === selectedCategoryIdRef.current) {
        return;
      }

      const signal = beginCategoryLoad();
      const requestId = ++requestRef.current;
      selectedCategoryIdRef.current = categoryId;
      setSelectedCategoryId(categoryId);
      rememberGuideMemory(providerId, { selectedCategoryId: categoryId });

      const cached = guideCache.get(cacheKey(providerId, categoryId));
      if (cached?.rows.length) {
        // Prefer cached pages for large catalogs — avoid re-downloading / re-EPG on every category revisit.
        rowsRef.current = cached.rows;
        setRows(cached.rows);
        setHasMore(cached.hasMore);
        setSelectedCategoryTotalCount(cached.totalCount);
        setStatus(statusForRows(categoryId, cached.rows, favoritesAvailable));
        setErrorMessage(null);
        setIsRefreshing(false);
        return;
      }

      rowsRef.current = [];
      setRows([]);
      setHasMore(false);
      setSelectedCategoryTotalCount(null);
      setStatus('loading');
      setErrorMessage(null);
      setIsRefreshing(false);
      void loadCategoryPage(categoryId, 0, requestId, false, signal);
    },
    [beginCategoryLoad, bundle, favoritesAvailable, loadCategoryPage, providerId],
  );

  const loadCategories = useCallback(async () => {
    if (!bundle) {
      setCategoriesStatus('error');
      setStatus('error');
      setErrorMessage('Provider is not connected.');
      return;
    }

    const signal = beginCategoryLoad();
    const requestId = ++requestRef.current;
    setCategoriesStatus('loading');
    setIsRefreshing(false);
    try {
      const nextCategories = await bundle.live.getCategories(signal);
      if (requestId !== requestRef.current || signal.aborted) {
        return;
      }

      setBaseCategories(nextCategories);
      setCategoriesStatus('ready');

      const guideMemory = getGuideMemory(bundle.providerId);
      const liveMemory = getLiveTvMemory(bundle.providerId);
      const availableIds = new Set([
        GUIDE_ALL_CATEGORY_ID,
        ...(favoritesAvailable ? [GUIDE_FAVORITES_CATEGORY_ID] : []),
        ...nextCategories.map((category) => category.id),
      ]);

      const resolvedCategoryId =
        (guideMemory.selectedCategoryId && availableIds.has(guideMemory.selectedCategoryId) && guideMemory.selectedCategoryId) ||
        (liveMemory.selectedCategoryId && availableIds.has(liveMemory.selectedCategoryId) && liveMemory.selectedCategoryId) ||
        // Prefer a real category over All Channels — All can be 10k+ streams and is too heavy for first paint.
        nextCategories[0]?.id ||
        GUIDE_ALL_CATEGORY_ID;

      // selectCategory no-ops when id matches selectedCategoryIdRef — clear so initial pick always loads.
      selectedCategoryIdRef.current = '';
      selectCategory(resolvedCategoryId);
    } catch (error) {
      if (requestId !== requestRef.current || signal.aborted || isAbortError(error)) {
        return;
      }
      setCategoriesStatus('error');
      setStatus('error');
      setErrorMessage('Unable to load guide categories from your provider.');
    }
  }, [beginCategoryLoad, bundle, favoritesAvailable, selectCategory]);

  useEffect(() => {
    void loadCategories();
    return () => {
      loadAbortRef.current?.abort();
      requestRef.current += 1;
    };
  }, [bundle?.generation, loadCategories]);

  const loadMore = useCallback(async () => {
    if (!bundle || !hasMore || loadingMoreRef.current || !rowsRef.current.length) return;
    if (selectedCategoryIdRef.current === GUIDE_FAVORITES_CATEGORY_ID) return;

    const signal = loadAbortRef.current?.signal;
    if (!signal || signal.aborted) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const requestId = requestRef.current;
    const categoryId = selectedCategoryIdRef.current;
    const offset = rowsRef.current.length;
    try {
      await loadCategoryPage(categoryId, offset, requestId, true, signal);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [bundle, hasMore, loadCategoryPage]);

  const reload = useCallback(() => {
    if (!bundle) {
      return;
    }

    if (!selectedCategoryIdRef.current || categoriesStatus === 'error') {
      void loadCategories();
      return;
    }

    const categoryId = selectedCategoryIdRef.current;
    guideCache.delete(cacheKey(providerId, categoryId));
    const signal = beginCategoryLoad();
    const requestId = ++requestRef.current;
    rowsRef.current = [];
    setRows([]);
    setHasMore(false);
    setStatus('loading');
    setErrorMessage(null);
    setIsRefreshing(false);
    void loadCategoryPage(categoryId, 0, requestId, false, signal);
  }, [beginCategoryLoad, bundle, categoriesStatus, loadCategories, loadCategoryPage, providerId]);

  const timeline = useMemo(() => getGuideWindow(rows), [rows]);
  const timeSlots = useMemo(() => {
    const slots: number[] = [];
    for (let timestamp = timeline.startAt; timestamp < timeline.endAt; timestamp += 60 * 60 * 1000) {
      slots.push(timestamp);
    }
    return slots;
  }, [timeline]);

  return {
    bundle,
    status: bundle ? status : 'error',
    rows,
    errorMessage: bundle ? errorMessage : 'Provider is not connected.',
    timeline,
    timeSlots,
    reload,
    loadMore,
    hasMore,
    isLoadingMore,
    isRefreshing,
    categories,
    categoriesStatus,
    selectedCategoryId,
    selectCategory,
    selectedCategoryTotalCount,
  };
}
