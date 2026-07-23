import type { ComponentType, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import { BackHandler, findNodeHandle, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';
import { novaTheme } from '@/theme';

import { SearchEmptyState } from './SearchEmptyState';
import { SearchInput } from './SearchInput';
import { SearchLoadingState } from './SearchLoadingState';
import { SearchPosterGrid } from './SearchPosterGrid';
import { SearchResults } from './SearchResults';
import { TvSearchKeyboard } from './TvSearchKeyboard';
import { logSearchEvent } from './searchDiagnostics';
import { scopedSearchEmptyHint } from './searchScopes';
import { isSearchableQuery } from './searchQuery';
import type { SearchResult, SearchScope } from './searchTypes';
import { useSearchController } from './useSearchController';

type SearchOverlayProps = {
  visible: boolean;
  scope: Exclude<SearchScope, 'all'>;
  providerId: string;
  title: string;
  placeholder?: string;
  /** Kept for API compatibility; Fire TV uses a solid dim (BlurView was invisible on device). */
  blurTarget?: RefObject<View | null>;
  executeSearch: Parameters<typeof useSearchController<SearchResult>>[0]['executeSearch'];
  onClose: () => void;
  /** Fires once the native Modal is on screen — browse layers can defer blocking until then. */
  onReady?: () => void;
  onSelectResult: (result: SearchResult) => void;
  pageSize?: number;
};

/** Avoid mounting search hooks while the overlay is closed — prevents idle reset loops. */
export function SearchOverlay(props: SearchOverlayProps) {
  if (!props.visible) {
    return null;
  }

  return <SearchOverlayContent {...props} />;
}

function SearchOverlayContent({
  visible,
  scope,
  providerId,
  title,
  placeholder,
  executeSearch,
  onClose,
  onReady,
  onSelectResult,
  pageSize = 50,
}: SearchOverlayProps) {
  const inputRef = useRef<TextInput>(null);
  const searchShellRef = useRef<View | null>(null);
  const closeButtonRef = useRef<View | null>(null);
  const focusConfirmedRef = useRef(false);
  const initialFocusRequestedRef = useRef(false);
  const [preferSearchFocus, setPreferSearchFocus] = useState(true);
  const [focusedResultKey, setFocusedResultKey] = useState<string | null>(null);
  const [closeFocused, setCloseFocused] = useState(false);
  const [searchFieldHandle, setSearchFieldHandle] = useState<number | undefined>(undefined);
  const useNativeTvKeyboard = Platform.isTV;
  const useOnScreenKeyboard = Platform.OS === 'android' && !useNativeTvKeyboard;

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
    if (initialFocusRequestedRef.current && focusConfirmedRef.current) {
      return;
    }

    initialFocusRequestedRef.current = true;
    focusNativeViewWhenReady(() => searchShellRef.current, () => {
      searchShellRef.current?.focus();
    });
  }, []);

  const handleSearchShellFocus = useCallback(() => {
    // Drop preferred focus after landing once — leaving it true fights Close/results forever.
    setPreferSearchFocus(false);
    confirmOverlayFocus('search-input');
  }, [confirmOverlayFocus]);

  const handleCloseFocus = useCallback(() => {
    // Never redirect Close → Search. That bounce caused a permanent focus flash loop.
    setCloseFocused(true);
    setPreferSearchFocus(false);
    confirmOverlayFocus('close');
  }, [confirmOverlayFocus]);

  const controller = useSearchController<SearchResult>({
    scope,
    providerId,
    enabled: visible,
    pageSize,
    executeSearch,
  });

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
    if (!visible) {
      focusConfirmedRef.current = false;
      initialFocusRequestedRef.current = false;
      setPreferSearchFocus(true);
      setFocusedResultKey(null);
      setCloseFocused(false);
    }
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible) {
      setSearchFieldHandle(undefined);
      return;
    }

    const search = searchShellRef.current ? findNodeHandle(searchShellRef.current) ?? undefined : undefined;
    setSearchFieldHandle((prev) => (prev === search ? prev : search));
  }, [visible]);

  const handleModalShow = useCallback(() => {
    logSearchEvent('search_overlay_modal_shown', { scope, nativeTvKeyboard: useNativeTvKeyboard });
    onReady?.();
    setPreferSearchFocus(true);
    initialFocusRequestedRef.current = false;
    focusConfirmedRef.current = false;
    logSearchEvent('search_input_focus_requested', { scope, source: 'modal-show' });
    focusSearchField();
  }, [focusSearchField, onReady, scope, useNativeTvKeyboard]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      logSearchEvent('search_overlay_back', { scope });
      onClose();
      return true;
    });

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

  const posterListHeader = useMemo(() => {
    if (showInitialResultsLoader) {
      return <SearchLoadingState />;
    }

    return <Text style={styles.count}>{resultsCountLabel} results</Text>;
  }, [resultsCountLabel, showInitialResultsLoader]);

  const handlePosterFocus = useCallback((key: string) => {
    // Track selection without forcing the poster grid to re-render on every D-pad move.
    setFocusedResultKey((current) => (current === key ? current : key));
    logSearchEvent('search_result_focus', { scope, key });
  }, [scope]);

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
      onClear={controller.clearQuery}
      focusUpHandle={resultsFocusUpHandle}
    />
  ) : showResults ? (
    usePosterGrid ? (
      <SearchPosterGrid
        results={controller.results}
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
            ? { trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
            : {})}>
          <View style={styles.panel}>
          <View style={styles.searchSlot}>
          <SearchInput
            focusRef={searchShellRef}
            inputRef={inputRef}
            value={controller.query}
            onChangeText={setQueryLogged}
            placeholder={placeholder ?? scopedSearchEmptyHint(scope)}
            onClear={controller.clearQuery}
            onSubmit={() => inputRef.current?.blur()}
            showSoftKeyboard={!useOnScreenKeyboard}
            openKeyboardOnFocus={useOnScreenKeyboard}
            autoFocus={false}
            preferredFocus={preferSearchFocus}
            focusUpHandle={searchFieldHandle}
            onShellFocus={handleSearchShellFocus}
          />
          </View>

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
              onBlur={() => setCloseFocused(false)}
              {...(searchFieldHandle
                ? {
                    nextFocusDown: searchFieldHandle,
                    nextFocusLeft: searchFieldHandle,
                    nextFocusRight: searchFieldHandle,
                  }
                : null)}
              style={[styles.closeButton, novaTvFocus.base, closeFocused && styles.closeButtonFocused]}>
              <MaterialCommunityIcons
                name="close"
                size={17}
                color={closeFocused ? novaTheme.colors.accentHover : novaTheme.colors.textSecondary}
                style={closeFocused ? styles.closeIconFocused : undefined}
              />
              <Text style={[styles.closeText, closeFocused && styles.closeTextFocused]}>Close</Text>
            </Pressable>
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
    position: 'absolute',
    top: 18,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  searchSlot: {
    marginTop: 48,
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
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity * 0.65,
    shadowRadius: 7,
  },
  closeIconFocused: {
    transform: [{ scale: 1.12 }],
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.9,
    shadowRadius: 7,
  },
  closeText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  closeTextFocused: {
    color: novaTheme.colors.accentHover,
    textShadowColor: novaTheme.colors.focusRing,
    textShadowRadius: 8,
  },
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
