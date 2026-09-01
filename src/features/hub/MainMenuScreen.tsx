import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findNodeHandle, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as ReactNative from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { NovaTvShell } from '@/components/nova';
import type { NovaNavigationFocusHandles, NovaNavigationId } from '@/components/nova';
import { novaTvFocus, createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { ChannelHeroCard } from '@/features/hub/ChannelHeroCard';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { ExitConfirmOverlay, useExitConfirmOnBack } from '@/features/navigation/ExitConfirmOverlay';
import { classifyProviderCategoryType, type ProviderCategoryType } from '@/features/providers/categoryNormalization';
import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { rememberLiveTvMemory } from '@/features/live/liveTvMemory';
import { rememberMoviesScreenMemory } from '@/features/movies/moviesScreenMemory';
import { rememberSeriesScreenMemory } from '@/features/series/seriesScreenMemory';
import { buildLiveChannelPlaybackUrl, buildMoviePlaybackUrlResolved } from '@/features/providers/providerPlayback';
import { getCatalogMovieItem } from '@/features/catalog/catalogRepository';
import {
  armHomeContinueWatchingFallbackRecovery,
  decideHomeContinueWatchingLaunch,
  describeHomeContinueWatchingShape,
  disarmHomeContinueWatchingFallbackRecovery,
  logHomeContinueWatchingCanonicalization,
  logHomeContinueWatchingLaunch,
  shouldHomeContinueWatchingOpenMovies,
} from '@/features/hub/homeContinueWatchingLaunch';
import {
  decideHomeWatchlistSeriesLaunch,
  logWatchlistLaunch,
} from '@/features/hub/homeWatchlistLaunch';
import {
  logHomeNavbarFocusRetained,
  logHomeNavbarRightAttempt,
  resolveHomeNavbarRightTarget,
  shouldRetainNavbarFocus,
} from '@/features/hub/homeNavbarFocus';
import { requestLaunchOverlayExit } from '@/features/startup/launchOverlay';
import { useUnifiedPlayer } from '@/features/playback/unified';
import { launchSeriesEpisodePlayback } from '@/features/series/seriesPlayback';
import { loadHomePersonalization, type HomePersonalizationSnapshot } from '@/features/personalization/personalizationHome';
import { getMovieCatalogIndex } from '@/features/movies/smart/movieCatalogIndex';
import { recordRecentItem, removeContinueWatchingItem, subscribePersonalization } from '@/features/personalization/personalizationStore';
import { subscribeMovieLibrary } from '@/features/movies/smart/movieLibraryStore';
import { subscribeMediaLibrary } from '@/features/media-browser/mediaLibraryStore';
import type { HomeContinueWatchingItem, RecentItemRecord } from '@/features/personalization/personalizationModel';
import type { MovieSummary } from '@/features/movies/movieTypes';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { markCatalogAuditFocus, markCatalogAuditRender } from '@/features/diagnostics/novaCastCatalogAudit';
import { noteFocusLatencyFocus } from '@/features/diagnostics/focusLatencyAudit';
import { waitOutCatalogWriteQuietPeriod } from '@/features/catalog/catalogWriteQuietPeriod';
import { processTimeBudgeted } from '@/features/catalog/jsChunkBudget';
import { showNotification } from '@/features/notifications/notificationStore';
import { maybeTriggerDevCatalogRefreshOnce } from '@/features/diagnostics/devCatalogRefreshOnce';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';

/**
 * Resolves a channel's category type for accent-color purposes. Prefers an
 * exact category-id lookup (built from the provider's real category names);
 * falls back to classifying the channel's own display name when the
 * category isn't known yet (e.g. categories still loading) or the channel
 * has no categoryId at all.
 */
function resolveChannelCategoryType(
  channel: { categoryId?: string; name: string },
  categoryTypeById: Map<string, ProviderCategoryType>,
): ProviderCategoryType {
  const byCategory = channel.categoryId ? categoryTypeById.get(channel.categoryId) : undefined;
  return byCategory ?? classifyProviderCategoryType(channel.name);
}

type HomeAuditSectionType = 'continue-watching' | 'watchlist' | 'favorite-channels' | 'favorites';

type HomePresentationAuditState = {
  rootLayoutValid: boolean;
  sectionLayoutValid: boolean;
  visuallyPresented: boolean;
};

const HOME_PRESENTATION_AUDIT_ENABLED =
  Boolean(__DEV__) ||
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_HOME_PRESENTATION_AUDIT === '1');

function logHomePresentationAudit(event: string, fields: Record<string, unknown>) {
  if (HOME_PRESENTATION_AUDIT_ENABLED) {
    console.info('[NovaCast Home Presentation Audit]', JSON.stringify({
      event,
      ...fields,
      ...(event === 'instrumentation-version' ? { dev: Boolean(__DEV__) } : null),
    }));
  }
}

export function MainMenuScreen() {
  markCatalogAuditRender('MainMenuScreen');
  const homeRenderCountRef = useRef(0);
  homeRenderCountRef.current += 1;
  const homeRootLayoutRef = useRef({ width: 0, height: 0 });
  const firstHomeSectionLayoutRef = useRef({ width: 0, height: 0 });
  const firstHomeSectionTypeRef = useRef<HomeAuditSectionType | null>(null);
  const firstHomeFocusableCardRegisteredRef = useRef(false);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const { isActive: playbackActive, isClosing: playbackClosing, launchPlayback } = useUnifiedPlayer();
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.hub.key);
  const exitConfirm = useExitConfirmOnBack(!playbackActive && !playbackClosing && !guide.visible);
  const activeProviderId = selectedProvider?.id ?? 'demo-provider';
  const freshFocusLoggedRef = useRef(false);
  const [categoryTypeById, setCategoryTypeById] = useState<Map<string, ProviderCategoryType>>(new Map());
  const [personalization, setPersonalization] = useState<HomePersonalizationSnapshot>(() => ({
    providerId: '',
    continueWatching: [] as HomeContinueWatchingItem[],
    watchlistMovies: [] as MovieSummary[],
    watchlistSeries: [] as SeriesSummary[],
    favoriteChannels: [],
    favoriteMovies: [] as MovieSummary[],
    favoriteSeries: [] as SeriesSummary[],
    recentlyWatched: [] as RecentItemRecord[],
  }));
  const watchlistItems = personalization.providerId === activeProviderId
    ? [
        ...personalization.watchlistMovies.map((item) => ({ kind: 'movie' as const, item })),
        ...personalization.watchlistSeries.map((item) => ({ kind: 'series' as const, item })),
      ]
    : [];
  const favoriteItems = personalization.providerId === activeProviderId
    ? [
        ...personalization.favoriteMovies.map((item) => ({ kind: 'movie' as const, item })),
        ...personalization.favoriteSeries.map((item) => ({ kind: 'series' as const, item })),
      ]
      : [];
  const continueWatchingCount = personalization.providerId === activeProviderId
    ? personalization.continueWatching.length
    : 0;

  const homePresentationAuditState = (): HomePresentationAuditState => {
    const rootLayoutValid = homeRootLayoutRef.current.width > 0 && homeRootLayoutRef.current.height > 0;
    const sectionLayoutValid = firstHomeSectionLayoutRef.current.width > 0 && firstHomeSectionLayoutRef.current.height > 0;
    return {
      rootLayoutValid,
      sectionLayoutValid,
      visuallyPresented: rootLayoutValid && sectionLayoutValid && !playbackActive && !playbackClosing,
    };
  };

  const registerFirstHomeSectionLayout = (sectionType: HomeAuditSectionType, width: number, height: number) => {
    if (firstHomeSectionTypeRef.current && firstHomeSectionTypeRef.current !== sectionType) {
      return;
    }
    firstHomeSectionTypeRef.current = sectionType;
    firstHomeSectionLayoutRef.current = { width, height };
  };

  const registerFirstHomeFocusableCard = (sectionType: HomeAuditSectionType, index: number, focusable: boolean) => {
    if (index !== 0 || firstHomeFocusableCardRegisteredRef.current) {
      return;
    }
    firstHomeFocusableCardRegisteredRef.current = true;
    logHomePresentationAudit('first-focusable-card-mounted', {
      sectionType,
      index,
      focusable,
      ...homePresentationAuditState(),
    });
  };

  useEffect(() => {
    logHomePresentationAudit('instrumentation-version', {
      marker: 'home-presentation-runtime-v2',
    });
    logHomePresentationAudit('actual-home-render-branch', {
      activeId: 'home',
      component: 'MainMenuScreen',
      shellInstanceId: null,
    });
  }, []);

  useEffect(() => {
    logHomePresentationAudit('mount', {
      providerId: activeProviderId,
      active: true,
      renderCount: homeRenderCountRef.current,
    });
    return () => {
      logHomePresentationAudit('unmount', {
        providerId: activeProviderId,
        active: false,
        renderCount: homeRenderCountRef.current,
      });
    };
  }, [activeProviderId]);

  useEffect(() => {
    logHomePresentationAudit('active-state', {
      providerId: activeProviderId,
      active: !playbackActive && !playbackClosing,
      renderCount: homeRenderCountRef.current,
    });
  }, [activeProviderId, playbackActive, playbackClosing]);

  useEffect(() => {
    logHomePresentationAudit('data-readiness', {
      providerId: activeProviderId,
      heroItemPresent: false,
      sectionCount: [continueWatchingCount, watchlistItems.length, personalization.favoriteChannels.length, favoriteItems.length]
        .filter((count) => count > 0).length,
      sections: {
        continueWatching: continueWatchingCount,
        watchlist: watchlistItems.length,
        favoriteChannels: personalization.favoriteChannels.length,
        favorites: favoriteItems.length,
      },
    });
  }, [activeProviderId, continueWatchingCount, favoriteItems.length, personalization.favoriteChannels.length, watchlistItems.length]);

  // Temporary startup rendering audit; remove after the physical-TV regression is closed.
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    console.info('[NovaCast Home Render]', {
      heroRendered: false,
      continueWatchingCount,
      watchlistCount: watchlistItems.length,
      favoriteChannelCount: personalization.favoriteChannels.length,
      favoritesCount: favoriteItems.length,
    });
  }, [continueWatchingCount, favoriteItems.length, personalization.favoriteChannels.length, watchlistItems.length]);
  const firstHomeFocusId =
    guide.visible
      ? null
      : personalization.providerId === activeProviderId && personalization.continueWatching.length
        ? `continue-${personalization.continueWatching[0].contentId}`
        : watchlistItems.length
          ? `watchlist-${watchlistItems[0].kind}-${watchlistItems[0].item.id}`
          : personalization.providerId === activeProviderId && personalization.favoriteChannels.length
            ? `favorite-channel-${personalization.favoriteChannels[0].id}`
            : favoriteItems.length
              ? `favorite-${favoriteItems[0].kind}-${favoriteItems[0].item.id}`
              : null;

  useEffect(() => {
    if (!__DEV__ || freshFocusLoggedRef.current || !guide.ready) {
      return;
    }
    freshFocusLoggedRef.current = true;
    const owners = ['home-nav'];
    console.info('[NovaCast Fresh Focus]', {
      event: 'startup-focus-owner',
      candidate: 'home-nav',
    });
    if (owners.length > 1) {
      console.warn('[NovaCast Fresh Focus]', {
        event: 'multiple-preferred-owners',
        owners,
      });
    }
  }, [guide.ready]);

  const [navFocusHandles, setNavFocusHandles] = useState<NovaNavigationFocusHandles>({});
  const [homeContentHandle, setHomeContentHandle] = useState<number | null>(null);
  const [navbarFocusedId, setNavbarFocusedId] = useState<NovaNavigationId | null>(null);
  const homeFocusDecision = useMemo(
    () =>
      resolveHomeNavbarRightTarget({
        firstVisibleHomeTargetId: firstHomeFocusId,
        contentHandle: homeContentHandle,
        walkthroughVisible: guide.visible,
      }),
    [firstHomeFocusId, guide.visible, homeContentHandle],
  );
  const navigationContentFocusHandle =
    homeFocusDecision.nextFocusMode === 'content' ? (homeContentHandle ?? undefined) : undefined;
  const navigationNextFocusRight =
    homeFocusDecision.nextFocusMode === 'retain-navbar' && Object.keys(navFocusHandles).length > 0
      ? navFocusHandles
      : undefined;

  const registerHomeFocusHandle = (targetId: string, handle: number | null) => {
    if (targetId !== firstHomeFocusId) {
      return;
    }
    setHomeContentHandle(handle);
  };

  const reactNativeTv = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: { eventType?: string }) => void) => void;
  };
  const useTVEventHandler = reactNativeTv.useTVEventHandler ?? ((_handler: (event: { eventType?: string }) => void) => {});
  useTVEventHandler((event: { eventType?: string }) => {
    if (event.eventType !== 'right' && event.eventType !== 'swipeRight') {
      return;
    }
    if (!navbarFocusedId) {
      return;
    }
    logHomeNavbarRightAttempt({
      navbarItem: navbarFocusedId,
      targetAvailable: homeFocusDecision.targetAvailable,
      targetId: homeFocusDecision.targetId,
    });
    if (shouldRetainNavbarFocus(homeFocusDecision)) {
      logHomeNavbarFocusRetained('no-visible-home-target');
    }
  });

  useEffect(() => {
    setHomeContentHandle(null);
  }, [firstHomeFocusId]);

  useEffect(() => {
    maybeTriggerDevCatalogRefreshOnce();
  }, [bundle]);

  useEffect(() => {
    if (!bundle || !selectedProvider) {
      return;
    }

    requestLaunchOverlayExit();
  }, [bundle, selectedProvider]);

  useEffect(() => {
    if (!bundle) {
      return;
    }

    let cancelled = false;
    // Wait until Movies/Series category SQLite upserts finish before even starting
    // the live-categories HTTP call — full getCategories() mapping previously stalled
    // JS ~2s after parse; accent hints avoid that path entirely.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await waitOutCatalogWriteQuietPeriod({ maxWaitMs: 30_000 });
          if (cancelled) {
            return;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const categories = bundle.live.getCategoryAccentHints
            ? await bundle.live.getCategoryAccentHints()
            : await bundle.live.getCategories();
          if (cancelled) {
            return;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));

          const next = new Map<string, ProviderCategoryType>();
          await processTimeBudgeted(
            categories,
            (category) => {
              if (!category.id) {
                return;
              }
              next.set(category.id, classifyProviderCategoryType(category.name));
            },
            { minItems: 8, maxItems: 48, kind: 'generic', targetMs: 35 },
          );
          if (!cancelled) {
            setCategoryTypeById(next);
          }
        } catch {
          // ignore accent-map failures
        }
      })();
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeProviderId, bundle]);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      void loadHomePersonalization(activeProviderId, bundle).then((next) => {
        if (!cancelled) {
          setPersonalization(next);
        }
      });
    };

    const debouncedRefresh = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(refresh, 300);
    };

    refresh();
    const unsubscribeMovie = subscribeMovieLibrary(debouncedRefresh);
    const unsubscribeMedia = subscribeMediaLibrary(debouncedRefresh);
    const unsubscribePersonalization = subscribePersonalization(debouncedRefresh);

    return () => {
      cancelled = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      unsubscribeMovie();
      unsubscribeMedia();
      unsubscribePersonalization();
    };
  }, [activeProviderId, bundle]);

  const navigateTo = (route: '/live' | '/movies' | '/series' | '/guide') => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    router.replace(route);
  };

  const playLiveChannelFullscreen = async (channel: ProviderLiveChannel) => {
    if (!bundle) {
      return;
    }

    const streamUrl = buildLiveChannelPlaybackUrl(bundle, channel);
    if (!streamUrl) {
      return;
    }

    rememberLiveTvMemory(activeProviderId, {
      selectedCategoryId: channel.categoryId,
      selectedChannelId: channel.id,
      focusedCategoryId: channel.categoryId,
      focusedChannelId: channel.id,
    });

    void recordRecentItem({
      providerId: activeProviderId,
      mediaType: 'live',
      contentId: channel.id,
      title: channel.name,
      artworkUrl: channel.logoUrl,
      categoryId: channel.categoryId,
    });

    await launchPlayback(
      {
        id: channel.id,
        mediaType: 'live',
        title: channel.name,
        subtitle: channel.current,
        streamUrl,
        artworkUrl: channel.logoUrl,
        channelNumber: channel.number ? String(channel.number) : undefined,
        isLive: true,
        providerId: activeProviderId,
      },
      { launchSource: 'channel', contentFit: 'cover' },
    );
  };

  const openContinueItem = async (item: HomeContinueWatchingItem) => {
    const memoryCatalogMovie = getMovieCatalogIndex(activeProviderId).getEntry(item.contentId);
    logHomeContinueWatchingCanonicalization({
      event: 'lookup-start',
      movieId: item.contentId,
      lookupKeyType: 'content-id',
      savedExtensionPresent: Boolean(item.containerExtension),
      canonicalFound: Boolean(memoryCatalogMovie),
      canonicalExtensionPresent: Boolean(memoryCatalogMovie?.containerExtension),
    });

    let sqliteCatalogMovie: {
      id: string;
      title: string;
      posterUrl?: string;
      containerExtension?: string;
    } | null = null;
    if (item.mediaType === 'movie' || (!item.parentSeriesId && !item.episodeId)) {
      if (!memoryCatalogMovie?.containerExtension) {
        const row = await getCatalogMovieItem(activeProviderId, item.contentId).catch(() => null);
        if (row) {
          sqliteCatalogMovie = {
            id: row.contentId,
            title: row.title,
            posterUrl: row.artworkUrl ?? undefined,
            containerExtension: row.streamExtension ?? undefined,
          };
        }
      }
      if (!memoryCatalogMovie?.containerExtension && !sqliteCatalogMovie?.containerExtension && bundle?.movies.getMovieInfo) {
        const local = await bundle.movies.getMovieInfo(item.contentId).catch(() => null);
        if (local) {
          sqliteCatalogMovie = {
            id: local.id,
            title: local.title,
            posterUrl: local.posterUrl,
            containerExtension: local.containerExtension,
          };
        }
      }
    }

    const catalogMovie = memoryCatalogMovie
      ? {
          id: memoryCatalogMovie.id,
          title: memoryCatalogMovie.title,
          posterUrl: memoryCatalogMovie.posterUrl,
          containerExtension: memoryCatalogMovie.containerExtension,
        }
      : null;
    const decision = decideHomeContinueWatchingLaunch({
      item,
      catalogMovie,
      sqliteCatalogMovie,
    });
    const canonicalFound = Boolean(sqliteCatalogMovie || catalogMovie);
    logHomeContinueWatchingCanonicalization({
      event: canonicalFound ? 'lookup-hit' : 'lookup-miss',
      movieId: item.contentId,
      lookupKeyType: 'content-id',
      canonicalFound,
      savedExtensionPresent: Boolean(item.containerExtension),
      canonicalExtensionPresent: Boolean(
        sqliteCatalogMovie?.containerExtension || catalogMovie?.containerExtension,
      ),
      resolvedExtensionPresent: decision.kind === 'launch-movie' && Boolean(decision.containerExtension),
    });
    if (decision.kind === 'launch-movie') {
      logHomeContinueWatchingCanonicalization({
        event: 'canonical-merged',
        movieId: decision.movieId,
        lookupKeyType: 'content-id',
        canonicalFound,
        savedExtensionPresent: Boolean(item.containerExtension),
        canonicalExtensionPresent: Boolean(
          sqliteCatalogMovie?.containerExtension || catalogMovie?.containerExtension,
        ),
        resolvedExtensionPresent: Boolean(decision.containerExtension),
      });
    }
    const shape = describeHomeContinueWatchingShape(item, {
      canonicalMovieFound: canonicalFound,
      canonicalContainerExtensionPresent: Boolean(
        sqliteCatalogMovie?.containerExtension || catalogMovie?.containerExtension,
      ),
      resolvedContainerExtensionPresent: decision.kind === 'launch-movie' && Boolean(decision.containerExtension),
      extensionSource: decision.kind === 'launch-movie' ? decision.extensionSource : undefined,
      decision: decision.kind,
    });
    logHomeContinueWatchingLaunch({
      ...shape,
      sourceResolvable: decision.sourceResolvable,
      origin: 'home-continue-watching',
      decision: decision.kind,
    });

    if (shouldHomeContinueWatchingOpenMovies() || decision.kind === 'error') {
      showNotification({
        type: 'error',
        title: 'Unable to resume',
        message: 'This title is no longer available.',
        duration: 6000,
        scope: 'home',
      });
      return;
    }

    if (!bundle) {
      showNotification({
        type: 'error',
        title: 'Unable to resume',
        message: 'This title is no longer available.',
        duration: 6000,
        scope: 'home',
      });
      return;
    }

    if (decision.kind === 'launch-movie') {
      const streamUrl = buildMoviePlaybackUrlResolved(
        bundle,
        decision.movieId,
        decision.containerExtension,
        decision.containerExtension,
      );
      if (!streamUrl) {
        showNotification({
          type: 'error',
          title: 'Unable to resume',
          message: 'This title is no longer available.',
          duration: 6000,
          scope: 'home',
        });
        return;
      }
      if (decision.extensionSource === 'fallback') {
        armHomeContinueWatchingFallbackRecovery({
          movieId: decision.movieId,
          extensionSource: 'fallback',
          attemptedExtension: decision.containerExtension ?? 'mp4',
          recover: async () => {
            const row = await getCatalogMovieItem(activeProviderId, decision.movieId).catch(() => null);
            const recoveredExtension = row?.streamExtension?.trim();
            if (!recoveredExtension) {
              return null;
            }
            const recoveredUrl = buildMoviePlaybackUrlResolved(
              bundle,
              decision.movieId,
              recoveredExtension,
              recoveredExtension,
            );
            return recoveredUrl ? { streamUrl: recoveredUrl, containerExtension: recoveredExtension } : null;
          },
        });
      } else {
        disarmHomeContinueWatchingFallbackRecovery();
      }
      logHomeContinueWatchingCanonicalization({
        event: 'launch',
        movieId: decision.movieId,
        lookupKeyType: 'content-id',
        canonicalFound,
        savedExtensionPresent: Boolean(item.containerExtension),
        canonicalExtensionPresent: Boolean(
          sqliteCatalogMovie?.containerExtension || catalogMovie?.containerExtension,
        ),
        resolvedExtensionPresent: Boolean(decision.containerExtension),
      });
      await launchPlayback(
        {
          id: decision.movieId,
          mediaType: 'movie',
          title: decision.title,
          streamUrl,
          artworkUrl: decision.artworkUrl,
          isLive: false,
          providerId: activeProviderId,
          resumePositionMs: decision.positionMs,
          containerExtension: decision.containerExtension,
          extensionSource: decision.extensionSource,
        },
        { launchSource: 'play', contentFit: 'contain', resumePolicy: 'silent' },
      );
      return;
    }

    const detail = await bundle.seriesDataSource.getSeriesInfo(decision.seriesId);
    const episode = detail
      ? Object.values(detail.episodesBySeason)
          .flat()
          .find((candidate) => candidate.id === decision.episodeId || candidate.id === decision.contentId)
      : null;
    if (!episode) {
      showNotification({
        type: 'error',
        title: 'Unable to resume',
        message: 'This episode is no longer available.',
        duration: 6000,
        scope: 'home',
      });
      return;
    }

    await launchSeriesEpisodePlayback({
      bundle,
      providerId: activeProviderId,
      episode,
      seriesTitle: detail?.title,
      artworkUrl: detail?.posterUrl,
      resumePositionMs: decision.positionMs,
      episodes: detail ? Object.values(detail.episodesBySeason).flat() : undefined,
      launchSource: 'episode',
      launchPlayback: (playbackItem, options) =>
        launchPlayback(playbackItem, { ...options, resumePolicy: 'silent' }),
    });
  };

  const openRecentItem = async (item: RecentItemRecord) => {
    const continueItem = personalization.continueWatching.find(
      (candidate) => candidate.contentId === item.contentId || candidate.episodeId === item.contentId,
    );
    if (continueItem) {
      await openContinueItem(continueItem);
      return;
    }

    if (item.mediaType === 'movie') {
      await openContinueItem({
        providerId: activeProviderId,
        mediaType: 'movie',
        contentId: item.contentId,
        title: item.title,
        artworkUrl: item.artworkUrl,
        positionMs: 0,
        durationMs: 0,
        progressPercent: 0,
        updatedAt: item.lastOpenedAt,
        containerExtension: undefined,
      });
      return;
    }

    if (item.mediaType === 'episode') {
      await openContinueItem({
        providerId: activeProviderId,
        mediaType: 'episode',
        contentId: item.contentId,
        title: item.title,
        artworkUrl: item.artworkUrl,
        parentSeriesId: item.parentSeriesId,
        episodeId: item.contentId,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        positionMs: 0,
        durationMs: 0,
        progressPercent: 0,
        updatedAt: item.lastOpenedAt,
      });
      return;
    }

    if (item.mediaType === 'series') {
      const detail = bundle
        ? await bundle.seriesDataSource.getSeriesInfo(item.contentId).catch(() => null)
        : null;
      if (detail) {
        const series: SeriesSummary = {
          id: detail.seriesId,
          seriesId: detail.seriesId,
          categoryId: item.categoryId ?? '',
          title: detail.title || item.title,
          year: detail.year,
          rating: detail.rating,
          releaseDate: detail.releaseDate,
          description: detail.description,
          genres: detail.genres,
          posterStyleKey: 'ember',
          posterUrl: detail.posterUrl ?? item.artworkUrl,
          backdropUrl: detail.backdropUrl,
        };
        rememberSeriesScreenMemory(activeProviderId, {
          pendingSeriesDetail: series,
          selectedSeriesId: series.id,
          focusedSeriesId: series.id,
          openDiscoverZone: false,
        });
        navigateTo('/series');
        return;
      }
      showNotification({
        type: 'error',
        title: 'Unable to play series',
        message: 'This series has no episode identity to play.',
        duration: 6000,
        scope: 'home',
      });
      return;
    }

    if (item.mediaType === 'live' && bundle) {
      const channel = await bundle.live.getChannel(item.contentId).catch(() => null);
      if (channel) {
        await playLiveChannelFullscreen(channel);
        return;
      }
    }

    showNotification({
      type: 'error',
      title: 'Unable to play channel',
      message: 'This channel is no longer available.',
      duration: 6000,
      scope: 'home',
    });
  };

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        homeRootLayoutRef.current = { width, height };
        logHomePresentationAudit('home-root-layout', {
          width,
          height,
          opacity: 1,
          hidden: false,
          transform: null,
          ...homePresentationAuditState(),
        });
        if ((width === 0 || height === 0) && (continueWatchingCount || watchlistItems.length || personalization.favoriteChannels.length || favoriteItems.length)) {
          logHomePresentationAudit('mismatch-zero-layout', {
            scope: 'home-root',
            reason: 'home-data-present-zero-layout',
          });
        }
      }}>
      <View style={styles.browseLayer} pointerEvents={playbackActive || playbackClosing ? 'none' : 'auto'}>
        <NovaTvShell
          activeId="home"
          preferActiveNavigationFocus
          onNavigationFocusHandles={setNavFocusHandles}
          onNavigationItemFocus={setNavbarFocusedId}
          navigationContentFocusHandle={navigationContentFocusHandle}
          navigationNextFocusRight={navigationNextFocusRight}
        >
          <ScrollView
            style={styles.screenScroll}
            contentContainerStyle={styles.screen}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled>
        <View style={styles.rows}>
          {personalization.providerId === activeProviderId && personalization.continueWatching.length ? (
            <HomeRow title="Continue Watching" sectionType="continue-watching" itemCount={continueWatchingCount} onAuditLayout={registerFirstHomeSectionLayout}>
              {personalization.continueWatching.map((item, index) => (
                <HomeMediaCard
                  key={`${item.mediaType}-${item.contentId}`}
                  title={item.title}
                  subtitle={item.subtitle ?? `${Math.round(item.progressPercent)}% watched`}
                  artworkUrl={item.artworkUrl}
                  progress={item.progressPercent}
                  preferredFocus={false}
                  nextFocusUp={firstHomeFocusId === `continue-${item.contentId}` ? navFocusHandles.home : undefined}
                  onFocusHandle={
                    firstHomeFocusId === `continue-${item.contentId}`
                      ? (handle) => registerHomeFocusHandle(`continue-${item.contentId}`, handle)
                      : undefined
                  }
                  onPress={() => void openContinueItem(item)}
                  onRemove={() => void removeContinueWatchingItem(activeProviderId, item.mediaType, item.contentId)}
                  auditSectionType="continue-watching"
                  auditItemIndex={index}
                  onAuditMounted={registerFirstHomeFocusableCard}
                  getAuditState={homePresentationAuditState}
                />
              ))}
            </HomeRow>
          ) : null}

          {watchlistItems.length ? (
            <HomeRow title="My Watchlist" sectionType="watchlist" itemCount={watchlistItems.length} onAuditLayout={registerFirstHomeSectionLayout}>
              {watchlistItems.map((entry, index) => (
                <HomeMediaCard
                  key={`watchlist-${entry.kind}-${entry.item.id}`}
                  title={entry.item.title}
                  subtitle={entry.kind === 'movie' ? 'Movie watchlist' : 'Series watchlist'}
                  artworkUrl={entry.item.posterUrl}
                  preferredFocus={false}
                  nextFocusUp={firstHomeFocusId === `watchlist-${entry.kind}-${entry.item.id}` ? navFocusHandles.home : undefined}
                  onFocusHandle={
                    firstHomeFocusId === `watchlist-${entry.kind}-${entry.item.id}`
                      ? (handle) => registerHomeFocusHandle(`watchlist-${entry.kind}-${entry.item.id}`, handle)
                      : undefined
                  }
                  onPress={() => {
                    if (entry.kind === 'movie') {
                      rememberMoviesScreenMemory(activeProviderId, { openDiscoverZone: true, selectedMovieId: entry.item.id });
                      navigateTo('/movies');
                      return;
                    }
                    const decision = decideHomeWatchlistSeriesLaunch(entry.item);
                    logWatchlistLaunch({
                      event: 'press',
                      mediaType: 'series',
                      providerIdPresent: Boolean(activeProviderId),
                      savedIdPresent: Boolean(entry.item.id),
                      canonicalContentIdPresent: Boolean(entry.item.id),
                      providerSeriesIdPresent: Boolean(entry.item.seriesId),
                    });
                    if (decision.kind !== 'open-series-detail') {
                      logWatchlistLaunch({
                        event: 'resolution-failed',
                        mediaType: 'series',
                        providerIdPresent: Boolean(activeProviderId),
                        savedIdPresent: Boolean(entry.item.id),
                        canonicalContentIdPresent: false,
                        providerSeriesIdPresent: Boolean(entry.item.seriesId),
                      });
                      return;
                    }
                    logWatchlistLaunch({
                      event: 'canonical-resolved',
                      mediaType: 'series',
                      providerIdPresent: Boolean(activeProviderId),
                      savedIdPresent: true,
                      canonicalContentIdPresent: Boolean(decision.series.id),
                      providerSeriesIdPresent: Boolean(decision.series.seriesId),
                    });
                    rememberSeriesScreenMemory(activeProviderId, {
                      pendingSeriesDetail: decision.series,
                      selectedSeriesId: decision.series.id,
                      focusedSeriesId: decision.series.id,
                      openDiscoverZone: false,
                    });
                    navigateTo('/series');
                  }}
                  auditSectionType="watchlist"
                  auditItemIndex={index}
                  onAuditMounted={registerFirstHomeFocusableCard}
                  getAuditState={homePresentationAuditState}
                />
              ))}
            </HomeRow>
          ) : null}

          {personalization.providerId === activeProviderId && personalization.favoriteChannels.length ? (
            <HomeRow title="My Channels" sectionType="favorite-channels" itemCount={personalization.favoriteChannels.length} onAuditLayout={registerFirstHomeSectionLayout}>
              {personalization.favoriteChannels.map((item, index) => (
                <ChannelHeroCard
                  key={item.id}
                  title={item.title}
                  subtitle="Favorite channel"
                  logoUrl={item.artworkUrl}
                  categoryType={resolveChannelCategoryType({ categoryId: item.categoryId, name: item.title }, categoryTypeById)}
                  isLive
                  preferredFocus={false}
                  nextFocusUp={firstHomeFocusId === `favorite-channel-${item.id}` ? navFocusHandles.home : undefined}
                  onFocusHandle={
                    firstHomeFocusId === `favorite-channel-${item.id}`
                      ? (handle) => registerHomeFocusHandle(`favorite-channel-${item.id}`, handle)
                      : undefined
                  }
                  onPress={() => void openRecentItem({ providerId: activeProviderId, mediaType: 'live', contentId: item.id, title: item.title, artworkUrl: item.artworkUrl, lastOpenedAt: Date.now() })}
                  auditSectionType="favorite-channels"
                  auditItemIndex={index}
                  onAuditMounted={registerFirstHomeFocusableCard}
                  getAuditState={homePresentationAuditState}
                  onAuditFocus={(focused) => logHomePresentationAudit(focused ? 'first-card-focus' : 'first-card-blur', {
                    sectionType: 'favorite-channels',
                    itemIndex: index,
                    visuallyPresented: true,
                  })}
                />
              ))}
            </HomeRow>
          ) : null}

          {favoriteItems.length ? (
            <HomeRow title="My Favorites" sectionType="favorites" itemCount={favoriteItems.length} onAuditLayout={registerFirstHomeSectionLayout}>
              {favoriteItems.map((entry, index) => (
                <HomeMediaCard
                  key={`favorite-${entry.kind}-${entry.item.id}`}
                  title={entry.item.title}
                  subtitle={entry.kind === 'movie' ? 'Favorite movie' : 'Favorite series'}
                  artworkUrl={entry.item.posterUrl}
                  preferredFocus={false}
                  nextFocusUp={firstHomeFocusId === `favorite-${entry.kind}-${entry.item.id}` ? navFocusHandles.home : undefined}
                  onFocusHandle={
                    firstHomeFocusId === `favorite-${entry.kind}-${entry.item.id}`
                      ? (handle) => registerHomeFocusHandle(`favorite-${entry.kind}-${entry.item.id}`, handle)
                      : undefined
                  }
                  onPress={() => {
                    if (entry.kind === 'movie') {
                      rememberMoviesScreenMemory(activeProviderId, { openDiscoverZone: true, selectedMovieId: entry.item.id });
                      navigateTo('/movies');
                      return;
                    }
                    rememberSeriesScreenMemory(activeProviderId, { openDiscoverZone: true, selectedSeriesId: entry.item.id });
                    navigateTo('/series');
                  }}
                  auditSectionType="favorites"
                  auditItemIndex={index}
                  onAuditMounted={registerFirstHomeFocusableCard}
                  getAuditState={homePresentationAuditState}
                />
              ))}
            </HomeRow>
          ) : null}
        </View>
          </ScrollView>
        </NovaTvShell>
      </View>
      <ExitConfirmOverlay
        visible={exitConfirm.visible}
        onCancel={exitConfirm.cancel}
        onConfirm={exitConfirm.confirm}
      />
      <WalkthroughOverlay
        key={guide.visible ? 'home-guide-open' : 'home-guide-closed'}
        visible={guide.visible && !playbackActive && !playbackClosing}
        title={ONBOARDING_GUIDES.hub.title}
        steps={ONBOARDING_GUIDES.hub.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </View>
  );
}

type HomeRowProps = {
  title: string;
  children: ReactNode;
  compact?: boolean;
  sectionType: HomeAuditSectionType;
  itemCount: number;
  onAuditLayout?: (sectionType: HomeAuditSectionType, width: number, height: number) => void;
};

const HomeRow = memo(function HomeRow({ title, children, compact = false, sectionType, itemCount, onAuditLayout }: HomeRowProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  const layoutRef = useRef('');
  const layoutSeenRef = useRef(false);
  useEffect(() => {
    logHomePresentationAudit('section-mounted', {
      sectionType,
      itemCount,
      intentionallyHidden: false,
      hiddenReason: null,
      opacity: 1,
      pointerEvents: 'auto',
    });
    const timer = setTimeout(() => {
      if (itemCount > 0 && !layoutSeenRef.current) {
        logHomePresentationAudit('section-not-laid-out', { sectionType, itemCount });
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [itemCount, sectionType]);
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const key = `${width}x${height}`;
    layoutSeenRef.current = true;
    onAuditLayout?.(sectionType, width, height);
    if (layoutRef.current === key) {
      return;
    }
    layoutRef.current = key;
    logHomePresentationAudit('section-layout', {
      sectionType,
      itemCount,
      width,
      height,
      zeroLayout: width === 0 || height === 0,
      opacity: 1,
      pointerEvents: 'auto',
    });
    if (itemCount > 0 && (width === 0 || height === 0)) {
      logHomePresentationAudit('section-focus-visibility-mismatch', {
        sectionType,
        itemCount,
        reason: 'zero-layout',
      });
    }
  };
  return (
    <View onLayout={handleLayout} style={[styles.rowSection, compact && styles.rowSectionCompact]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowCards}
        removeClippedSubviews={false}
        nestedScrollEnabled>
        {children}
      </ScrollView>
    </View>
  );
});

type HomeMediaCardProps = {
  title: string;
  subtitle: string;
  artworkUrl?: string;
  progress?: number;
  icon?: 'television' | 'history' | 'movie-open-outline';
  preferredFocus?: boolean;
  nextFocusUp?: number;
  onFocusHandle?: (handle: number | null) => void;
  onPress: () => void;
  onRemove?: () => void;
  auditSectionType?: HomeAuditSectionType;
  auditItemIndex?: number;
  onAuditMounted?: (sectionType: HomeAuditSectionType, index: number, focusable: boolean) => void;
  getAuditState?: () => HomePresentationAuditState;
};

const HomeMediaCard = memo(function HomeMediaCard({
  title,
  subtitle,
  artworkUrl,
  progress,
  icon,
  preferredFocus = false,
  nextFocusUp,
  onFocusHandle,
  onPress,
  onRemove,
  auditSectionType,
  auditItemIndex,
  onAuditMounted,
  getAuditState,
}: HomeMediaCardProps) {
  markCatalogAuditRender('HomeMediaCard');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const [removeFocused, setRemoveFocused] = useState(false);
  const preferredFocusConsumedRef = useRef(false);

  useEffect(() => {
    if (auditSectionType && auditItemIndex === 0) {
      onAuditMounted?.(auditSectionType, auditItemIndex, true);
    }
  }, []);

  return (
    <View style={styles.mediaCardWrap}>
      <Pressable
        ref={(node) => onFocusHandle?.(node ? findNodeHandle(node) : null)}
        collapsable={false}
        focusable
        hasTVPreferredFocus={preferredFocus && !preferredFocusConsumedRef.current}
        {...(nextFocusUp != null ? { nextFocusUp } : null)}
        onFocus={() => {
          preferredFocusConsumedRef.current = true;
          markCatalogAuditFocus('home-card');
          noteFocusLatencyFocus('home-card');
          if (auditSectionType && auditItemIndex === 0) {
            logHomePresentationAudit('first-home-card-focus', {
              sectionType: auditSectionType,
              itemIndex: auditItemIndex,
              ...getAuditState?.(),
            });
          }
          setFocused(true);
        }}
        onBlur={() => {
          if (auditSectionType && auditItemIndex === 0) {
            logHomePresentationAudit('first-home-card-blur', {
              sectionType: auditSectionType,
              itemIndex: auditItemIndex,
              ...getAuditState?.(),
            });
          }
          setFocused(false);
        }}
        onPress={onPress}
        style={[styles.mediaCard, novaTvFocus.base, styles.mediaCardGlassBase, focused && styles.mediaCardFocused]}>
        <View style={[styles.mediaArtwork, focused && styles.mediaArtworkFocused]}>
          {artworkUrl ? <Image source={{ uri: artworkUrl }} style={styles.mediaArtworkImage} contentFit="cover" /> : null}
          {!artworkUrl ? <MaterialCommunityIcons name={icon ?? 'movie-open-outline'} size={28} color={theme.colors.accent} /> : null}
          {typeof progress === 'number' ? (
            <View style={styles.mediaProgressTrack}>
              <View style={[styles.mediaProgressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.mediaTitle, focused && styles.mediaTitleFocused]}>{displayStreamTitle(title)}</Text>
        <Text numberOfLines={1} style={[styles.mediaSubtitle, focused && styles.mediaSubtitleFocused]}>{subtitle}</Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          focusable
          onFocus={() => setRemoveFocused(true)}
          onBlur={() => setRemoveFocused(false)}
          onPress={onRemove}
          style={[styles.removeButton, novaTvFocus.base, removeFocused && styles.removeButtonFocused]}>
          <MaterialCommunityIcons name="close" size={14} color={theme.colors.textSecondary} />
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

function createHomeStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  browseLayer: {
    flex: 1,
  },
  screenScroll: {
    flex: 1,
  },
  screen: {
    flexGrow: 1,
    paddingBottom: 20,
    gap: 4,
  },
  rows: {
    gap: 4,
  },
  rowSection: {
    minHeight: 170,
    gap: 0,
    paddingBottom: 4,
  },
  rowSectionCompact: {
    minHeight: 155,
  },
  rowCards: {
    gap: 8,
    paddingVertical: 2,
    paddingRight: 18,
  },
  mediaCard: {
    width: 215,
    minHeight: 160,
    backgroundColor: 'transparent',
    padding: 0,
    ...focusChrome.base,
  },
  mediaCardGlassBase: {
    borderWidth: 1,
    borderRadius: NOVA_GLASS.radius.base,
    borderColor: NOVA_GLASS.subtle.borderColor,
    backgroundColor: NOVA_GLASS.subtle.backgroundColor,
  },
  mediaCardFocused: {
    borderColor: NOVA_GLASS.activeFocused.borderColor,
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderRadius: NOVA_GLASS.radius.base,
  },
  mediaArtworkFocused: {},
  mediaCardWrap: {
    width: 215,
    gap: 3,
  },
  removeButton: {
    minHeight: 24,
    borderTopWidth: 1,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...focusChrome.base,
  },
  removeButtonFocused: focusChrome.active,
  removeButtonText: {
    color: theme.colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
  },
  mediaArtwork: {
    height: 116,
    borderRadius: 11,
    backgroundColor: theme.colors.backgroundRaised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mediaArtworkImage: {
    width: '100%',
    height: '100%',
  },
  mediaProgressTrack: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    left: 6,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  mediaProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  mediaTitle: {
    marginTop: 4,
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  mediaTitleFocused: focusText.title,
  mediaSubtitle: {
    marginTop: 1,
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  mediaSubtitleFocused: focusText.secondary,
  lowerGrid: {
    flex: 0.74,
    minHeight: 0,
    flexDirection: 'row',
    gap: 16,
  },
  section: {
    flex: 1.65,
    minWidth: 0,
  },
  liveSection: {
    flex: 0.75,
    minWidth: 280,
  },
  sectionHeader: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
  },
  continueEmpty: {
    flex: 1,
    minHeight: 120,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
  },
  continueEmptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  continueEmptyCopy: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  liveEmpty: {
    flex: 1,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  liveEmptyText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.danger,
  },
  liveList: {
    flex: 1,
    gap: 7,
  },
  liveRow: {
    flex: 1,
    minHeight: 0,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 9,
  },
  liveLogo: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  liveLogoImage: {
    width: '100%',
    height: '100%',
  },
  liveLogoText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  liveCopy: {
    flex: 1,
  },
  liveChannel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  liveProgram: {
    marginTop: 3,
    color: theme.colors.textSecondary,
    fontSize: 11,
  },
});
}
