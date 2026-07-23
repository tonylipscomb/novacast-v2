import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, InteractionManager, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BlurTargetView } from 'expo-blur';

import { getSeriesPosterColumns, NovaTvShell } from '@/components/nova';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { MediaDetailOverlay } from '@/components/media/MediaDetailOverlay';
import { isDiscoverCollectionsPending, useCatalogSyncStatus } from '@/features/hub/useCatalogSyncStatus';
import {
  finishUnifiedPlaybackClose,
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
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { SearchOverlay } from '@/features/search/SearchOverlay';
import { searchSeries } from '@/features/search/repositories/seriesSearchRepository';
import type { SearchResult } from '@/features/search/searchTypes';
import { MovieToolbar } from '@/features/movies/components/MovieToolbar';
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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createSeriesStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const seriesLibrary = useMediaLibraryStore(activeProviderId);
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const discoverStatusMessage = isDiscoverCollectionsPending(catalogSyncPhase)
    ? 'Preparing Features collections…'
    : null;
  const memory = getSeriesScreenMemory(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.series.key);
  const posterRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const categoryRowRefs = useRef<Map<string, ElementRef<typeof Pressable>>>(new Map());
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [sortFocusRightHandle, setSortFocusRightHandle] = useState<number | undefined>();
  const blurTargetRef = useRef<View | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
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
    categoryLoading,
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
  const playbackUiActive = playbackActive || playbackClosing;
  const detailOverlayVisible = detailOpen && !playbackUiActive && Boolean(selectedItem);
  const searchBlocksBrowse = searchOverlayReady;
  const selectedItemRef = useRef(selectedItem);

  useEffect(() => {
    if (!searchOpen || playbackUiActive) {
      setSearchOverlayReady(false);
    }
  }, [playbackUiActive, searchOpen]);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const posterColumns = getSeriesPosterColumns(width);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const selectedCategoryLabel = selectedCategory
    ? displayProviderCategoryName({
        name: selectedCategory.name,
        rawName: selectedCategory.rawName,
        countryCode: selectedCategory.countryCode,
        contentType: 'series',
        kind: selectedCategory.kind,
      })
    : 'Series';

  const syncCategoryFocusLeftHandle = useCallback(() => {
    const target = categoryRowRefs.current.get(selectedCategoryId);
    setCategoryFocusLeftHandle(target ? findNodeHandle(target) ?? undefined : undefined);
  }, [selectedCategoryId]);

  useEffect(() => {
    syncCategoryFocusLeftHandle();
  }, [categories.length, selectedCategoryId, syncCategoryFocusLeftHandle]);

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

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchOverlayReady(false);
  }, []);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.type !== 'series') {
        return;
      }

      setSearchOpen(false);
      setSearchOverlayReady(false);
      const series = {
        id: result.id,
        seriesId: result.seriesId ?? result.id,
        categoryId: result.categoryId ?? selectedCategoryId,
        title: result.title,
        year: result.year,
        rating: result.rating,
        genres: result.genres ?? ['Series'],
        posterUrl: result.posterUrl,
        posterStyleKey: 'ember' as const,
      };
      selectSeries(series);
      focusSeries(series);
      void loadSeriesDetail(series);
      setDetailOpen(true);
    },
    [focusSeries, loadSeriesDetail, selectSeries, selectedCategoryId],
  );

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

      if (searchOpen) {
        closeSearch();
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
  }, [closeDetail, closePlayback, closeSearch, detailOpen, guide.visible, playbackActive, playbackClosing, router, searchOpen]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    finishUnifiedPlaybackClose();

    const selectedId = selectedItem?.id ?? null;
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      focusNativeViewWhenReady(
        () => (selectedId ? posterRefs.current.get(selectedId) : null),
        () => undefined,
      );
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [didJustClose, selectedItem?.id]);

  const executeSeriesSearch = useCallback(
    (request: Parameters<typeof searchSeries>[2]) => searchSeries(activeProviderId, bundle?.seriesDataSource, request),
    [activeProviderId, bundle?.seriesDataSource],
  );

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
      <NovaTvShell activeId="series" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Series unavailable</Text>
          <Text style={styles.emptyCopy}>Connect a provider to browse your series library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  if (categories.length === 0 && loadStatus === 'error') {
    return (
      <NovaTvShell activeId="series" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Series unavailable</Text>
          <Text style={styles.emptyCopy}>{loadErrorMessage ?? 'Unable to load series categories from your provider.'}</Text>
          <Pressable
            focusable
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Retry Series"
            onPress={handleReload}
            style={styles.retryButton}>
            <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </NovaTvShell>
    );
  }

  return (
    <View style={styles.root}>
      {!playbackUiActive ? (
        <>
      <BlurTargetView
        ref={blurTargetRef}
        style={styles.blurTarget}
        pointerEvents={detailOverlayVisible || searchBlocksBrowse ? 'none' : 'auto'}>
        <View
          style={styles.browseLayer}
          pointerEvents={detailOpen || searchBlocksBrowse ? 'none' : 'auto'}
          importantForAccessibility={detailOpen || searchBlocksBrowse ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={detailOpen || searchBlocksBrowse}>
        <NovaTvShell
          activeId="series"
          providerLabel={selectedProviderLabel}
          preferActiveNavigationFocus={!playbackUiActive && !detailOverlayVisible && !searchBlocksBrowse}
          compactNavigationRail>
          <View style={styles.screen}>
            <View style={styles.topBar}>
              <View style={styles.headingBlock}>
                <Text style={styles.heading}>Series</Text>
                <Text style={styles.copy}>Browse seasons and episodes from your provider.</Text>
              </View>
              <MovieToolbar
                onSearchPress={() => {
                  if (searchOpen) {
                    closeSearch();
                    return;
                  }

                  setSearchOpen(true);
                }}
              />
            </View>
            <View style={styles.contentRow}>
            <MediaCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={selectedCategoryId}
              contentType="series"
              discoverStatusMessage={discoverStatusMessage}
              onSelectCategory={handleSelectCategory}
              onPrefetchCategoryCount={prefetchCategoryCount}
              registerItemRef={(categoryId, instance) => {
                if (instance) {
                  categoryRowRefs.current.set(categoryId, instance);
                } else {
                  categoryRowRefs.current.delete(categoryId);
                }
                if (categoryId === selectedCategoryId) {
                  syncCategoryFocusLeftHandle();
                }
              }}
              nextFocusRightHandle={sortFocusRightHandle}
            />

            <View style={styles.middleColumn}>
            {categories.length === 0 && loadStatus !== 'error' ? (
              <View style={styles.initialLoadingPanel}>
                <NovaSpaceLoader label="Loading series categories…" />
              </View>
            ) : (
            <SeriesPosterGrid
              series={visibleItems}
              selectedCategoryLabel={selectedCategoryLabel}
              selectedCategoryId={selectedCategoryId}
              columns={posterColumns}
              hasMore={hasMore}
              loading={loading}
              categoryLoading={categoryLoading}
              emptyNotice={gridEmptyNotice}
              focusedSeriesId={focusedItem?.id ?? null}
              selectedSeriesId={selectedItem?.id ?? null}
              postersFocusable={!detailOpen && !playbackUiActive && !searchBlocksBrowse}
              onFocusSeries={focusSeries}
              onSelectSeries={(series) => {
                if (detailOpen && selectedItem?.id === series.id) {
                  return;
                }

                selectSeries(series);
                void loadSeriesDetail(series);
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
              sortFocusLeftHandle={categoryFocusLeftHandle}
              onSortFocusHandleReady={setSortFocusRightHandle}
              loadMore={loadMore}
            />
            )}
            </View>

            </View>
          </View>
        </NovaTvShell>
        </View>
      </BlurTargetView>

      <MediaDetailOverlay
        visible={detailOverlayVisible}
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
        </>
      ) : null}

      <SearchOverlay
        visible={searchOpen && !playbackUiActive}
        scope="series"
        providerId={activeProviderId}
        title="Search Series"
        blurTarget={blurTargetRef}
        executeSearch={executeSeriesSearch}
        onReady={() => setSearchOverlayReady(true)}
        onClose={closeSearch}
        onSelectResult={handleSearchSelect}
      />

      <WalkthroughOverlay
        key={guide.visible ? 'series-guide-open' : 'series-guide-closed'}
        visible={guide.visible && !playbackUiActive}
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

function createSeriesStyles(theme: NovaTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    browseLayer: {
      flex: 1,
    },
    blurTarget: {
      flex: 1,
      zIndex: 1,
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
      color: theme.colors.textPrimary,
      fontSize: 32,
      fontWeight: '900',
      letterSpacing: -0.5,
    },
    copy: {
      marginTop: 2,
      color: theme.colors.textSecondary,
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
    initialLoadingPanel: {
      flex: 1,
      minHeight: 280,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      color: theme.colors.textPrimary,
      fontSize: 28,
      fontWeight: '900',
    },
    emptyCopy: {
      color: theme.colors.textSecondary,
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
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 16,
    },
    retryText: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
  });
}
