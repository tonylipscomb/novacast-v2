import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageBackground as ReactNativeImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { NovaLogo, NovaTvShell } from '@/components/nova';
import { ChannelHeroCard } from '@/features/hub/ChannelHeroCard';
import { loadRandomUsEntertainmentChannels } from '@/features/hub/hubLiveNow';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { shouldAutoShowGuide } from '@/features/onboarding/onboardingModel';
import { useOnboardingStore } from '@/features/onboarding/onboardingStore';
import { classifyProviderCategoryType, type ProviderCategoryType } from '@/features/providers/categoryNormalization';
import { useProviderLibrarySummary } from '@/features/providers/providerLibrarySummaryStore';
import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { rememberLiveTvMemory } from '@/features/live/liveTvMemory';
import { rememberMoviesScreenMemory } from '@/features/movies/moviesScreenMemory';
import { rememberSeriesScreenMemory } from '@/features/series/seriesScreenMemory';
import { buildMoviePlaybackUrl } from '@/features/providers/providerPlayback';
import { UnifiedPlayerHost, useUnifiedPlayer } from '@/features/playback/unified';
import { launchSeriesEpisodePlayback } from '@/features/series/seriesPlayback';
import { loadHomePersonalization, type HomePersonalizationSnapshot } from '@/features/personalization/personalizationHome';
import { getMovieCatalogIndex } from '@/features/movies/smart/movieCatalogIndex';
import { removeContinueWatchingItem, subscribePersonalization } from '@/features/personalization/personalizationStore';
import { subscribeMovieLibrary } from '@/features/movies/smart/movieLibraryStore';
import { subscribeMediaLibrary } from '@/features/media-browser/mediaLibraryStore';
import type { HomeContinueWatchingItem, RecentItemRecord } from '@/features/personalization/personalizationModel';
import type { MovieSummary } from '@/features/movies/movieTypes';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';

const heroArtwork = require('../../../assets/images/novacastnewcard.png');

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
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const navigationGateRef = useRef(createTvNavigationGate());
  const requestedHubRef = useRef(false);
  const { state, ready } = useOnboardingStore();
  const { selectedProvider } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const { isActive: playbackActive, isClosing: playbackClosing, launchPlayback } = useUnifiedPlayer();
  const activeProviderId = selectedProvider?.id ?? 'demo-provider';
  const heroHeight = Math.min(380, Math.max(240, Math.round(width * 0.196)));
  const { summary: librarySummary } = useProviderLibrarySummary(activeProviderId);
  const [liveNow, setLiveNow] = useState<ProviderLiveChannel[]>([]);
  const [liveNowProviderId, setLiveNowProviderId] = useState('');
  const [categoryTypeById, setCategoryTypeById] = useState<Map<string, ProviderCategoryType>>(new Map());
  const [personalization, setPersonalization] = useState<HomePersonalizationSnapshot>(() => ({
    providerId: '',
    continueWatching: [] as HomeContinueWatchingItem[],
    favoriteChannels: [],
    favoriteMovies: [] as MovieSummary[],
    favoriteSeries: [] as SeriesSummary[],
    recentlyWatched: [] as RecentItemRecord[],
  }));
  const firstHomeFocusId =
    personalization.providerId === activeProviderId && personalization.continueWatching.length
      ? `continue-${personalization.continueWatching[0].contentId}`
      : personalization.providerId === activeProviderId && personalization.favoriteChannels.length
        ? `favorite-channel-${personalization.favoriteChannels[0].id}`
        : liveNowProviderId === activeProviderId && liveNow.length
          ? `live-${liveNow[0].id}`
          : personalization.providerId === activeProviderId && personalization.favoriteMovies.length
            ? `favorite-movie-${personalization.favoriteMovies[0].id}`
            : personalization.providerId === activeProviderId && personalization.favoriteSeries.length
              ? `favorite-series-${personalization.favoriteSeries[0].id}`
              : personalization.providerId === activeProviderId && personalization.recentlyWatched.length
                ? `recent-${personalization.recentlyWatched[0].mediaType}-${personalization.recentlyWatched[0].contentId}`
                : null;

  useEffect(() => {
    if (!bundle) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const channels = await loadRandomUsEntertainmentChannels(
        () => bundle.live.getCategories(),
        (categoryId) => bundle.live.getChannels(categoryId),
        (channelId, limit, signal, epgChannelId) => bundle.live.getShortEpg(channelId, limit, signal, epgChannelId),
        3,
      );
      if (!cancelled) {
        setLiveNow(channels);
        setLiveNowProviderId(activeProviderId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProviderId, bundle, librarySummary.lastProviderSyncAt, librarySummary.liveChannelCount]);

  useEffect(() => {
    if (!bundle) {
      return;
    }

    let cancelled = false;
    void bundle.live
      .getCategories()
      .then((categories) => {
        if (cancelled) {
          return;
        }

        const next = new Map<string, ProviderCategoryType>();
        categories.forEach((category) => next.set(category.id, classifyProviderCategoryType(category.name)));
        setCategoryTypeById(next);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeProviderId, bundle, librarySummary.lastProviderSyncAt]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void loadHomePersonalization(activeProviderId, bundle).then((next) => {
      if (!cancelled) {
        setPersonalization(next);
      }
    });
    refresh();
    const unsubscribeMovie = subscribeMovieLibrary(refresh);
    const unsubscribeMedia = subscribeMediaLibrary(refresh);
    const unsubscribePersonalization = subscribePersonalization(refresh);

    return () => {
      cancelled = true;
      unsubscribeMovie();
      unsubscribeMedia();
      unsubscribePersonalization();
    };
  }, [activeProviderId, bundle, librarySummary.lastProviderSyncAt]);

  useEffect(() => {
    if (!ready || requestedHubRef.current) {
      return;
    }

    if (!shouldAutoShowGuide(state, 'hubGuideSeen')) {
      return;
    }

    requestedHubRef.current = true;
    router.push('/content-hub');
  }, [ready, router, state]);

  const navigateTo = (route: '/live' | '/movies' | '/series' | '/guide') => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    router.replace(route);
  };

  const openLiveNowChannel = (channel: ProviderLiveChannel) => {
    rememberLiveTvMemory(activeProviderId, {
      selectedCategoryId: channel.categoryId,
      selectedChannelId: channel.id,
      focusedCategoryId: channel.categoryId,
      focusedChannelId: channel.id,
    });
    navigateTo('/live');
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
        openLiveNowChannel(channel);
      }
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.browseLayer} pointerEvents={playbackActive || playbackClosing ? 'none' : 'auto'}>
        <NovaTvShell activeId="home" title="Home" subtitle="Your entertainment. One place.">
          <ScrollView style={styles.screenScroll} contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBlock}>
          <ReactNativeImageBackground
            source={heroArtwork}
            resizeMode="cover"
            imageStyle={styles.heroArtwork}
            style={[styles.hero, { height: heroHeight }]}
          >
            <View pointerEvents="none" style={styles.heroContent}>
              <NovaLogo
                size="lg"
                subtitle="ENTERTAINMENT STARTS HERE"
                variant="full"
              />
              <Text style={styles.heroEyebrow}>WELCOME BACK</Text>
              <Text style={styles.heroTitle}>Entertainment starts here.</Text>
              <Text numberOfLines={1} style={styles.heroSubtitle}>
                Jump back into live channels, movies, and series without the clutter.
              </Text>
            </View>
          </ReactNativeImageBackground>
        </View>

        <View style={styles.rows}>
          {personalization.providerId === activeProviderId && personalization.continueWatching.length ? (
            <HomeRow title="Continue Watching">
              {personalization.continueWatching.map((item) => (
                <HomeMediaCard
                  key={`${item.mediaType}-${item.contentId}`}
                  title={item.title}
                  subtitle={item.subtitle ?? `${Math.round(item.progressPercent)}% watched`}
                  artworkUrl={item.artworkUrl}
                  progress={item.progressPercent}
                  preferredFocus={firstHomeFocusId === `continue-${item.contentId}`}
                  focused={focusedId === `continue-${item.contentId}`}
                  onFocus={() => setFocusedId(`continue-${item.contentId}`)}
                  onBlur={() => setFocusedId(null)}
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
                  preferredFocus={firstHomeFocusId === `favorite-channel-${item.id}`}
                  focused={focusedId === `favorite-channel-${item.id}`}
                  onFocus={() => setFocusedId(`favorite-channel-${item.id}`)}
                  onBlur={() => setFocusedId(null)}
                  onPress={() => void openRecentItem({ providerId: activeProviderId, mediaType: 'live', contentId: item.id, title: item.title, artworkUrl: item.artworkUrl, lastOpenedAt: Date.now() })}
                />
              ))}
            </HomeRow>
          ) : null}

          {liveNowProviderId === activeProviderId && liveNow.length ? (
            <HomeRow title="Live Now">
              {liveNow.map((item) => (
                <ChannelHeroCard
                  key={item.id}
                  title={item.name}
                  subtitle={item.current || 'Now playing'}
                  logoUrl={item.logoUrl}
                  categoryType={resolveChannelCategoryType(item, categoryTypeById)}
                  isLive
                  preferredFocus={firstHomeFocusId === `live-${item.id}`}
                  focused={focusedId === `live-${item.id}`}
                  onFocus={() => setFocusedId(`live-${item.id}`)}
                  onBlur={() => setFocusedId(null)}
                  onPress={() => openLiveNowChannel(item)}
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
                  preferredFocus={firstHomeFocusId === `favorite-movie-${item.id}`}
                  focused={focusedId === `favorite-movie-${item.id}`}
                  onFocus={() => setFocusedId(`favorite-movie-${item.id}`)}
                  onBlur={() => setFocusedId(null)}
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
                  preferredFocus={firstHomeFocusId === `favorite-series-${item.id}`}
                  focused={focusedId === `favorite-series-${item.id}`}
                  onFocus={() => setFocusedId(`favorite-series-${item.id}`)}
                  onBlur={() => setFocusedId(null)}
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

          {personalization.providerId === activeProviderId && personalization.recentlyWatched.length ? (
            <HomeRow title="Recently Watched">
              {personalization.recentlyWatched.map((item) => (
                <HomeMediaCard
                  key={`${item.mediaType}-${item.contentId}`}
                  title={item.title}
                  subtitle={item.mediaType === 'live' ? 'Live channel' : 'Recently watched'}
                  artworkUrl={item.artworkUrl}
                  icon={item.mediaType === 'live' ? 'television' : 'history'}
                  preferredFocus={firstHomeFocusId === `recent-${item.mediaType}-${item.contentId}`}
                  focused={focusedId === `recent-${item.mediaType}-${item.contentId}`}
                  onFocus={() => setFocusedId(`recent-${item.mediaType}-${item.contentId}`)}
                  onBlur={() => setFocusedId(null)}
                  onPress={() => void openRecentItem(item)}
                />
              ))}
            </HomeRow>
          ) : null}
        </View>
          </ScrollView>
        </NovaTvShell>
      </View>
      {playbackActive || playbackClosing ? <UnifiedPlayerHost /> : null}
    </View>
  );
}

type HomeRowProps = { title: string; children: ReactNode };

function HomeRow({ title, children }: HomeRowProps) {
  return (
    <View style={styles.rowSection}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowCards}>
        {children}
      </ScrollView>
    </View>
  );
}

type HomeMediaCardProps = {
  title: string;
  subtitle: string;
  artworkUrl?: string;
  progress?: number;
  icon?: 'television' | 'history' | 'movie-open-outline';
  preferredFocus?: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
  onRemove?: () => void;
};

function HomeMediaCard({ title, subtitle, artworkUrl, progress, icon, preferredFocus = false, focused, onFocus, onBlur, onPress, onRemove }: HomeMediaCardProps) {
  const [removeFocused, setRemoveFocused] = useState(false);

  return (
    <View style={styles.mediaCardWrap}>
      <Pressable focusable hasTVPreferredFocus={preferredFocus} onFocus={onFocus} onBlur={onBlur} onPress={onPress} style={[styles.mediaCard, focused && styles.focused]}>
        <View style={styles.mediaArtwork}>
          {artworkUrl ? <Image source={{ uri: artworkUrl }} style={styles.mediaArtworkImage} contentFit="cover" /> : null}
          {!artworkUrl ? <MaterialCommunityIcons name={icon ?? 'movie-open-outline'} size={28} color={novaTheme.colors.accentHover} /> : null}
          {typeof progress === 'number' ? (
            <View style={styles.mediaProgressTrack}>
              <View style={[styles.mediaProgressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.mediaTitle}>{displayStreamTitle(title)}</Text>
        <Text numberOfLines={1} style={styles.mediaSubtitle}>{subtitle}</Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          focusable
          onFocus={() => setRemoveFocused(true)}
          onBlur={() => setRemoveFocused(false)}
          onPress={onRemove}
          style={[styles.removeButton, removeFocused && styles.removeButtonFocused]}>
          <MaterialCommunityIcons name="close" size={14} color={novaTheme.colors.textSecondary} />
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: novaTheme.colors.background,
  },
  browseLayer: {
    flex: 1,
  },
  screenScroll: {
    flex: 1,
  },
  screen: {
    paddingBottom: 28,
    gap: 12,
  },
  heroBlock: {
    width: '100%',
  },
  hero: {
    width: '100%',
    borderRadius: novaTheme.radius.xl,
    overflow: 'hidden',
    backgroundColor: '#050816',
  },
  heroArtwork: {
    borderRadius: novaTheme.radius.xl,
  },
  heroContent: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingHorizontal: 28,
    paddingBottom: 15,
  },
  heroEyebrow: {
    marginTop: 7,
    color: '#55A8FF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2.1,
  },
  heroTitle: {
    marginTop: 3,
    color: novaTheme.colors.textPrimary,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  heroSubtitle: {
    marginTop: 3,
    maxWidth: 620,
    color: novaTheme.colors.textSecondary,
    fontSize: 19,
    fontWeight: '600',
  },
  rows: {
    gap: 14,
  },
  rowSection: {
    minHeight: 174,
    gap: 4,
  },
  rowCards: {
    gap: 10,
    paddingVertical: 4,
    paddingRight: 18,
  },
  mediaCard: {
    width: 168,
    minHeight: 148,
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    padding: 7,
  },
  mediaCardWrap: {
    width: 168,
    gap: 5,
  },
  removeButton: {
    minHeight: 28,
    borderRadius: novaTheme.radius.sm,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  removeButtonText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  removeButtonFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  mediaArtwork: {
    height: 96,
    borderRadius: novaTheme.radius.sm,
    backgroundColor: novaTheme.colors.backgroundRaised,
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
    backgroundColor: novaTheme.colors.accentHover,
  },
  mediaTitle: {
    marginTop: 7,
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  mediaSubtitle: {
    marginTop: 3,
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
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
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.sectionTitle,
    fontWeight: '800',
  },
  continueEmpty: {
    flex: 1,
    minHeight: 120,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
  },
  continueEmptyTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  continueEmptyCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  liveEmpty: {
    flex: 1,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  liveEmptyText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: novaTheme.colors.danger,
  },
  liveList: {
    flex: 1,
    gap: 7,
  },
  liveRow: {
    flex: 1,
    minHeight: 0,
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 9,
  },
  liveLogo: {
    width: 42,
    height: 42,
    borderRadius: novaTheme.radius.sm,
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
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  liveProgram: {
    marginTop: 3,
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
  },
  focused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
});
