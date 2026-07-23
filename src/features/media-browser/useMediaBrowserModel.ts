import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MediaCategory } from './mediaTypes';
import type { ContentSortOption } from './contentSorting';
import { buildContentSortRequestKey } from './contentSortRequest';
import { findDefaultBrowseCategoryId, normalizeSelectedSmartCategoryId } from './mediaCategoryUtils';

export type MediaDataSource<TItem> = {
  getCategories(): Promise<MediaCategory[]>;
  getItemsPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }): Promise<{
    items: TItem[];
    totalCount: number;
    hasMore: boolean;
  }>;
  searchItems?(input: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{
    items: TItem[];
    totalCount: number;
    hasMore: boolean;
  }>;
  getCategoryCount?(categoryId: string): Promise<number>;
  prefetchAllCategoryCounts?(
    categoryIds: string[],
    onCategoryCount: (categoryId: string, count: number) => void,
  ): Promise<void>;
};

export type MediaBrowserModelOptions = {
  initialSelectedCategoryId?: string;
  initialFocusedItemId?: string | null;
  initialSelectedItemId?: string | null;
  pageSize?: number;
  sortOption?: ContentSortOption;
  providerId?: string;
};

export type MediaLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

function uniqueItems<T extends { id: string }>(existing: T[], incoming: T[]) {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}

function applyCategoryCount(categories: MediaCategory[], categoryId: string, count: number) {
  return categories.map((category) => (category.id === categoryId ? { ...category, count, countKnown: true } : category));
}

function isSelectableCategory(category: MediaCategory) {
  return category.kind !== 'section';
}

export function useMediaBrowserModel<TItem extends { id: string }>(
  dataSource: MediaDataSource<TItem> | null | undefined,
  options: MediaBrowserModelOptions = {},
) {
  const pageSize = options.pageSize ?? 48;
  const sortOption = options.sortOption ?? 'newest';
  const providerId = options.providerId ?? 'unknown-provider';
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    normalizeSelectedSmartCategoryId(options.initialSelectedCategoryId) ?? '',
  );
  const [visibleItems, setVisibleItems] = useState<TItem[]>([]);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(options.initialFocusedItemId ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(options.initialSelectedItemId ?? null);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<MediaLoadStatus>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [categoryHasRatings, setCategoryHasRatings] = useState(true);

  const offsetRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const loadStatusRef = useRef<MediaLoadStatus>(loadStatus);
  loadStatusRef.current = loadStatus;
  const focusedItemIdRef = useRef<string | null>(null);
  const categoryCountRequestRef = useRef(new Set<string>());
  const previousListScopeRef = useRef({ providerId: '', categoryId: '' });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const syncCategoryCount = useCallback((categoryId: string, count: number) => {
    if (!categoryId || count < 0) {
      return;
    }
    setCategories((current) => applyCategoryCount(current, categoryId, count));
  }, []);

  const prefetchCategoryCount = useCallback(
    (categoryId: string) => {
      if (
        !dataSource?.getCategoryCount ||
        !categoryId ||
        categoryId.startsWith('section:') ||
        categoryId.startsWith('smart:') ||
        categoryCountRequestRef.current.has(categoryId)
      ) {
        return;
      }

      categoryCountRequestRef.current.add(categoryId);
      void dataSource.getCategoryCount(categoryId).then((count) => {
        syncCategoryCount(categoryId, count);
      });
    },
    [dataSource, syncCategoryCount],
  );

  const queryMode = searchQuery.trim();
  const isSearchMode = queryMode.length > 0;

  useEffect(() => {
    if (!dataSource) {
      return;
    }

    let mounted = true;
    const loadCategories = async () => {
      try {
        const nextCategories = await dataSource.getCategories();
        if (!mounted) {
          return;
        }

        setCategories(nextCategories);
        setSelectedCategoryId((current) => {
          if (current && nextCategories.some((category) => category.id === current && isSelectableCategory(category))) {
            return current;
          }
          const remembered = options.initialSelectedCategoryId;
          if (remembered && nextCategories.some((category) => category.id === remembered && isSelectableCategory(category))) {
            return remembered;
          }
          return findDefaultBrowseCategoryId(nextCategories);
        });
      } catch (error) {
        if (!mounted) {
          return;
        }

        setCategories([]);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load categories.');
      }
    };

    void loadCategories();

    return () => {
      mounted = false;
    };
  }, [dataSource, options.initialSelectedCategoryId, reloadToken]);

  useEffect(() => {
    if (!selectedCategoryId || isSearchMode || selectedCategoryId.startsWith('section:')) {
      return;
    }

    prefetchCategoryCount(selectedCategoryId);
  }, [isSearchMode, prefetchCategoryCount, selectedCategoryId]);

  useEffect(() => {
    focusedItemIdRef.current = focusedItemId;
  }, [focusedItemId]);

  useEffect(() => {
    if (!dataSource || (!isSearchMode && (!selectedCategoryId || selectedCategoryId.startsWith('section:')))) {
      return;
    }

    let cancelled = false;
    const generation = ++requestGenerationRef.current;
    const requestKey = buildContentSortRequestKey({
      providerId,
      contentType: 'series',
      categoryId: selectedCategoryId,
      sort: sortOption,
      offset: 0,
      generation,
    });
    const previousFocusedItemId = focusedItemIdRef.current;
    const retainVisible =
      !isSearchMode &&
      previousListScopeRef.current.providerId === providerId &&
      previousListScopeRef.current.categoryId === selectedCategoryId;
    previousListScopeRef.current = { providerId, categoryId: selectedCategoryId };

    const loadInitialPage = async () => {
      // Same-category refreshes (e.g. background catalog sync) update silently
      // without flashing the grid loading overlay.
      if (!retainVisible) {
        setLoading(true);
        setCategoryLoading(true);
      }
      setLoadStatus(retainVisible ? loadStatusRef.current : 'loading');
      setLoadErrorMessage(null);
      if (!retainVisible) {
        setVisibleItems([]);
      }
      setCategoryHasRatings(true);
      offsetRef.current = 0;

      try {
        const page =
          isSearchMode && dataSource.searchItems
            ? await dataSource.searchItems({ query: queryMode, offset: 0, limit: pageSize })
            : await dataSource.getItemsPage({ categoryId: selectedCategoryId, offset: 0, limit: pageSize, sort: sortOption });

        if (cancelled || buildContentSortRequestKey({
          providerId,
          contentType: 'series',
          categoryId: selectedCategoryId,
          sort: sortOption,
          offset: 0,
          generation,
        }) !== requestKey) {
          return;
        }

        offsetRef.current = page.items.length;
        setVisibleItems(page.items);
        setHasMore(page.hasMore);
        setCategoryHasRatings('hasValidRatings' in page ? Boolean(page.hasValidRatings) : true);
        syncCategoryCount(selectedCategoryId, page.totalCount);

        const restoredFocusId =
          page.items.find((item) => item.id === previousFocusedItemId)?.id ?? page.items[0]?.id ?? null;
        setFocusedItemId(restoredFocusId);
        setSelectedItemId((current) => {
          if (current && page.items.some((item) => item.id === current)) {
            return current;
          }
          return restoredFocusId;
        });
        setLoadStatus(page.items.length > 0 ? 'ready' : 'empty');
      } catch (error) {
        if (cancelled || buildContentSortRequestKey({
          providerId,
          contentType: 'series',
          categoryId: selectedCategoryId,
          sort: sortOption,
          offset: 0,
          generation,
        }) !== requestKey) {
          return;
        }

        setVisibleItems([]);
        setHasMore(false);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load items for this category.');
      } finally {
        if (!cancelled && buildContentSortRequestKey({
          providerId,
          contentType: 'series',
          categoryId: selectedCategoryId,
          sort: sortOption,
          offset: 0,
          generation,
        }) === requestKey) {
          setLoading(false);
          setCategoryLoading(false);
        }
      }
    };

    void loadInitialPage();
    return () => {
      cancelled = true;
    };
  }, [dataSource, isSearchMode, pageSize, providerId, queryMode, reloadToken, selectedCategoryId, sortOption, syncCategoryCount]);

  const focusedItem = useMemo(
    () => visibleItems.find((item) => item.id === focusedItemId) ?? visibleItems[0] ?? null,
    [focusedItemId, visibleItems],
  );

  const selectedItem = useMemo(
    () => visibleItems.find((item) => item.id === selectedItemId) ?? focusedItem,
    [focusedItem, selectedItemId, visibleItems],
  );

  const selectCategory = (categoryId: string) => {
    if (categoryId === selectedCategoryId && !isSearchMode) {
      return;
    }
    setSearchQueryState('');
    setSelectedCategoryId(categoryId);
    setLoadStatus('loading');
    setLoadErrorMessage(null);
  };

  const focusItem = (item: TItem) => {
    focusedItemIdRef.current = item.id;
    setFocusedItemId(item.id);
  };

  const selectItem = (item: TItem) => {
    focusedItemIdRef.current = item.id;
    setFocusedItemId(item.id);
    setSelectedItemId(item.id);
  };

  const loadMore = async () => {
    if (!dataSource || loading || !hasMore) {
      return;
    }

    const generationAtRequest = requestGenerationRef.current;
    const sortAtRequest = sortOption;
    const categoryAtRequest = selectedCategoryId;
    const providerAtRequest = providerId;
    const nextOffset = offsetRef.current;
    setLoading(true);

    try {
      const page =
        isSearchMode && dataSource.searchItems
          ? await dataSource.searchItems({ query: queryMode, offset: nextOffset, limit: pageSize })
          : await dataSource.getItemsPage({ categoryId: selectedCategoryId, offset: nextOffset, limit: pageSize, sort: sortOption });

      if (
        generationAtRequest !== requestGenerationRef.current ||
        sortAtRequest !== sortOption ||
        categoryAtRequest !== selectedCategoryId ||
        providerAtRequest !== providerId
      ) {
        return;
      }

      offsetRef.current += page.items.length;
      setVisibleItems((current) => uniqueItems(current, page.items));
      setHasMore(page.hasMore);
      if ('hasValidRatings' in page) {
        setCategoryHasRatings((current) => current || Boolean(page.hasValidRatings));
      }
      syncCategoryCount(selectedCategoryId, page.totalCount);
      setLoadStatus((current) => (current === 'error' ? current : 'ready'));

      if (!focusedItemIdRef.current && page.items[0]) {
        setFocusedItemId(page.items[0].id);
      }
    } catch (error) {
      if (
        generationAtRequest !== requestGenerationRef.current ||
        sortAtRequest !== sortOption ||
        categoryAtRequest !== selectedCategoryId ||
        providerAtRequest !== providerId
      ) {
        return;
      }

      setLoadStatus('error');
      setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load more items.');
    } finally {
      if (
        generationAtRequest === requestGenerationRef.current &&
        sortAtRequest === sortOption &&
        categoryAtRequest === selectedCategoryId &&
        providerAtRequest === providerId
      ) {
        setLoading(false);
      }
    }
  };

  return {
    categories: dataSource ? categories : [],
    selectedCategoryId,
    focusedItem: dataSource ? focusedItem : null,
    selectedItem: dataSource ? selectedItem : null,
    selectedItemId: dataSource ? selectedItemId : null,
    visibleItems: dataSource ? visibleItems : [],
    loading: dataSource ? loading : false,
    categoryLoading: dataSource ? categoryLoading : false,
    loadStatus: dataSource ? loadStatus : 'error',
    loadErrorMessage: dataSource ? loadErrorMessage : 'Provider is not connected.',
    hasMore: dataSource ? hasMore : false,
    selectCategory,
    prefetchCategoryCount,
    focusItem,
    selectItem,
    loadMore,
    reload,
    searchQuery,
    setSearchQuery: setSearchQueryState,
    hasDataSource: Boolean(dataSource),
    categoryHasRatings,
  };
}
