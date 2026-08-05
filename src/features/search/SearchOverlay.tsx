import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import { BackHandler, findNodeHandle, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus, createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { novaTheme } from '@/theme';

const focusText = createNovaTvFocusTextStyles(novaTheme);

import { SearchEmptyState } from './SearchEmptyState';
import { SearchInput } from './SearchInput';
import { SearchLoadingState } from './SearchLoadingState';
import { SearchPosterGrid } from './SearchPosterGrid';
import { SearchResults } from './SearchResults';
import { TvSearchKeyboard } from './TvSearchKeyboard';
import { logSearchEvent } from './searchDiagnostics';
import {
  cancelMoviesSearchResultFocus,
  getMoviesSearchResultTargetRef,
  logMoviesSearchFocus,
  noteMoviesSearchResultsReady,
} from './moviesSearchFocus';
import {
  beginMoviesSearchInputDownHandoff,
  bumpMoviesSearchInputQueryRevision,
  cancelMoviesSearchInputHandoff,
  getFirstMoviesSearchResultNativeTag,
  getMoviesSearchInputQueryRevision,
  hasPendingMoviesSearchInputHandoff,
  noteMoviesSearchInputReclaimed,
  setMoviesSearchInputTargetsListener,
  setMoviesSearchNativeTagResolver,
} from './moviesSearchInputHandoff';
import { getActiveMoviesSearchRequestId } from './moviesSearchPerfDiagnostics';
import { shouldReclaimSearchFromClose, shouldReturnFocusToSearchShellAfterIme, shouldAutoFocusSearchFocusGuide, resolveCloseNextFocusHandles, shouldWireSearchNextFocusUpToClose } from './searchOverlayFocusPolicy';
import { scopedSearchEmptyHint } from './searchScopes';
import { isSearchableQuery } from './searchQuery';
import type { SearchResult, SearchScope } from './searchTypes';
import { useSearchController } from './useSearchController';

type SearchOverlayProps = {
  visible: boolean;
  /**
   * Stage 3G.3: keep controller/results mounted while Detail is open so Search
   * can restore the same query/results after detail closes.
   */
  retainMounted?: boolean;
  /** After returning from Detail, focus this movie result once. */
  restoreFocusMovieId?: string | null;
  onRestoreFocusHandled?: () => void;
  scope: Exclude<SearchScope, 'all'>;
  providerId: string;
  title: string;
  placeholder?: string;
  executeSearch: Parameters<typeof useSearchController<SearchResult>>[0]['executeSearch'];
  onClose: () => void;
  /** Fires once the native Modal is on screen — browse layers can defer blocking until then. */
  onReady?: () => void;
  onSelectResult: (result: SearchResult) => void;
  onQueryCommitted?: (query: string) => void;
  pageSize?: number;
};

/** Avoid mounting search hooks while the overlay is closed — prevents idle reset loops. */
export function SearchOverlay(props: SearchOverlayProps) {
  if (!props.visible && !props.retainMounted) {
    return null;
  }

  return <SearchOverlayContent {...props} />;
}

function SearchOverlayContent({
  visible,
  retainMounted = false,
  restoreFocusMovieId = null,
  onRestoreFocusHandled,
  scope,
  providerId,
  title,
  placeholder,
  executeSearch,
  onClose,
  onReady,
  onSelectResult,
  onQueryCommitted,
  pageSize = 50,
}: SearchOverlayProps) {
  const inputRef = useRef<TextInput>(null);
  const searchShellRef = useRef<View | null>(null);
  const closeButtonRef = useRef<View | null>(null);
  const focusConfirmedRef = useRef(false);
  const initialFocusRequestedRef = useRef(false);
  const closeOwnsFocusRef = useRef(false);
  const [preferSearchFocus, setPreferSearchFocus] = useState(true);
  const [focusedResultKey, setFocusedResultKey] = useState<string | null>(null);
  const [focusedSearchMovieId, setFocusedSearchMovieId] = useState<string | null>(null);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [closeFocused, setCloseFocused] = useState(false);
  const [searchFieldHandle, setSearchFieldHandle] = useState<number | undefined>(undefined);
  const [closeHandle, setCloseHandle] = useState<number | undefined>(undefined);
  const [firstResultNativeTag, setFirstResultNativeTag] = useState<number | undefined>(undefined);
  const [handoffActive, setHandoffActive] = useState(false);
  // Fire TV / Android TV: native soft keyboard. Close never reclaims Search focus.
  const useNativeTvKeyboard = Platform.isTV;
  const useOnScreenKeyboard = Platform.OS === 'android' && !useNativeTvKeyboard;
  const searchInputFocusedRef = useRef(false);
  const preferSearchFocusRef = useRef(true);
  const imeVisibleRef = useRef(false);
  const handoffGuardRef = useRef(false);

  const confirmOverlayFocus = useCallback(
    (source: string) => {
      if (focusConfirmedRef.current) {
        return;
      }

      focusConfirmedRef.current = true;
      logSearchEvent('search_overlay_focus_confirmed', { scope, source });
    },
    [scope],
  );

  const focusSearchField = useCallback(() => {
    if (closeOwnsFocusRef.current) {
      return;
    }
    if (initialFocusRequestedRef.current && focusConfirmedRef.current) {
      return;
    }

    initialFocusRequestedRef.current = true;
    requestTvFocus({
      screen: 'search-overlay',
      source: 'SearchOverlay',
      region: 'search-shell',
      reason: 'overlay-open',
      isActive: () => visible && !closeOwnsFocusRef.current,
      getTarget: () => searchShellRef.current,
    });
  }, [visible]);

  const handleSearchShellFocus = useCallback(() => {
    // Preferred focus only for open / empty / Up-return — never reclaim mid-handoff.
    if (handoffGuardRef.current || hasPendingMoviesSearchInputHandoff()) {
      setPreferSearchFocus(false);
      preferSearchFocusRef.current = false;
      return;
    }
    setSearchInputFocused(true);
    searchInputFocusedRef.current = true;
    setHandoffActive(false);
    if (focusedSearchMovieId) {
      // Explicit Up-from-results return — preferred focus allowed again for the field.
      setPreferSearchFocus(true);
      preferSearchFocusRef.current = true;
      const requestId = getActiveMoviesSearchRequestId();
      logMoviesSearchFocus({
        requestId,
        query: '',
        resultCount: 0,
        action: 'up-to-input',
        targetMovieId: focusedSearchMovieId,
        targetMounted: false,
        focusRequested: false,
        actuallyFocusedMovieId: null,
        searchInputFocused: true,
        retryCount: 0,
      });
      noteMoviesSearchInputReclaimed({
        requestId,
        queryRevision: getMoviesSearchInputQueryRevision(),
        inputPreferred: true,
      });
    } else {
      // Drop preferred focus after first open landing — leaving it true fights results.
      setPreferSearchFocus(false);
      preferSearchFocusRef.current = false;
    }
    setFocusedSearchMovieId(null);
    confirmOverlayFocus('search-input');
  }, [confirmOverlayFocus, focusedSearchMovieId]);

  const handleSearchShellBlur = useCallback(() => {
    setSearchInputFocused(false);
    searchInputFocusedRef.current = false;
  }, []);

  const handleCloseFocus = useCallback(() => {
    // Never reclaim Search when Close (or a result) receives focus.
    if (shouldReclaimSearchFromClose(focusConfirmedRef.current)) {
      return;
    }

    closeOwnsFocusRef.current = true;
    setCloseFocused(true);
    setPreferSearchFocus(false);
    confirmOverlayFocus('close');
  }, [confirmOverlayFocus]);

  const handleKeyboardActivate = useCallback(() => {
    imeVisibleRef.current = true;
    logSearchEvent('search_input_ime_armed', { scope });
  }, [scope]);

  const handleImeReturnToShell = useCallback(() => {
    if (closeOwnsFocusRef.current || !shouldReturnFocusToSearchShellAfterIme({ closeFocused })) {
      return;
    }

    requestTvFocus({
      screen: 'search-overlay',
      source: 'SearchOverlay',
      region: 'search-shell',
      reason: 'ime-submit-return',
      isActive: () => visible && !closeOwnsFocusRef.current,
      getTarget: () => searchShellRef.current,
    });
  }, [closeFocused, visible]);

  const controller = useSearchController<SearchResult>({
    scope,
    providerId,
    // Keep searching while retainMounted even if the modal is temporarily hidden for Detail.
    enabled: visible || retainMounted,
    pageSize,
    executeSearch,
    onQueryCommitted,
  });

  useEffect(() => {
    if (scope !== 'movie') {
      setMoviesSearchInputTargetsListener(null);
      setMoviesSearchNativeTagResolver(null);
      setFirstResultNativeTag(undefined);
      return;
    }
    setMoviesSearchNativeTagResolver((target) => {
      if (!target) {
        return null;
      }
      return findNodeHandle(target as never) ?? null;
    });
    const refresh = () => {
      const tag = getFirstMoviesSearchResultNativeTag();
      setFirstResultNativeTag((prev) => (prev === (tag ?? undefined) ? prev : tag ?? undefined));
    };
    setMoviesSearchInputTargetsListener(refresh);
    refresh();
    return () => {
      setMoviesSearchInputTargetsListener(null);
      setMoviesSearchNativeTagResolver(null);
    };
  }, [scope, controller.results.length, controller.status]);

  const usePosterGrid = scope === 'movie' || scope === 'series';

  useEffect(() => {
    logSearchEvent('search_overlay_open', {
      scope,
      providerId,
      onScreenKeyboard: useOnScreenKeyboard,
      nativeTvKeyboard: useNativeTvKeyboard,
      solidOverlay: true,
    });
    return () => {
      logSearchEvent('search_overlay_close', { scope, providerId });
    };
  }, [providerId, scope, useNativeTvKeyboard, useOnScreenKeyboard]);

  useEffect(() => {
    // Stage 3G.3: when retainMounted hides the modal, do NOT wipe query/results/focus memory.
    if (!visible && !retainMounted) {
      focusConfirmedRef.current = false;
      initialFocusRequestedRef.current = false;
      closeOwnsFocusRef.current = false;
      setPreferSearchFocus(true);
      preferSearchFocusRef.current = true;
      setFocusedResultKey(null);
      setFocusedSearchMovieId(null);
      setSearchInputFocused(false);
      searchInputFocusedRef.current = false;
      setCloseFocused(false);
      setFirstResultNativeTag(undefined);
      setHandoffActive(false);
      handoffGuardRef.current = false;
      imeVisibleRef.current = false;
      cancelMoviesSearchResultFocus('search-closed', {
        searchInputFocused: false,
        resultCount: 0,
      });
      cancelMoviesSearchInputHandoff('search-closed', {
        searchInputFocused: false,
        resultCount: 0,
      });
    }
  }, [retainMounted, visible]);

  // Stage 3G.3: restore focus to the selected search result after Detail closes.
  useEffect(() => {
    if (!visible || !restoreFocusMovieId || scope !== 'movie') {
      return;
    }
    setPreferSearchFocus(false);
    preferSearchFocusRef.current = false;
    setFocusedSearchMovieId(restoreFocusMovieId);
    setFocusedResultKey(`movie:${restoreFocusMovieId}`);
    const movieId = restoreFocusMovieId;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) {
        return;
      }
      requestTvFocus({
        screen: 'search-overlay',
        source: 'SearchOverlay',
        region: 'search-results',
        itemId: movieId,
        reason: 'restore-after-detail-close',
        isActive: () => visible,
        getTarget: () => getMoviesSearchResultTargetRef(movieId)?.current ?? null,
      });
      onRestoreFocusHandled?.();
    }, 48);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onRestoreFocusHandled, restoreFocusMovieId, scope, visible]);

  useEffect(() => {
    return () => {
      cancelMoviesSearchResultFocus('overlay-unmount');
      cancelMoviesSearchInputHandoff('overlay-unmount');
      setMoviesSearchInputTargetsListener(null);
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      setSearchFieldHandle(undefined);
      setCloseHandle(undefined);
      return;
    }

    const search = searchShellRef.current ? findNodeHandle(searchShellRef.current) ?? undefined : undefined;
    const close = closeButtonRef.current ? findNodeHandle(closeButtonRef.current) ?? undefined : undefined;
    setSearchFieldHandle((prev) => (prev === search ? prev : search));
    setCloseHandle((prev) => (prev === close ? prev : close));
    // Intentionally omit closeFocused/preferSearchFocus — refreshing nextFocus* mid
    // transition is what bounces Down off Close back onto Close.
  }, [visible]);

  const handleModalShow = useCallback(() => {
    logSearchEvent('search_overlay_modal_shown', { scope, nativeTvKeyboard: useNativeTvKeyboard });
    onReady?.();
    // Stage 4.2J: Detail→Search return owns focus — never let modal-show reclaim the input.
    if (restoreFocusMovieId) {
      closeOwnsFocusRef.current = false;
      setPreferSearchFocus(false);
      preferSearchFocusRef.current = false;
      initialFocusRequestedRef.current = true;
      focusConfirmedRef.current = false;
      logSearchEvent('search_input_focus_suppressed', {
        scope,
        source: 'modal-show-restore-result',
        restoreFocusMovieId,
      });
      return;
    }
    closeOwnsFocusRef.current = false;
    setPreferSearchFocus(true);
    initialFocusRequestedRef.current = false;
    focusConfirmedRef.current = false;
    logSearchEvent('search_input_focus_requested', { scope, source: 'modal-show' });
    focusSearchField();
  }, [focusSearchField, onReady, restoreFocusMovieId, scope, useNativeTvKeyboard]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') {
      return;
    }

    const handlerId = scope === 'movies' ? 'movies-search-overlay' : 'search-overlay';
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        handlerId,
        () => {
          logSearchEvent('search_overlay_back', { scope });
          onClose();
          return true;
        },
        () => ({
          screen: 'SearchOverlay',
          scope,
          visible,
        }),
      ),
    );

    return () => subscription.remove();
  }, [onClose, scope, visible]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      logSearchEvent('search_result_select', {
        scope,
        type: result.type,
        id: result.id,
        hasPoster: 'posterUrl' in result ? Boolean(result.posterUrl) : false,
      });
      onSelectResult(result);
    },
    [onSelectResult, scope],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const setQueryLogged = useCallback(
    (value: string) => {
      logSearchEvent('search_query_change', { scope, queryLength: value.trim().length });
      bumpMoviesSearchInputQueryRevision();
      cancelMoviesSearchResultFocus('query-change', {
        query: value.trim(),
        searchInputFocused: searchInputFocusedRef.current,
      });
      cancelMoviesSearchInputHandoff('query-change', {
        resultCount: 0,
        inputFocused: searchInputFocusedRef.current,
        inputPreferred: preferSearchFocusRef.current,
        imeVisible: imeVisibleRef.current,
      });
      setFocusedSearchMovieId(null);
      setHandoffActive(false);
      handoffGuardRef.current = false;
      controller.setQuery(value);
    },
    [controller, scope],
  );

  const trimmedQuery = controller.query.trim();
  const showIdle = !isSearchableQuery(trimmedQuery);
  const showEmpty = !showIdle && controller.status === 'empty';
  const showError = !showIdle && controller.status === 'error';
  const showResults = !showIdle && !showError && (controller.status === 'ready' || controller.status === 'loading');
  const resultsFocusUpHandle = searchFieldHandle;
  const resultsCountLabel = controller.totalCount.toLocaleString();
  const showInitialResultsLoader = controller.status === 'loading' && controller.results.length === 0;

  useEffect(() => {
    if (scope !== 'movie') {
      return;
    }
    const requestId = getActiveMoviesSearchRequestId();
    if (!requestId) {
      return;
    }
    if (showEmpty) {
      noteMoviesSearchResultsReady({
        requestId,
        query: trimmedQuery,
        resultIds: [],
        searchInputFocused: searchInputFocusedRef.current,
      });
      setFocusedSearchMovieId(null);
      return;
    }
    if (!showResults || controller.status !== 'ready') {
      return;
    }
    const movieIds = controller.results
      .filter((result): result is SearchResult & { type: 'movie'; id: string } => result.type === 'movie')
      .map((result) => result.id);
    noteMoviesSearchResultsReady({
      requestId,
      query: trimmedQuery,
      resultIds: movieIds,
      searchInputFocused: searchInputFocusedRef.current,
    });
  }, [controller.results, controller.status, scope, showEmpty, showResults, trimmedQuery]);

  const posterListHeader = useMemo(() => {
    if (showInitialResultsLoader) {
      return <SearchLoadingState />;
    }

    return <Text style={styles.count}>{resultsCountLabel} results</Text>;
  }, [resultsCountLabel, showInitialResultsLoader]);

  const handlePosterFocus = useCallback((key: string) => {
    // Track selection without forcing the poster grid to re-render on every D-pad move.
    setFocusedResultKey((current) => (current === key ? current : key));
    if (key.startsWith('movie:')) {
      setFocusedSearchMovieId(key.slice('movie:'.length));
    }
    // Target confirmed — SearchInput must not reclaim preferred focus.
    setHandoffActive(false);
    handoffGuardRef.current = false;
    setPreferSearchFocus(false);
    preferSearchFocusRef.current = false;
    logSearchEvent('search_result_focus', { scope, key });
  }, [scope]);

  const handleSearchDown = useCallback(
    (meta: { imeVisible: boolean }) => {
      if (scope !== 'movie') {
        return;
      }
      // One Down press → one handoff (ignore repeats while pending).
      if (handoffGuardRef.current || hasPendingMoviesSearchInputHandoff()) {
        return;
      }

      const movieIds = controller.results
        .filter((result): result is SearchResult & { type: 'movie'; id: string } => result.type === 'movie')
        .map((result) => result.id);

      if (!isSearchableQuery(trimmedQuery) || movieIds.length === 0) {
        beginMoviesSearchInputDownHandoff({
          requestId: getActiveMoviesSearchRequestId() ?? 0,
          queryRevision: getMoviesSearchInputQueryRevision(),
          resultIds: [],
          inputPreferred: preferSearchFocusRef.current,
          inputFocused: searchInputFocusedRef.current,
          imeVisible: meta.imeVisible || imeVisibleRef.current,
        });
        return;
      }

      // Stage 3G.2: clear preferred focus before Down leaves the field.
      setPreferSearchFocus(false);
      preferSearchFocusRef.current = false;
      handoffGuardRef.current = true;
      setHandoffActive(true);

      const result = beginMoviesSearchInputDownHandoff({
        requestId: getActiveMoviesSearchRequestId() ?? 0,
        queryRevision: getMoviesSearchInputQueryRevision(),
        resultIds: movieIds,
        inputPreferred: false,
        inputFocused: searchInputFocusedRef.current,
        imeVisible: meta.imeVisible || imeVisibleRef.current,
        dismissIme: () => {
          imeVisibleRef.current = false;
          inputRef.current?.blur();
        },
      });

      if (!result.accepted) {
        handoffGuardRef.current = false;
        setHandoffActive(false);
      } else if (result.nativeTag != null) {
        setFirstResultNativeTag(result.nativeTag);
      }

      // Release the press guard after a tick so native nextFocusDown + requestTvFocus
      // cannot double-fire a second token from the same Down.
      requestAnimationFrame(() => {
        // Keep handoffActive until target confirms / cancels; only clear the press latch.
        handoffGuardRef.current = false;
      });
    },
    [controller.results, scope, trimmedQuery],
  );

  const handleLoadMore = useCallback(() => {
    if (controller.hasMore) {
      void controller.loadMore();
    }
  }, [controller.hasMore, controller.loadMore]);

  const reactNative = ReactNative as typeof ReactNative & {
    TVFocusGuideView?: typeof View;
  };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }>;

  const resultsPane = showIdle ? (
    <SearchEmptyState scope={scope} mode="idle" />
  ) : showError ? (
    <SearchEmptyState
      scope={scope}
      mode="error"
      errorMessage={controller.errorMessage}
      onRetry={controller.reload}
      focusUpHandle={resultsFocusUpHandle}
    />
  ) : showEmpty ? (
    <SearchEmptyState
      scope={scope}
      mode="empty"
      query={trimmedQuery}
      // Stage 3G: movie empty state is non-focusable — keep Search focused (no retry loop).
      onClear={scope === 'movie' ? undefined : controller.clearQuery}
      focusUpHandle={scope === 'movie' ? undefined : resultsFocusUpHandle}
    />
  ) : showResults ? (
    usePosterGrid ? (
      <SearchPosterGrid
        results={controller.results}
        focusedMovieId={focusedSearchMovieId}
        searchQuery={trimmedQuery}
        onFocusResult={handlePosterFocus}
        onSelectResult={handleSelect}
        onEndReached={handleLoadMore}
        loadingMore={controller.status === 'loading' && controller.results.length > 0}
        focusUpHandle={resultsFocusUpHandle}
        listHeader={posterListHeader}
      />
    ) : (
      <SearchResults
        results={controller.results}
        focusedResultKey={focusedResultKey}
        onFocusResult={setFocusedResultKey}
        onSelectResult={handleSelect}
        focusUpHandle={resultsFocusUpHandle}
      />
    )
  ) : null;

  // Stage 3G.4: while Detail/playback owns the screen, keep controller state mounted
  // but do NOT render the Modal — a hidden Modal still steals Android TV focus/OK.
  if (!visible) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      onShow={handleModalShow}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      hardwareAccelerated>
      <View style={styles.overlay} accessibilityViewIsModal collapsable={false}>
        <View style={styles.scrim} pointerEvents="none" />

        <FocusBoundaryView
          style={styles.focusBoundary}
          {...(Platform.OS === 'android'
            ? {
                autoFocus: shouldAutoFocusSearchFocusGuide(),
                trapFocusLeft: true,
                trapFocusRight: true,
                trapFocusUp: true,
                trapFocusDown: true,
              }
            : {})}>
          <View style={styles.panel}>
          <View style={styles.header} pointerEvents="box-none">
            <Text style={styles.title}>{title}</Text>
            <Pressable
              ref={closeButtonRef}
              focusable
              accessibilityRole="button"
              accessibilityLabel="Close search"
              onPress={handleClose}
              {...(Platform.isTV ? ({ onClick: handleClose } as object) : null)}
              onFocus={handleCloseFocus}
              onBlur={() => {
                closeOwnsFocusRef.current = false;
                setCloseFocused(false);
              }}
              {...(resolveCloseNextFocusHandles({ closeHandle, searchFieldHandle }) ?? null)}
              style={[styles.closeButton, novaTvFocus.base, closeFocused && styles.closeButtonFocused]}>
              <MaterialCommunityIcons
                name="close"
                size={17}
                color={closeFocused ? novaTheme.colors.textPrimary : novaTheme.colors.textSecondary}
                style={closeFocused ? styles.closeIconFocused : undefined}
              />
              <Text style={[styles.closeText, closeFocused && styles.closeTextFocused]}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.searchSlot}>
          <SearchInput
            focusRef={searchShellRef}
            inputRef={inputRef}
            value={controller.query}
            onChangeText={setQueryLogged}
            placeholder={placeholder ?? scopedSearchEmptyHint(scope)}
            onClear={controller.clearQuery}
            onSubmit={() => {
              inputRef.current?.blur();
              imeVisibleRef.current = false;
              handleImeReturnToShell();
            }}
            showSoftKeyboard={!useOnScreenKeyboard}
            openKeyboardOnFocus={false}
            autoFocus={false}
            preferredFocus={
              preferSearchFocus &&
              !closeFocused &&
              !handoffActive &&
              (showIdle || showEmpty || controller.results.length === 0)
            }
            focusUpHandle={shouldWireSearchNextFocusUpToClose() ? closeHandle : undefined}
            // Stage 3G.2: point Down at the first mounted result — never trap to self.
            focusDownHandle={
              scope === 'movie' &&
              controller.results.length > 0 &&
              firstResultNativeTag != null &&
              firstResultNativeTag !== searchFieldHandle
                ? firstResultNativeTag
                : undefined
            }
            onDown={scope === 'movie' ? handleSearchDown : undefined}
            onShellFocus={handleSearchShellFocus}
            onShellBlur={handleSearchShellBlur}
            onKeyboardActivate={handleKeyboardActivate}
          />
          </View>

          <View style={styles.body}>
          {useOnScreenKeyboard ? (
            <View style={styles.tvBody}>
              <View style={styles.keyboardColumn}>
                <Text style={styles.keyboardHint}>Use the remote to type</Text>
                <TvSearchKeyboard
                  onType={(char) => setQueryLogged(`${controller.query}${char}`)}
                  onBackspace={() => setQueryLogged(controller.query.slice(0, -1))}
                  onClear={() => {
                    controller.clearQuery();
                    logSearchEvent('search_query_change', { scope, queryLength: 0, cleared: true });
                  }}
                  onSpace={() => setQueryLogged(`${controller.query} `)}
                />
              </View>
              <View style={styles.resultsColumn}>{resultsPane}</View>
            </View>
          ) : (
            resultsPane
          )}
          </View>
          </View>
        </FocusBoundaryView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 80,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 9, 13, 0.92)',
  },
  focusBoundary: {
    flex: 1,
  },
  panel: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: 'rgba(10, 14, 22, 0.96)',
    borderLeftWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  searchSlot: {
    zIndex: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
    gap: 10,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  closeButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  closeButtonFocused: {
    ...novaTvFocus.active,
  },
  closeIconFocused: {},
  closeText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  closeTextFocused: focusText.title,
  tvBody: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 16,
  },
  keyboardColumn: {
    width: '42%',
    maxWidth: 520,
    gap: 6,
  },
  keyboardHint: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  resultsColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  count: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
});
