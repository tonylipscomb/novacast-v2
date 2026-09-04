import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildLiveChannelPlaybackSource, buildLiveChannelPlaybackUrl, warmLivePlaybackUrlContract } from '@/features/providers/providerPlayback';
import { mergeCategoryCountIndex, readCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveFavoritesCategoryId,
  isSyntheticLiveMyChannelsCategoryId,
  isSyntheticLivePersonalizationCategoryId,
  providerLiveCategoriesOnly,
  resolveInitialLiveBrowseCategoryId,
} from '@/features/providers/liveCategoryIdSafety';
import { derivedLiveCategoryName, logLivePublicationTrace } from '@/features/providers/liveCatalogCompletion';
import { buildCategoryRegionalProfile } from '@/features/providers/categoryRegionalPipeline';
import type {
  ProviderLiveCategory,
  ProviderLiveCategoryAccentHint,
  ProviderLiveChannel,
} from '@/features/providers/providerRepositories';
import { sortLiveCategoriesUsFirst } from '@/features/providers/usAmericanSort';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { usePersonalizationStore } from '@/features/personalization/personalizationStore';
import { getLiveChannelIndexEntry } from '@/features/search/liveChannelIndex';

import {
  composeLiveCategoryRail,
  resolveMyChannelsLiveChannels,
  resolveRecentLiveChannels,
} from './liveSyntheticCategories';

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
import { computeLiveStartupKey, shouldRestartLiveStartup } from './liveTvStartupGate';
import { clearLiveTvChannelRowDataPool, mergeLiveTvChannelEpg } from './liveTvChannelRowData';
import { logLiveScreenReadTrace, logLiveScreenSource, type LiveTvScreenSource } from './liveTvScreenSource';
import {
  logLiveCategory,
  logLiveCategoryOrderAudit,
  logLiveEpgTrigger,
  logLivePerformance,
  logLiveStabilityLoader,
  logLiveStallAudit,
  logLiveStartup,
  type LiveCategoryNameSource,
} from './liveTvDiagnostics';
import type { LiveTvLoadStatus } from './liveTvLogic';

export type { LiveTvLoadStatus } from './liveTvLogic';

type LiveLoadAudit = (event: string, fields?: Record<string, unknown>) => void;

// DEV-only: enrich the first 10 categories with the real name used for sorting,
// its source, and the region bucket / sort label the regional pipeline derives.
function buildLiveCategoryOrderSample(
  categories: readonly ProviderLiveCategory[],
  resolveNameSource: (id: string, name: string) => LiveCategoryNameSource,
) {
  return categories.slice(0, 10).map((category) => {
    const profile = buildCategoryRegionalProfile({
      name: category.name,
      rawName: category.rawName,
      contentType: 'live',
    });
    return {
      id: category.id,
      name: category.name,
      categoryNameUsedForSort: category.name,
      categoryNameSource: resolveNameSource(category.id, category.name),
      regionBucket: profile.regionGroup,
      sortLabel: profile.sortLabel,
    };
  });
}

export function useLiveTvScreenModel(
  initialCategoryId?: string,
  initialChannelId?: string | null,
  options: { onLoadAudit?: LiveLoadAudit } = {},
) {
  const { bundle, isXtream } = useActiveProviderBundle();
  const { onLoadAudit } = options;
  const personalization = usePersonalizationStore(bundle?.providerId ?? '');
  const liveFavoriteRecords = personalization.state.liveFavorites;
  const recentRecords = personalization.state.recentItems;
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
  const categoryMetadataKeyRef = useRef<string | null>(null);
  const channelCacheRef = useRef(new Map<string, ProviderLiveChannel[]>());
  const publishedSnapshotRef = useRef<{ generation: number; channelCount: number }>({ generation: 0, channelCount: 0 });

  const providerCategories = useMemo(() => providerLiveCategoriesOnly(baseCategories), [baseCategories]);

  const myChannelsCount = useMemo(
    () => liveFavoriteRecords.filter((record) => record.mediaType === 'live').length,
    [liveFavoriteRecords],
  );
  const recentsLiveCount = useMemo(
    () => recentRecords.filter((item) => item.mediaType === 'live').length,
    [recentRecords],
  );

  // Final rail: My Channels, Recents, then the US-first sorted provider list.
  const categories = useMemo(
    () => composeLiveCategoryRail(providerCategories, { myChannelsCount, recentsCount: recentsLiveCount }),
    [providerCategories, myChannelsCount, recentsLiveCount],
  );

  const providerIdForResolve = bundle?.providerId ?? '';
  const myChannelsLiveChannels = useMemo(
    () =>
      resolveMyChannelsLiveChannels(liveFavoriteRecords, {
        loadedChannels: channelsBaselineRef.current,
        getIndexEntry: providerIdForResolve
          ? (id) => getLiveChannelIndexEntry(providerIdForResolve, id)
          : undefined,
      }),
    [liveFavoriteRecords, providerIdForResolve],
  );
  const recentLiveChannels = useMemo(
    () =>
      resolveRecentLiveChannels(recentRecords, {
        loadedChannels: channelsBaselineRef.current,
        getIndexEntry: providerIdForResolve
          ? (id) => getLiveChannelIndexEntry(providerIdForResolve, id)
          : undefined,
      }),
    [recentRecords, providerIdForResolve],
  );

  // Synthetic categories build their channel list from personalization data only —
  // never a provider fetch. This effect also keeps the list live when a favorite is
  // toggled or a channel is tuned while the synthetic category is selected.
  useEffect(() => {
    if (!isSyntheticLivePersonalizationCategoryId(selectedCategoryId)) {
      return;
    }
    const next = isSyntheticLiveMyChannelsCategoryId(selectedCategoryId)
      ? myChannelsLiveChannels
      : recentLiveChannels;
    channelsBaselineRef.current = next;
    setChannels(next);
    setChannelListPending(false);
    setStatus(next.length ? 'ready' : 'empty');
  }, [selectedCategoryId, myChannelsLiveChannels, recentLiveChannels]);

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
      const generation = publishedSnapshotRef.current.generation;
      const cacheKey = `${bundle.providerId}:${generation}:${categoryId}`;
      const cachedChannels = generation > 0 ? channelCacheRef.current.get(cacheKey) : undefined;
      if (cachedChannels) {
        onLoadAudit?.('channel-load', {
          categoryId,
          action: 'reused',
          source: 'memory-cache',
          channelCount: cachedChannels.length,
          durationMs: 0,
        });
        return cachedChannels;
      }
      onLoadAudit?.('channel-load-start', { categoryId, source: generation > 0 ? 'published-sqlite' : 'pending', action: 'executed' });
      logLiveCategory('load-started', { categoryId });
      logLiveScreenReadTrace('channel-read-start', {
        providerId: bundle.providerId,
        selectedCategoryId: categoryId,
        source: catalogSourceRef.current,
      });
      if (publishedSnapshotRef.current.generation > 0) {
        const next = await getPublishedLiveChannels(bundle.providerId, categoryId, {
          publishedGeneration: generation,
          publishedChannelCount: publishedSnapshotRef.current.channelCount,
        });
        channelCacheRef.current.set(cacheKey, next);
        catalogSourceRef.current = 'published-sqlite';
        logLiveStallAudit('live.getPublishedLiveChannels', next.length, startedAt);
        logLiveCategory('load-completed', {
          categoryId,
          channelCount: next.length,
          elapsedMs: Date.now() - startedAt,
          source: 'published-sqlite',
        });
        onLoadAudit?.('channel-load-complete', { categoryId, channelCount: next.length, source: 'published-sqlite', durationMs: Date.now() - startedAt });
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
        const next = await getPublishedLiveChannels(bundle.providerId, categoryId, {
          publishedGeneration: publishedState.generation,
          publishedChannelCount: publishedState.channelCount,
        });
        channelCacheRef.current.set(`${bundle.providerId}:${publishedState.generation}:${categoryId}`, next);
        catalogSourceRef.current = 'published-sqlite';
        logLiveStallAudit('live.getPublishedLiveChannels', next.length, startedAt);
        logLiveCategory('load-completed', {
          categoryId,
          channelCount: next.length,
          elapsedMs: Date.now() - startedAt,
          source: 'published-sqlite',
        });
        onLoadAudit?.('channel-load-complete', { categoryId, channelCount: next.length, source: 'published-sqlite', durationMs: Date.now() - startedAt });
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
      onLoadAudit?.('channel-load-complete', { categoryId, channelCount: next.length, source: 'provider-fallback', durationMs: Date.now() - startedAt });
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
    [bundle, onLoadAudit],
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
      const epgStartedAt = Date.now();
      onLoadAudit?.('epg-init', {
        categoryId,
        channelCount: nextChannels.length,
        blocking: false,
      });
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
        onLoadAudit?.('epg-first-usable', {
          categoryId,
          channelCount: fullyEnriched.length,
          durationMs: Date.now() - epgStartedAt,
          blocking: false,
        });
      });
    },
    [applyIncrementalEpg, bundle, commitChannels, initialChannelId, onLoadAudit],
  );

  const loadCategories = useCallback(async () => {
    const categoryStartedAt = Date.now();
    onLoadAudit?.('category-load-start', { providerId: bundle?.providerId ?? null });
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
        const categoryCacheKey = `${bundle.providerId}:${publishedState.generation}`;
        const categoryWasLoaded = categoryMetadataKeyRef.current === categoryCacheKey;
        onLoadAudit?.('category-metadata-read', {
          providerId: bundle.providerId,
          generation: publishedState.generation,
          action: categoryWasLoaded ? 'reused' : 'executed',
          source: categoryWasLoaded ? 'memory-cache' : 'published-sqlite',
        });
        nextCategories = await getPublishedLiveCategories(bundle.providerId, { state: publishedState });
        categoryMetadataKeyRef.current = categoryCacheKey;
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
        categoryMetadataKeyRef.current = `${bundle.providerId}:0`;
        onLoadAudit?.('category-metadata-read', {
          providerId: bundle.providerId,
          generation: 0,
          action: 'executed',
          source: 'provider-fallback',
        });
      }
      onLoadAudit?.('category-load-complete', {
        categoryCount: nextCategories.length,
        source,
        durationMs: Date.now() - categoryStartedAt,
      });
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

      const filteredCategories = providerLiveCategoriesOnly(nextCategories).map((category) => ({
        ...category,
        count: category.count ?? null,
      }));
      const orderToken = publishedState.ready ? publishedState.generation : 0;

      // Attach REAL category names BEFORE the regional sort. The published SQLite
      // path can hand back synthetic "Live {id}" labels when category_name was not
      // persisted for this generation; sorting those mislabels every region and the
      // real names would only be painted on afterwards (wrong order). Provider
      // fallback already carries real provider names.
      const enrichedNameIds = new Set<string>();
      let namedCategories = filteredCategories;
      const hasSyntheticName = filteredCategories.some(
        (category) => category.name === derivedLiveCategoryName(category.id),
      );
      if (hasSyntheticName && bundle.live.getCategoryAccentHints) {
        const hints = await bundle.live
          .getCategoryAccentHints(signal)
          .catch(() => [] as ProviderLiveCategoryAccentHint[]);
        if (requestId !== requestRef.current) {
          logLiveScreenReadTrace('early-return', {
            providerId: bundle.providerId,
            readableGeneration: publishedState.ready ? publishedState.generation : null,
            publishedGeneration: publishedState.generation || null,
            publishedTotal: publishedSnapshotRef.current.channelCount,
            categoryCount: filteredCategories.length,
            source: source ?? 'none',
            returnReason: 'stale-request-after-accent-hints',
          });
          return;
        }
        if (hints.length) {
          const realNames = new Map<string, string>();
          for (const hint of hints) {
            const id = hint.id?.trim();
            const name = hint.name?.trim();
            if (id && name) {
              realNames.set(id, name);
            }
          }
          if (realNames.size) {
            namedCategories = filteredCategories.map((category) => {
              const real = realNames.get(category.id);
              if (real && real !== category.name) {
                enrichedNameIds.add(category.id);
                return { ...category, name: real, rawName: real };
              }
              return category;
            });
            ingestLiveSearchCategories(
              bundle.providerId,
              [...realNames.entries()].map(([id, name]) => ({ id, name })),
            );
          }
        }
      }

      const resolveCategoryNameSource = (id: string, name: string): LiveCategoryNameSource => {
        if (name === derivedLiveCategoryName(id)) {
          return 'synthetic-fallback';
        }
        if (enrichedNameIds.has(id)) {
          return 'provider-category-name';
        }
        return source === 'published-sqlite' ? 'published-category-name' : 'provider-category-name';
      };
      const namesResolved = !hasSyntheticName || enrichedNameIds.size > 0;

      logLiveStabilityLoader('categories-named', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        namesResolved,
        categoryCount: namedCategories.length,
      });
      logLiveCategoryOrderAudit('raw-categories-ready', {
        providerId: bundle.providerId,
        generation: orderToken,
        categoryCount: namedCategories.length,
        sample: buildLiveCategoryOrderSample(namedCategories, resolveCategoryNameSource),
        orderReady: false,
        selectionSource: 'provisional',
        orderToken,
      });

      // Single atomic final sort on REAL names — the only category commit.
      const providerCategories = sortLiveCategoriesUsFirst(namedCategories);
      logLiveStabilityLoader('categories-sorted', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        namesResolved,
        categoryOrderReady: true,
        categoryCount: providerCategories.length,
      });
      logLiveCategoryOrderAudit('sorted-categories-ready', {
        providerId: bundle.providerId,
        generation: orderToken,
        categoryCount: providerCategories.length,
        sample: buildLiveCategoryOrderSample(providerCategories, resolveCategoryNameSource),
        finalSortedNames: providerCategories.map((category) => category.name),
        orderReady: true,
        orderToken,
      });
      setBaseCategories(providerCategories);
      ingestLiveSearchCategories(bundle.providerId, providerCategories);
      logLiveCategoryOrderAudit('categories-state-committed', {
        providerId: bundle.providerId,
        generation: orderToken,
        categoryCount: providerCategories.length,
        sample: buildLiveCategoryOrderSample(providerCategories, resolveCategoryNameSource),
        orderReady: true,
        orderToken,
      });
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
      logLiveStabilityLoader('selection-resolved', {
        elapsedMs: Date.now() - mountStartedAtRef.current,
        namesResolved,
        categoryOrderReady: true,
        selectionResolved: Boolean(resolvedCategoryId),
        categoryCount: providerCategories.length,
        selectedCategoryId: resolvedCategoryId || null,
      });
      const explicitInitialSelection =
        isRealProviderLiveCategoryId(initialCategoryId) &&
        providerCategories.some((category) => category.id === initialCategoryId);
      logLiveCategoryOrderAudit('initial-category-resolved', {
        providerId: bundle.providerId,
        generation: orderToken,
        categoryCount: providerCategories.length,
        selectedCategoryId: resolvedCategoryId || null,
        selectedCategoryName:
          providerCategories.find((category) => category.id === resolvedCategoryId)?.name ?? null,
        selectionSource: explicitInitialSelection ? 'persisted-user' : 'auto-default',
        orderReady: true,
        orderToken,
      });
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

      // Defer EPG prefetch one macrotask so the just-committed channel list can
      // paint before the (potentially JS-blocking) provider EPG read runs.
      setTimeout(() => {
        if (requestId !== requestRef.current) {
          return;
        }
        prefetchChannelEpg(requestId, nextChannels, resolvedCategoryId);
      }, 0);
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
  }, [bundle, initialCategoryId, commitChannels, loadChannelsForCategory, onLoadAudit, prefetchChannelEpg, updateCategoryCount]);

  const loadCategoriesRef = useRef(loadCategories);
  const lastStartupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadCategoriesRef.current = loadCategories;
  }, [loadCategories]);

  useEffect(() => {
    const startupKey = computeLiveStartupKey(bundle?.providerId, bundle?.generation);
    if (!shouldRestartLiveStartup(lastStartupKeyRef.current, startupKey)) {
      // Same provider + published generation: a persisted initial-category
      // change must not restart the full startup pipeline. Provider change,
      // generation change, or a remount all change the key and still run.
      return;
    }
    lastStartupKeyRef.current = startupKey;
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
      if (isSyntheticLivePersonalizationCategoryId(categoryId)) {
        // Synthetic categories resolve from personalization data — no provider fetch.
        ++requestRef.current;
        resetLiveTvFocusIdle();
        epgFetchedIdsRef.current.clear();
        epgInFlightIdsRef.current.clear();
        if (focusedEpgTimerRef.current) {
          clearTimeout(focusedEpgTimerRef.current);
          focusedEpgTimerRef.current = null;
        }
        cancelLiveTvEpgWork('category-switch');
        clearLiveTvChannelRowDataPool();
        const next = isSyntheticLiveMyChannelsCategoryId(categoryId)
          ? myChannelsLiveChannels
          : recentLiveChannels;
        setSelectedCategoryId(categoryId);
        channelsBaselineRef.current = next;
        setChannels(next);
        setChannelListPending(false);
        setStatus(next.length ? 'ready' : 'empty');
        logLiveCategory('selection-accepted', { categoryId, reason: 'synthetic-personalization' });
        return next;
      }
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
    [
      bundle,
      commitChannels,
      loadChannelsForCategory,
      prefetchChannelEpg,
      updateCategoryCount,
      myChannelsLiveChannels,
      recentLiveChannels,
    ],
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
    if (!providerCategories.length || providerCategories.some((category) => category.count == null)) {
      return null;
    }

    return providerCategories.reduce((total, category) => total + (category.count ?? 0), 0);
  }, [providerCategories]);

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
