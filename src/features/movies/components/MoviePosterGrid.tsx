import type { ElementRef } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAppTheme, type NovaTheme } from '@/theme';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { ContentSortControl, type ContentSortControlHandle } from '@/features/media-browser/ContentSortControl';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';

import type { MovieSummary } from '../movieTypes';
import { MoviePosterCard } from './MoviePosterCard';

type MoviePosterGridProps = {
  movies: MovieSummary[];
  selectedCategoryLabel: string;
  selectedCategoryId: string;
  columns: number;
  hasMore: boolean;
  loading: boolean;
  categoryLoading?: boolean;
  focusedMovieId: string | null;
  selectedMovieId: string | null;
  postersFocusable?: boolean;
  onFocusMovie: (movie: MovieSummary) => void;
  onSelectMovie: (movie: MovieSummary) => void;
  registerPosterRef?: (movieId: string, instance: ElementRef<typeof View> | null) => void;
  loadMore: () => void;
  sortOption: ContentSortOption;
  onSortChange: (value: ContentSortOption) => void;
  showRatingSort?: boolean;
  isDiscover?: boolean;
  emptyNotice?: string | null;
  sortFocusLeftHandle?: number;
  onSortFocusHandleReady?: (handle: number | undefined) => void;
};

export function MoviePosterGrid({
  movies,
  selectedCategoryLabel,
  selectedCategoryId,
  columns,
  hasMore,
  loading,
  categoryLoading = false,
  focusedMovieId,
  selectedMovieId,
  postersFocusable = true,
  onFocusMovie,
  onSelectMovie,
  registerPosterRef,
  loadMore,
  sortOption,
  onSortChange,
  showRatingSort = true,
  isDiscover = false,
  emptyNotice = null,
  sortFocusLeftHandle,
  onSortFocusHandleReady,
}: MoviePosterGridProps) {
  const gridHeaderSuffix = loading ? 'Loading' : hasMore ? 'More available' : `${movies.length} items`;
  const loadMoreThreshold = Math.max(columns * 2, movies.length - columns * 2);
  const firstMovieId = movies[0]?.id;
  const focusSeedRef = useRef<string | null>(null);
  const focusClaimedRef = useRef(false);
  const firstCardRef = useRef<ElementRef<typeof View> | null>(null);
  const sortControlRef = useRef<ContentSortControlHandle | null>(null);
  const sortMountedRef = useRef(false);

  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    focusClaimedRef.current = false;
    focusSeedRef.current = selectedMovieId ?? firstMovieId ?? null;
  }, [firstMovieId, selectedCategoryId, selectedMovieId]);

  useEffect(() => {
    if (!sortMountedRef.current) {
      sortMountedRef.current = true;
      return;
    }

    requestAnimationFrame(() => sortControlRef.current?.focus());
  }, [sortOption]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      onSortFocusHandleReady?.(sortControlRef.current?.getFocusHandle());
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, onSortFocusHandleReady, selectedCategoryId, sortOption]);

  const loadingLabel = `Loading ${selectedCategoryLabel}…`;
  const showInitialLoader = categoryLoading && movies.length === 0 && !emptyNotice;
  const showLoadingOverlay = categoryLoading && movies.length > 0;
  const showFooterLoader = loading && !categoryLoading && movies.length > 0;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.title}>
          {selectedCategoryLabel}
        </Text>
        <View style={styles.sortGroup}>
          <ContentSortControl
            ref={sortControlRef}
            value={sortOption}
            onChange={onSortChange}
            showRating={showRatingSort}
            nextFocusLeft={sortFocusLeftHandle}
          />
          <Text style={styles.subtitle}>{gridHeaderSuffix}</Text>
        </View>
      </View>

      {showInitialLoader ? (
        <View style={styles.loadingStage}>
          <NovaSpaceLoader label={loadingLabel} />
        </View>
      ) : emptyNotice ? (
        <View style={styles.emptyNotice}>
          <MaterialCommunityIcons
            name={emptyNotice.includes('display') ? 'cloud-off-outline' : 'movie-off-outline'}
            size={22}
            color={theme.colors.textMuted}
          />
          <Text style={styles.emptyNoticeText}>{emptyNotice}</Text>
        </View>
      ) : (
      <View style={styles.listStage}>
      <FlatList
        data={movies}
        key={columns}
        numColumns={columns}
        keyExtractor={(item) => item.id}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        columnWrapperStyle={columns > 1 ? styles.row : undefined}
        removeClippedSubviews={false}
        windowSize={5}
        initialNumToRender={columns * 3}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (hasMore && !loading) {
            loadMore();
          }
        }}
        ListFooterComponent={
          showFooterLoader ? (
            <View style={styles.footerLoader}>
              <NovaSpaceLoader label="Loading more…" variant="inline" />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <MoviePosterCard
            movie={item}
            isDiscover={isDiscover}
            focusable={postersFocusable}
            hasPreferredFocus={
              !focusClaimedRef.current &&
              !loading &&
              item.id === focusSeedRef.current
            }
            onFocus={(movie) => {
              focusClaimedRef.current = true;
              onFocusMovie(movie);
              if (hasMore && !loading && index >= loadMoreThreshold) {
                loadMore();
              }
            }}
            onPress={(movie) => {
              onSelectMovie(movie);
            }}
            registerRef={(instance) => {
              if (item.id === firstMovieId) firstCardRef.current = instance;
              registerPosterRef?.(item.id, instance);
            }}
          />
        )}
      />
      {showLoadingOverlay ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <NovaSpaceLoader label={loadingLabel} />
        </View>
      ) : null}
      </View>
      )}
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
  panel: {
    flex: 1,
    minWidth: 0,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  sortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  list: {
    paddingTop: 2,
    paddingBottom: 20,
    paddingHorizontal: 2,
  },
  row: {
    gap: 6,
    marginBottom: 6,
  },
  emptyNotice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  emptyNoticeText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
  },
  listStage: {
    flex: 1,
    minHeight: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      theme.colors.background === '#F3EEE4' ? 'rgba(26,21,16,0.45)' : 'rgba(0,0,0,0.35)',
  },
  footerLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
});
}

