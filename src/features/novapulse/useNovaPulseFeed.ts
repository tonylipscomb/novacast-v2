import { useEffect, useMemo, useRef, useState } from 'react';

import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';
import { Image } from 'expo-image';
import type { MovieSummary } from '@/features/movies/movieTypes';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { NOVA_PULSE_MOCK_FEED } from './novaPulseMockFeed';
import { composeNovaPulseFeed } from './novaPulseComposer';
import { createNovaPulseCatalogSource, createNovaPulseMockSource, createNovaPulseSportsSource } from './novaPulseSources';
import { fetchNovaPulseSportsItems } from './novaPulseSportsSource';
import type { NovaPulseItem } from './novaPulseTypes';
import { createNovaPulseArtworkPrefetchPlan, inspectNovaPulseArtworkPrefetch } from './novaPulseArtworkPrefetch';

type UseNovaPulseFeedOptions = {
  providerId: string;
  movies: readonly MovieSummary[];
  series: readonly SeriesSummary[];
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

export function useNovaPulseFeed({ providerId, movies, series, diagnostics }: UseNovaPulseFeedOptions): readonly NovaPulseItem[] {
  const [realSports, setRealSports] = useState<readonly NovaPulseItem[] | null>(null);
  const [cachedArtworkRefs, setCachedArtworkRefs] = useState<ReadonlyMap<string, import('expo-image').ImageRef>>(() => new Map());
  const lastDiagnosticSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchNovaPulseSportsItems().then((items) => { if (active) setRealSports(items); }).catch(() => { if (active) setRealSports(null); });
    return () => { active = false; };
  }, []);
  const composed = useMemo(() => {
    const includeMockCatalogFallback = { movie: movies.length === 0, series: series.length === 0 };
    const composed = composeNovaPulseFeed([
      createNovaPulseCatalogSource(movies, series),
      ...(realSports ? [createNovaPulseSportsSource(realSports)] : []),
      createNovaPulseMockSource(realSports ? NOVA_PULSE_MOCK_FEED.filter((item) => item.type !== 'sports') : NOVA_PULSE_MOCK_FEED, includeMockCatalogFallback),
    ]);
    return composed.length ? composed : [NOVA_PULSE_BRANDED_FALLBACK];
  }, [movies, series, realSports]);

  const artworkPrefetchPlan = useMemo(
    () => createNovaPulseArtworkPrefetchPlan(composed, providerId),
    [composed, providerId],
  );
  const prefetchedArtworkSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!artworkPrefetchPlan.urls.length || prefetchedArtworkSignatureRef.current === artworkPrefetchPlan.signature) {
      return;
    }
    prefetchedArtworkSignatureRef.current = artworkPrefetchPlan.signature;
    let cancelled = false;
    void inspectNovaPulseArtworkPrefetch(composed, artworkPrefetchPlan, {
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
  }, [artworkPrefetchPlan]);

  useEffect(() => {
    const upcoming = (realSports ?? []).filter((item) => item.subtype === 'upcoming' || item.subtype === 'live').length;
    const finals = (realSports ?? []).filter((item) => item.subtype === 'final').length;
    const announcements = composed.filter((item) => item.type === 'announcement').length;
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
    const signature = [diagnostics?.movieIndex ?? 0, diagnostics?.seriesIndex ?? 0, diagnostics?.movieRecentlyWatched ?? 0, diagnostics?.seriesRecentlyWatched ?? 0, diagnostics?.movieWatchlist ?? 0, diagnostics?.seriesWatchlist ?? 0, diagnostics?.movieFavorites ?? 0, diagnostics?.seriesFavorites ?? 0, diagnostics?.movieIndexExtracted ?? 0, diagnostics?.seriesIndexExtracted ?? 0, diagnostics?.activeProviderChanged ?? false, diagnostics?.movieLocalHydrationAttempted ?? false, diagnostics?.seriesLocalHydrationAttempted ?? false, diagnostics?.movieLocalHydrationCount ?? 0, diagnostics?.seriesLocalHydrationCount ?? 0, diagnostics?.movieArtworkLoadSuccess ?? 0, diagnostics?.movieArtworkLoadError ?? 0, diagnostics?.seriesArtworkLoadSuccess ?? 0, diagnostics?.seriesArtworkLoadError ?? 0, movieWithArtwork, movieWithDescription, seriesWithArtwork, seriesWithDescription, movies.length, series.length, upcoming, finals, announcements, composed.length, movieDuplicateIds, seriesDuplicateIds, movieRejectMissingId, seriesRejectMissingId, movieRejectMissingTitle, seriesRejectMissingTitle, composed.map((item) => item.type).join(',')].join('|');
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
      selected: composed.length,
      movieItemsEnteringComposer: movies.length,
      seriesItemsEnteringComposer: series.length,
      movieItemsSelected: composed.filter((item) => item.type === 'movie').length,
      seriesItemsSelected: composed.filter((item) => item.type === 'series').length,
      types: composed.map((item) => item.type),
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
    () => composed.map((item) => {
      const uri = item.artworkUrl?.trim() ?? '';
      const artworkRef = (item.type === 'movie' || item.type === 'series') && uri ? cachedArtworkRefs.get(uri) : undefined;
      return artworkRef ? { ...item, artworkRef } : item;
    }),
    [cachedArtworkRefs, composed],
  );
}
