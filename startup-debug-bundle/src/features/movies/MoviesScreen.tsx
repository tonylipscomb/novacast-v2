import type { ElementRef } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, InteractionManager, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BlurTargetView } from 'expo-blur';

import { getPosterColumns, NovaTvShell } from '@/components/nova';
import { MediaDetailOverlay } from '@/components/media/MediaDetailOverlay';
import { isDiscoverCollectionsPending, useCatalogSyncStatus } from '@/features/hub/useCatalogSyncStatus';
import {
  finishUnifiedPlaybackClose,
  UnifiedPlayerHost,
  useUnifiedPlayer,
} from '@/features/playback/unified';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
} from '@/features/playback/unified/unifiedRemoteDebug';
import { buildMoviePlaybackUrl } from '@/features/providers/providerPlayback';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppNotification } from '@/features/notifications/useAppNotification';

import { MovieCategoryRail } from './components/MovieCategoryRail';
import { MoviePosterGrid } from './components/MoviePosterGrid';
import { MovieToolbar } from './components/MovieToolbar';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import { useMoviesScreenModel } from './useMoviesScreenModel';
import { displayCategoryName } from '@/features/series/metadata/titleNormalization';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { novaTheme } from '@/theme';

import { decideMoviesBackAction } from './moviesPlaybackLogic';
import {
  MOVIES_DETAIL_NOTIFICATION_ID,
  MOVIES_LOAD_NOTIFICATION_ID,
  MOVIES_NOTIFICATION_DURATION_MS,
  resolveMoviesDetailNotification,
  resolveMoviesNotificationForStatus,
} from './moviesScreenLogic';
import { toggleFavorite, toggleWatchlist, useMovieLibraryStore } from './smart/movieLibraryStore';
import { buildMoviePreviewDetail } from '@/features/media-browser/mediaDetail';

const FOCUS_RESTORE_MAX_ATTEMPTS = 3;

function focusNativeViewWhenReady(
  getTarget: () => ElementRef<typeof View> | null | undefined,
  onSettled: () => void,
  attemptsLeft = FOCUS_RESTORE_MAX_ATTEMPTS,
): () => void {
  const target = getTarget();
  if (target) {
    target.focus();
    onSettled();
    return () => {};
  }

  if (attemptsLeft <= 0) {
    onSettled();
    return () => {};
  }

  const frame = requestAnimationFrame(() => {
    focusNativeViewWhenReady(getTarget, onSettled, attemptsLeft - 1);
  });
  return () => cancelAnimationFrame(frame);
}

export function MoviesScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const discoverStatusMessage = isDiscoverCollectionsPending(catalogSyncPhase)
    ? 'Preparing Discover collections…'
    : null;
  const moviesMemory = getMoviesScreenMemory(activeProviderId);
  const library = useMovieLibraryStore(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.movies.key);
  const posterRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const blurTargetRef = useRef<View | null>(null);
  const isRestoringPlaybackFocusRef = useRef(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const moviesRetryAttemptedRef = useRef(false);
  const moviesDetailRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const { isActive: playbackActive, isClosing: playbackClosing, didJustClose, launchPlayback, closePlayback } =
    useUnifiedPlayer();
  const {
    categories,
    selectedCategoryId,
    focusedMovie,
    selectedMovie,
    visibleMovies,
    loading,
    loadStatus,
    loadErrorMessage,
    hasMore,
    selectCategory,
    prefetchCategoryCount,
    focusMovie,
    selectMovie,
    resolvePlaybackMovieId,
    loadMovieDetail,
    movieDetail,
    detailLoading,
    detailError,
    loadMore,
    reload,
    hasDataSource,
    sortOption,
    setSort,
    categoryHasRatings,
  } = useMoviesScreenModel(undefined, {
    initialSelectedCategoryId: moviesMemory.selectedCategoryId,
    initialFocusedMovieId: moviesMemory.focusedMovieId,
    initialSelectedMovieId: moviesMemory.selectedMovieId,
  });
  const selectedMovieRef = useRef(selectedMovie);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  const selectedCategoryLabel = displayCategoryName(
    categories.find((category) => category.id === selectedCategoryId)?.name ?? 'All Movies',
  );
  const posterColumns = getPosterColumns(width);
  const isDiscoverCategory = selectedCategoryId === 'smart:discover';

  const focusSelectedPoster = useCallback(() => {
    const selectedId = selectedMovie?.id;
    if (!selectedId) {
      return;
    }

    requestAnimationFrame(() => {
      focusNativeViewWhenReady(() => posterRefs.current.get(selectedId), () => {});
    });
  }, [selectedMovie?.id]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    focusSelectedPoster();
  }, [focusSelectedPoster]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'BackHandler',
            eventType: 'hardwareBackPress',
            disposition: 'consumed',
            actionTaken: 'ignored-guide-visible',
          });
        }
        return true;
      }

      if (detailOpen) {
        closeDetail();
        return true;
      }

      if (playbackClosing) {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'BackHandler',
            eventType: 'hardwareBackPress',
            disposition: 'consumed',
            actionTaken: 'ignored-playback-closing',
          });
        }
        return true;
      }

      const action = decideMoviesBackAction(playbackActive, isRestoringPlaybackFocusRef.current);

      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'BackHandler',
          eventType: 'hardwareBackPress',
          disposition: action === 'leave-screen' ? 'accepted' : 'consumed',
          actionTaken: `movies-shell-${action}`,
        });
      }

      if (action === 'close-playback') {
        closePlayback();
        return true;
      }

      if (action === 'swallow') {
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace(TV_HOME_ROUTE);
      return true;
    });

    return () => subscription.remove();
  }, [closeDetail, closePlayback, detailOpen, guide.visible, playbackActive, playbackClosing, router]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    isRestoringPlaybackFocusRef.current = true;
    const selectedId = selectedMovie?.id ?? null;

    const cancel = focusNativeViewWhenReady(
      () => (selectedId ? posterRefs.current.get(selectedId) : null),
      () => {
        isRestoringPlaybackFocusRef.current = false;
        finishUnifiedPlaybackClose();
      },
    );

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      // Ensures browse layout is committed before focus restore retries.
    });

    return () => {
      cancel();
      interactionTask.cancel();
    };
  }, [didJustClose, selectedMovie?.id]);

  useEffect(() => {
    rememberMoviesScreenMemory(activeProviderId, {
      selectedCategoryId,
      focusedMovieId: focusedMovie?.id ?? getMoviesScreenMemory(activeProviderId).focusedMovieId,
      selectedMovieId: selectedMovie?.id ?? getMoviesScreenMemory(activeProviderId).selectedMovieId,
    });
  }, [activeProviderId, focusedMovie?.id, selectedCategoryId, selectedMovie?.id]);

  const startPlayback = useCallback(() => {
    if (!bundle || !selectedMovie) {
      return;
    }

    const playbackId = resolvePlaybackMovieId();
    if (!playbackId || playbackId !== selectedMovie.id) {
      return;
    }

    const streamUrl = buildMoviePlaybackUrl(
      bundle,
      selectedMovie.id,
      selectedMovie.containerExtension ?? 'mp4',
    );
    if (!streamUrl) {
      return;
    }

    setDetailOpen(false);
    void launchPlayback(
      {
        id: selectedMovie.id,
        mediaType: 'movie',
        title: selectedMovie.title,
        streamUrl,
        artworkUrl: selectedMovie.posterUrl,
        isLive: false,
        providerId: activeProviderId,
      },
      {
        launchSource: 'play',
        contentFit: 'contain',
      },
    );
  }, [activeProviderId, bundle, launchPlayback, resolvePlaybackMovieId, selectedMovie]);

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    moviesRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handleDetailRetry = useCallback(() => {
    const movie = selectedMovieRef.current;
    if (!movie) {
      return;
    }

    moviesDetailRetryAttemptedRef.current = true;
    void loadMovieDetail(movie);
  }, [loadMovieDetail]);

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      moviesRetryAttemptedRef.current = false;
      selectCategory(categoryId);
    },
    [selectCategory],
  );

  useEffect(() => {
    if (loadStatus === 'ready') {
      moviesRetryAttemptedRef.current = false;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (!detailError) {
      moviesDetailRetryAttemptedRef.current = false;
    }
  }, [detailError]);

  useEffect(() => {
    if (!hasDataSource || categories.length === 0) {
      dismissNotification(MOVIES_LOAD_NOTIFICATION_ID);
      return;
    }

    const spec = resolveMoviesNotificationForStatus(loadStatus, moviesRetryAttemptedRef.current, loadErrorMessage);
    if (!spec) {
      dismissNotification(MOVIES_LOAD_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: MOVIES_LOAD_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleReload,
      duration: MOVIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'movies',
    });
  }, [categories.length, dismissNotification, handleReload, hasDataSource, loadErrorMessage, loadStatus, showNotification]);

  useEffect(() => {
    if (!detailOpen || !detailError) {
      dismissNotification(MOVIES_DETAIL_NOTIFICATION_ID);
      return;
    }

    const spec = resolveMoviesDetailNotification(moviesDetailRetryAttemptedRef.current, detailError);
    showNotification({
      id: MOVIES_DETAIL_NOTIFICATION_ID,
      type: 'warning',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleDetailRetry,
      duration: MOVIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'movies',
    });
  }, [detailError, detailOpen, dismissNotification, handleDetailRetry, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('movies');
    };
  }, [clearScope]);

  const gridEmptyNotice =
    !loading && visibleMovies.length === 0 && loadStatus === 'error'
      ? 'No movies to display right now.'
      : !loading && visibleMovies.length === 0 && loadStatus === 'empty'
        ? 'No movies in this category.'
        : null;

  if (!hasDataSource) {
    return (
      <NovaTvShell activeId="movies" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.emptyTitle}>Movies unavailable</Text>
          <Text style={styles.emptyCopy}>Connect a provider to browse your movie library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  if (categories.length === 0 && loadStatus === 'error') {
    return (
      <NovaTvShell activeId="movies" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.emptyTitle}>Movies unavailable</Text>
          <Text style={styles.emptyCopy}>{loadErrorMessage ?? 'Unable to load movie categories from your provider.'}</Text>
          <Pressable
            focusable
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Retry Movies"
            onPress={handleReload}
            style={styles.retryButton}>
            <MaterialCommunityIcons name="refresh" size={18} color={novaTheme.colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </NovaTvShell>
    );
  }

  return (
    <View style={styles.root}>
      {!playbackActive ? (
      <BlurTargetView ref={blurTargetRef} style={styles.blurTarget}>
        <View
          style={styles.browseLayer}
          pointerEvents={playbackClosing || detailOpen ? 'none' : 'auto'}
          importantForAccessibility={playbackClosing || detailOpen ? 'no-hide-descendants' : 'auto'}>
      <NovaTvShell
        activeId="movies"
        providerLabel={selectedProviderLabel}
         preferActiveNavigationFocus={!playbackActive && !detailOpen}
        compactNavigationRail>
        <View style={styles.screen}>
          <View style={styles.topBar}>
            <View style={styles.headingBlock}>
              <Text style={styles.heading}>Movies</Text>
              <Text style={styles.copy}>Thousands of movies. Any genre. Anytime.</Text>
            </View>
            <MovieToolbar
              onSearchPress={() => undefined}
              onFilterPress={() => undefined}
            />
          </View>

          <View style={styles.contentRow}>
            <MovieCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={moviesMemory.selectedCategoryId}
              discoverStatusMessage={discoverStatusMessage}
              onSelectCategory={handleSelectCategory}
              onPrefetchCategoryCount={prefetchCategoryCount}
            />

            <View style={styles.middleColumn}>
              <MoviePosterGrid
                movies={visibleMovies}
                selectedCategoryLabel={selectedCategoryLabel}
                selectedCategoryId={selectedCategoryId}
                columns={posterColumns}
                hasMore={hasMore}
                loading={loading}
                emptyNotice={gridEmptyNotice}
                focusedMovieId={focusedMovie?.id ?? null}
                selectedMovieId={selectedMovie?.id ?? null}
                onFocusMovie={(movie) => {
                  focusMovie(movie);
                }}
                onSelectMovie={(movie) => {
                  selectMovie(movie);
                  void loadMovieDetail(movie);
                  setDetailOpen(true);
                }}
                registerPosterRef={(movieId, instance) => {
                  if (instance) {
                    posterRefs.current.set(movieId, instance);
                  } else {
                    posterRefs.current.delete(movieId);
                  }
                }}
                sortOption={sortOption}
                onSortChange={setSort}
                showRatingSort={categoryHasRatings}
                isDiscover={isDiscoverCategory}
                loadMore={() => void loadMore()}
              />
            </View>

          </View>
        </View>
      </NovaTvShell>
        </View>
      </BlurTargetView>
      ) : null}

      <MediaDetailOverlay
        visible={detailOpen && !playbackActive && !playbackClosing && Boolean(selectedMovie)}
        blurTarget={blurTargetRef}
        detail={
          selectedMovie
            ? movieDetail?.id === selectedMovie.id
              ? movieDetail
              : buildMoviePreviewDetail(selectedMovie)
            : null
        }
        detailError={null}
        detailLoading={detailLoading}
        isFavorite={selectedMovie ? library.isFavorite(selectedMovie.id) : false}
        isWatchlisted={selectedMovie ? library.isWatchlisted(selectedMovie.id) : false}
        onClose={closeDetail}
        onPlay={selectedMovie ? startPlayback : undefined}
        onRetry={selectedMovie ? handleDetailRetry : undefined}
        onTrailerPress={
          movieDetail?.trailerUrl
            ? () => {
                void Linking.openURL(movieDetail.trailerUrl!);
              }
            : undefined
        }
        onFavoritePress={
          selectedMovie
            ? () => {
                void toggleFavorite(activeProviderId, selectedMovie.id);
              }
            : undefined
        }
        onWatchlistPress={
          selectedMovie
            ? () => {
                void toggleWatchlist(activeProviderId, selectedMovie.id);
              }
            : undefined
        }
      />

      {playbackActive || playbackClosing ? (
        <View style={[styles.playbackHost, { width, height }]} pointerEvents="auto">
          <UnifiedPlayerHost />
        </View>
      ) : null}

      {playbackClosing ? <View style={[styles.playbackClosingCover, { width, height }]} /> : null}

      <WalkthroughOverlay
        key={guide.visible ? 'movies-guide-open' : 'movies-guide-closed'}
        visible={guide.visible}
        title={ONBOARDING_GUIDES.movies.title}
        steps={ONBOARDING_GUIDES.movies.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
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
  blurTarget: {
    flex: 1,
  },
  screen: {
    flex: 1,
    minHeight: 0,
    paddingTop: 4,
    gap: 12,
  },
  topBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headingBlock: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    color: novaTheme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  copy: {
    marginTop: 2,
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
  },
  contentRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'stretch',
  },
  middleColumn: {
    flex: 1,
    minWidth: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
  },
  emptyCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 16,
  },
  retryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  playbackHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    elevation: 30,
  },
  playbackClosingCover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    zIndex: 101,
  },
});
