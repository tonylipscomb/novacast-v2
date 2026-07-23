import type { ElementRef } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, InteractionManager, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { toggleMediaFavorite, toggleMediaWatchlist, useMediaLibraryStore } from '@/features/media-browser/mediaLibraryStore';
import { MediaCategoryRail } from '@/features/media-browser/MediaCategoryRail';
import { buildSeriesMediaDetail, buildSeriesPreviewDetail } from '@/features/media-browser/mediaDetail';
import { displayCategoryName } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { SeriesPosterGrid } from './components/SeriesPosterGrid';
import { launchSeriesEpisodePlayback } from './seriesPlayback';
import {
  SERIES_DETAIL_NOTIFICATION_ID,
  SERIES_LOAD_NOTIFICATION_ID,
  SERIES_NOTIFICATION_DURATION_MS,
  resolveSeriesDetailNotification,
  resolveSeriesNotificationForStatus,
} from './seriesScreenLogic';
import { getSeriesScreenMemory } from './seriesScreenMemory';
import { useSeriesScreenModel } from './useSeriesScreenModel';

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

  requestAnimationFrame(() => {
    focusNativeViewWhenReady(getTarget, onSettled, attemptsLeft - 1);
  });
  return () => {};
}

export function SeriesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const seriesLibrary = useMediaLibraryStore(activeProviderId);
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const discoverStatusMessage = isDiscoverCollectionsPending(catalogSyncPhase)
    ? 'Preparing Discover collectionsâ€¦'
    : null;
  const memory = getSeriesScreenMemory(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.series.key);
  const posterRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const blurTargetRef = useRef<View | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(null);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const seriesRetryAttemptedRef = useRef(false);
  const seriesDetailRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const { isActive: playbackActive, isClosing: playbackClosing, didJustClose, launchPlayback, closePlayback } =
    useUnifiedPlayer();

  const {
    categories,
    selectedCategoryId,
    visibleItems,
    focusedItem,
    selectedItem,
    loading,
    loadStatus,
    loadErrorMessage,
    hasMore,
    selectCategory,
    prefetchCategoryCount,
    focusSeries,
    selectSeries,
    loadMore,
    reload,
    seriesDetail,
    selectedSeasonId,
    selectSeason,
    detailLoading,
    detailError,
    loadSeriesDetail,
    continueWatching,
    hasDataSource,
    bundle,
    sortOption,
    setSort,
    categoryHasRatings,
  } = useSeriesScreenModel({
    initialSelectedCategoryId: memory.selectedCategoryId,
    initialFocusedSeriesId: memory.focusedSeriesId,
    initialSelectedSeriesId: memory.selectedSeriesId,
  });
  const selectedItemRef = useRef(selectedItem);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const posterColumns = getPosterColumns(width);
  const selectedCategoryLabel = displayCategoryName(
    categories.find((category) => category.id === selectedCategoryId)?.name ?? 'Series',
  );
  const isDiscoverCategory = selectedCategoryId === 'smart:discover';

  const focusSelectedPoster = useCallback(() => {
    const selectedId = selectedItem?.id;
    if (!selectedId) {
      return;
    }

    requestAnimationFrame(() => {
      focusNativeViewWhenReady(() => posterRefs.current.get(selectedId), () => {});
    });
  }, [selectedItem?.id]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    focusSelectedPoster();
  }, [focusSelectedPoster]);

  const playEpisodeById = useCallback(
    async (episodeId: string, launchSource: 'play' | 'episode' = 'episode') => {
      if (!bundle || !seriesDetail) {
        return;
      }

      const episode = Object.values(seriesDetail.episodesBySeason)
        .flat()
        .find((item) => item.id === episodeId);
      if (!episode) {
        return;
      }

      setDetailOpen(false);
      await launchSeriesEpisodePlayback({
        bundle,
        providerId: activeProviderId,
        episode,
        seriesTitle: seriesDetail.title,
        artworkUrl: seriesDetail.posterUrl,
        launchSource,
        launchPlayback,
      });
    },
    [activeProviderId, bundle, launchPlayback, seriesDetail],
  );

  const playFirstEpisode = useCallback(
    async (fromBeginning = false) => {
      if (!seriesDetail) {
        return;
      }

      const allEpisodes = Object.values(seriesDetail.episodesBySeason).flat();
      const resumeEpisodeId = !fromBeginning ? continueWatching?.episodeId : undefined;
      const episode =
        (resumeEpisodeId ? allEpisodes.find((item) => item.id === resumeEpisodeId) : undefined) ?? allEpisodes[0];
      if (episode) {
        await playEpisodeById(episode.id, 'play');
      }
    },
    [continueWatching?.episodeId, playEpisodeById, seriesDetail],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) {
        return true;
      }

      if (detailOpen) {
        closeDetail();
        return true;
      }

      if (playbackClosing) {
        return true;
      }

      if (playbackActive) {
        closePlayback();
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

    const cancel = focusNativeViewWhenReady(
      () => (selectedItem?.id ? posterRefs.current.get(selectedItem.id) : null),
      () => finishUnifiedPlaybackClose(),
    );

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      // Ensures browse layout is committed before focus restore retries.
    });

    return () => {
      cancel();
      interactionTask.cancel();
    };
  }, [didJustClose, selectedItem?.id]);

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    seriesRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handleDetailRetry = useCallback(() => {
    const item = selectedItemRef.current;
    if (!item) {
      return;
    }

    seriesDetailRetryAttemptedRef.current = true;
    void loadSeriesDetail(item);
  }, [loadSeriesDetail]);

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      seriesRetryAttemptedRef.current = false;
      selectCategory(categoryId);
    },
    [selectCategory],
  );

  useEffect(() => {
    if (loadStatus === 'ready') {
      seriesRetryAttemptedRef.current = false;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (!detailError) {
      seriesDetailRetryAttemptedRef.current = false;
    }
  }, [detailError]);

  useEffect(() => {
    if (!hasDataSource || categories.length === 0) {
      dismissNotification(SERIES_LOAD_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSeriesNotificationForStatus(loadStatus, seriesRetryAttemptedRef.current, loadErrorMessage);
    if (!spec) {
      dismissNotification(SERIES_LOAD_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: SERIES_LOAD_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleReload,
      duration: SERIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'series',
    });
  }, [categories.length, dismissNotification, handleReload, hasDataSource, loadErrorMessage, loadStatus, showNotification]);

  useEffect(() => {
    if (!detailOpen || !detailError) {
      dismissNotification(SERIES_DETAIL_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSeriesDetailNotification(seriesDetailRetryAttemptedRef.current, detailError);
    showNotification({
      id: SERIES_DETAIL_NOTIFICATION_ID,
      type: 'warning',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleDetailRetry,
      duration: SERIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'series',
    });
  }, [detailError, detailOpen, dismissNotification, handleDetailRetry, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('series');
    };
  }, [clearScope]);

  const gridEmptyNotice =
    !loading && visibleItems.length === 0 && loadStatus === 'error'
      ? 'No series to display right now.'
      : !loading && visibleItems.length === 0 && loadStatus === 'empty'
        ? 'No series in this category.'
        : null;

  if (!hasDataSource || !bundle) {
    return (
      <NovaTvShell
        activeId="series"
        title="Series"
        subtitle="Browse seasons and episodes from your provider."
        preferActiveNavigationFocus={false}
        compactNavigationRail>
        <View style={styles.statePanel}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.stateTitle}>Series unavailable</Text>
          <Text style={styles.stateCopy}>Connect a provider to browse your series library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  if (categories.length === 0 && loadStatus === 'error') {
    return (
      <NovaTvShell
        activeId="series"
        title="Series"
        subtitle="Browse seasons and episodes from your provider."
        preferActiveNavigationFocus={false}
        compactNavigationRail>
        <View style={styles.statePanel}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.stateTitle}>Series unavailable</Text>
          <Text style={styles.stateCopy}>{loadErrorMessage ?? 'Unable to load series categories from your provider.'}</Text>
          <Pressable
            focusable
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Retry Series"
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
      <BlurTargetView ref={blurTargetRef} style={styles.blurTarget}>
        <View
          style={styles.browseLayer}
          pointerEvents={playbackActive || playbackClosing || detailOpen ? 'none' : 'auto'}
          importantForAccessibility={playbackActive || playbackClosing || detailOpen ? 'no-hide-descendants' : 'auto'}>
        <NovaTvShell
          activeId="series"
          title="Series"
          subtitle="Browse seasons and episodes from your provider."
          providerLabel={selectedProviderLabel}
          preferActiveNavigationFocus={!(playbackActive || playbackClosing || detailOpen)}
          compactNavigationRail>
          <View style={styles.layout}>
            <MediaCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={selectedCategoryId}
              discoverStatusMessage={discoverStatusMessage}
              onSelectCategory={handleSelectCategory}
              onPrefetchCategoryCount={prefetchCategoryCount}
            />

            <SeriesPosterGrid
              series={visibleItems}
              selectedCategoryLabel={selectedCategoryLabel}
              selectedCategoryId={selectedCategoryId}
              columns={posterColumns}
              hasMore={hasMore}
              loading={loading}
              emptyNotice={gridEmptyNotice}
              focusedSeriesId={focusedItem?.id ?? null}
              selectedSeriesId={selectedItem?.id ?? null}
              onFocusSeries={focusSeries}
              onSelectSeries={(series) => {
                selectSeries(series);
                setDetailOpen(true);
              }}
              registerPosterRef={(seriesId, instance) => {
                if (instance) {
                  posterRefs.current.set(seriesId, instance);
                } else {
                  posterRefs.current.delete(seriesId);
                }
              }}
              sortOption={sortOption}
              onSortChange={setSort}
              showRatingSort={categoryHasRatings}
              isDiscover={isDiscoverCategory}
              loadMore={loadMore}
            />

          </View>
        </NovaTvShell>
        </View>
      </BlurTargetView>

      <MediaDetailOverlay
        visible={detailOpen && !playbackActive && !playbackClosing && Boolean(selectedItem)}
        blurTarget={blurTargetRef}
        detail={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? buildSeriesMediaDetail(seriesDetail)
            : selectedItem
              ? buildSeriesPreviewDetail(selectedItem)
              : null
        }
        detailError={null}
        detailLoading={detailLoading}
        isFavorite={selectedItem ? seriesLibrary.isFavorite(selectedItem.seriesId) : false}
        isWatchlisted={selectedItem ? seriesLibrary.isWatchlisted(selectedItem.seriesId) : false}
        continueWatchingLabel={continueWatching ? 'Resume' : 'Play'}
        onClose={closeDetail}
        onRetry={selectedItem ? handleDetailRetry : undefined}
        onPlay={seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId && seriesDetail.seasons.length ? () => void playFirstEpisode() : undefined}
        onPlayFromBeginning={seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId ? () => void playFirstEpisode(true) : undefined}
        onFavoritePress={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? () => {
                void toggleMediaFavorite(activeProviderId, seriesDetail.seriesId, 'series', {
                  title: seriesDetail.title,
                  artworkUrl: seriesDetail.posterUrl,
                });
              }
            : undefined
        }
        onWatchlistPress={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? () => {
                void toggleMediaWatchlist(activeProviderId, seriesDetail.seriesId);
              }
            : undefined
        }
        selectedSeasonNumber={Number(selectedSeasonId) || undefined}
        focusedEpisodeId={focusedEpisodeId}
        onSeasonPress={(seasonNumber) => selectSeason(String(seasonNumber))}
        onEpisodeFocus={setFocusedEpisodeId}
        onEpisodePress={(episode) => {
          setFocusedEpisodeId(episode.id);
          void playEpisodeById(episode.id, 'episode');
        }}
      />

      <UnifiedPlayerHost />

      <WalkthroughOverlay
        key={guide.visible ? 'series-guide-open' : 'series-guide-closed'}
        visible={guide.visible}
        title={ONBOARDING_GUIDES.series.title}
        steps={ONBOARDING_GUIDES.series.steps}
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
  layout: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 10,
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  stateCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
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
});
