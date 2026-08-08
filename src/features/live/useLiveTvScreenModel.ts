/* eslint-disable react-hooks/set-state-in-effect -- Provider-backed screens load async repository data in effects. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildLiveChannelPlaybackUrl } from '@/features/providers/providerPlayback';
import { mergeCategoryCountIndex, readCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import { fallbackProviderCategoryId } from '@/features/providers/categoryNormalization';
import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { getLiveFavoriteEntries, usePersonalizationStore } from '@/features/personalization/personalizationStore';

import {
  clearLiveTvEpgCache,
  enrichChannelsWithPrefetchedEpg,
  enrichSingleChannelEpg,
  mapChannelsWithoutEpg,
} from './liveTvChannelEpg';
import { ingestLiveChannels } from '@/features/search/repositories/liveSearchRepository';
import { resetLiveTvFocusIdle } from './liveTvFocusIdle';
import { clearLiveTvChannelRowDataPool, mergeLiveTvChannelEpg } from './liveTvChannelRowData';
import type { LiveTvLoadStatus } from './liveTvLogic';
import { beginSwitchTrace, endSwitchTrace, markSwitchEvent } from './liveTvSwitchDiagnostics';

export type { LiveTvLoadStatus } from './liveTvLogic';

export function useLiveTvScreenModel(initialCategoryId?: string, initialChannelId?: string | null) {
  const { bundle, isXtream } = useActiveProviderBundle();
  const [status, setStatus] = useState<LiveTvLoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [channels, setChannels] = useState<ProviderLiveChannel[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId ?? '');
  const [baseCategories, setBaseCategories] = useState<ProviderLiveCategory[]>([]);
  // Stage 4.2S.1 — distinct loading signals so only channel/content loading drives the
  // local content-pane loader (never a screen-wide blocker).
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [isSwitchingCategory, setIsSwitchingCategory] = useState(false);
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  const [isLoadingEpg, setIsLoadingEpg] = useState(false);
  const { state: personalizationState } = usePersonalizationStore(bundle?.providerId ?? 'no-provider');
  const requestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const epgFetchedIdsRef = useRef(new Set<string>());
  const channelsBaselineRef = useRef<ProviderLiveChannel[]>([]);
  const previousBundleGenerationRef = useRef<number | null>(null);

  const categoriesWithFavorites = useMemo(() => {
    const withoutStaticFavorites = baseCategories.filter((category) => category.id !== 'favorites');
    if (!personalizationState.liveFavorites.length) {
      return withoutStaticFavorites;
    }

    return [
      {
        id: 'favorites',
        renderKey: 'favorites',
        name: 'Favorites',
        count: personalizationState.liveFavorites.length,
        icon: 'star-outline' as const,
      },
      ...withoutStaticFavorites,
    ];
  }, [baseCategories, personalizationState.liveFavorites.length]);

  const loadChannelsForCategory = useCallback(
    async (categoryId: string, signal?: AbortSignal) => {
      if (!bundle) {
        return [];
      }

      if (categoryId !== 'favorites') {
        return bundle.live.getChannels(categoryId, signal);
      }

      const favoriteEntries = await getLiveFavoriteEntries(bundle.providerId);
      const channelsForFavorites = await Promise.all(
        favoriteEntries.map(async (entry) => {
          const channel = await bundle.live.getChannel(entry.contentId, signal).catch(() => null);
          return channel;
        }),
      );
      return channelsForFavorites.filter((channel): channel is ProviderLiveChannel => Boolean(channel));
    },
    [bundle],
  );

  const commitChannels = useCallback((next: ProviderLiveChannel[]) => {
    channelsBaselineRef.current = next;
    setChannels(next);
    if (bundle?.providerId) {
      ingestLiveChannels(bundle.providerId, next);
    }
  }, [bundle]);

  const updateCategoryCount = useCallback((categoryId: string, count: number) => {
    if (categoryId === 'favorites') {
      return;
    }

    setBaseCategories((current) => {
      let changed = false;
      const next = current.map((category) => {
        if (category.id !== categoryId || category.count === count) {
          return category;
        }

        changed = true;
        return { ...category, count };
      });

      return changed ? next : current;
    });

    if (bundle?.providerId) {
      void mergeCategoryCountIndex(bundle.providerId, 'live', { [categoryId]: count }).catch(() => undefined);
    }
  }, [bundle]);

  const applyCategoryCounts = useCallback(
    (requestId: number, counts: Record<string, number>) => {
      if (requestId !== requestRef.current) {
        return;
      }

      setBaseCategories((current) => {
        let changed = false;
        const next = current.map((category) => {
          if (category.id === 'favorites') {
            return category;
          }

          const count = counts[category.id] ?? 0;
          if (category.count === count) {
            return category;
          }

          changed = true;
          return { ...category, count: Math.floor(count) };
        });

        const fallbackId = fallbackProviderCategoryId('live');
        const fallbackCount = counts[fallbackId] ?? 0;
        if (fallbackCount > 0 && !next.some((category) => category.id === fallbackId)) {
          next.push({
            id: fallbackId,
            renderKey: `${fallbackId}::fallback`,
            name: 'Uncategorized',
            count: Math.floor(fallbackCount),
            icon: 'flag-outline',
          });
          changed = true;
        }

        return changed ? next : current;
      });

      if (bundle?.providerId && Object.keys(counts).length) {
        void mergeCategoryCountIndex(bundle.providerId, 'live', counts).catch(() => undefined);
      }
    },
    [bundle],
  );

  const applyIncrementalEpg = useCallback((enriched: ProviderLiveChannel, requestId: number) => {
    if (requestId !== requestRef.current) {
      return;
    }

    setChannels((current) => {
      const baseline = current.length >= channelsBaselineRef.current.length ? current : channelsBaselineRef.current;
      const merged = mergeLiveTvChannelEpg(baseline, [enriched]);
      channelsBaselineRef.current = merged;
      return merged;
    });
  }, []);

  const prefetchChannelEpg = useCallback(
    (requestId: number, nextChannels: ProviderLiveChannel[]) => {
      if (!bundle) {
        return;
      }

      setIsLoadingEpg(true);
      void enrichChannelsWithPrefetchedEpg(bundle, nextChannels, {
        onChannelEnriched: (enriched) => {
          applyIncrementalEpg(enriched, requestId);
        },
      })
        .then((fullyEnriched) => {
          if (requestId !== requestRef.current) {
            return;
          }

          commitChannels(fullyEnriched);
        })
        .finally(() => {
          if (requestId === requestRef.current) {
            setIsLoadingEpg(false);
          }
        });
    },
    [applyIncrementalEpg, bundle, commitChannels],
  );

  const loadCategories = useCallback(async (isProviderSwitch = false) => {
    if (!bundle) {
      setStatus('error');
      setErrorMessage('Provider is not connected.');
      setIsSwitchingProvider(false);
      return;
    }

    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const signal = controller.signal;

    const requestId = ++requestRef.current;
    setStatus('loading');
    setErrorMessage(null);
    setIsLoadingChannels(true);
    const traceId = isProviderSwitch
      ? beginSwitchTrace('provider', { providerId: bundle.providerId })
      : -1;
    markSwitchEvent(traceId, 'current_rows_retained', { retainedRows: channelsBaselineRef.current.length });
    try {
      const nextCategories = await bundle.live.getCategories(signal);
      if (requestId !== requestRef.current) {
        endSwitchTrace(traceId);
        return;
      }

      // Don't block first paint on count-index disk I/O — hydrate counts in the background.
      const categoriesWithoutCounts = nextCategories.map((category) => ({
        ...category,
        count: category.count ?? null,
      }));
      setBaseCategories(categoriesWithoutCounts);
      const visibleCategories = [
        ...categoriesWithoutCounts.filter((category) => category.id !== 'favorites'),
        ...(personalizationState.liveFavorites.length
          ? [
              {
                id: 'favorites',
                renderKey: 'favorites',
                name: 'Favorites',
                count: personalizationState.liveFavorites.length,
                icon: 'star-outline' as const,
              },
            ]
          : []),
      ].sort((left, right) => (left.id === 'favorites' ? -1 : right.id === 'favorites' ? 1 : 0));

      if (!visibleCategories.length) {
        channelsBaselineRef.current = [];
        setChannels([]);
        setStatus('empty');
        setIsLoadingChannels(false);
        setIsSwitchingProvider(false);
        endSwitchTrace(traceId);
        return;
      }

      const resolvedCategoryId = visibleCategories.some((item) => item.id === initialCategoryId)
        ? initialCategoryId ?? nextCategories[0]?.id ?? ''
        : visibleCategories[0]?.id ?? '';

      setSelectedCategoryId(resolvedCategoryId);

      void readCategoryCountIndex(bundle.providerId, 'live')
        .then((persistedCountIndex) => {
          if (requestId !== requestRef.current) {
            return;
          }

          setBaseCategories((current) =>
            current.map((category) => ({
              ...category,
              count: category.count ?? persistedCountIndex.counts[category.id] ?? null,
            })),
          );
        })
        .catch(() => undefined);

      markSwitchEvent(traceId, 'channel_query_started');
      const nextChannels = await loadChannelsForCategory(resolvedCategoryId, signal);
      if (requestId !== requestRef.current) {
        endSwitchTrace(traceId);
        return;
      }

      markSwitchEvent(traceId, 'channel_query_finished', { rowCount: nextChannels.length });
      updateCategoryCount(resolvedCategoryId, nextChannels.length);

      if (!nextChannels.length) {
        channelsBaselineRef.current = [];
        setChannels([]);
        setStatus('empty');
        setIsLoadingChannels(false);
        setIsSwitchingProvider(false);
        endSwitchTrace(traceId);
        return;
      }

      commitChannels(mapChannelsWithoutEpg(nextChannels));
      markSwitchEvent(traceId, 'row_pool_rebuilt', { rowCount: nextChannels.length });
      setStatus('ready');
      setIsLoadingChannels(false);
      setIsSwitchingProvider(false);
      markSwitchEvent(traceId, 'content_ready', { rowCount: nextChannels.length });

      markSwitchEvent(traceId, 'epg_refresh_started');
      prefetchChannelEpg(requestId, nextChannels);
      endSwitchTrace(traceId);

      if (bundle.live.getCategoryCounts) {
        void bundle.live
          .getCategoryCounts()
          .then((counts) => {
            if (counts) {
              applyCategoryCounts(requestId, counts);
            }
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (requestId !== requestRef.current || signal.aborted) {
        endSwitchTrace(traceId);
        return;
      }

      // Keep last-good channels on refresh failure — do not wipe a usable browse list.
      setStatus(channelsBaselineRef.current.length ? 'ready' : 'error');
      setErrorMessage('Unable to load live channels from your provider.');
      setIsLoadingChannels(false);
      setIsSwitchingProvider(false);
      endSwitchTrace(traceId);
    }
  }, [applyCategoryCounts, bundle, initialCategoryId, commitChannels, loadChannelsForCategory, personalizationState.liveFavorites.length, prefetchChannelEpg, updateCategoryCount]);

  const loadCategoriesRef = useRef(loadCategories);
  loadCategoriesRef.current = loadCategories;

  useEffect(() => {
    const generation = bundle?.generation ?? null;
    const previous = previousBundleGenerationRef.current;
    const isProviderSwitch = previous != null && previous !== generation;
    previousBundleGenerationRef.current = generation;
    if (isProviderSwitch) {
      setIsSwitchingProvider(true);
    }
    void loadCategoriesRef.current(isProviderSwitch);
  }, [bundle?.generation, initialCategoryId]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [bundle?.generation]);

  const selectCategory = useCallback(
    async (categoryId: string) => {
      if (!bundle) {
        return [];
      }

      const requestId = ++requestRef.current;
      resetLiveTvFocusIdle();
      epgFetchedIdsRef.current.clear();
      clearLiveTvEpgCache();
      setSelectedCategoryId(categoryId);
      setIsSwitchingCategory(true);
      setIsLoadingChannels(true);

      const traceId = beginSwitchTrace('category', { categoryId, providerId: bundle.providerId });
      markSwitchEvent(traceId, 'current_rows_retained', { retainedRows: channelsBaselineRef.current.length });
      markSwitchEvent(traceId, 'channel_query_started');

      try {
        const nextChannels = await loadChannelsForCategory(categoryId);
        if (requestId !== requestRef.current) {
          endSwitchTrace(traceId);
          return [];
        }

        markSwitchEvent(traceId, 'channel_query_finished', { rowCount: nextChannels.length });
        updateCategoryCount(categoryId, nextChannels.length);
        const immediate = mapChannelsWithoutEpg(nextChannels);
        clearLiveTvChannelRowDataPool();
        commitChannels(immediate);
        markSwitchEvent(traceId, 'row_pool_rebuilt', { rowCount: immediate.length });
        setStatus(immediate.length ? 'ready' : 'empty');
        setIsLoadingChannels(false);
        setIsSwitchingCategory(false);
        markSwitchEvent(traceId, 'content_ready', { rowCount: immediate.length });

        markSwitchEvent(traceId, 'epg_refresh_started');
        prefetchChannelEpg(requestId, nextChannels);
        endSwitchTrace(traceId);

        return immediate;
      } catch {
        if (requestId !== requestRef.current) {
          endSwitchTrace(traceId);
          return [];
        }

        // Retain previous category list on failure so the user is not left with an empty rail.
        setStatus(channelsBaselineRef.current.length ? 'ready' : 'error');
        setErrorMessage('Unable to load channels for this category.');
        setIsLoadingChannels(false);
        setIsSwitchingCategory(false);
        endSwitchTrace(traceId);
        return channelsBaselineRef.current;
      }
    },
    [bundle, commitChannels, loadChannelsForCategory, prefetchChannelEpg, updateCategoryCount],
  );

  useEffect(() => {
    if (!baseCategories.length || selectedCategoryId !== 'favorites' || personalizationState.liveFavorites.length) {
      return;
    }

    const fallback = categoriesWithFavorites[0]?.id ?? '';
    if (fallback) {
      void selectCategory(fallback);
    }
  }, [baseCategories.length, categoriesWithFavorites, personalizationState.liveFavorites.length, selectCategory, selectedCategoryId]);

  const enrichFocusedChannelEpg = useCallback(
    (channelId: string) => {
      if (!bundle || epgFetchedIdsRef.current.has(channelId)) {
        return;
      }

      const channel = channels.find((item) => item.id === channelId);
      if (!channel) {
        return;
      }

      epgFetchedIdsRef.current.add(channelId);
      void enrichSingleChannelEpg(bundle, channel).then((enriched) => {
        if (
          enriched.current === channel.current &&
          enriched.next === channel.next &&
          enriched.following === channel.following
        ) {
          return;
        }

        setChannels((current) => current.map((item) => (item.id === channelId ? enriched : item)));
      });
    },
    [bundle, channels],
  );

  const resolvePlaybackUrl = useCallback(
    (channel: ProviderLiveChannel | null) => {
      if (!bundle || !channel) {
        return null;
      }

      return buildLiveChannelPlaybackUrl(bundle, channel);
    },
    [bundle],
  );

  const initialChannel = useMemo(() => {
    if (!channels.length) {
      return null;
    }

    if (initialChannelId) {
      return channels.find((channel) => channel.id === initialChannelId) ?? channels[0];
    }

    return channels[0];
  }, [channels, initialChannelId]);

  const categoryTotalCount = useMemo(() => {
    const countableCategories = baseCategories.filter((category) => category.id !== 'favorites');
    if (!countableCategories.length || countableCategories.some((category) => category.count == null)) {
      return null;
    }

    return countableCategories.reduce((total, category) => total + (category.count ?? 0), 0);
  }, [baseCategories]);

  return {
    bundle,
    isXtream,
    status: bundle ? status : 'error',
    errorMessage: bundle ? errorMessage : 'Provider is not connected.',
    categories: categoriesWithFavorites,
    categoryTotalCount,
    channels,
    selectedCategoryId,
    isLoadingChannels,
    isSwitchingCategory,
    isSwitchingProvider,
    isLoadingEpg,
    selectCategory,
    enrichFocusedChannelEpg,
    resolvePlaybackUrl,
    reload: loadCategories,
    initialChannel,
  };
}
