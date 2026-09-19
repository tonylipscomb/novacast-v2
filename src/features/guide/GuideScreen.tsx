import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
    BackHandler,
    findNodeHandle,
    FlatList,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
  TextInput,
  useWindowDimensions,
    View,
} from 'react-native';

import { createNovaTvFocusChrome, createNovaTvFocusTextStyles, NovaSpaceLoader, novaTvFocus, NovaTvShell } from '@/components/nova';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { toggleLiveFavorite, usePersonalizationStore } from '@/features/personalization/personalizationStore';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { tvPerfSetFocus, tvPerfSetScreen } from '@/features/perf/tvPerfStore';
import { decodeDisplayTextEntities } from '@/features/live/liveTvProgramText';
import { ingestGuideRows } from '@/features/search/repositories/guideSearchRepository';
import { GuideCategoryRail } from './GuideCategoryRail';
import { GuideLocalFocusPressable } from './GuideLocalFocusPressable';
import { GUIDE_DETAILS_FOCUS_DEBOUNCE_MS } from './guideFocusPolicy';
import {
    createInitialGuideState,
    focusGuideProgramAt,
    GUIDE_NOTIFICATION_DURATION_MS,
    GUIDE_NOTIFICATION_ID,
    resolveGuideNotificationForStatus,
    selectGuideProgram,
    shouldAcceptGuideTune,
} from './guideLogic';
import { getGuideMemory, rememberGuideMemory } from './guideMemory';
import { filterGuideRows } from './guideSearch';
import {
    findProgramForTimestamp,
    findVerticalProgram,
    formatGuideDate,
  formatGuideTime,
  getGuideNowOffset,
    getProgramOffset,
    getProgramStatus,
    getProgramWidth,
    GUIDE_CHANNEL_COLUMN_WIDTH,
    GUIDE_MIN_PROGRAM_WIDTH,
    GUIDE_PIXELS_PER_MINUTE,
    GUIDE_ROW_HEIGHT,
    GUIDE_TIME_SLOT_MINUTES,
    deriveGuideColumnWidths,
    type NormalizedGuideProgram,
    type NormalizedGuideRow,
} from './guideTimeline';
import { useGuideScreenModel } from './useGuideScreenModel';

type Focusable = ElementRef<typeof Pressable>;

function programKey(channelId: string, programId: string) {
  return `${channelId}-${programId}`;
}

function ChannelLogo({ channel }: { channel: NormalizedGuideRow['channel'] }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [failed, setFailed] = useState(false);

  if (channel.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: channel.logoUrl }}
        style={styles.channelLogo}
        contentFit="contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.channelLogo, styles.channelLogoFallback, { backgroundColor: channel.tone }]}>
      <Text style={styles.channelLogoText}>{channel.shortName || 'TV'}</Text>
    </View>
  );
}

function GuideLoadingPanel({ label }: { label: string }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.loadingPanel}>
      <NovaSpaceLoader label={label} />
    </View>
  );
}

export function GuideScreen() {
  // NOVACAST_GUIDE_V2_FOUNDATION_V1: compact channels-first Guide shell; channels stay usable without schedule data.
  // NOVACAST_GUIDE_V2_1_POLISH_V1: prior visible short-EPG hydration experiment.
  // NOVACAST_GUIDE_V2_2_STABILITY_V1: no interactive EPG requests; stabilize TV focus while bulk/local EPG is built separately.
  // NOVACAST_GUIDE_V2_2_1_DPAD_LOCK_V1: keep rapid channel D-pad movement inside the Guide while FlatList mounts neighbors.
  const { theme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  // Fixed dp columns (264/320) ate ~61% of the 960dp ONN window; derive them from the live window instead.
  const { categoryWidth, channelWidth } = deriveGuideColumnWidths(windowWidth);
  const styles = useMemo(
    () => createStyles(theme, channelWidth, categoryWidth),
    [theme, channelWidth, categoryWidth],
  );
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.guide.key);
  const guideMemory = getGuideMemory(activeProviderId);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const {
    bundle,
    status,
    rows,
    errorMessage,
    timeline,
    timeSlots,
    reload,
    loadMore,
    hasMore,
    isLoadingMore,
    isRefreshing,
    categories,
    categoriesStatus,
    selectedCategoryId,
    selectCategory,
    selectedCategoryTotalCount,
  } = useGuideScreenModel();

  useEffect(() => {
    tvPerfSetScreen('guide');
  }, []);

  const { state: personalizationState } = usePersonalizationStore(activeProviderId);
  const selectedCategoryName = categories.find((category) => category.id === selectedCategoryId)?.name ?? '';
  const [guideState, setGuideState] = useState(() => ({
    ...createInitialGuideState(
      guideMemory.focusedChannelId ?? 'channel-0',
      guideMemory.focusedProgramId ?? 'channel-0-0',
    ),
    focusedTimestamp: guideMemory.focusedTimestamp,
  }));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(guideMemory.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [focusedAction, setFocusedAction] = useState<'jump' | 'search' | 'clear' | 'retry' | null>(null);
  const rowsRef = useRef<FlatList<NormalizedGuideRow>>(null);
  const timelineHeaderRef = useRef<ScrollView>(null);
  const rowScrollRefs = useRef<Record<string, ScrollView | null>>({});
  const channelRefs = useRef<Record<string, Focusable | null>>({});
  const programRefs = useRef<Record<string, Focusable | null>>({});
  const jumpRef = useRef<Focusable | null>(null);
  const searchRef = useRef<Focusable | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const retryRef = useRef<Focusable | null>(null);
  const emptyStateActionRef = useRef<Focusable | null>(null);
  const categoryRailItemRefs = useRef<Record<string, Focusable | null>>({});
  const categoryRailFocusedRef = useRef(false);
  const nowRef = useRef(0);
  const lastTuneRef = useRef<{ key: string; at: number } | null>(null);
  const lastRetryAtRef = useRef(0);
  /** Set once the user retries; cleared on a successful load or a category change. Drives whether a repeated error toast becomes persistent. */
  const guideRetryAttemptedRef = useRef(false);
  const [stateActionHandle, setStateActionHandle] = useState<number | undefined>();
  const horizontalOffsetRef = useRef(guideMemory.horizontalOffset);
  const initialHorizontalPositionedRef = useRef(false);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [focusGraphRevision, setFocusGraphRevision] = useState(0);
  const focusGraphFrameRef = useRef<number | null>(null);
  const programRefCallbacks = useRef<Record<string, (instance: Focusable | null) => void>>({});
  const channelRefCallbacks = useRef<Record<string, (instance: Focusable | null) => void>>({});
  const initialFocusProviderRef = useRef<string | null>(null);
  const preferredFocusConsumedRef = useRef(false);
  const detailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFocusRef = useRef({
    channelId: guideMemory.focusedChannelId,
    programId: guideMemory.focusedProgramId,
    timestamp: guideMemory.focusedTimestamp ?? null as number | null,
  });

  const favoriteIds = useMemo(
    () => new Set(personalizationState.liveFavorites.map((item) => item.contentId)),
    [personalizationState.liveFavorites],
  );
  const filteredRows = useMemo(
    () => filterGuideRows(rows, 'all', favoriteIds, deferredSearchQuery),
    [deferredSearchQuery, favoriteIds, rows],
  );

  useEffect(() => {
    if (rows.length) {
      ingestGuideRows(activeProviderId, rows);
    }
  }, [activeProviderId, rows]);
  const timelineWidth = Math.max(
    GUIDE_MIN_PROGRAM_WIDTH * 4,
    ((timeline.endAt - timeline.startAt) / 60_000) * GUIDE_PIXELS_PER_MINUTE,
  );
  const preferredProgramKey = useMemo(() => {
    if (preferredFocusConsumedRef.current) {
      return null;
    }
    const seedChannelId = guideMemory.focusedChannelId;
    const seedProgramId = guideMemory.focusedProgramId;
    const focused = filteredRows.some(
      (row) =>
        row.channel.id === seedChannelId &&
        row.programs.some((program) => programKey(row.channel.id, program.id) === seedProgramId),
    );
    if (focused && seedChannelId && seedProgramId) {
      return programKey(seedChannelId, seedProgramId);
    }
    const first = filteredRows[0]?.programs[0];
    return first && filteredRows[0] ? programKey(filteredRows[0].channel.id, first.id) : null;
  }, [filteredRows, guideMemory.focusedChannelId, guideMemory.focusedProgramId]);
  useEffect(() => {
    const updateNow = () => {
      nowRef.current = Date.now();
    };
    updateNow();
    const timer = setInterval(updateNow, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setStateActionHandle(findNodeHandle(retryRef.current ?? emptyStateActionRef.current) ?? undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [bundle, filteredRows.length, status]);

  const stateActionFocusProps = stateActionHandle
    ? {
      nextFocusUp: stateActionHandle,
      nextFocusDown: stateActionHandle,
      nextFocusLeft: stateActionHandle,
      nextFocusRight: stateActionHandle,
    }
    : null;

  useEffect(() => {
    rememberGuideMemory(activeProviderId, {
      focusedChannelId: guideState.focusedChannelId ?? getGuideMemory(activeProviderId).focusedChannelId,
      focusedProgramId: guideState.focusedProgramId ?? getGuideMemory(activeProviderId).focusedProgramId,
      selectedChannelId: guideState.selectedChannelId ?? getGuideMemory(activeProviderId).selectedChannelId,
      selectedProgramId: guideState.selectedProgramId ?? getGuideMemory(activeProviderId).selectedProgramId,
      focusedTimestamp: guideState.focusedTimestamp,
      searchQuery,
    });
  }, [activeProviderId, guideState, searchQuery]);

  useEffect(() => {
    // Only the truly-fatal "no provider connected" full panel auto-focuses its Retry
    // button — it's the one case where the screen has no other usable focus target at
    // all. A transient error/no-epg (provider connected, categories/channels still there)
    // is now a corner toast instead, and must never steal focus from the category rail,
    // channel rows, etc. that stay usable underneath.
    if (bundle || status !== 'error') return;
    const frame = requestAnimationFrame(() => retryRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [bundle, status]);

  useEffect(() => {
    const shouldFocusEmptyAction =
      status === 'empty' || status === 'no-favorites' || (status === 'ready' && !filteredRows.length);
    if (!shouldFocusEmptyAction) return;

    const frame = requestAnimationFrame(() => emptyStateActionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [filteredRows.length, status]);

  useEffect(() => {
    if (status === 'ready') {
      guideRetryAttemptedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'ready' || !rows.length || timelineViewportWidth <= 0) return;
    if (initialHorizontalPositionedRef.current) return;
    initialHorizontalPositionedRef.current = true;
    const initialOffset = getGuideNowOffset(
      nowRef.current || Date.now(),
      timeline.startAt,
      undefined,
      Math.max(0, timelineWidth - timelineViewportWidth),
    );
    const frame = requestAnimationFrame(() => {
      timelineHeaderRef.current?.scrollTo({ x: initialOffset, animated: false });
      Object.values(rowScrollRefs.current).forEach((rowScrollRef) => {
        rowScrollRef?.scrollTo({ x: initialOffset, animated: false });
      });
      horizontalOffsetRef.current = initialOffset;
    });
    return () => cancelAnimationFrame(frame);
  }, [rows.length, status, timeline.startAt, timelineViewportWidth, timelineWidth]);

  useEffect(() => {
    return () => {
      if (detailsTimerRef.current) {
        clearTimeout(detailsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !filteredRows.length || initialFocusProviderRef.current === activeProviderId) return;

    const targetKey = preferredProgramKey;
    const firstChannelId = filteredRows[0]?.channel.id ?? null;
    const cancel = focusNativeViewWhenReady(
      () =>
        targetKey
          ? programRefs.current[targetKey]
          : firstChannelId
            ? channelRefs.current[firstChannelId]
            : null,
      () => {
        const targetReady = targetKey
          ? Boolean(programRefs.current[targetKey])
          : Boolean(firstChannelId && channelRefs.current[firstChannelId]);
        if (targetReady) {
          initialFocusProviderRef.current = activeProviderId;
          preferredFocusConsumedRef.current = true;
        }
      },
    );

    return cancel;
  }, [activeProviderId, filteredRows.length, focusGraphRevision, preferredProgramKey, status]);

  const registerCategoryRailItemRef = useCallback((categoryId: string, instance: Focusable | null) => {
    categoryRailItemRefs.current[categoryId] = instance;
  }, []);

  const focusCategoryRail = useCallback(() => {
    const target = categoryRailItemRefs.current[selectedCategoryId] ?? Object.values(categoryRailItemRefs.current)[0];
    target?.focus();
  }, [selectedCategoryId]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'guide-screen',
        () => {
          if (guide.visible) return true;

          if (searchOpen) {
            setSearchOpen(false);
            setSearchQuery('');
            requestAnimationFrame(() => searchRef.current?.focus());
            return true;
          }

          if (!categoryRailFocusedRef.current) {
            requestAnimationFrame(() => focusCategoryRail());
            return true;
          }

          if (!tryAcquireTvNavigationGate(navigationGateRef.current)) return true;
          router.replace(TV_HOME_ROUTE);
          return true;
        },
        () => ({
          screen: 'GuideScreen',
          guideVisible: guide.visible,
          searchOpen,
        }),
      ),
    );

    return () => subscription.remove();
  }, [focusCategoryRail, guide.visible, router, searchOpen]);

  const scheduleFocusGraphRefresh = useCallback(() => {
    if (focusGraphFrameRef.current !== null) return;

    focusGraphFrameRef.current = requestAnimationFrame(() => {
      focusGraphFrameRef.current = null;
      setFocusGraphRevision((current) => current + 1);
    });
  }, []);

  const setProgramRef = useCallback((key: string, instance: Focusable | null) => {
    const previousHandle = programRefs.current[key] ? findNodeHandle(programRefs.current[key]) : null;
    programRefs.current[key] = instance;
    const nextHandle = instance ? findNodeHandle(instance) : null;
    if (previousHandle !== nextHandle) scheduleFocusGraphRefresh();
  }, [scheduleFocusGraphRefresh]);

  const getProgramRefCallback = useCallback((key: string) => {
    const existing = programRefCallbacks.current[key];
    if (existing) return existing;

    const callback = (instance: Focusable | null) => setProgramRef(key, instance);
    programRefCallbacks.current[key] = callback;
    return callback;
  }, [setProgramRef]);

  const setChannelRef = useCallback((key: string, instance: Focusable | null) => {
    const previousHandle = channelRefs.current[key] ? findNodeHandle(channelRefs.current[key]) : null;
    channelRefs.current[key] = instance;
    const nextHandle = instance ? findNodeHandle(instance) : null;
    if (previousHandle !== nextHandle) scheduleFocusGraphRefresh();
  }, [scheduleFocusGraphRefresh]);

  const getChannelRefCallback = useCallback((key: string) => {
    const existing = channelRefCallbacks.current[key];
    if (existing) return existing;

    const callback = (instance: Focusable | null) => setChannelRef(key, instance);
    channelRefCallbacks.current[key] = callback;
    return callback;
  }, [setChannelRef]);

  const getProgramTimestamp = (program: NormalizedGuideProgram, index: number) =>
    program.startAt ?? timeline.startAt + index * 60 * 60 * 1000;

  const syncHorizontalOffset = (offset: number, sourceChannelId?: string) => {
    const nextOffset = Math.min(
      Math.max(0, Math.round(offset)),
      Math.max(0, timelineWidth - timelineViewportWidth),
    );
    // Imperative scroll only — avoid setState on every D-pad / swipe move.
    horizontalOffsetRef.current = nextOffset;
    rememberGuideMemory(activeProviderId, { horizontalOffset: nextOffset });
    timelineHeaderRef.current?.scrollTo({ x: nextOffset, animated: false });
    Object.entries(rowScrollRefs.current).forEach(([channelId, rowScrollRef]) => {
      if (channelId !== sourceChannelId) {
        rowScrollRef?.scrollTo({ x: nextOffset, animated: false });
      }
    });
  };

  const scrollToProgram = (rowIndex: number, channelId: string, timestamp: number, horizontalOffset?: number) => {
    // Never center row 0/1 — viewPosition 0.5 there left ~169dp of blank space above the first rows.
    const viewPosition = rowIndex <= 1 ? 0 : 0.4;
    rowsRef.current?.scrollToIndex({ index: rowIndex, animated: true, viewPosition });
    const x = horizontalOffset ?? Math.max(0, ((timestamp - timeline.startAt) / 60_000) * GUIDE_PIXELS_PER_MINUTE - 110);
    syncHorizontalOffset(x, channelId);
    const appliedOffset = horizontalOffsetRef.current;
    rowScrollRefs.current[channelId]?.scrollTo({ x: appliedOffset, animated: true });
    timelineHeaderRef.current?.scrollTo({ x: appliedOffset, animated: true });
  };

  const publishGuideFocus = useCallback(
    (channelId: string, programId: string, timestamp: number | null, immediate = false) => {
      latestFocusRef.current = { channelId, programId, timestamp };
      preferredFocusConsumedRef.current = true;
      tvPerfSetFocus('GuideProgram', `${channelId}:${programId}`);
      rememberGuideMemory(activeProviderId, {
        focusedChannelId: channelId,
        focusedProgramId: programId,
        focusedTimestamp: timestamp,
      });

      const apply = () => {
        setGuideState((current) => focusGuideProgramAt(current, channelId, programId, timestamp));
      };

      if (detailsTimerRef.current) {
        clearTimeout(detailsTimerRef.current);
        detailsTimerRef.current = null;
      }

      if (immediate) {
        apply();
        return;
      }

      detailsTimerRef.current = setTimeout(apply, GUIDE_DETAILS_FOCUS_DEBOUNCE_MS);
    },
    [activeProviderId],
  );

  const focusProgram = (rowIndex: number, row: NormalizedGuideRow, program: NormalizedGuideProgram, programIndex: number) => {
    const timestamp = getProgramTimestamp(program, programIndex);
    publishGuideFocus(row.channel.id, program.id, timestamp, false);
    // Native preferred focus is state-only. Scrolling during initial mount can
    // center the first row and create the large blank region above the grid.
    // Once initial focus has settled, user-driven focus keeps the existing
    // row-0/1 top anchor and deeper-row visibility behavior.
    if (initialFocusProviderRef.current === activeProviderId) {
      scrollToProgram(rowIndex, row.channel.id, timestamp);
    }
  };

  const focusJumpTarget = (rowIndex: number, row: NormalizedGuideRow, program: NormalizedGuideProgram | null) => {
    if (!program) {
      requestAnimationFrame(() => channelRefs.current[row.channel.id]?.focus());
      return;
    }

    const key = programKey(row.channel.id, program.id);
    publishGuideFocus(row.channel.id, program.id, program.startAt ?? Date.now(), true);
    scrollToProgram(
      rowIndex,
      row.channel.id,
      program.startAt ?? Date.now(),
      getGuideNowOffset(nowRef.current || Date.now(), timeline.startAt),
    );
    focusNativeViewWhenReady(() => programRefs.current[key] ?? null, () => undefined);
  };

  const jumpToNow = () => {
    const now = nowRef.current;
    const rememberedIndex = filteredRows.findIndex((row) => row.channel.id === guideState.focusedChannelId);
    const rowIndex = rememberedIndex >= 0 ? rememberedIndex : 0;
    const row = filteredRows[rowIndex];
    if (!row) return;
    focusJumpTarget(rowIndex, row, findProgramForTimestamp(row, now));
  };

  const tuneProgram = (row: NormalizedGuideRow, program: NormalizedGuideProgram) => {
    const key = programKey(row.channel.id, program.id);
    const now = nowRef.current;
    if (!row.channel.streamUrl || !shouldAcceptGuideTune(lastTuneRef.current, key, now)) {
      return;
    }
    lastTuneRef.current = { key, at: now };
    setGuideState((current) => selectGuideProgram(current, row.channel.id, program.id));
    router.push({
      pathname: '/live',
      params: { categoryId: row.channel.categoryId, channelId: row.channel.id, returnRoute: 'guide' },
    });
  };

  const tuneChannel = (row: NormalizedGuideRow) => {
    const program = findProgramForTimestamp(row, nowRef.current) ?? row.programs[0];
    if (program) tuneProgram(row, program);
    else if (row.channel.streamUrl) router.push({ pathname: '/live', params: { categoryId: row.channel.categoryId, channelId: row.channel.id, returnRoute: 'guide' } });
  };

  const toggleChannelFavorite = (row: NormalizedGuideRow) => {
    void toggleLiveFavorite(activeProviderId, row.channel);
  };

  const handleRetry = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) return;
    lastRetryAtRef.current = now;
    guideRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      guideRetryAttemptedRef.current = false;
      selectCategory(categoryId);
    },
    [selectCategory],
  );

  useEffect(() => {
    // The fatal "no provider connected" case keeps its own full panel (see JSX below) and
    // never surfaces a toast — there's nothing else on screen for it to coexist with.
    if (!bundle) {
      dismissNotification(GUIDE_NOTIFICATION_ID);
      return;
    }

    const spec = resolveGuideNotificationForStatus(status, guideRetryAttemptedRef.current);
    if (!spec) {
      dismissNotification(GUIDE_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: GUIDE_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: GUIDE_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'guide',
    });
  }, [bundle, dismissNotification, showNotification, status]);

  useEffect(() => {
    return () => {
      clearScope('guide');
    };
  }, [clearScope]);

  const getProgramFocusTarget = (rowIndex: number, program: NormalizedGuideProgram, direction: 'up' | 'down') => {
    const targetRow = filteredRows[rowIndex + (direction === 'up' ? -1 : 1)];
    if (!targetRow) return null;
    const target = findVerticalProgram(filteredRows, rowIndex, program.startAt ?? nowRef.current, direction);
    return target ? programRefs.current[programKey(targetRow.channel.id, target.id)] : null;
  };

  const getHandle = (instance: Focusable | null | undefined) => (instance ? findNodeHandle(instance) ?? undefined : undefined);

  return (
    <NovaTvShell
      activeId="guide"
      providerLabel={selectedProviderLabel}
      preferActiveNavigationFocus={false}>
      <View style={styles.screen}>
        {/* Compact actions pinned into the grid's header band (no separate top strip). */}
        <View style={styles.toolbar}>
          <View style={styles.toolbarActions}>
            {searchOpen ? (
              <View style={styles.searchBox}>
                <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.textMuted} />
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search channels or programs"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.searchInput}
                  returnKeyType="done"
                  onSubmitEditing={() => searchInputRef.current?.blur()}
                />
                <Pressable
                  focusable
                  accessibilityRole="button"
                  accessibilityLabel="Clear Guide search"
                  onFocus={() => setFocusedAction('clear')}
                  onBlur={() => setFocusedAction(null)}
                  onPress={() => setSearchQuery('')}
                  style={[styles.iconButton, novaTvFocus.base, focusedAction === 'clear' && styles.textFocusActive]}>
                  <MaterialCommunityIcons name="close" size={17} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
            ) : null}
            {searchOpen && searchQuery.trim() && selectedCategoryId !== 'all' ? (
              <Text style={styles.searchScopeHint} numberOfLines={1}>
                In {selectedCategoryName || 'category'} · pick All Channels to search everything
              </Text>
            ) : null}
            {!searchOpen ? (
              <Pressable
                ref={searchRef}
                focusable
                accessibilityRole="button"
                accessibilityLabel="Search Guide"
                onFocus={() => setFocusedAction('search')}
                onBlur={() => setFocusedAction(null)}
                onPress={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                style={[styles.actionButton, novaTvFocus.base, focusedAction === 'search' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.accentHover} />
                <Text style={[styles.actionText, focusedAction === 'search' && styles.actionTextFocused]}>Search</Text>
              </Pressable>
            ) : null}
            <Pressable
              ref={jumpRef}
              focusable
              accessibilityRole="button"
              accessibilityLabel="Jump to now"
              onFocus={() => setFocusedAction('jump')}
              onBlur={() => setFocusedAction(null)}
              onPress={jumpToNow}
              style={[styles.actionButton, novaTvFocus.base, focusedAction === 'jump' && styles.textFocusActive]}>
              <MaterialCommunityIcons name="clock-fast" size={18} color={theme.colors.accentHover} />
              <Text style={[styles.actionText, focusedAction === 'jump' && styles.actionTextFocused]}>Jump to Now</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.guideBody}>
          <View style={styles.categoriesPanel}>
            <View style={styles.panelHeader}>
              <Text style={styles.headerLabel}>Categories</Text>
            </View>
            <GuideCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelect={handleSelectCategory}
              orientation="vertical"
              onFocusChange={(focused) => {
                categoryRailFocusedRef.current = focused;
              }}
              registerItemRef={registerCategoryRailItemRef}
            />
          </View>

          <View style={styles.guideFrame}>
          <View style={styles.guideHeaderRow}>
            <View style={styles.channelHeader}>
              <Text style={styles.headerLabel}>Channels</Text>
              <Text style={styles.headerHint}>
                {selectedCategoryTotalCount != null && selectedCategoryTotalCount > rows.length
                  ? `${rows.length} of ${selectedCategoryTotalCount}`
                  : filteredRows.length}
              </Text>
            </View>
            <ScrollView
              ref={timelineHeaderRef}
              horizontal
              focusable={false}
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              persistentScrollbar={false}
              onLayout={(event) => setTimelineViewportWidth(event.nativeEvent.layout.width)}
              style={styles.timeHeader}
              contentContainerStyle={[styles.timeHeaderContent, { width: timelineWidth }]}>
              {timeSlots.map((time) => (
                <View key={time} style={styles.timeSlot}>
                  <Text numberOfLines={1} style={styles.timeText}>{formatGuideTime(time)}</Text>
                  <Text numberOfLines={1} style={styles.timeDate}>{formatGuideDate(time)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>

          {categoriesStatus === 'loading' && !rows.length ? (
            <GuideLoadingPanel label="Loading guide categories…" />
          ) : status === 'loading' && !rows.length ? (
            <GuideLoadingPanel label="Loading guide…" />
          ) : !bundle ? (
            // Truly fatal case (per the spec's own "no provider configured" example): no
            // provider bundle exists at all, so there is no category rail content, no
            // channels, nothing else usable on this screen. This is the one state that
            // still warrants a full blocking panel with its Retry auto-focused, since
            // there is genuinely nothing else to focus.
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name="alert-circle-outline" size={32} color={theme.colors.warning} />
              <Text style={styles.stateTitle}>Guide unavailable</Text>
              <Text style={styles.stateCopy}>{errorMessage ?? 'No EPG data is available for this provider right now.'}</Text>
              <Pressable
                ref={retryRef}
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Retry Guide"
                {...(stateActionFocusProps ?? {})}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={handleRetry}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
                <Text style={[styles.retryText, focusedAction === 'retry' && styles.retryTextFocused]}>Retry</Text>
              </Pressable>
            </View>
          ) : status === 'empty' ? (
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name="television-off" size={32} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>No channels available</Text>
              <Text style={styles.stateCopy}>Your provider did not return any channels for the Guide.</Text>
              <Pressable
                ref={emptyStateActionRef}
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Retry Guide"
                {...(stateActionFocusProps ?? {})}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={handleRetry}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
                <Text style={[styles.retryText, focusedAction === 'retry' && styles.retryTextFocused]}>Retry</Text>
              </Pressable>
            </View>
          ) : status === 'no-favorites' ? (
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name="star-off-outline" size={32} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>No favorite channels yet</Text>
              <Text style={styles.stateCopy}>Open All Channels and press and hold OK on a channel to add it to Favorites.</Text>
              <Pressable
                ref={emptyStateActionRef}
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Browse all Guide channels"
                {...(stateActionFocusProps ?? {})}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={() => handleSelectCategory('all')}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <Text style={[styles.retryText, focusedAction === 'retry' && styles.retryTextFocused]}>Browse all channels</Text>
              </Pressable>
            </View>
          ) : status === 'error' && !filteredRows.length ? (
            // A transient fetch failure with zero channels loaded. The "Guide data
            // unavailable" corner toast (see the effect above) carries the message;
            // this is just a modest placeholder for the empty row area — no giant
            // blocking panel, no focus stolen from the category rail. Retry remains
            // on the empty/unavailable panels and via category reselection.
            <View style={styles.inlineStateNotice}>
              <MaterialCommunityIcons name="cloud-off-outline" size={22} color={theme.colors.textMuted} />
              <Text style={styles.inlineStateText}>No channels to display right now.</Text>
            </View>
          ) : !filteredRows.length ? (
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name="magnify-close" size={32} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>No Guide matches</Text>
              <Text style={styles.stateCopy}>Try a different channel or program name.</Text>
              <Pressable
                ref={emptyStateActionRef}
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Clear Guide search"
                {...(stateActionFocusProps ?? {})}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={() => setSearchQuery('')}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <Text style={[styles.retryText, focusedAction === 'retry' && styles.retryTextFocused]}>Clear search</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.rowsHost}>
              {isRefreshing ? (
                <View pointerEvents="none" style={styles.refreshOverlay}>
                  <NovaSpaceLoader label="Updating guide…" variant="inline" />
                </View>
              ) : null}
              <FlatList
              ref={rowsRef}
              data={filteredRows}
              keyExtractor={(item) => item.channel.id}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              persistentScrollbar={false}
              style={styles.rowsList}
              contentContainerStyle={styles.rows}
              removeClippedSubviews={false}
              windowSize={7}
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={40}
              getItemLayout={(_, index) => ({ length: GUIDE_ROW_HEIGHT, offset: GUIDE_ROW_HEIGHT * index, index })}
              onEndReached={() => {
                if (hasMore) void loadMore();
              }}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={styles.loadingMoreWrap}>
                    <NovaSpaceLoader label="Loading more channels…" variant="inline" />
                  </View>
                ) : !hasMore && selectedCategoryTotalCount != null && selectedCategoryTotalCount > filteredRows.length ? (
                  <Text style={styles.loadingMoreText}>
                    Showing first {filteredRows.length} channels — pick a category to browse more.
                  </Text>
                ) : null
              }
              onScroll={(event) => {
                rememberGuideMemory(activeProviderId, { verticalOffset: event.nativeEvent.contentOffset.y });
              }}
              scrollEventThrottle={100}
              onScrollToIndexFailed={(info) => {
                rowsRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              }}
              renderItem={({ item, index }) => {
                const firstProgram = item.programs[0];
                const channelDisplayName = decodeDisplayTextEntities(item.channel.name ?? '') || item.channel.name;
                const firstProgramHandle = firstProgram ? getHandle(programRefs.current[programKey(item.channel.id, firstProgram.id)]) : undefined;
                const ownChannelHandle = getHandle(channelRefs.current[item.channel.id]);
                const previousChannelHandle = getHandle(channelRefs.current[filteredRows[index - 1]?.channel.id]);
                const nextChannelHandle = getHandle(channelRefs.current[filteredRows[index + 1]?.channel.id]);
                const nextChannelTarget =
                  nextChannelHandle ?? ownChannelHandle;
                return (
                  <View style={styles.guideRow}>
                    <GuideLocalFocusPressable
                      pressableRef={getChannelRefCallback(item.channel.id)}
                      focusable
                      accessibilityRole="button"
                      accessibilityLabel={`Channel ${channelDisplayName}`}
                      hasTVPreferredFocus={!preferredFocusConsumedRef.current && !preferredProgramKey && index === 0}
                      nextFocusRight={firstProgramHandle ?? ownChannelHandle}
                      nextFocusUp={previousChannelHandle}
                      nextFocusDown={nextChannelTarget}
                      onFocus={() => {
                        preferredFocusConsumedRef.current = true;
                        latestFocusRef.current = {
                          ...latestFocusRef.current,
                          channelId: item.channel.id,
                        };
                        rememberGuideMemory(activeProviderId, { focusedChannelId: item.channel.id });
                      }}
                      onPress={() => tuneChannel(item)}
                      onLongPress={() => toggleChannelFavorite(item)}
                      style={[styles.channelCell, novaTvFocus.base]}
                      focusedStyle={styles.channelCellFocused}>
                      {(focused) => (
                        <>
                          <Text style={[styles.channelNumber, focused && styles.channelNumberFocused]}>{item.channel.number || '—'}</Text>
                          <ChannelLogo channel={item.channel} />
                          <View style={styles.channelCopy}>
                            <Text numberOfLines={1} style={[styles.channelName, focused && styles.channelNameFocused]}>{channelDisplayName}</Text>
                            <Text style={[styles.channelMeta, focused && styles.channelMetaFocused]}>
                              {item.programs.length ? `${item.programs.length} programs` : 'No schedule data'}
                            </Text>
                          </View>
                          {favoriteIds.has(item.channel.id) ? <MaterialCommunityIcons name="star" size={15} color={theme.colors.accentHover} /> : null}
                        </>
                      )}
                    </GuideLocalFocusPressable>

                    <ScrollView
                      ref={(ref) => {
                        rowScrollRefs.current[item.channel.id] = ref;
                      }}
                      horizontal
                      focusable={false}
                      showsHorizontalScrollIndicator={false}
                      showsVerticalScrollIndicator={false}
                      persistentScrollbar={false}
                      style={styles.programScroller}
                      contentContainerStyle={[styles.programRow, { minWidth: timelineWidth }]}
                      onScroll={(event) => {
                        if (latestFocusRef.current.channelId === item.channel.id) {
                          syncHorizontalOffset(event.nativeEvent.contentOffset.x, item.channel.id);
                        }
                      }}
                      scrollEventThrottle={100}>
                      {item.programs.length ? item.programs.map((program, programIndex) => {
                        const key = programKey(item.channel.id, program.id);
                        const selected = guideState.selectedProgramId === program.id && guideState.selectedChannelId === item.channel.id;
                        const previous = item.programs[programIndex - 1];
                        const next = item.programs[programIndex + 1];
                        const up = getProgramFocusTarget(index, program, 'up');
                        const down = getProgramFocusTarget(index, program, 'down');
                        const ownHandle = getHandle(programRefs.current[key]);
                        const left = getHandle(programRefs.current[previous ? programKey(item.channel.id, previous.id) : '']) ?? getHandle(channelRefs.current[item.channel.id]);
                        const right = getHandle(programRefs.current[next ? programKey(item.channel.id, next.id) : '']) ?? ownHandle;
                        const downTarget = down ? getHandle(down) : ownHandle;
                        const programStatus = getProgramStatus(program);
                        return (
                          <GuideLocalFocusPressable
                            key={key}
                            pressableRef={getProgramRefCallback(key)}
                            focusable
                            hasTVPreferredFocus={preferredProgramKey === key}
                            nextFocusLeft={left}
                            nextFocusRight={right}
                            nextFocusUp={up ? getHandle(up) : ownHandle}
                            nextFocusDown={downTarget}
                            onFocus={() => focusProgram(index, item, program, programIndex)}
                            onPress={() => tuneProgram(item, program)}
                            style={[
                              styles.programCell,
                              novaTvFocus.base,
                              {
                                width: getProgramWidth(program),
                                marginLeft: programIndex === 0
                                  ? getProgramOffset(program, timeline.startAt)
                                  : previous?.endAt !== undefined && program.startAt !== undefined
                                    ? Math.max(
                                      0,
                                      getProgramOffset(program, timeline.startAt) -
                                        getProgramOffset({ startAt: previous.endAt }, timeline.startAt),
                                    )
                                    : 0,
                              },
                              programStatus === 'past' && styles.programPast,
                              programStatus === 'live' && styles.programLive,
                              programStatus === 'unknown' && styles.programUnknown,
                              selected && styles.programSelected,
                            ]}
                            focusedStyle={styles.programCellFocused}>
                            {(focused) => (
                              <>
                                <View style={styles.programTopline}>
                                  {programStatus === 'live' ? <Text style={styles.liveLabel}>LIVE</Text> : null}
                                  <Text numberOfLines={1} style={[styles.programMeta, focused && styles.programMetaFocused]}>{program.meta}</Text>
                                </View>
                                <Text numberOfLines={2} style={[styles.programTitle, focused && styles.programTitleFocused]}>{program.title}</Text>
                              </>
                            )}
                          </GuideLocalFocusPressable>
                        );
                      }) : (
                        <View style={[styles.noProgramCell, { width: 280 }]}>
                          <Text style={styles.noProgramText}>No schedule data</Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                );
              }}
            />
            </View>
          )}
          </View>
        </View>

        <WalkthroughOverlay
          key={guide.visible ? 'guide-guide-open' : 'guide-guide-closed'}
          visible={guide.visible}
          title={ONBOARDING_GUIDES.guide.title}
          steps={ONBOARDING_GUIDES.guide.steps}
          onDismiss={guide.dismiss}
          onSkip={guide.skip}
          onDontShowAgain={guide.dontShowAgain}
          onComplete={guide.complete}
        />
      </View>
    </NovaTvShell>
  );
}

function createStyles(
  theme: NovaTheme,
  channelWidth: number = GUIDE_CHANNEL_COLUMN_WIDTH,
  categoryWidth: number = 264,
) {
  const light = theme.scheme === 'light';
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  const guideFocusChrome = StyleSheet.create({
    active: {
      borderWidth: 2,
      backgroundColor: 'rgba(112, 70, 255, 0.32)',
      borderColor: 'rgba(150, 95, 255, 0.95)',
      borderRadius: 10,
      shadowColor: '#784DFF',
      shadowOpacity: 0.48,
      shadowRadius: 10,
      elevation: 5,
    },
  });

  return StyleSheet.create({
    screen: { flex: 1, minHeight: 0 },
    toolbar: {
      position: 'absolute',
      top: -36,
      right: 0,
      zIndex: 10,
      height: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 8,
      backgroundColor: light ? 'rgba(3, 8, 20, 0.92)' : 'rgba(2, 7, 18, 0.94)',
    },
    toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionButton: {
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: light ? 'rgba(9, 15, 32, 0.72)' : 'rgba(6, 12, 28, 0.74)',
      paddingHorizontal: 11,
      paddingVertical: 5,
    },
    actionText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '800' },
    actionTextFocused: focusText.title,
    searchBox: {
      minHeight: 32,
      width: 230,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      paddingLeft: 4,
    },
    searchScopeHint: { flexShrink: 1, maxWidth: 220, color: theme.colors.textMuted, fontSize: 10, fontWeight: '600' },
    searchInput: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 12, paddingVertical: 5 },
    iconButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 0,
      backgroundColor: 'transparent',
    },
    guideFrame: {
      flex: 1,
      minHeight: 0,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: light ? 'rgba(9, 15, 30, 0.86)' : 'rgba(4, 9, 22, 0.88)',
      overflow: 'hidden',
    },
    guideBody: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 8 },
    categoriesPanel: {
      width: categoryWidth,
      minHeight: 0,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: light ? 'rgba(9, 15, 30, 0.82)' : 'rgba(4, 9, 22, 0.84)',
      overflow: 'hidden',
    },
    panelHeader: {
      height: 32,
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      paddingHorizontal: 12,
    },
    guideHeaderRow: {
      height: 42,
      maxHeight: 42,
      flexDirection: 'row',
      alignItems: 'stretch',
      flexGrow: 0,
      flexShrink: 0,
    },
    channelHeader: {
      width: channelWidth,
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: light ? 'rgba(3, 8, 20, 0.78)' : 'rgba(2, 7, 18, 0.82)',
      paddingHorizontal: 10,
    },
    headerLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
    headerHint: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
    timeHeader: {
      flex: 1,
      flexGrow: 0,
      flexShrink: 1,
      height: 42,
      maxHeight: 42,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: light ? 'rgba(3, 8, 20, 0.8)' : 'rgba(2, 7, 18, 0.84)',
    },
    timeHeaderContent: { flexDirection: 'row', alignItems: 'center', flexGrow: 0 },
    timeSlot: {
      width: GUIDE_TIME_SLOT_MINUTES * GUIDE_PIXELS_PER_MINUTE,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 4,
    },
    timeText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
    timeDate: { marginTop: 1, color: theme.colors.textMuted, fontSize: 9, fontWeight: '600', opacity: 0.7 },
    rowsList: { flex: 1, minHeight: 0 },
    rows: { paddingBottom: 6 },
    loadingMoreText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', paddingVertical: 12, textAlign: 'center' },
    loadingMoreWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
    loadingPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
    rowsHost: { flex: 1, minHeight: 0, position: 'relative' },
    refreshOverlay: {
      position: 'absolute',
      top: 8,
      right: 12,
      zIndex: 2,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: light ? 'rgba(243, 238, 228, 0.92)' : 'rgba(6, 12, 24, 0.82)',
    },
    guideRow: { height: GUIDE_ROW_HEIGHT, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.borderSubtle },
    channelCell: {
      width: channelWidth,
      height: GUIDE_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 6,
      overflow: 'hidden',
      backgroundColor: light ? 'rgba(3, 7, 18, 0.5)' : 'rgba(2, 6, 16, 0.55)',
    },
    channelCellFocused: guideFocusChrome.active,
    channelNumber: { width: 24, color: theme.colors.textMuted, fontSize: 10, textAlign: 'center' },
    channelNumberFocused: focusText.count,
    channelLogo: {
      width: 27,
      height: 27,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    channelLogoFallback: { alignItems: 'center', justifyContent: 'center' },
    channelLogoText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
    channelCopy: { flex: 1, minWidth: 0 },
    channelName: { color: theme.colors.textPrimary, fontSize: 12, lineHeight: 14, fontWeight: '800' },
    channelNameFocused: focusText.title,
    channelMeta: { marginTop: 1, color: theme.colors.textMuted, fontSize: 8 },
    channelMetaFocused: focusText.secondary,
    programScroller: { flex: 1, minWidth: 0, backgroundColor: light ? 'rgba(14, 22, 46, 0.34)' : 'rgba(12, 20, 44, 0.36)' },
    programRow: { height: GUIDE_ROW_HEIGHT, minHeight: GUIDE_ROW_HEIGHT, paddingRight: 6 },
    programCell: {
      height: GUIDE_ROW_HEIGHT,
      minHeight: GUIDE_ROW_HEIGHT,
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 8,
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    programCellFocused: guideFocusChrome.active,
    programTopline: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, minWidth: 0 },
    programTitle: { color: theme.colors.textPrimary, fontSize: 11, lineHeight: 14, fontWeight: '800' },
    programTitleFocused: focusText.title,
    programMeta: { flexShrink: 1, color: theme.colors.textMuted, fontSize: 8, lineHeight: 10, fontWeight: '700' },
    programMetaFocused: focusText.secondary,
    liveLabel: { color: theme.colors.success, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
    programPast: { opacity: 0.62 },
    programLive: { backgroundColor: 'rgba(59,130,246,0.12)', borderRightColor: theme.colors.borderSubtle },
    programUnknown: { backgroundColor: theme.colors.surfaceMuted },
    programSelected: { backgroundColor: 'rgba(112,70,255,0.18)' },
    noProgramCell: { height: GUIDE_ROW_HEIGHT, justifyContent: 'center', paddingHorizontal: 10 },
    noProgramText: { color: theme.colors.textMuted, fontSize: 12, fontStyle: 'italic' },
    statePanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 24 },
    stateTitle: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800' },
    stateCopy: { maxWidth: 500, color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
    inlineStateNotice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
    inlineStateText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    retryButton: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
    },
    retryText: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '800' },
    retryTextFocused: focusText.title,
    textFocusActive: guideFocusChrome.active,
  });
}
