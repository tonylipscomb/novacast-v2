import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildLiveChannelPlaybackUrl } from '@/features/providers/providerPlayback';
import { mergeCategoryCountIndex, readCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveFavoritesCategoryId,
  providerLiveCategoriesOnly,
  resolveInitialLiveBrowseCategoryId,
} from '@/features/providers/liveCategoryIdSafety';
import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';

import {
  LIVE_EPG_FOCUS_DEBOUNCE_MS,
  cancelLiveTvEpgWork,
  enrichChannelsWithPrefetchedEpg,
  enrichSingleChannelEpg,
  mapChannelsWithoutEpg,
  selectVisibleEpgWindow,
  shouldIssueFocusedEpgRequest,
} from './liveTvChannelEpg';
import { getLiveTvWorkload, shouldSuspendLiveListEpg } from './liveTvWorkload';
import { ingestLiveChannels, ingestLiveSearchCategories } from '@/features/search/repositories/liveSearchRepository';
import { resetLiveTvFocusIdle } from './liveTvFocusIdle';
import { clearLiveTvChannelRowDataPool, mergeLiveTvChannelEpg } from './liveTvChannelRowData';
import {
  logLiveCategory,
  logLiveEpgTrigger,
  logLivePerformance,
  logLiveStallAudit,
  logLiveStartup,
} from './liveTvDiagnostics';
import type { LiveTvLoadStatus } from './liveTvLogic';

export type { LiveTvLoadStatus } from './liveTvLogic';

export function useLiveTvScreenModel(initialCategoryId?: string, initialChannelId?: string | null) {
  const { bundle, isXtream } = useActiveProviderBundle();
  const [status, setStatus] = useState<LiveTvLoadStatus>('loading');
  const [channelListPending, setChannelListPending] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [channels, setChannels] = useState<ProviderLiveChannel[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(() =>
    isRealProviderLiveCategoryId(initialCategoryId) ? initialCategoryId ?? '' : '',
  );
  const [baseCategories, setBaseCategories] = useState<ProviderLiveCategory[]>([]);
  const requestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const epgFetchedIdsRef = useRef(new Set<string>());
  const epgInFlightIdsRef = useRef(new Set<string>());
  const focusedEpgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusedEpgRef = useRef<{ channelId: string; atMs: number } | null>(null);
  const channelsBaselineRef = useRef<ProviderLiveChannel[]>([]);
  const mountStartedAtRef = useRef(0);
  const interactiveLoggedRef = useRef(false);

  const categories = useMemo(() => providerLiveCategoriesOnly(baseCategories), [baseCategories]);

  const loadChannelsForCategory = useCallback(
    async (categoryId: string, signal?: AbortSignal) => {
      if (!bundle) {
        return [];
      }

      if (!isRealProviderLiveCategoryId(categoryId)) {
        logLiveCategory('selection-rejected', {
          categoryId,
          reason: isSyntheticLiveFavoritesCategoryId(categoryId)
            ? 'synthetic-favorites'
            : 'invalid-provider-category',
        });
        return [];
      }

      const startedAt = Date.now();
      logLiveCategory('load-started', { categoryId });
      const next = await bundle.live.getChannels(categoryId, signal);
      logLiveStallAudit('live.getChannels', next.length, startedAt);
      logLiveCategory('load-completed', {
        categoryId,
        channelCount: next.length,
        elapsedMs: Date.now() - startedAt,
      });
      return next;
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
    if (!isRealProviderLiveCategoryId(categoryId)) {
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
    (requestId: number, nextChannels: ProviderLiveChannel[], categoryId: string, focusedChannelId?: string | null) => {
      if (!bundle) {
        return;
      }

      if (shouldSuspendLiveListEpg()) {
        cancelLiveTvEpgWork('list-prefetch-suspended');
        return;
      }

      const generation = cancelLiveTvEpgWork('category-prefetch-supersede');
      const focusedId = focusedChannelId || initialChannelId || nextChannels[0]?.id || null;
      logLiveEpgTrigger({
        caller: 'useLiveTvScreenModel.prefetchChannelEpg',
        reason: 'visible-window-current-program',
        categoryId,
        channelCount: selectVisibleEpgWindow(nextChannels, focusedId).length,
      });

      void enrichChannelsWithPrefetchedEpg(bundle, nextChannels, {
        focusedChannelId: focusedId,
        generation,
        onChannelEnriched: (enriched) => {
          applyIncrementalEpg(enriched, requestId);
        },
      }).then((fullyEnriched) => {
        if (requestId !== requestRef.current) {
          return;
        }

        commitChannels(fullyEnriched);
      });
    },
    [applyIncrementalEpg, bundle, commitChannels, initialChannelId],
  );

  const loadCategories = useCallback(async () => {
    if (!bundle) {
      setChannelListPending(false);
      setStatus('error');
      setErrorMessage('Provider is not connected.');
      return;
    }

    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const signal = controller.signal;

    const requestId = ++requestRef.current;
    const keepExistingList = channelsBaselineRef.current.length > 0;
    if (!keepExistingList) {
      setStatus('loading');
      setChannelListPending(true);
    }
    setErrorMessage(null);
    try {
      const categoriesStartedAt = Date.now();
      const nextCategories = await bundle.live.getCategories(signal);
      logLiveStallAudit('live.getCategories', nextCategories.length, categoriesStartedAt);
      if (requestId !== requestRef.current) {
        return;
      }

      const providerCategories = providerLiveCategoriesOnly(nextCategories).map((category) => ({
        ...category,
        count: category.count ?? null,
      }));
      setBaseCategories(providerCategories);
      ingestLiveSearchCategories(bundle.providerId, providerCategories);
      logLiveStartup('categories-ready', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        categoryCount: providerCategories.length,
        providerIdPresent: Boolean(bundle.providerId),
      });
      logLivePerformance({
        event: 'categories-ready',
        elapsedMs: Date.now() - mountStartedAtRef.current,
        providerIdPresent: Boolean(bundle.providerId),
        categoryCount: providerCategories.length,
        selectedCategoryIdPresent: false,
        source: 'repository',
        epgPending: false,
        discoverPending: false,
      });

      if (!providerCategories.length) {
        channelsBaselineRef.current = [];
        setChannels([]);
        setSelectedCategoryId('');
        setChannelListPending(false);
        setStatus('empty');
        return;
      }

      const resolvedCategoryId = resolveInitialLiveBrowseCategoryId(initialCategoryId, providerCategories);
      setSelectedCategoryId(resolvedCategoryId);
      logLiveStartup('initial-category-selected', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        categoryCount: providerCategories.length,
        selectedCategoryId: resolvedCategoryId,
        providerIdPresent: Boolean(bundle.providerId),
      });
      logLiveCategory('selection-accepted', {
        categoryId: resolvedCategoryId,
        reason: 'initial-browse',
      });

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

      const nextChannels = await loadChannelsForCategory(resolvedCategoryId, signal);
      if (requestId !== requestRef.current) {
        return;
      }

      updateCategoryCount(resolvedCategoryId, nextChannels.length);

      if (!nextChannels.length) {
        if (!keepExistingList) {
          channelsBaselineRef.current = [];
          setChannels([]);
        }
        setChannelListPending(false);
        setStatus(keepExistingList ? 'ready' : 'empty');
        return;
      }

      commitChannels(mapChannelsWithoutEpg(nextChannels));
      setChannelListPending(false);
      setStatus('ready');
      logLiveStartup('first-channel-list-ready', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        categoryCount: providerCategories.length,
        channelCount: nextChannels.length,
        selectedCategoryId: resolvedCategoryId,
        providerIdPresent: Boolean(bundle.providerId),
      });
      logLivePerformance({
        event: 'first-channel-list-ready',
        elapsedMs: Date.now() - mountStartedAtRef.current,
        providerIdPresent: Boolean(bundle.providerId),
        categoryCount: providerCategories.length,
        channelCount: nextChannels.length,
        selectedCategoryIdPresent: Boolean(resolvedCategoryId),
        source: 'repository',
        epgPending: true,
        discoverPending: false,
      });
      if (!interactiveLoggedRef.current) {
        interactiveLoggedRef.current = true;
        logLiveStartup('interactive', {
          elapsedMs: Date.now() - mountStartedAtRef.current,
          categoryCount: providerCategories.length,
          channelCount: nextChannels.length,
          selectedCategoryId: resolvedCategoryId,
          providerIdPresent: Boolean(bundle.providerId),
        });
        logLivePerformance({
          event: 'interactive',
          elapsedMs: Date.now() - mountStartedAtRef.current,
          providerIdPresent: Boolean(bundle.providerId),
          categoryCount: providerCategories.length,
          channelCount: nextChannels.length,
          selectedCategoryIdPresent: Boolean(resolvedCategoryId),
          source: 'repository',
          epgPending: true,
          discoverPending: false,
        });
      }

      prefetchChannelEpg(requestId, nextChannels, resolvedCategoryId);
    } catch {
      if (requestId !== requestRef.current || signal.aborted) {
        return;
      }

      setChannelListPending(false);
      setStatus(channelsBaselineRef.current.length ? 'ready' : 'error');
      setErrorMessage('Unable to load live channels from your provider.');
    }
  }, [bundle, initialCategoryId, commitChannels, loadChannelsForCategory, prefetchChannelEpg, updateCategoryCount]);

  const loadCategoriesRef = useRef(loadCategories);

  useEffect(() => {
    loadCategoriesRef.current = loadCategories;
  }, [loadCategories]);

  useEffect(() => {
    mountStartedAtRef.current = Date.now();
    interactiveLoggedRef.current = false;
    logLiveStartup('screen-mounted', {
      elapsedMs: 0,
      providerIdPresent: Boolean(bundle?.providerId),
      selectedCategoryId: initialCategoryId,
    });
    logLivePerformance({
      event: 'screen-mounted',
      elapsedMs: 0,
      providerIdPresent: Boolean(bundle?.providerId),
      selectedCategoryIdPresent: isRealProviderLiveCategoryId(initialCategoryId),
      source: 'memory',
      epgPending: false,
      discoverPending: false,
    });
    void loadCategoriesRef.current();
  }, [bundle?.generation, bundle?.providerId, initialCategoryId]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
      if (focusedEpgTimerRef.current) {
        clearTimeout(focusedEpgTimerRef.current);
        focusedEpgTimerRef.current = null;
      }
      cancelLiveTvEpgWork('live-model-unmount');
    };
  }, [bundle?.generation]);

  const selectCategory = useCallback(
    async (categoryId: string) => {
      if (!bundle) {
        return [];
      }

      logLiveCategory('selection-requested', { categoryId });
      if (!isRealProviderLiveCategoryId(categoryId)) {
        logLiveCategory('selection-rejected', {
          categoryId,
          reason: isSyntheticLiveFavoritesCategoryId(categoryId)
            ? 'synthetic-favorites'
            : 'invalid-provider-category',
        });
        return channelsBaselineRef.current;
      }

      const requestId = ++requestRef.current;
      const startedAt = Date.now();
      resetLiveTvFocusIdle();
      epgFetchedIdsRef.current.clear();
      epgInFlightIdsRef.current.clear();
      if (focusedEpgTimerRef.current) {
        clearTimeout(focusedEpgTimerRef.current);
        focusedEpgTimerRef.current = null;
      }
      cancelLiveTvEpgWork('category-switch');
      setSelectedCategoryId(categoryId);
      setChannelListPending(true);
      logLiveCategory('selection-accepted', { categoryId, reason: 'user-select' });

      try {
        const nextChannels = await loadChannelsForCategory(categoryId);
        if (requestId !== requestRef.current) {
          return [];
        }

        updateCategoryCount(categoryId, nextChannels.length);
        const immediate = mapChannelsWithoutEpg(nextChannels);
        clearLiveTvChannelRowDataPool();
        commitChannels(immediate);
        setChannelListPending(false);
        setStatus(immediate.length ? 'ready' : 'empty');
        logLivePerformance({
          event: 'category-switch-first-channels',
          elapsedMs: Date.now() - startedAt,
          providerIdPresent: Boolean(bundle.providerId),
          channelCount: immediate.length,
          selectedCategoryIdPresent: true,
          source: 'repository',
          epgPending: true,
          discoverPending: false,
        });

        prefetchChannelEpg(requestId, nextChannels, categoryId);

        return immediate;
      } catch {
        if (requestId !== requestRef.current) {
          return [];
        }

        setChannelListPending(false);
        setStatus(channelsBaselineRef.current.length ? 'ready' : 'error');
        setErrorMessage('Unable to load channels for this category.');
        return channelsBaselineRef.current;
      }
    },
    [bundle, commitChannels, loadChannelsForCategory, prefetchChannelEpg, updateCategoryCount],
  );

  const enrichFocusedChannelEpg = useCallback(
    (channelId: string) => {
      if (!bundle) {
        return;
      }

      if (focusedEpgTimerRef.current) {
        clearTimeout(focusedEpgTimerRef.current);
      }

      focusedEpgTimerRef.current = setTimeout(() => {
        focusedEpgTimerRef.current = null;
        const workload = getLiveTvWorkload();
        const channel = channelsBaselineRef.current.find((item) => item.id === channelId);
        if (!channel) {
          return;
        }

        const decision = shouldIssueFocusedEpgRequest({
          channelId,
          lastIssuedChannelId: lastFocusedEpgRef.current?.channelId,
          lastIssuedAtMs: lastFocusedEpgRef.current?.atMs,
          nowMs: Date.now(),
          inFlight: epgInFlightIdsRef.current.has(channelId),
          cached: epgFetchedIdsRef.current.has(channelId),
          suspended: shouldSuspendLiveListEpg(workload),
        });
        if (decision !== 'issue') {
          return;
        }

        lastFocusedEpgRef.current = { channelId, atMs: Date.now() };
        epgFetchedIdsRef.current.add(channelId);
        epgInFlightIdsRef.current.add(channelId);
        logLiveEpgTrigger({
          caller: 'useLiveTvScreenModel.enrichFocusedChannelEpg',
          reason: 'focused-channel-current-program',
          categoryId: selectedCategoryId,
          channelCount: 1,
        });
        void enrichSingleChannelEpg(bundle, channel)
          .then((enriched) => {
            if (
              enriched.current === channel.current &&
              enriched.next === channel.next &&
              enriched.following === channel.following
            ) {
              return;
            }

            setChannels((current) => current.map((item) => (item.id === channelId ? enriched : item)));
          })
          .finally(() => {
            epgInFlightIdsRef.current.delete(channelId);
          });
      }, LIVE_EPG_FOCUS_DEBOUNCE_MS);
    },
    [bundle, selectedCategoryId],
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
    if (!categories.length || categories.some((category) => category.count == null)) {
      return null;
    }

    return categories.reduce((total, category) => total + (category.count ?? 0), 0);
  }, [categories]);

  return {
    bundle,
    isXtream,
    status: bundle ? status : 'error',
    errorMessage: bundle ? errorMessage : 'Provider is not connected.',
    categories,
    categoryTotalCount,
    channels,
    selectedCategoryId,
    channelListPending,
    selectCategory,
    enrichFocusedChannelEpg,
    resolvePlaybackUrl,
    reload: loadCategories,
    initialChannel,
  };
}
