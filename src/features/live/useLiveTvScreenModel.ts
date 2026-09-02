import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildLiveChannelPlaybackSource, buildLiveChannelPlaybackUrl, warmLivePlaybackUrlContract } from '@/features/providers/providerPlayback';
import { mergeCategoryCountIndex, readCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveFavoritesCategoryId,
  providerLiveCategoriesOnly,
  resolveInitialLiveBrowseCategoryId,
} from '@/features/providers/liveCategoryIdSafety';
import { logLivePublicationTrace } from '@/features/providers/liveCatalogCompletion';
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
import {
  getPublishedLiveCatalogState,
  getPublishedLiveCategories,
  getPublishedLiveChannels,
} from '@/features/search/liveSearchSqliteCatalog';
import { ingestLiveChannels, ingestLiveSearchCategories } from '@/features/search/repositories/liveSearchRepository';
import { resetLiveTvFocusIdle } from './liveTvFocusIdle';
import { clearLiveTvChannelRowDataPool, mergeLiveTvChannelEpg } from './liveTvChannelRowData';
import { logLiveScreenReadTrace, logLiveScreenSource, type LiveTvScreenSource } from './liveTvScreenSource';
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
  const catalogSourceRef = useRef<LiveTvScreenSource | null>(null);
  const publishedSnapshotRef = useRef<{ generation: number; channelCount: number }>({ generation: 0, channelCount: 0 });

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
      logLiveScreenReadTrace('channel-read-start', {
        providerId: bundle.providerId,
        selectedCategoryId: categoryId,
        source: catalogSourceRef.current,
      });
      if (publishedSnapshotRef.current.generation > 0) {
        const next = await getPublishedLiveChannels(bundle.providerId, categoryId);
        catalogSourceRef.current = 'published-sqlite';
        logLiveStallAudit('live.getPublishedLiveChannels', next.length, startedAt);
        logLiveCategory('load-completed', {
          categoryId,
          channelCount: next.length,
          elapsedMs: Date.now() - startedAt,
          source: 'published-sqlite',
        });
        logLiveScreenReadTrace('channel-read-result', {
          providerId: bundle.providerId,
          readableGeneration: publishedSnapshotRef.current.generation,
          publishedGeneration: publishedSnapshotRef.current.generation,
          publishedTotal: publishedSnapshotRef.current.channelCount,
          channelCount: next.length,
          selectedCategoryId: categoryId,
          source: 'published-sqlite',
        });
        return next;
      }
      const publishedState = await getPublishedLiveCatalogState(bundle.providerId);
      if (publishedState.ready) {
        const next = await getPublishedLiveChannels(bundle.providerId, categoryId);
        catalogSourceRef.current = 'published-sqlite';
        logLiveStallAudit('live.getPublishedLiveChannels', next.length, startedAt);
        logLiveCategory('load-completed', {
          categoryId,
          channelCount: next.length,
          elapsedMs: Date.now() - startedAt,
          source: 'published-sqlite',
        });
        logLiveScreenReadTrace('channel-read-result', {
          providerId: bundle.providerId,
          readableGeneration: publishedState.generation,
          publishedGeneration: publishedState.generation,
          publishedTotal: publishedState.channelCount,
          channelCount: next.length,
          selectedCategoryId: categoryId,
          source: 'published-sqlite',
        });
        return next;
      }

      const next = await bundle.live.getChannels(categoryId, signal);
      catalogSourceRef.current = 'provider-fallback';
      logLivePublicationTrace('live-publication-skipped', {
        providerId: bundle.providerId,
        requestSource: 'live-tv-screen',
        publishedCount: next.length,
        skipReason: 'live-tv-direct-repository-getChannels',
      });
      logLiveStallAudit('live.getChannels', next.length, startedAt);
      logLiveCategory('load-completed', {
        categoryId,
        channelCount: next.length,
        elapsedMs: Date.now() - startedAt,
        source: 'provider-fallback',
      });
      logLiveScreenReadTrace('channel-read-result', {
        providerId: bundle.providerId,
        readableGeneration: publishedState.generation || null,
        publishedGeneration: publishedState.generation || null,
        publishedTotal: publishedState.channelCount || null,
        channelCount: next.length,
        selectedCategoryId: categoryId,
        source: 'provider-fallback',
        returnReason: publishedState.unreadinessReason ?? 'no-published-generation',
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
      logLiveScreenReadTrace('model-enter', { source: 'none', returnReason: 'provider-not-connected' });
      logLiveScreenReadTrace('early-return', { source: 'none', returnReason: 'provider-not-connected' });
      logLiveScreenSource({
        providerId: null,
        source: 'none',
        readableGeneration: null,
        publishedTotal: null,
        categoryCount: null,
        selectedCategoryId: null,
        loadedChannelCount: 0,
        fallbackReason: null,
        errorReason: 'Provider is not connected.',
      });
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
    let publishedState: Awaited<ReturnType<typeof getPublishedLiveCatalogState>> = {
      ready: false,
      generation: 0,
      channelCount: 0,
      counts: {},
      categoryNames: {},
      status: null,
      stateRowPresent: false,
      buildingGeneration: 0,
      stateChannelCount: 0,
      unreadinessReason: null,
    };
    let source: LiveTvScreenSource | null = null;
    let fallbackReason: string | null = null;
    logLiveScreenReadTrace('model-enter', {
      providerId: bundle.providerId,
      selectedCategoryId: initialCategoryId ?? null,
    });
    try {
      const categoriesStartedAt = Date.now();
      logLiveScreenReadTrace('published-state-read-start', {
        providerId: bundle.providerId,
      });
      publishedState = await getPublishedLiveCatalogState(bundle.providerId);
      publishedSnapshotRef.current = {
        generation: publishedState.ready ? publishedState.generation : 0,
        channelCount: publishedState.ready ? publishedState.channelCount : 0,
      };
      logLiveScreenReadTrace('published-state-read-result', {
        providerId: bundle.providerId,
        readableGeneration: publishedState.ready ? publishedState.generation : null,
        publishedGeneration: publishedState.generation || null,
        publishedTotal: publishedSnapshotRef.current.channelCount,
        categoryCount: Object.keys(publishedState.counts).length,
        channelCount: publishedState.channelCount,
        source: publishedState.ready ? 'published-sqlite' : 'none',
        returnReason: publishedState.unreadinessReason,
      });
      let nextCategories: ProviderLiveCategory[] = [];

      if (publishedState.ready) {
        logLiveScreenReadTrace('published-category-read-start', {
          providerId: bundle.providerId,
          readableGeneration: publishedState.generation,
          publishedGeneration: publishedState.generation,
          publishedTotal: publishedSnapshotRef.current.channelCount,
          source: 'published-sqlite',
        });
        nextCategories = await getPublishedLiveCategories(bundle.providerId, { state: publishedState });
        source = 'published-sqlite';
        catalogSourceRef.current = 'published-sqlite';
        logLiveStallAudit('live.getPublishedLiveCategories', nextCategories.length, categoriesStartedAt);
        logLiveScreenReadTrace('published-category-read-result', {
          providerId: bundle.providerId,
          readableGeneration: publishedState.generation,
          publishedGeneration: publishedState.generation,
          publishedTotal: publishedSnapshotRef.current.channelCount,
          categoryCount: nextCategories.length,
          source: 'published-sqlite',
          returnReason: nextCategories.length ? null : 'published-categories-empty',
        });
      } else {
        fallbackReason = publishedState.unreadinessReason ?? 'no-published-generation';
        nextCategories = await bundle.live.getCategories(signal);
        source = 'provider-fallback';
        catalogSourceRef.current = 'provider-fallback';
        logLivePublicationTrace('live-publication-skipped', {
          providerId: bundle.providerId,
          requestSource: 'live-tv-screen',
          publishedCount: nextCategories.length,
          skipReason: 'live-tv-direct-repository-getCategories',
        });
        logLiveStallAudit('live.getCategories', nextCategories.length, categoriesStartedAt);
      }
      logLiveScreenReadTrace('source-selection', {
        providerId: bundle.providerId,
        readableGeneration: publishedState.ready ? publishedState.generation : null,
        publishedGeneration: publishedState.generation || null,
        publishedTotal: publishedSnapshotRef.current.channelCount,
        categoryCount: nextCategories.length,
        source,
        returnReason: fallbackReason,
      });
      if (requestId !== requestRef.current) {
        logLiveScreenReadTrace('early-return', {
          providerId: bundle.providerId,
          readableGeneration: publishedState.ready ? publishedState.generation : null,
          publishedGeneration: publishedState.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount,
          categoryCount: nextCategories.length,
          source: source ?? 'none',
          returnReason: 'stale-request-after-categories',
        });
        logLiveScreenSource({
          providerId: bundle.providerId,
          source: source ?? 'none',
          readableGeneration: publishedState.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount || null,
          categoryCount: nextCategories.length,
          selectedCategoryId: null,
          loadedChannelCount: 0,
          fallbackReason,
          errorReason: 'stale-request-after-categories',
        });
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
        source,
      });
      logLivePerformance({
        event: 'categories-ready',
        elapsedMs: Date.now() - mountStartedAtRef.current,
        providerIdPresent: Boolean(bundle.providerId),
        categoryCount: providerCategories.length,
        selectedCategoryIdPresent: false,
        source: source === 'published-sqlite' ? 'sqlite' : source === 'provider-fallback' ? 'network' : 'repository',
        epgPending: false,
        discoverPending: false,
      });

      if (!providerCategories.length) {
        channelsBaselineRef.current = [];
        setChannels([]);
        setSelectedCategoryId('');
        setChannelListPending(false);
        setStatus('empty');
        logLiveScreenSource({
          providerId: bundle.providerId,
          source,
          readableGeneration: publishedState.generation || null,
          publishedTotal: publishedState.channelCount || null,
          categoryCount: 0,
          selectedCategoryId: null,
          loadedChannelCount: 0,
          fallbackReason,
          errorReason: source === 'published-sqlite' ? 'published-generation-had-no-categories' : 'provider-categories-empty',
        });
        return;
      }

      let resolvedCategoryId = resolveInitialLiveBrowseCategoryId(initialCategoryId, providerCategories);
      if (!isRealProviderLiveCategoryId(resolvedCategoryId)) {
        resolvedCategoryId =
          providerCategories.find((category) => isRealProviderLiveCategoryId(category.id))?.id ??
          providerCategories[0]?.id ??
          '';
      }
      setSelectedCategoryId(resolvedCategoryId);
      logLiveScreenReadTrace('selected-category-resolved', {
        providerId: bundle.providerId,
        readableGeneration: publishedState.ready ? publishedState.generation : null,
        publishedGeneration: publishedState.generation || null,
        publishedTotal: publishedSnapshotRef.current.channelCount,
        categoryCount: providerCategories.length,
        selectedCategoryId: resolvedCategoryId || null,
        source,
        returnReason: resolvedCategoryId ? null : 'no-valid-category-id',
      });
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

      if (source === 'published-sqlite' && bundle.live.getCategoryAccentHints) {
        void bundle.live.getCategoryAccentHints(signal)
          .then((hints) => {
            if (requestId !== requestRef.current || !hints.length) {
              return;
            }
            const names = new Map<string, string>();
            for (const hint of hints) {
              const id = hint.id?.trim();
              const name = hint.name?.trim();
              if (id && name) {
                names.set(id, name);
              }
            }
            if (!names.size) {
              return;
            }
            ingestLiveSearchCategories(
              bundle.providerId,
              [...names.entries()].map(([id, name]) => ({ id, name })),
            );
            setBaseCategories((current) => {
              let changed = false;
              const next = current.map((category) => {
                const overlay = names.get(category.id);
                if (!overlay || overlay === category.name) {
                  return category;
                }
                changed = true;
                return { ...category, name: overlay, rawName: overlay };
              });
              return changed ? next : current;
            });
          })
          .catch(() => undefined);
      }

      const nextChannels = await loadChannelsForCategory(resolvedCategoryId, signal);
      if (requestId !== requestRef.current) {
        logLiveScreenReadTrace('early-return', {
          providerId: bundle.providerId,
          readableGeneration: publishedState.ready ? publishedState.generation : null,
          publishedGeneration: publishedState.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount,
          categoryCount: providerCategories.length,
          channelCount: nextChannels.length,
          selectedCategoryId: resolvedCategoryId || null,
          source: source ?? 'none',
          returnReason: 'stale-request-after-channels',
        });
        logLiveScreenSource({
          providerId: bundle.providerId,
          source: source ?? 'none',
          readableGeneration: publishedState.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount || null,
          categoryCount: providerCategories.length,
          selectedCategoryId: resolvedCategoryId || null,
          loadedChannelCount: nextChannels.length,
          fallbackReason,
          errorReason: 'stale-request-after-channels',
        });
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
        logLiveScreenSource({
          providerId: bundle.providerId,
          source,
          readableGeneration: publishedState.generation || null,
          publishedTotal: publishedState.channelCount || null,
          categoryCount: providerCategories.length,
          selectedCategoryId: resolvedCategoryId,
          loadedChannelCount: 0,
          fallbackReason,
          errorReason: null,
        });
        return;
      }

      commitChannels(mapChannelsWithoutEpg(nextChannels));
      setChannelListPending(false);
      setStatus('ready');
      logLiveScreenSource({
        providerId: bundle.providerId,
        source,
        readableGeneration: publishedState.generation || null,
        publishedTotal: publishedState.channelCount || null,
        categoryCount: providerCategories.length,
        selectedCategoryId: resolvedCategoryId,
        loadedChannelCount: nextChannels.length,
        fallbackReason,
        errorReason: null,
      });
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
        source: source === 'published-sqlite' ? 'sqlite' : source === 'provider-fallback' ? 'network' : 'repository',
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
          source: source === 'published-sqlite' ? 'sqlite' : source === 'provider-fallback' ? 'network' : 'repository',
          epgPending: true,
          discoverPending: false,
        });
      }

      prefetchChannelEpg(requestId, nextChannels, resolvedCategoryId);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aborted = requestId !== requestRef.current || signal.aborted;
      logLiveScreenReadTrace('error', {
        providerId: bundle.providerId,
        readableGeneration: publishedState.ready ? publishedState.generation : null,
        publishedGeneration: publishedState.generation || null,
        publishedTotal: publishedSnapshotRef.current.channelCount || publishedState.channelCount || null,
        source: source ?? (publishedState.ready ? 'published-sqlite' : 'none'),
        returnReason: aborted ? (signal.aborted ? 'aborted' : 'stale-request-in-catch') : 'load-failed',
        errorName,
        errorMessage,
      });
      logLiveScreenSource({
        providerId: bundle.providerId,
        source: source ?? (publishedState.ready ? 'published-sqlite' : 'none'),
        readableGeneration: publishedState.generation || null,
        publishedTotal: publishedSnapshotRef.current.channelCount || publishedState.channelCount || null,
        categoryCount: null,
        selectedCategoryId: null,
        loadedChannelCount: 0,
        fallbackReason,
        errorReason: aborted
          ? signal.aborted
            ? 'aborted'
            : 'stale-request-in-catch'
          : 'Unable to load live channels from your provider.',
      });
      if (aborted) {
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
        logLiveScreenSource({
          providerId: bundle.providerId,
          source: catalogSourceRef.current,
          readableGeneration: publishedSnapshotRef.current.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount || null,
          categoryCount: null,
          selectedCategoryId: categoryId,
          loadedChannelCount: immediate.length,
          fallbackReason: catalogSourceRef.current === 'provider-fallback' ? 'no-published-generation' : null,
          errorReason: null,
        });
        logLivePerformance({
          event: 'category-switch-first-channels',
          elapsedMs: Date.now() - startedAt,
          providerIdPresent: Boolean(bundle.providerId),
          channelCount: immediate.length,
          selectedCategoryIdPresent: true,
          source: catalogSourceRef.current === 'published-sqlite' ? 'sqlite' : catalogSourceRef.current === 'provider-fallback' ? 'network' : 'repository',
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
        logLiveScreenSource({
          providerId: bundle.providerId,
          source: catalogSourceRef.current ?? 'none',
          readableGeneration: publishedSnapshotRef.current.generation || null,
          publishedTotal: publishedSnapshotRef.current.channelCount || null,
          categoryCount: null,
          selectedCategoryId: categoryId,
          loadedChannelCount: 0,
          fallbackReason: catalogSourceRef.current === 'provider-fallback' ? 'no-published-generation' : null,
          errorReason: 'Unable to load channels for this category.',
        });
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

  useEffect(() => {
    if (!bundle || !channels[0]) {
      return;
    }
    warmLivePlaybackUrlContract(bundle, channels[0]);
  }, [bundle, channels]);

  const resolvePlaybackUrl = useCallback(
    (channel: ProviderLiveChannel | null) => {
      if (!bundle || !channel) {
        return null;
      }

      return buildLiveChannelPlaybackUrl(bundle, channel);
    },
    [bundle],
  );

  const resolvePlaybackSource = useCallback(
    (channel: ProviderLiveChannel | null) => {
      if (!bundle || !channel) {
        return null;
      }

      return buildLiveChannelPlaybackSource(bundle, channel);
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
    resolvePlaybackSource,
    reload: loadCategories,
    initialChannel,
  };
}
