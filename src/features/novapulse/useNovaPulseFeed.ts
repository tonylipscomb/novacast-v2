import { useEffect, useMemo, useRef, useState } from 'react';

import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';
import { Image } from 'expo-image';
import type { MovieSummary } from '@/features/movies/movieTypes';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { NOVA_PULSE_MOCK_FEED } from './novaPulseMockFeed';
import { createNovaPulseCatalogSource, createNovaPulseLiveEpgSource, createNovaPulseMockSource, createNovaPulseSportsSource } from './novaPulseSources';
import { fetchNovaPulseSportsItems, NOVA_PULSE_SPORTS_ENABLED } from './novaPulseSportsSource';
import type { NovaPulseItem } from './novaPulseTypes';
import { createNovaPulseArtworkPrefetchPlan, inspectNovaPulseArtworkPrefetch } from './novaPulseArtworkPrefetch';
import { composeNovaPulseFeedV2, createNovaPulseCompositionSession } from './novaPulseV2';
import { createNovaPulseHistoryWriteGate, getCachedNovaPulseHistory, hasCachedNovaPulseHistory, loadNovaPulseHistory, recordNovaPulseSelection } from './novaPulseHistory';
import { hasNovaPulseDisplayPrefix, preferNovaPulseEnglishVariants, type NovaPulseVariantDiagnostics } from './novaPulseLogic';
import { getCachedProviderMovieInfo } from '@/features/movies/movieDetailEnrichment';
import { getSeriesMetadataCacheEntry, type SeriesMetadataCacheEntry } from '@/features/series/metadata/seriesMetadataCache';
import { enrichNovaPulsePresentation } from './novaPulsePresentation';
import { runNovaPulseEnrichmentCycle, type NovaPulseEnrichmentDiagnostics, type NovaPulseMovieEnrichment } from './novaPulseEnrichment';
import { runNovaPulseLiveEpgCycle, type NovaPulseLiveEpgDiagnostics } from './novaPulseLiveEpg';
import { getCachedNovaPulseAnnouncements, loadNovaPulseAnnouncements, NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED, type NovaPulseAnnouncementsResult } from './novaPulseAnnouncements';
import { curateNovaPulseCatalog } from './novaPulseCuration';
import { getActiveContentPolicy as getContentPolicy } from '@/features/content-policy/ContentPolicyService';
import type { HomeFavoriteChannel } from '@/features/personalization/personalizationHome';
import type { RecentItemRecord } from '@/features/personalization/personalizationModel';
import type { ProviderGuideProgram } from '@/features/providers/providerRepositories';
import { getRecommendationCandidates, type RecommendationCandidate } from './recommendationCandidateClient';
import {
  buildNovaPulseCatalogBridge,
  buildNovaPulsePersonalSeeds,
  createLocalSignalMap,
  recommendationSignalForCandidate,
  type NovaPulseLocalRecommendationContext,
} from './recommendationFeed';

const EMPTY_NOVA_PULSE_HISTORY = [] as const;

type UseNovaPulseFeedOptions = {
  providerId: string;
  movies: readonly MovieSummary[];
  series: readonly SeriesSummary[];
  fetchMovieDetail?: (movieId: string) => Promise<import('@/features/media-browser/mediaTypes').MediaDetail | null>;
  fetchSeriesDetail?: (seriesId: string) => Promise<import('@/features/media-browser/mediaTypes').SeriesDetail | null>;
  recommendationContext?: NovaPulseLocalRecommendationContext;
  liveEpg?: {
    favoriteChannels: readonly HomeFavoriteChannel[];
    recentItems: readonly RecentItemRecord[];
    getIndexEntry?: (channelId: string) => ReturnType<typeof import('@/features/search/liveChannelIndex').getLiveChannelIndexEntry>;
    getIndexSize?: () => number;
    getShortEpg?: (channelId: string, limit?: number, signal?: AbortSignal, epgChannelId?: string) => Promise<ProviderGuideProgram[]>;
  };
  diagnostics?: {
    movieIndex: number;
    seriesIndex: number;
    movieRecentlyWatched: number;
    seriesRecentlyWatched: number;
    movieWatchlist: number;
    seriesWatchlist: number;
    movieFavorites: number;
    seriesFavorites: number;
    movieIndexExtracted: number;
    seriesIndexExtracted: number;
    activeProviderChanged: boolean;
    movieLocalHydrationAttempted: boolean;
    seriesLocalHydrationAttempted: boolean;
    movieLocalHydrationCount: number;
    seriesLocalHydrationCount: number;
    movieArtworkLoadSuccess: number;
    movieArtworkLoadError: number;
    seriesArtworkLoadSuccess: number;
    seriesArtworkLoadError: number;
  };
};

const NOVA_PULSE_BRANDED_FALLBACK: NovaPulseItem = {
  id: 'novacast-branded-fallback',
  type: 'announcement',
  subtype: 'featured',
  title: 'NovaCast',
  message: 'Your featured NovaPulse updates will appear here soon.',
  announcementType: 'general',
  announcementPriority: 'normal',
  priority: 1,
  action: { type: 'none' },
};

export function useNovaPulseFeed({ providerId, movies, series, fetchMovieDetail, fetchSeriesDetail, recommendationContext, liveEpg, diagnostics }: UseNovaPulseFeedOptions): readonly NovaPulseItem[] {
  const [realSports, setRealSports] = useState<readonly NovaPulseItem[] | null>(null);
  const [cachedArtworkRefs, setCachedArtworkRefs] = useState<ReadonlyMap<string, import('expo-image').ImageRef>>(() => new Map());
  const lastDiagnosticSignatureRef = useRef<string | null>(null);
  const lastV2SignatureRef = useRef<string | null>(null);
  const lastRecommendationFeedSignatureRef = useRef<string | null>(null);
  const [backendCandidates, setBackendCandidates] = useState<readonly RecommendationCandidate[]>([]);
  const [recommendationRequestAttempted, setRecommendationRequestAttempted] = useState(false);
  const [recommendationCacheHit, setRecommendationCacheHit] = useState(false);
  const [cachedSeriesMetadataState, setCachedSeriesMetadataState] = useState<{ providerId: string; entries: ReadonlyMap<string, SeriesMetadataCacheEntry> }>({ providerId: '', entries: new Map() });
  const [enrichmentState, setEnrichmentState] = useState<{ providerId: string; movies: ReadonlyMap<string, NovaPulseMovieEnrichment>; series: ReadonlyMap<string, SeriesMetadataCacheEntry>; seriesDetails: ReadonlyMap<string, import('@/features/media-browser/mediaTypes').SeriesDetail>; translations: ReadonlyMap<string, string>; diagnostics: NovaPulseEnrichmentDiagnostics | null }>({ providerId: '', movies: new Map(), series: new Map(), seriesDetails: new Map(), translations: new Map(), diagnostics: null });
  const [liveEpgState, setLiveEpgState] = useState<{ providerId: string; items: readonly NovaPulseItem[]; diagnostics: NovaPulseLiveEpgDiagnostics | null }>({ providerId: '', items: [], diagnostics: null });
  const [compositionSession] = useState(() => createNovaPulseCompositionSession());
  const [compositionContentPolicy] = useState(() => getContentPolicy());
  const [announcementSession, setAnnouncementSession] = useState<{ providerId: string; result: NovaPulseAnnouncementsResult | null }>(() => ({ providerId, result: getCachedNovaPulseAnnouncements() }));
  const announcementFrozenRef = useRef(false);
  const [, setHistoryRevision] = useState(0);
  const historySessionRef = useRef<{ providerId: string; entries: ReturnType<typeof getCachedNovaPulseHistory> | null; compositionStarted: boolean } | null>(null);
  if (!historySessionRef.current || historySessionRef.current.providerId !== providerId) {
    historySessionRef.current = {
      providerId,
      entries: hasCachedNovaPulseHistory(providerId) ? getCachedNovaPulseHistory(providerId) : null,
      compositionStarted: false,
    };
  }
  const historySnapshot = historySessionRef.current.entries ?? EMPTY_NOVA_PULSE_HISTORY;
  const historyWriteRef = useRef<{ providerId: string; shouldWrite: () => boolean }>({ providerId, shouldWrite: createNovaPulseHistoryWriteGate() });
  if (historyWriteRef.current.providerId !== providerId) historyWriteRef.current = { providerId, shouldWrite: createNovaPulseHistoryWriteGate() };
  const fetchMovieDetailRef = useRef<UseNovaPulseFeedOptions['fetchMovieDetail']>(fetchMovieDetail);
  fetchMovieDetailRef.current = fetchMovieDetail;
  const fetchSeriesDetailRef = useRef<UseNovaPulseFeedOptions['fetchSeriesDetail']>(fetchSeriesDetail);
  fetchSeriesDetailRef.current = fetchSeriesDetail;
  const liveEpgIndexEntryRef = useRef(liveEpg?.getIndexEntry);
  const liveEpgFetcherRef = useRef(liveEpg?.getShortEpg);
  liveEpgIndexEntryRef.current = liveEpg?.getIndexEntry;
  liveEpgFetcherRef.current = liveEpg?.getShortEpg;
  const seriesMetadataReadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    void loadNovaPulseHistory(providerId).then((result) => {
      const session = historySessionRef.current;
      if (session?.providerId === providerId && !session.compositionStarted) {
        session.entries = result.entries;
        setHistoryRevision((revision) => revision + 1);
      }
      const metadata = { entriesLoaded: result.loadedCount, expiredRemoved: result.expiredRemoved, storageFailed: result.storageFailed };
      console.info('[NOVAPULSE_HISTORY]', JSON.stringify(metadata));
      recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_history_load', ...metadata } });
    }).catch(() => undefined);
  }, [providerId]);
  useEffect(() => {
    if (!NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED) return;
    announcementFrozenRef.current = false;
    let active = true;
    const controller = new AbortController();
    void loadNovaPulseAnnouncements(controller.signal).then((result) => {
      if (!active || announcementFrozenRef.current) return;
      announcementFrozenRef.current = true;
      setAnnouncementSession((current) => current.providerId === providerId ? { providerId, result } : current);
    }).catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [providerId]);
  useEffect(() => {
    if (!NOVA_PULSE_SPORTS_ENABLED) {
      setRealSports(null);
      return;
    }
    let active = true;
    void fetchNovaPulseSportsItems().then((items) => { if (active && items) setRealSports(items); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const boundedMovies = useMemo(() => movies.slice(0, 56), [movies]);
  const boundedSeries = useMemo(() => series.slice(0, 32), [series]);
  const recommendationSeeds = useMemo(
    () => buildNovaPulsePersonalSeeds(recommendationContext ?? {
      recentlyWatched: [],
      favoriteMovies: [],
      watchlistMovies: [],
      favoriteSeries: [],
      watchlistSeries: [],
    }),
    [recommendationContext?.recentlyWatched, recommendationContext?.favoriteMovies, recommendationContext?.watchlistMovies, recommendationContext?.favoriteSeries, recommendationContext?.watchlistSeries],
  );
  const recommendationBridge = useMemo(
    () => buildNovaPulseCatalogBridge(movies.slice(0, 100), series.slice(0, 100)),
    [movies, series],
  );
  const seriesMetadataReadKey = useMemo(
    () => `${providerId}::${boundedSeries.map((item) => `${item.id || item.seriesId}:${item.title}`).join('|')}`,
    [boundedSeries, providerId],
  );
  useEffect(() => {
    if (seriesMetadataReadKeyRef.current === seriesMetadataReadKey) return;
    seriesMetadataReadKeyRef.current = seriesMetadataReadKey;
    let active = true;
    setCachedSeriesMetadataState({ providerId, entries: new Map() });
    void Promise.all(boundedSeries.map(async (item) => [String(item.id || item.seriesId), await getSeriesMetadataCacheEntry(providerId, String(item.id || item.seriesId))] as const)).then((results) => {
      if (!active) return;
      const entries = new Map<string, SeriesMetadataCacheEntry>();
      for (const [seriesId, entry] of results) {
        if (entry) entries.set(seriesId, entry);
      }
      setCachedSeriesMetadataState({ providerId, entries });
    });
    return () => { active = false; };
  }, [boundedSeries, providerId, seriesMetadataReadKey]);
  const localRecommendationSignals = useMemo(
    () => createLocalSignalMap(recommendationContext ?? {
      recentlyWatched: [],
      favoriteMovies: [],
      watchlistMovies: [],
      favoriteSeries: [],
      watchlistSeries: [],
    }),
    [recommendationContext?.favoriteMovies, recommendationContext?.watchlistMovies, recommendationContext?.favoriteSeries, recommendationContext?.watchlistSeries],
  );
  useEffect(() => {
    let active = true;
    setBackendCandidates([]);
    setRecommendationRequestAttempted(false);
    setRecommendationCacheHit(false);
    void getRecommendationCandidates({
      providerId,
      seeds: recommendationSeeds.seeds,
      catalogFingerprints: recommendationBridge.entries.map(({ itemKey: _itemKey, ...entry }) => entry),
      supportedContentTypes: ['movie', 'series'],
      limit: 30,
    }, recommendationSeeds.signature).then((response) => {
      if (!active) return;
      setRecommendationRequestAttempted(true);
      setRecommendationCacheHit(response?.meta?.cacheHit === true);
      setBackendCandidates(response?.candidates ?? []);
    });
    return () => { active = false; };
  }, [providerId, recommendationSeeds.signature]);
  const recommendationSignals = useMemo(() => {
    const signals = new Map(localRecommendationSignals);
    for (const candidate of backendCandidates) {
      if (!candidate.catalogMatchToken) continue;
      signals.set(candidate.catalogMatchToken, recommendationSignalForCandidate(candidate, recommendationSeeds.confidence));
    }
    return signals;
  }, [backendCandidates, localRecommendationSignals, recommendationSeeds.confidence]);
  const recommendationSignalSignature = useMemo(
    () => [...recommendationSignals.entries()].map(([key, value]) => `${key}:${value.reason}:${value.behaviorScore ?? 0}:${value.affinityScore ?? 0}:${value.trendScore ?? 0}`).join('|'),
    [recommendationSignals],
  );
  const candidateInputSignature = useMemo(() => [
    boundedMovies.map((movie) => [movie.id, movie.title, movie.rawTitle ?? '', movie.categoryName ?? '', movie.countryCode ?? '', movie.description ?? '', movie.posterUrl ?? '', movie.rating ?? movie.score ?? '', movie.year ?? '', movie.addedAt ?? '', movie.popularity ?? '', movie.providerSortOrder ?? ''].join('~')).join('|'),
    boundedSeries.map((seriesItem) => [seriesItem.id, seriesItem.title, seriesItem.rawTitle ?? '', seriesItem.categoryName ?? '', seriesItem.countryCode ?? '', seriesItem.description ?? '', seriesItem.backdropUrl ?? seriesItem.posterUrl ?? '', seriesItem.rating ?? '', seriesItem.year ?? '', seriesItem.addedAt ?? '', seriesItem.popularity ?? '', seriesItem.providerSortOrder ?? ''].join('~')).join('|'),
  ].join('||'), [boundedMovies, boundedSeries]);
  const curatedCatalog = useMemo(
    () => curateNovaPulseCatalog(boundedMovies, boundedSeries, compositionContentPolicy),
    [boundedMovies, boundedSeries, candidateInputSignature, compositionContentPolicy],
  );
  const languageFilteredCatalog = useMemo(() => {
    const movies = preferNovaPulseEnglishVariants(curatedCatalog.movies, 'movie');
    const series = preferNovaPulseEnglishVariants(curatedCatalog.series, 'series');
    return {
      movies: movies.items,
      series: series.items,
      diagnostics: {
        foreignVariantsRejected: movies.diagnostics.foreignVariantsRejected + series.diagnostics.foreignVariantsRejected,
        englishVariantsPreferred: movies.diagnostics.englishVariantsPreferred + series.diagnostics.englishVariantsPreferred,
        duplicateVariantsCollapsed: movies.diagnostics.duplicateVariantsCollapsed + series.diagnostics.duplicateVariantsCollapsed,
      } satisfies NovaPulseVariantDiagnostics,
    };
  }, [curatedCatalog]);
  const liveEpgSignature = useMemo(() => {
    const favorites = (liveEpg?.favoriteChannels ?? []).map((item) => item.id).sort().join(',');
    const recents = (liveEpg?.recentItems ?? []).filter((item) => item.mediaType === 'live').map((item) => `${item.contentId}:${item.lastOpenedAt}`).sort().join(',');
    return `${providerId}|${favorites}|${recents}`;
  }, [liveEpg?.favoriteChannels, liveEpg?.recentItems, providerId]);
  const liveEpgFetcherAvailable = Boolean(liveEpg?.getShortEpg);
  useEffect(() => {
    let active = true;
    setLiveEpgState({ providerId, items: [], diagnostics: null });
    void runNovaPulseLiveEpgCycle({
      providerId,
      favoriteChannels: liveEpg?.favoriteChannels ?? [],
      recentItems: liveEpg?.recentItems ?? [],
      getIndexEntry: liveEpgIndexEntryRef.current,
      getIndexSize: liveEpg?.getIndexSize,
      getShortEpg: liveEpgFetcherRef.current,
      contentPolicy: compositionContentPolicy,
      isCurrent: () => active,
    }).then((result) => {
      if (!active) return;
      setLiveEpgState({ providerId, items: result.items, diagnostics: result.diagnostics });
      console.info('[NOVAPULSE_EPG]', JSON.stringify(result.diagnostics));
      recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_epg', ...result.diagnostics } });
    }).catch(() => {
      if (active) setLiveEpgState({ providerId, items: [], diagnostics: null });
    });
    return () => { active = false; };
  }, [compositionContentPolicy, liveEpgFetcherAvailable, liveEpgSignature, providerId]);
  const liveEpgItems = liveEpgState.providerId === providerId ? liveEpgState.items : [];
  const realSportsSignature = useMemo(() => (realSports ?? []).slice(0, 32).map((item) => [item.id, item.title, item.subtype, item.updatedAt ?? ''].join('~')).join('|'), [realSports]);
  const composed = useMemo(() => {
    const includeMockCatalogFallback = { movie: boundedMovies.length === 0, series: boundedSeries.length === 0 };
    const announcementResult = announcementSession.providerId === providerId ? announcementSession.result : null;
    const announcementItems = !NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED || !announcementResult
      ? NOVA_PULSE_MOCK_FEED
      : announcementResult.source === 'static'
        ? NOVA_PULSE_MOCK_FEED
        : announcementResult.items;
    const result = composeNovaPulseFeedV2([
      createNovaPulseCatalogSource(languageFilteredCatalog.movies, languageFilteredCatalog.series, recommendationSignals, compositionSession.startedAt),
      ...(realSports ? [createNovaPulseSportsSource(realSports)] : []),
      ...(liveEpgItems.length ? [createNovaPulseLiveEpgSource(liveEpgItems)] : []),
      createNovaPulseMockSource(realSports ? announcementItems.filter((item) => item.type !== 'sports') : announcementItems, includeMockCatalogFallback),
    ], { seed: compositionSession.seed, nowMs: compositionSession.startedAt, recentHistory: historySnapshot });
    return result.items.length ? result : { ...result, items: [NOVA_PULSE_BRANDED_FALLBACK] };
  }, [announcementSession, compositionSession, historySnapshot, languageFilteredCatalog, liveEpgItems, providerId, realSportsSignature, recommendationSignalSignature]);
  const catalogReadyForHistory = boundedMovies.length > 0 || boundedSeries.length > 0;
  useEffect(() => {
    if (catalogReadyForHistory && historySessionRef.current?.providerId === providerId) {
      historySessionRef.current.compositionStarted = true;
    }
  }, [catalogReadyForHistory, providerId]);
  useEffect(() => {
    if (!catalogReadyForHistory || !historyWriteRef.current.shouldWrite()) return;
    void recordNovaPulseSelection(providerId, composed.items).then((result) => {
      const metadata = { writeSuccess: result.success, writtenCount: result.writtenCount };
      console.info('[NOVAPULSE_HISTORY]', JSON.stringify(metadata));
      recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_history_write', ...metadata } });
    }).catch(() => undefined);
  }, [catalogReadyForHistory, composed.items, providerId]);
  const selectedEnrichmentSignature = useMemo(
    () => `${providerId}::${composed.items.filter((item) => item.type === 'movie' || item.type === 'series').map((item) => `${item.type}:${item.sourceItemId ?? item.id}`).join('|')}`,
    [composed.items, providerId],
  );
  const fetchMovieDetailAvailable = Boolean(fetchMovieDetail);
  const fetchSeriesDetailAvailable = Boolean(fetchSeriesDetail);
  useEffect(() => {
    let active = true;
    setEnrichmentState({ providerId, movies: new Map(), series: new Map(), seriesDetails: new Map(), translations: new Map(), diagnostics: null });
    void runNovaPulseEnrichmentCycle({
      providerId,
      items: composed.items,
      fetchMovieDetail: (movieId) => fetchMovieDetailRef.current?.(movieId) ?? Promise.resolve(null),
      fetchSeriesDetail: (seriesId) => fetchSeriesDetailRef.current?.(seriesId) ?? Promise.resolve(null),
      isCurrent: () => active,
    }).then((result) => {
      if (!active) return;
      setEnrichmentState({ providerId, movies: result.movies, series: result.series, seriesDetails: result.seriesDetails, translations: result.translations, diagnostics: result.diagnostics });
      console.info('[NOVAPULSE_ENRICH]', JSON.stringify(result.diagnostics));
      recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_enrich', ...result.diagnostics } });
    }).catch(() => {
      if (!active) return;
      setEnrichmentState({ providerId, movies: new Map(), series: new Map(), seriesDetails: new Map(), translations: new Map(), diagnostics: null });
    });
    return () => { active = false; };
  }, [composed.items, fetchMovieDetailAvailable, fetchSeriesDetailAvailable, providerId, selectedEnrichmentSignature]);
  const presentation = useMemo(
    () => enrichNovaPulsePresentation({
      items: composed.items,
      movies: boundedMovies,
      series: boundedSeries,
      cachedSeriesMetadata: cachedSeriesMetadataState.providerId === providerId ? cachedSeriesMetadataState.entries : new Map(),
      seriesDetails: enrichmentState.providerId === providerId ? enrichmentState.seriesDetails : new Map(),
      translations: enrichmentState.providerId === providerId ? enrichmentState.translations : new Map(),
      movieEnrichments: enrichmentState.providerId === providerId ? enrichmentState.movies : new Map(),
      getCachedMovieDetail: (movieId) => getCachedProviderMovieInfo(providerId, movieId),
    }),
    [boundedMovies, boundedSeries, cachedSeriesMetadataState, composed.items, enrichmentState, providerId],
  );
  const displayPrefixesRemoved = useMemo(
    () => boundedMovies.filter((movie) => hasNovaPulseDisplayPrefix(movie.title)).length +
      boundedSeries.filter((item) => hasNovaPulseDisplayPrefix(item.title)).length,
    [boundedMovies, boundedSeries],
  );

  const artworkPrefetchPlan = useMemo(
    () => createNovaPulseArtworkPrefetchPlan(presentation.items, providerId),
    [presentation.items, providerId],
  );
  const prefetchedArtworkSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!artworkPrefetchPlan.urls.length || prefetchedArtworkSignatureRef.current === artworkPrefetchPlan.signature) {
      return;
    }
    prefetchedArtworkSignatureRef.current = artworkPrefetchPlan.signature;
    let cancelled = false;
    void inspectNovaPulseArtworkPrefetch(presentation.items, artworkPrefetchPlan, {
      prefetch: (url, options) => Image.prefetch(url, options),
      getCachePathAsync: (cacheKey) => Image.getCachePathAsync(cacheKey),
      readFromCacheAsync: (cacheKey) => Image.readFromCacheAsync(cacheKey),
      loadAsync: (source) => Image.loadAsync(source),
    }).then(({ cacheRefs, ...payload }) => {
      if (cancelled) {
        return;
      }
      setCachedArtworkRefs(cacheRefs);
      console.info('[NOVAPULSE_MEDIA_PREFETCH]', JSON.stringify(payload));
      recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_media_prefetch', ...payload } });
    });
    return () => {
      cancelled = true;
    };
  }, [artworkPrefetchPlan, presentation.items]);

  useEffect(() => {
    const previous = lastV2SignatureRef.current;
    const payload = {
      candidateMovies: composed.diagnostics.candidateMovies,
      candidateSeries: composed.diagnostics.candidateSeries,
      candidateSports: composed.diagnostics.candidateSports,
      candidateAnnouncements: composed.diagnostics.candidateAnnouncements,
      candidateLive: composed.diagnostics.candidateLive,
      selectedCount: composed.diagnostics.selectedCount,
      selectedMovies: composed.diagnostics.selectedMovies,
      selectedSeries: composed.diagnostics.selectedSeries,
      selectedSports: composed.diagnostics.selectedSports,
      selectedAnnouncements: composed.diagnostics.selectedAnnouncements,
      selectedLive: composed.diagnostics.selectedLive,
      feedSignatureChanged: previous !== null && previous !== composed.diagnostics.signature,
    };
    if (previous === composed.diagnostics.signature) return;
    lastV2SignatureRef.current = composed.diagnostics.signature;
    console.info('[NOVAPULSE_V2]', JSON.stringify(payload));
    recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_v2', ...payload } });
  }, [composed]);

  useEffect(() => {
    const feedSignature = [recommendationSeeds.signature, composed.diagnostics.signature, recommendationSignalSignature].join('||');
    const previousFeedSignature = lastRecommendationFeedSignatureRef.current;
    lastRecommendationFeedSignatureRef.current = feedSignature;
    const reasonCounts = composed.items.reduce<Record<string, number>>((counts, item) => {
      const reason = item.recommendation?.reason ?? 'fallback';
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {});
    const payload = {
      movieSourceWindow: composed.diagnostics.movieSourceWindow,
      seriesSourceWindow: composed.diagnostics.seriesSourceWindow,
      movieRankedCandidates: composed.diagnostics.movieRankedCandidates,
      seriesRankedCandidates: composed.diagnostics.seriesRankedCandidates,
      seedCount: recommendationSeeds.seeds.length,
      behaviorConfidence: recommendationSeeds.confidence,
      backendCandidates: backendCandidates.length,
      catalogMatched: backendCandidates.filter((candidate) => Boolean(candidate.catalogMatchToken)).length,
      behavioralSelected: composed.items.filter((item) => Boolean(item.recommendation?.behaviorScore)).length,
      trendSelected: composed.items.filter((item) => item.recommendation?.reason === 'trending_novacast').length,
      affinitySelected: composed.items.filter((item) => item.recommendation?.reason === 'viewers_also_watched').length,
      fallbackSelected: composed.items.filter((item) => !item.recommendation).length,
      sportsAvailable: composed.diagnostics.sportsAvailable,
      sportsSelected: composed.diagnostics.sportsSelected,
      announcementsSelected: composed.diagnostics.announcementsSelected,
      candidateLive: composed.diagnostics.candidateLive,
      selectedLive: composed.diagnostics.selectedLive,
      sportsGuardApplied: composed.diagnostics.sportsGuardApplied,
      displayPrefixesRemoved,
      ...presentation.diagnostics,
      ...languageFilteredCatalog.diagnostics,
      ...curatedCatalog.diagnostics,
      ...(enrichmentState.diagnostics ?? {}),
      ...(liveEpgState.diagnostics ?? {}),
      finalCount: composed.items.length,
      cacheHit: recommendationCacheHit,
      requestAttempted: recommendationRequestAttempted,
      reasonCounts,
      sourceCounts: composed.items.reduce<Record<string, number>>((counts, item) => {
        counts[item.type] = (counts[item.type] ?? 0) + 1;
        return counts;
      }, {}),
      recentItemsPenalized: composed.diagnostics.recentItemsPenalized,
      feedSignatureChanged: previousFeedSignature !== null && previousFeedSignature !== feedSignature,
    };
    console.info('[NOVAPULSE_RECS_FEED]', JSON.stringify(payload));
    recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_recs_feed', ...payload } });
  }, [backendCandidates, composed, curatedCatalog.diagnostics, displayPrefixesRemoved, enrichmentState.diagnostics, languageFilteredCatalog.diagnostics, liveEpgState.diagnostics, presentation.diagnostics, recommendationCacheHit, recommendationRequestAttempted, recommendationSeeds.confidence, recommendationSeeds.seeds.length, recommendationSeeds.signature, recommendationSignalSignature]);

  useEffect(() => {
    const upcoming = (realSports ?? []).filter((item) => item.subtype === 'upcoming' || item.subtype === 'live').length;
    const finals = (realSports ?? []).filter((item) => item.subtype === 'final').length;
        const announcements = composed.items.filter((item) => item.type === 'announcement').length;
    const movieDuplicateIds = movies.length - new Set(movies.map((item) => String(item.id ?? ''))).size;
    const seriesDuplicateIds = series.length - new Set(series.map((item) => String(item.id ?? ''))).size;
    const movieRejectMissingId = movies.filter((item) => !String(item.id ?? '').trim()).length;
    const seriesRejectMissingId = series.filter((item) => !String(item.id ?? '').trim()).length;
    const movieRejectMissingTitle = movies.filter((item) => String(item.id ?? '').trim() && !String(item.title ?? '').trim()).length;
    const seriesRejectMissingTitle = series.filter((item) => String(item.id ?? '').trim() && !String(item.title ?? '').trim()).length;
    const movieWithArtwork = movies.filter((item) => Boolean(item.posterUrl?.trim())).length;
    const movieWithDescription = movies.filter((item) => Boolean(item.description?.trim())).length;
    const seriesWithArtwork = series.filter((item) => Boolean((item.backdropUrl ?? item.posterUrl)?.trim())).length;
    const seriesWithDescription = series.filter((item) => Boolean(item.description?.trim())).length;
    const signature = [diagnostics?.movieIndex ?? 0, diagnostics?.seriesIndex ?? 0, diagnostics?.movieRecentlyWatched ?? 0, diagnostics?.seriesRecentlyWatched ?? 0, diagnostics?.movieWatchlist ?? 0, diagnostics?.seriesWatchlist ?? 0, diagnostics?.movieFavorites ?? 0, diagnostics?.seriesFavorites ?? 0, diagnostics?.movieIndexExtracted ?? 0, diagnostics?.seriesIndexExtracted ?? 0, diagnostics?.activeProviderChanged ?? false, diagnostics?.movieLocalHydrationAttempted ?? false, diagnostics?.seriesLocalHydrationAttempted ?? false, diagnostics?.movieLocalHydrationCount ?? 0, diagnostics?.seriesLocalHydrationCount ?? 0, diagnostics?.movieArtworkLoadSuccess ?? 0, diagnostics?.movieArtworkLoadError ?? 0, diagnostics?.seriesArtworkLoadSuccess ?? 0, diagnostics?.seriesArtworkLoadError ?? 0, movieWithArtwork, movieWithDescription, seriesWithArtwork, seriesWithDescription, movies.length, series.length, upcoming, finals, announcements, composed.items.length, movieDuplicateIds, seriesDuplicateIds, movieRejectMissingId, seriesRejectMissingId, movieRejectMissingTitle, seriesRejectMissingTitle, composed.items.map((item) => item.type).join(',')].join('|');
    if (lastDiagnosticSignatureRef.current === signature) {
      return;
    }
    lastDiagnosticSignatureRef.current = signature;
    const payload = {
      movies: movies.length,
      series: series.length,
      movieIndex: diagnostics?.movieIndex ?? 0,
      seriesIndex: diagnostics?.seriesIndex ?? 0,
      movieRecentlyWatched: diagnostics?.movieRecentlyWatched ?? 0,
      seriesRecentlyWatched: diagnostics?.seriesRecentlyWatched ?? 0,
      movieWatchlist: diagnostics?.movieWatchlist ?? 0,
      seriesWatchlist: diagnostics?.seriesWatchlist ?? 0,
      movieFavorites: diagnostics?.movieFavorites ?? 0,
      seriesFavorites: diagnostics?.seriesFavorites ?? 0,
      movieIndexExtracted: diagnostics?.movieIndexExtracted ?? 0,
      seriesIndexExtracted: diagnostics?.seriesIndexExtracted ?? 0,
      activeProviderChanged: diagnostics?.activeProviderChanged ?? false,
      movieLocalHydrationAttempted: diagnostics?.movieLocalHydrationAttempted ?? false,
      seriesLocalHydrationAttempted: diagnostics?.seriesLocalHydrationAttempted ?? false,
      movieLocalHydrationCount: diagnostics?.movieLocalHydrationCount ?? 0,
      seriesLocalHydrationCount: diagnostics?.seriesLocalHydrationCount ?? 0,
      upcoming,
      finals,
      announcements,
      selected: composed.items.length,
      movieItemsEnteringComposer: movies.length,
      seriesItemsEnteringComposer: series.length,
      movieItemsSelected: composed.items.filter((item) => item.type === 'movie').length,
      seriesItemsSelected: composed.items.filter((item) => item.type === 'series').length,
      types: composed.items.map((item) => item.type),
      movieExtracted: movies.length,
      seriesExtracted: series.length,
      movieNormalized: movies.length - movieRejectMissingId - movieRejectMissingTitle,
      seriesNormalized: series.length - seriesRejectMissingId - seriesRejectMissingTitle,
      movieRejectMissingId,
      movieRejectMissingTitle,
      movieRejectMissingActionPayload: 0,
      movieRejectDedupe: Math.max(0, movieDuplicateIds),
      seriesRejectMissingId,
      seriesRejectMissingTitle,
      seriesRejectMissingContentId: 0,
      seriesRejectMissingSeriesId: 0,
      seriesRejectDedupe: Math.max(0, seriesDuplicateIds),
      movieCandidates: movies.length,
      movieWithArtwork,
      movieWithDescription,
      seriesCandidates: series.length,
      seriesWithArtwork,
      seriesWithDescription,
      movieArtworkLoadSuccess: diagnostics?.movieArtworkLoadSuccess ?? 0,
      movieArtworkLoadError: diagnostics?.movieArtworkLoadError ?? 0,
      seriesArtworkLoadSuccess: diagnostics?.seriesArtworkLoadSuccess ?? 0,
      seriesArtworkLoadError: diagnostics?.seriesArtworkLoadError ?? 0,
    };
    console.info('[NOVAPULSE_FEED_RELEASE]', JSON.stringify(payload));
    recordDiagnostic({ eventType: 'live_performance', metadata: { summary: 'novapulse_feed_release', ...payload } });
      }, [composed, diagnostics, movies.length, realSports, series.length]);

  return useMemo(
    () => presentation.items.map((item) => {
      const uri = item.artworkUrl?.trim() ?? '';
      const artworkRef = (item.type === 'movie' || item.type === 'series') && uri ? cachedArtworkRefs.get(uri) : undefined;
      return artworkRef ? { ...item, artworkRef } : item;
    }),
    [cachedArtworkRefs, presentation.items],
  );
}
