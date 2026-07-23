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
  View,
} from 'react-native';

import { NovaSpaceLoader, NovaTvShell, novaTvFocus } from '@/components/nova';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { toggleLiveFavorite, usePersonalizationStore } from '@/features/personalization/personalizationStore';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { GuideCategoryRail } from './GuideCategoryRail';
import {
  focusGuideProgramAt,
  createInitialGuideState,
  GUIDE_NOTIFICATION_DURATION_MS,
  GUIDE_NOTIFICATION_ID,
  resolveGuideNotificationForStatus,
  selectGuideProgram,
  shouldAcceptGuideTune,
} from './guideLogic';
import { filterGuideRows, type GuideFilter } from './guideSearch';
import { ingestGuideRows } from '@/features/search/repositories/guideSearchRepository';
import { getGuideMemory, rememberGuideMemory } from './guideMemory';
import {
  findProgramForTimestamp,
  findVerticalProgram,
  formatGuideDate,
  formatGuideTime,
  formatRelativeGuideTime,
  getProgramOffset,
  getProgramStatus,
  getProgramWidth,
  GUIDE_CHANNEL_COLUMN_WIDTH,
  GUIDE_MIN_PROGRAM_WIDTH,
  GUIDE_PIXELS_PER_MINUTE,
  GUIDE_TIME_SLOT_MINUTES,
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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const { state: personalizationState } = usePersonalizationStore(activeProviderId);
  const selectedCategoryName = categories.find((category) => category.id === selectedCategoryId)?.name ?? '';
  const [guideState, setGuideState] = useState(() => ({
    ...createInitialGuideState(
      guideMemory.focusedChannelId ?? 'channel-0',
      guideMemory.focusedProgramId ?? 'channel-0-0',
    ),
    focusedTimestamp: guideMemory.focusedTimestamp,
  }));
  const [filter, setFilter] = useState<GuideFilter>(guideMemory.filter);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(guideMemory.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [focusedAction, setFocusedAction] = useState<'jump' | 'search' | 'filter' | 'favorite' | 'clear' | 'retry' | null>(null);
  const rowsRef = useRef<FlatList<NormalizedGuideRow>>(null);
  const timelineHeaderRef = useRef<ScrollView>(null);
  const rowScrollRefs = useRef<Record<string, ScrollView | null>>({});
  const channelRefs = useRef<Record<string, Focusable | null>>({});
  const programRefs = useRef<Record<string, Focusable | null>>({});
  const jumpRef = useRef<Focusable | null>(null);
  const searchRef = useRef<Focusable | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const filterRef = useRef<Focusable | null>(null);
  const favoriteRef = useRef<Focusable | null>(null);
  const retryRef = useRef<Focusable | null>(null);
  const emptyStateActionRef = useRef<Focusable | null>(null);
  const categoryRailItemRefs = useRef<Record<string, Focusable | null>>({});
  const categoryRailFocusedRef = useRef(false);
  const nowRef = useRef(0);
  const lastTuneRef = useRef<{ key: string; at: number } | null>(null);
  const lastRetryAtRef = useRef(0);
  /** Set once the user retries; cleared on a successful load or a category change. Drives whether a repeated error toast becomes persistent. */
  const guideRetryAttemptedRef = useRef(false);
  const [favoriteHandle, setFavoriteHandle] = useState<number | undefined>();
  const [stateActionHandle, setStateActionHandle] = useState<number | undefined>();
  const [horizontalOffset, setHorizontalOffset] = useState(guideMemory.horizontalOffset);
  const [focusGraphRevision, setFocusGraphRevision] = useState(0);
  const focusGraphFrameRef = useRef<number | null>(null);
  const programRefCallbacks = useRef<Record<string, (instance: Focusable | null) => void>>({});
  const channelRefCallbacks = useRef<Record<string, (instance: Focusable | null) => void>>({});
  const initialFocusProviderRef = useRef<string | null>(null);

  const favoriteIds = useMemo(
    () => new Set(personalizationState.liveFavorites.map((item) => item.contentId)),
    [personalizationState.liveFavorites],
  );
  const filteredRows = useMemo(
    () => filterGuideRows(rows, filter, favoriteIds, deferredSearchQuery),
    [deferredSearchQuery, favoriteIds, filter, rows],
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
    const focused = filteredRows.some((row) => row.channel.id === guideState.focusedChannelId && row.programs.some((program) => programKey(row.channel.id, program.id) === guideState.focusedProgramId));
    if (focused) return programKey(guideState.focusedChannelId ?? '', guideState.focusedProgramId ?? '');
    const first = filteredRows[0]?.programs[0];
    return first && filteredRows[0] ? programKey(filteredRows[0].channel.id, first.id) : null;
  }, [filteredRows, guideState.focusedChannelId, guideState.focusedProgramId]);
  const focusedRow = filteredRows.find((row) => row.channel.id === guideState.focusedChannelId) ?? filteredRows[0];
  const focusedProgram = focusedRow?.programs.find((program) => programKey(focusedRow.channel.id, program.id) === guideState.focusedProgramId) ?? focusedRow?.programs[0];
  const focusedIsFavorite = Boolean(focusedRow && favoriteIds.has(focusedRow.channel.id));
  const focusedProgramTime = focusedProgram?.startAt
    ? `${formatGuideTime(focusedProgram.startAt)}${focusedProgram.endAt ? ` - ${formatGuideTime(focusedProgram.endAt)}` : ''}`
    : '';

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
      setFavoriteHandle(findNodeHandle(favoriteRef.current) ?? undefined);
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
      filter,
      searchQuery,
    });
  }, [activeProviderId, filter, guideState, searchQuery]);

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
  }, [filteredRows.length, filter, status]);

  useEffect(() => {
    if (status === 'ready') {
      guideRetryAttemptedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'ready' || !rows.length) return;
    const frame = requestAnimationFrame(() => {
      rowsRef.current?.scrollToOffset({ offset: guideMemory.verticalOffset, animated: false });
      timelineHeaderRef.current?.scrollTo({ x: guideMemory.horizontalOffset, animated: false });
      Object.values(rowScrollRefs.current).forEach((rowScrollRef) => {
        rowScrollRef?.scrollTo({ x: guideMemory.horizontalOffset, animated: false });
      });
      setHorizontalOffset(guideMemory.horizontalOffset);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeProviderId, guideMemory.horizontalOffset, guideMemory.verticalOffset, rows.length, status]);

  useEffect(() => {
    if (status !== 'ready' || !filteredRows.length || initialFocusProviderRef.current === activeProviderId) return;

    const targetKey = preferredProgramKey;
    const cancel = focusNativeViewWhenReady(
      () => (targetKey ? programRefs.current[targetKey] : jumpRef.current),
      () => {
        if (!targetKey || programRefs.current[targetKey]) {
          initialFocusProviderRef.current = activeProviderId;
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

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) return true;

      if (searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        requestAnimationFrame(() => searchRef.current?.focus());
        return true;
      }

      if (filter !== 'all') {
        setFilter('all');
        requestAnimationFrame(() => filterRef.current?.focus());
        return true;
      }

      if (!categoryRailFocusedRef.current) {
        requestAnimationFrame(() => focusCategoryRail());
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) return true;
      router.replace(TV_HOME_ROUTE);
      return true;
    });

    return () => subscription.remove();
  }, [filter, focusCategoryRail, guide.visible, router, searchOpen]);

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
    const nextOffset = Math.max(0, Math.round(offset));
    setHorizontalOffset(nextOffset);
    rememberGuideMemory(activeProviderId, { horizontalOffset: nextOffset });
    timelineHeaderRef.current?.scrollTo({ x: nextOffset, animated: false });
    Object.entries(rowScrollRefs.current).forEach(([channelId, rowScrollRef]) => {
      if (channelId !== sourceChannelId) {
        rowScrollRef?.scrollTo({ x: nextOffset, animated: false });
      }
    });
  };

  const scrollToProgram = (rowIndex: number, channelId: string, timestamp: number) => {
    rowsRef.current?.scrollToIndex({ index: rowIndex, animated: true, viewPosition: 0.5 });
    const x = Math.max(0, ((timestamp - timeline.startAt) / 60_000) * GUIDE_PIXELS_PER_MINUTE - 110);
    syncHorizontalOffset(x, channelId);
    rowScrollRefs.current[channelId]?.scrollTo({ x, animated: true });
    timelineHeaderRef.current?.scrollTo({ x, animated: true });
  };

  const focusProgram = (rowIndex: number, row: NormalizedGuideRow, program: NormalizedGuideProgram, programIndex: number) => {
    const timestamp = getProgramTimestamp(program, programIndex);
    setGuideState((current) => focusGuideProgramAt(current, row.channel.id, program.id, timestamp));
    scrollToProgram(rowIndex, row.channel.id, timestamp);
  };

  const focusJumpTarget = (rowIndex: number, row: NormalizedGuideRow, program: NormalizedGuideProgram | null) => {
    if (!program) {
      requestAnimationFrame(() => channelRefs.current[row.channel.id]?.focus());
      return;
    }

    const key = programKey(row.channel.id, program.id);
    setGuideState((current) => focusGuideProgramAt(current, row.channel.id, program.id, program.startAt ?? Date.now()));
    scrollToProgram(rowIndex, row.channel.id, program.startAt ?? Date.now());
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

  const toggleFocusedFavorite = async () => {
    if (!focusedRow) return;
    await toggleLiveFavorite(activeProviderId, focusedRow.channel);
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
      actionLabel: 'Retry',
      onAction: handleRetry,
      duration: GUIDE_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'guide',
    });
  }, [bundle, dismissNotification, handleRetry, showNotification, status]);

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

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <NovaTvShell
      activeId="guide"
      title="Guide"
      subtitle="Browse the timeline without tuning until you press OK."
      providerLabel={selectedProviderLabel}
      preferActiveNavigationFocus={false}>
      <View style={styles.screen}>
        <View style={styles.toolbar}>
          <View style={styles.dateBlock}>
            <Text style={styles.dateEyebrow}>TV GUIDE</Text>
            <Text style={styles.dateText}>{todayLabel}</Text>
          </View>
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
                <Text style={styles.actionText}>Search</Text>
              </Pressable>
            ) : null}
            <Pressable
              ref={filterRef}
              focusable
              accessibilityRole="button"
              accessibilityLabel={filter === 'favorites' ? 'Show all guide channels' : 'Show favorite guide channels'}
              onFocus={() => setFocusedAction('filter')}
              onBlur={() => setFocusedAction(null)}
              onPress={() => setFilter((current) => (current === 'all' ? 'favorites' : 'all'))}
              style={[styles.actionButton, novaTvFocus.base, filter === 'favorites' && styles.actionSelected, focusedAction === 'filter' && styles.textFocusActive]}>
              <MaterialCommunityIcons name={filter === 'favorites' ? 'star' : 'star-outline'} size={18} color={theme.colors.accentHover} />
              <Text style={[styles.actionText, filter === 'favorites' && styles.actionTextSelected]}>
                {filter === 'favorites' ? 'Favorites' : 'All channels'}
              </Text>
            </Pressable>
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
              <Text style={styles.actionText}>Jump to Now</Text>
            </Pressable>
          </View>
        </View>

        <GuideCategoryRail
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelect={handleSelectCategory}
          onFocusChange={(focused) => {
            categoryRailFocusedRef.current = focused;
          }}
          registerItemRef={registerCategoryRailItemRef}
        />

        <View style={styles.guideFrame}>
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
            style={styles.timeHeader}
            contentContainerStyle={[styles.timeHeaderContent, { width: timelineWidth }]}>
            {timeSlots.map((time) => (
              <View key={time} style={styles.timeSlot}>
                <Text style={styles.timeText}>{formatGuideTime(time)}</Text>
                <Text style={styles.timeDate}>{formatGuideDate(time)}</Text>
              </View>
            ))}
          </ScrollView>

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
                <Text style={styles.retryText}>Retry</Text>
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
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : status === 'no-favorites' ? (
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name="star-off-outline" size={32} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>No favorite channels yet</Text>
              <Text style={styles.stateCopy}>Focus a channel in All Channels, then use the star action below to add it.</Text>
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
                <Text style={styles.retryText}>Browse all channels</Text>
              </Pressable>
            </View>
          ) : status === 'error' && !filteredRows.length ? (
            // A transient fetch failure with zero channels loaded. The "Guide data
            // unavailable" corner toast (see the effect above) carries the real message
            // and the Retry action; this is just a modest placeholder for the empty row
            // area — no giant blocking panel, no focus stolen from the category rail.
            <View style={styles.inlineStateNotice}>
              <MaterialCommunityIcons name="cloud-off-outline" size={22} color={theme.colors.textMuted} />
              <Text style={styles.inlineStateText}>No channels to display right now.</Text>
            </View>
          ) : !filteredRows.length ? (
            <View style={styles.statePanel}>
              <MaterialCommunityIcons name={filter === 'favorites' ? 'star-off-outline' : 'magnify-close'} size={32} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>{filter === 'favorites' ? 'No favorite channels' : 'No Guide matches'}</Text>
              <Text style={styles.stateCopy}>
                {filter === 'favorites' ? 'Focus a channel, then use the star action below to add it.' : 'Try a different channel or program name.'}
              </Text>
              <Pressable
                ref={emptyStateActionRef}
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Show all Guide channels"
                {...(stateActionFocusProps ?? {})}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={() => {
                  setFilter('all');
                  setSearchQuery('');
                }}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <Text style={styles.retryText}>Show all channels</Text>
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
              contentContainerStyle={styles.rows}
              removeClippedSubviews={false}
              windowSize={5}
              initialNumToRender={6}
              maxToRenderPerBatch={6}
              updateCellsBatchingPeriod={40}
              onEndReached={() => {
                if (hasMore) void loadMore();
              }}
              onEndReachedThreshold={0.7}
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
                const firstProgramHandle = firstProgram ? getHandle(programRefs.current[programKey(item.channel.id, firstProgram.id)]) : undefined;
                const previousChannelHandle = getHandle(channelRefs.current[filteredRows[index - 1]?.channel.id]);
                const nextChannelHandle = getHandle(channelRefs.current[filteredRows[index + 1]?.channel.id]);
                return (
                  <View style={styles.guideRow}>
                    <Pressable
                      ref={getChannelRefCallback(item.channel.id)}
                      focusable
                      accessibilityRole="button"
                      accessibilityLabel={`Channel ${item.channel.name}`}
                      hasTVPreferredFocus={!preferredProgramKey && index === 0}
                      {...(firstProgramHandle ? { nextFocusRight: firstProgramHandle } : null)}
                      {...(previousChannelHandle ? { nextFocusUp: previousChannelHandle } : null)}
                      {...(nextChannelHandle ? { nextFocusDown: nextChannelHandle } : null)}
                      onFocus={() => {
                        setGuideState((current) => ({ ...current, focusedChannelId: item.channel.id }));
                      }}
                      onPress={() => tuneChannel(item)}
                      style={[styles.channelCell, novaTvFocus.base, guideState.focusedChannelId === item.channel.id && styles.channelCellFocused]}>
                      <Text style={styles.channelNumber}>{item.channel.number || '—'}</Text>
                      <ChannelLogo channel={item.channel} />
                      <View style={styles.channelCopy}>
                        <Text numberOfLines={1} style={styles.channelName}>{item.channel.name}</Text>
                        <Text style={styles.channelMeta}>{item.programs.length ? `${item.programs.length} programs` : 'No program information'}</Text>
                      </View>
                      {favoriteIds.has(item.channel.id) ? <MaterialCommunityIcons name="star" size={15} color={theme.colors.accentHover} /> : null}
                    </Pressable>

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
                        if (guideState.focusedChannelId === item.channel.id) {
                          syncHorizontalOffset(event.nativeEvent.contentOffset.x, item.channel.id);
                        }
                      }}
                      scrollEventThrottle={100}>
                      {item.programs.length ? item.programs.map((program, programIndex) => {
                        const key = programKey(item.channel.id, program.id);
                        const focused = guideState.focusedProgramId === program.id && guideState.focusedChannelId === item.channel.id;
                        const selected = guideState.selectedProgramId === program.id && guideState.selectedChannelId === item.channel.id;
                        const previous = item.programs[programIndex - 1];
                        const next = item.programs[programIndex + 1];
                        const up = getProgramFocusTarget(index, program, 'up');
                        const down = getProgramFocusTarget(index, program, 'down');
                        const ownHandle = getHandle(programRefs.current[key]);
                        const left = getHandle(programRefs.current[previous ? programKey(item.channel.id, previous.id) : '']) ?? getHandle(channelRefs.current[item.channel.id]);
                        const right = getHandle(programRefs.current[next ? programKey(item.channel.id, next.id) : '']) ?? ownHandle;
                        const downTarget = down ? getHandle(down) : index === filteredRows.length - 1 ? favoriteHandle : ownHandle;
                        const programStatus = getProgramStatus(program);
                        return (
                          <Pressable
                            key={key}
                            ref={getProgramRefCallback(key)}
                            focusable
                            {...(left ? { nextFocusLeft: left } : null)}
                            {...(right ? { nextFocusRight: right } : null)}
                            {...(up ? { nextFocusUp: getHandle(up) } : ownHandle ? { nextFocusUp: ownHandle } : null)}
                            {...(downTarget ? { nextFocusDown: downTarget } : null)}
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
                              focused && styles.programCellFocused,
                              selected && styles.programSelected,
                            ]}>
                            <View style={styles.programTopline}>
                              {programStatus === 'live' ? <Text style={styles.liveLabel}>LIVE</Text> : null}
                              <Text numberOfLines={1} style={styles.programMeta}>{program.meta}</Text>
                            </View>
                            <Text numberOfLines={2} style={styles.programTitle}>{program.title}</Text>
                          </Pressable>
                        );
                      }) : (
                        <View style={[styles.noProgramCell, { width: timelineWidth }]}>
                          <Text style={styles.noProgramText}>No program information available.</Text>
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

        <View style={styles.detailsPanel}>
          <View style={styles.detailsCopy}>
            <Text style={styles.detailsEyebrow}>{focusedProgram ? getProgramStatus(focusedProgram).toUpperCase() : 'PROGRAM DETAILS'}</Text>
            <Text numberOfLines={1} style={styles.detailsTitle}>{focusedProgram?.title ?? 'Select a program'}</Text>
            <Text numberOfLines={1} style={styles.detailsMeta}>
              {focusedRow?.channel.name ?? 'Choose a channel'}
              {focusedProgramTime ? `  •  ${focusedProgramTime}` : ''}
              {focusedProgram ? `  •  ${formatRelativeGuideTime(focusedProgram) ?? 'EPG timing unavailable'}` : ''}
            </Text>
            {focusedProgram?.description ? <Text numberOfLines={1} style={styles.detailsDescription}>{focusedProgram.description}</Text> : null}
          </View>
          <Pressable
            ref={favoriteRef}
            focusable
            accessibilityRole="button"
            accessibilityLabel={focusedIsFavorite ? 'Remove channel from favorites' : 'Add channel to favorites'}
            onFocus={() => setFocusedAction('favorite')}
            onBlur={() => setFocusedAction(null)}
            onPress={() => void toggleFocusedFavorite()}
            style={[styles.favoriteButton, novaTvFocus.base, focusedAction === 'favorite' && styles.textFocusActive]}>
            <MaterialCommunityIcons name={focusedIsFavorite ? 'star' : 'star-outline'} size={20} color={theme.colors.accentHover} />
            <Text style={styles.actionText}>{focusedIsFavorite ? 'Favorited' : 'Favorite channel'}</Text>
          </Pressable>
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

function createStyles(theme: NovaTheme) {
  const light = theme.scheme === 'light';

  return StyleSheet.create({
    screen: { flex: 1, minHeight: 0, gap: 10 },
    toolbar: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
    dateBlock: { gap: 2, flex: 1 },
    dateEyebrow: { color: theme.colors.accentHover, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
    dateText: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800' },
    toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionButton: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    actionSelected: {
      borderBottomColor: theme.colors.success,
    },
    actionText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '800' },
    actionTextSelected: { color: theme.colors.accentHover },
    searchBox: {
      minHeight: 38,
      width: 260,
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
      borderRadius: 0,
      borderWidth: 0,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    },
    channelHeader: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: GUIDE_CHANNEL_COLUMN_WIDTH,
      height: 49,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      paddingHorizontal: 15,
      zIndex: 3,
    },
    headerLabel: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
    headerHint: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
    timeHeader: {
      marginLeft: GUIDE_CHANNEL_COLUMN_WIDTH,
      height: 49,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
    },
    timeHeaderContent: { flexDirection: 'row' },
    timeSlot: {
      width: GUIDE_TIME_SLOT_MINUTES * GUIDE_PIXELS_PER_MINUTE,
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 8,
    },
    timeText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '800' },
    timeDate: { marginTop: 2, color: theme.colors.textMuted, fontSize: 9 },
    rows: { paddingBottom: 12 },
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
    guideRow: { height: 60, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.borderSubtle },
    channelCell: {
      width: GUIDE_CHANNEL_COLUMN_WIDTH,
      height: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 8,
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    channelCellFocused: light
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          shadowColor: theme.colors.accentHover,
          shadowOpacity: 0.9,
          shadowRadius: 9,
        },
    channelNumber: { width: 28, color: theme.colors.textMuted, fontSize: 11, textAlign: 'center' },
    channelLogo: {
      width: 32,
      height: 32,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    channelLogoFallback: { alignItems: 'center', justifyContent: 'center' },
    channelLogoText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
    channelCopy: { flex: 1, minWidth: 0 },
    channelName: { color: theme.colors.textPrimary, fontSize: 13, lineHeight: 16, fontWeight: '800' },
    channelMeta: { marginTop: 3, color: theme.colors.textMuted, fontSize: 9 },
    programScroller: { flex: 1, minWidth: 0 },
    programRow: { height: 60, minHeight: 60, paddingRight: 8 },
    programCell: {
      height: 60,
      minHeight: 60,
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingHorizontal: 10,
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    programCellFocused: light
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          borderColor: theme.colors.focusRing,
          backgroundColor: 'transparent',
          shadowColor: theme.colors.accentHover,
          shadowOpacity: 0.9,
          shadowRadius: 9,
        },
    programTopline: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, minWidth: 0 },
    programTitle: { color: theme.colors.textPrimary, fontSize: 12, lineHeight: 16, fontWeight: '800' },
    programMeta: { flexShrink: 1, color: theme.colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: '700' },
    liveLabel: { color: theme.colors.success, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
    programPast: { opacity: 0.62 },
    programLive: { backgroundColor: 'rgba(59,130,246,0.12)', borderRightColor: theme.colors.borderSubtle },
    programUnknown: { backgroundColor: theme.colors.surfaceMuted },
    programSelected: { backgroundColor: 'rgba(59,130,246,0.08)' },
    noProgramCell: { height: 60, justifyContent: 'center', paddingHorizontal: 12 },
    noProgramText: { color: theme.colors.textMuted, fontSize: 12, fontStyle: 'italic' },
    detailsPanel: {
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 18,
      borderRadius: 0,
      borderWidth: 0,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    detailsCopy: { flex: 1, minWidth: 0 },
    detailsEyebrow: { color: theme.colors.accentHover, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
    detailsTitle: { marginTop: 3, color: theme.colors.textPrimary, fontSize: 16, fontWeight: '900' },
    detailsMeta: { marginTop: 3, color: theme.colors.textSecondary, fontSize: 11 },
    detailsDescription: { marginTop: 3, color: theme.colors.textMuted, fontSize: 10 },
    favoriteButton: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
    },
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
    textFocusActive: light
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          shadowColor: theme.colors.accentHover,
          shadowOpacity: 0.9,
          shadowRadius: 9,
        },
  });
}
