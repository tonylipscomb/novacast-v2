import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ImageBackground as ReactNativeImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { NovaLogo, NovaTvShell } from '@/components/nova';
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
import { buildLiveChannelPlaybackUrl, buildMoviePlaybackUrl } from '@/features/providers/providerPlayback';
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
import { getThemeHeroSource } from '@/theme/brandingAssets';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { markCatalogAuditFocus, markCatalogAuditRender } from '@/features/diagnostics/novaCastCatalogAudit';
import { noteFocusLatencyFocus } from '@/features/diagnostics/focusLatencyAudit';
import { waitOutCatalogWriteQuietPeriod } from '@/features/catalog/catalogWriteQuietPeriod';
import { processTimeBudgeted } from '@/features/catalog/jsChunkBudget';
import {
  getHomeScreenMemory,
  rememberHomeScreenMemory,
  resolveHomeInitialFocusId,
  type HomeFocusSnapshot,
} from '@/features/hub/homeScreenMemory';
import {
  noteHomeRowUpdated,
  recordHomeStabilityOnce,
} from '@/features/hub/homeStabilityDiagnostics';

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

export function MainMenuScreen() {
  markCatalogAuditRender('MainMenuScreen');
  const { theme, themeId } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  const heroArtwork = useMemo(() => getThemeHeroSource(themeId), [themeId]);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const scrollRef = useRef<ScrollView | null>(null);
  const homeInteractiveFiredRef = useRef(false);
  const focusDiagnosticFiredRef = useRef(false);
  const { selectedProvider } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const { isActive: playbackActive, isClosing: playbackClosing, launchPlayback } = useUnifiedPlayer();
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.hub.key);
  const exitConfirm = useExitConfirmOnBack(!playbackActive && !playbackClosing && !guide.visible);
  const activeProviderId = selectedProvider?.id ?? 'demo-provider';
  const heroHeight = Math.min(280, Math.max(200, Math.round(width * 0.16)));
  const [categoryTypeById, setCategoryTypeById] = useState<Map<string, ProviderCategoryType>>(new Map());
  const [personalization, setPersonalization] = useState<HomePersonalizationSnapshot>(() => ({
    providerId: '',
    continueWatching: [] as HomeContinueWatchingItem[],
    favoriteChannels: [],
    favoriteMovies: [] as MovieSummary[],
    favoriteSeries: [] as SeriesSummary[],
    recentlyWatched: [] as RecentItemRecord[],
  }));
  const recentlyWatchedItems =
    personalization.providerId === activeProviderId ? personalization.recentlyWatched.slice(0, 6) : [];

  const focusSnapshot: HomeFocusSnapshot = {
    providerId: personalization.providerId,
    recentlyWatched: recentlyWatchedItems,
    continueWatching:
      personalization.providerId === activeProviderId ? personalization.continueWatching : [],
    favoriteChannels:
      personalization.providerId === activeProviderId ? personalization.favoriteChannels : [],
    favoriteMovies:
      personalization.providerId === activeProviderId ? personalization.favoriteMovies : [],
    favoriteSeries:
      personalization.providerId === activeProviderId ? personalization.favoriteSeries : [],
  };

  // Stage 4.2R: resolve the initial focus target ONCE per Home mount and freeze
  // it. Later debounced/background personalization refreshes must not re-point
  // preferred focus, which would steal focus after data settles. The remembered
  // target (from a prior Home visit) is restored when it still exists. While the
  // guided walkthrough is visible, Home content owns no focus.
  const resolvedFocusIdRef = useRef<string | null | undefined>(undefined);
  let firstHomeFocusId: string | null;
  if (guide.visible) {
    firstHomeFocusId = null;
  } else if (resolvedFocusIdRef.current !== undefined) {
    firstHomeFocusId = resolvedFocusIdRef.current;
  } else {
    const candidate = resolveHomeInitialFocusId(focusSnapshot, activeProviderId, {
      guideVisible: false,
      rememberedFocusId: getHomeScreenMemory(activeProviderId).focusedCardId,
    });
    if (candidate) {
      resolvedFocusIdRef.current = candidate;
    }
    firstHomeFocusId = candidate;
  }

  // Stage 4.2R: the Home shell (NovaTvShell) starts the diagnostics generation;
  // this parent effect runs afterwards and records the Home mount marker.
  useEffect(() => {
    recordHomeStabilityOnce('home_mount_started', { providerId: activeProviderId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage 4.2R: once the initial focus target is resolved, emit a one-shot
  // diagnostic and restore the prior vertical scroll offset when we are
  // restoring a remembered target (Home-return path).
  useEffect(() => {
    if (focusDiagnosticFiredRef.current || !firstHomeFocusId) {
      return;
    }
    focusDiagnosticFiredRef.current = true;
    const memory = getHomeScreenMemory(activeProviderId);
    const restored = memory.focusedCardId === firstHomeFocusId;
    recordHomeStabilityOnce(restored ? 'home_focus_restored' : 'home_initial_focus_assigned', {
      focusId: firstHomeFocusId,
    });
    if (restored && memory.scrollOffsetY > 0) {
      const targetY = memory.scrollOffsetY;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: targetY, animated: false });
      });
    }
  }, [activeProviderId, firstHomeFocusId]);

  const handleCardFocused = useCallback(
    (focusId: string) => {
      rememberHomeScreenMemory(activeProviderId, { focusedCardId: focusId });
      if (!homeInteractiveFiredRef.current) {
        homeInteractiveFiredRef.current = true;
        recordHomeStabilityOnce('home_interactive', { focusId });
      }
    },
    [activeProviderId],
  );

  const handleHomeScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      rememberHomeScreenMemory(activeProviderId, { scrollOffsetY: event.nativeEvent.contentOffset.y });
    },
    [activeProviderId],
  );

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
    let loadedOnce = false;

    const refresh = () => {
      void loadHomePersonalization(activeProviderId, bundle).then((next) => {
        if (cancelled) {
          return;
        }
        setPersonalization(next);
        if (loadedOnce) {
          noteHomeRowUpdated('personalization-refresh');
        } else {
          loadedOnce = true;
          recordHomeStabilityOnce('home_data_snapshot_ready', {
            recentlyWatched: next.recentlyWatched.length,
            continueWatching: next.continueWatching.length,
            favoriteChannels: next.favoriteChannels.length,
            favoriteMovies: next.favoriteMovies.length,
            favoriteSeries: next.favoriteSeries.length,
          });
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
    if (!bundle) {
      return;
    }

    if (item.mediaType === 'movie') {
      const indexedMovie =
        getMovieCatalogIndex(activeProviderId).getSummaries([item.contentId])[0] ??
        ({
          id: item.contentId,
          categoryId: '',
          title: item.title,
          genres: ['Movies'],
          posterStyleKey: 'midnight',
          posterUrl: item.artworkUrl,
        } satisfies MovieSummary);
      const streamUrl = indexedMovie
        ? buildMoviePlaybackUrl(bundle, indexedMovie.id, indexedMovie.containerExtension ?? 'mp4')
        : null;
      if (streamUrl) {
        await launchPlayback(
          {
            id: indexedMovie.id,
            mediaType: 'movie',
            title: indexedMovie.title,
            streamUrl,
            artworkUrl: indexedMovie.posterUrl,
            isLive: false,
            providerId: activeProviderId,
            resumePositionMs: item.positionMs,
          },
          { launchSource: 'play', contentFit: 'contain' },
        );
      }
      return;
    }

    if (!item.parentSeriesId) {
      return;
    }

    const detail = await bundle.seriesDataSource.getSeriesInfo(item.parentSeriesId);
    const episode = detail
      ? Object.values(detail.episodesBySeason)
          .flat()
          .find((candidate) => candidate.id === item.episodeId || candidate.id === item.contentId)
      : null;
    if (!episode) {
      return;
    }

    await launchSeriesEpisodePlayback({
      bundle,
      providerId: activeProviderId,
      episode,
      seriesTitle: detail?.title,
      artworkUrl: detail?.posterUrl,
      resumePositionMs: item.positionMs,
      launchSource: 'episode',
      launchPlayback,
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
      rememberMoviesScreenMemory(activeProviderId, {
        selectedCategoryId: 'smart:recently-watched',
        focusedMovieId: item.contentId,
        selectedMovieId: item.contentId,
      });
      navigateTo('/movies');
      return;
    }

    if (item.mediaType === 'episode' || item.mediaType === 'series') {
      rememberSeriesScreenMemory(activeProviderId, {
        selectedCategoryId: 'smart:recently-watched',
        focusedSeriesId: item.parentSeriesId ?? item.contentId,
        selectedSeriesId: item.parentSeriesId ?? item.contentId,
      });
      navigateTo('/series');
      return;
    }

    if (item.mediaType === 'live' && bundle) {
      const channel = await bundle.live.getChannel(item.contentId).catch(() => null);
      if (channel) {
        await playLiveChannelFullscreen(channel);
      }
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.browseLayer} pointerEvents={playbackActive || playbackClosing ? 'none' : 'auto'}>
        <NovaTvShell
          activeId="home"
          title="Home"
          subtitle="Your entertainment. One place."
          preferActiveNavigationFocus={!firstHomeFocusId}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.screenScroll}
            contentContainerStyle={styles.screen}
            showsVerticalScrollIndicator={false}
            onScroll={handleHomeScroll}
            scrollEventThrottle={64}
            nestedScrollEnabled>
        <View style={styles.heroBlock}>
          <ReactNativeImageBackground
            source={heroArtwork}
            resizeMode="cover"
            imageStyle={styles.heroArtwork}
            style={[styles.hero, { height: heroHeight }]}>
            <View pointerEvents="none" style={styles.heroContent}>
              <NovaLogo
                size="md"
                subtitle="ENTERTAINMENT STARTS HERE"
                variant="full"
              />
              <Text style={styles.heroEyebrow}>WELCOME BACK</Text>
              <Text numberOfLines={1} style={styles.heroTitle}>Entertainment starts here.</Text>
            </View>
          </ReactNativeImageBackground>
        </View>

        <View style={styles.rows}>
          {recentlyWatchedItems.length ? (
            <HomeRow title="Recently Watched" compact>
              {recentlyWatchedItems.map((item) => (
                <HomeMediaCard
                  key={`${item.mediaType}-${item.contentId}`}
                  title={item.title}
                  subtitle={item.mediaType === 'live' ? 'Live channel' : 'Recently watched'}
                  artworkUrl={item.artworkUrl}
                  icon={item.mediaType === 'live' ? 'television' : 'history'}
                  focusId={`recent-${item.mediaType}-${item.contentId}`}
                  onFocused={handleCardFocused}
                  preferredFocus={firstHomeFocusId === `recent-${item.mediaType}-${item.contentId}`}
                  onPress={() => void openRecentItem(item)}
                />
              ))}
            </HomeRow>
          ) : null}

          {personalization.providerId === activeProviderId && personalization.continueWatching.length ? (
            <HomeRow title="Continue Watching">
              {personalization.continueWatching.map((item) => (
                <HomeMediaCard
                  key={`${item.mediaType}-${item.contentId}`}
                  title={item.title}
                  subtitle={item.subtitle ?? `${Math.round(item.progressPercent)}% watched`}
                  artworkUrl={item.artworkUrl}
                  progress={item.progressPercent}
                  focusId={`continue-${item.contentId}`}
                  onFocused={handleCardFocused}
                  preferredFocus={firstHomeFocusId === `continue-${item.contentId}`}
                  onPress={() => void openContinueItem(item)}
                  onRemove={() => void removeContinueWatchingItem(activeProviderId, item.mediaType, item.contentId)}
                />
              ))}
            </HomeRow>
          ) : null}

          {personalization.providerId === activeProviderId && personalization.favoriteChannels.length ? (
            <HomeRow title="Favorite Channels">
              {personalization.favoriteChannels.map((item) => (
                <ChannelHeroCard
                  key={item.id}
                  title={item.title}
                  subtitle="Favorite channel"
                  logoUrl={item.artworkUrl}
                  categoryType={resolveChannelCategoryType({ categoryId: item.categoryId, name: item.title }, categoryTypeById)}
                  isLive
                  focusId={`favorite-channel-${item.id}`}
                  onFocused={handleCardFocused}
                  preferredFocus={firstHomeFocusId === `favorite-channel-${item.id}`}
                  onPress={() => void openRecentItem({ providerId: activeProviderId, mediaType: 'live', contentId: item.id, title: item.title, artworkUrl: item.artworkUrl, lastOpenedAt: Date.now() })}
                />
              ))}
            </HomeRow>
          ) : null}

          {personalization.providerId === activeProviderId && personalization.favoriteMovies.length ? (
            <HomeRow title="Favorite Movies">
              {personalization.favoriteMovies.map((item) => (
                <HomeMediaCard
                  key={item.id}
                  title={item.title}
                  subtitle="Favorite movie"
                  artworkUrl={item.posterUrl}
                  focusId={`favorite-movie-${item.id}`}
                  onFocused={handleCardFocused}
                  preferredFocus={firstHomeFocusId === `favorite-movie-${item.id}`}
                  onPress={() => {
                    rememberMoviesScreenMemory(activeProviderId, {
                      selectedCategoryId: 'smart:your-favorites',
                      focusedMovieId: item.id,
                      selectedMovieId: item.id,
                    });
                    navigateTo('/movies');
                  }}
                />
              ))}
            </HomeRow>
          ) : null}

          {personalization.providerId === activeProviderId && personalization.favoriteSeries.length ? (
            <HomeRow title="Favorite Series">
              {personalization.favoriteSeries.map((item) => (
                <HomeMediaCard
                  key={item.id}
                  title={item.title}
                  subtitle="Favorite series"
                  artworkUrl={item.posterUrl}
                  focusId={`favorite-series-${item.id}`}
                  onFocused={handleCardFocused}
                  preferredFocus={firstHomeFocusId === `favorite-series-${item.id}`}
                  onPress={() => {
                    rememberSeriesScreenMemory(activeProviderId, {
                      selectedCategoryId: 'smart:favorites',
                      focusedSeriesId: item.id,
                      selectedSeriesId: item.id,
                    });
                    navigateTo('/series');
                  }}
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

type HomeRowProps = { title: string; children: ReactNode; compact?: boolean };

const HomeRow = memo(function HomeRow({ title, children, compact = false }: HomeRowProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  return (
    <View style={[styles.rowSection, compact && styles.rowSectionCompact]}>
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
  focusId?: string;
  onFocused?: (id: string) => void;
  onPress: () => void;
  onRemove?: () => void;
};

const HomeMediaCard = memo(function HomeMediaCard({
  title,
  subtitle,
  artworkUrl,
  progress,
  icon,
  preferredFocus = false,
  focusId,
  onFocused,
  onPress,
  onRemove,
}: HomeMediaCardProps) {
  markCatalogAuditRender('HomeMediaCard');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const [removeFocused, setRemoveFocused] = useState(false);
  const preferredFocusConsumedRef = useRef(false);

  return (
    <View style={styles.mediaCardWrap}>
      <Pressable
        focusable
        hasTVPreferredFocus={preferredFocus && !preferredFocusConsumedRef.current}
        onFocus={() => {
          preferredFocusConsumedRef.current = true;
          markCatalogAuditFocus('home-card');
          noteFocusLatencyFocus('home-card');
          setFocused(true);
          if (focusId) {
            onFocused?.(focusId);
          }
        }}
        onBlur={() => setFocused(false)}
        onPress={onPress}
        style={[styles.mediaCard, novaTvFocus.base, focused && styles.mediaCardFocused]}>
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
    paddingBottom: 20,
    gap: 8,
  },
  heroBlock: {
    width: '100%',
  },
  hero: {
    width: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#050816',
  },
  heroArtwork: {
    borderRadius: 0,
  },
  heroContent: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  heroEyebrow: {
    marginTop: 4,
    color: '#55A8FF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  heroTitle: {
    marginTop: 2,
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    marginTop: 3,
    maxWidth: 620,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 19,
    fontWeight: '600',
  },
  rows: {
    gap: 8,
  },
  rowSection: {
    minHeight: 168,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  rowSectionCompact: {
    minHeight: 148,
  },
  rowCards: {
    gap: 10,
    paddingVertical: 2,
    paddingRight: 18,
  },
  mediaCard: {
    width: 168,
    minHeight: 148,
    borderRadius: 0,
    backgroundColor: 'transparent',
    padding: 0,
    ...focusChrome.base,
  },
  mediaCardFocused: focusChrome.active,
  mediaArtworkFocused: {},
  mediaCardWrap: {
    width: 168,
    gap: 5,
  },
  removeButton: {
    minHeight: 28,
    borderRadius: 0,
    borderTopWidth: 1,
    borderColor: theme.colors.borderSubtle,
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
    fontSize: 10,
    fontWeight: '700',
  },
  mediaArtwork: {
    height: 96,
    borderRadius: 0,
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
    marginTop: 7,
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  mediaTitleFocused: focusText.title,
  mediaSubtitle: {
    marginTop: 3,
    color: theme.colors.textMuted,
    fontSize: 11,
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
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.sectionTitle,
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
