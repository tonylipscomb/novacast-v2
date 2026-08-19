// TODO(stage-live): migrate preview/fullscreen playback to useUnifiedPlayer via UnifiedPlayerHost.
/* eslint-disable react-hooks/refs -- Android TV focus restoration, list handles, and Animated values are intentionally imperative. */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getTvDensity, NovaSpaceLoader, NovaTvShell, novaTvFocus, createNovaTvFocusChrome } from '@/components/nova';
import { usePlaybackActivity } from '@/features/playback/usePlaybackActivity';
import type { PlayingChangeEventPayload, TimeUpdateEventPayload } from 'expo-video';
import { NovaStreamSurface, useNovaStreamPlayer } from '@/features/playback/NovaStreamPlayer';
import type { PlaybackItem } from '@/features/playback/unified/types';
import { playbackAnalyticsTracker } from '@/features/analytics/playbackAnalytics';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import {
  chooseLiveChannel,
  closeLiveFullscreen,
  createInitialLiveTvState,
  createLiveTvLandingState,
  createLiveTvShellState,
  focusLiveChannel,
  surfLiveFullscreenChannel,
  LIVE_TV_LOAD_NOTIFICATION_ID,
  LIVE_TV_NOTIFICATION_DURATION_MS,
  LIVE_TV_PREVIEW_NOTIFICATION_ID,
  resolveLivePreview,
  resolveLiveTvNotificationForStatus,
  resolveLiveTvPreviewNotification,
  selectLiveCategory,
  type LiveTvState,
} from './liveTvLogic';
import { shouldAcceptLiveTvOkPress, type LiveTvOkPressRecord } from './liveTvOkDedup';
import {
  decideLiveTvBackAction,
  didFullscreenJustClose,
  didFullscreenJustOpen,
  isChannelPressEnteringFullscreen,
  type FullscreenLaunchSource,
} from './liveTvFocusRestoration';
import {
  FULLSCREEN_FIRST_FRAME_TIMEOUT_MS,
  shouldKeepPreviewAlive,
  shouldShowFullscreenFallback,
  shouldShowFullscreenLoadingOverlay,
  type FullscreenFrameStatus,
} from './liveTvPlaybackReadiness';
import {
  FULLSCREEN_CHROME_AUTO_HIDE_MS,
  shouldAutoHideFullscreenChrome,
  shouldRenderFullscreenChrome,
} from './liveTvFullscreenChrome';
import { LiveTvCategoryRow } from './LiveTvCategoryRow';
import { LiveTvProgramDetailPanel } from './LiveTvProgramDetailPanel';
import { LiveTvChannelList } from './LiveTvChannelList';
import { formatLiveTvCategoryCount } from './liveTvCategoryCount';
import type { LiveTvChannelRowShellData } from './liveTvChannelRowData';
import { getLiveTvMemory, rememberLiveTvMemory } from './liveTvMemory';
import { sanitizePersistedLiveCategoryId } from '@/features/providers/liveCategoryIdSafety';
import {
  recordRecentItem,
  toggleLiveFavorite,
  usePersonalizationStore,
} from '@/features/personalization/personalizationStore';
import {
  recordLiveTvChannelTune,
  recordLiveTvMemorySync,
  recordLiveTvManualScroll,
  recordLiveTvScreenRender,
} from './liveTvScrollPerf';
import {
  PREVIEW_FOCUS_DEBOUNCE_MS,
  shouldClearPreviewStreamUrl,
} from './liveTvPreviewScheduling';
import {
  shouldLoadCategoryOnFocusAlone,
} from './liveTvFocusPreview';
import {
  recordLiveTvFocusEvent,
} from './liveTvFocusDiagnostics';
import { LiveTvFocusRouter, type LiveTvFocusRouterHandle } from './LiveTvFocusRouter';
import { logLiveSelection } from './liveTvSelectionDiagnostics';
import {
  LIVE_SURF_OVERLAY_HIDE_MS,
  createLiveSurfSessionId,
  logLiveSurf,
  resolveLiveSurfAdjacent,
  shouldApplyLiveSurfResolution,
} from './liveTvSurf';
import {
  LIVE_CHANNEL_SURF_DEBOUNCE_MS,
  shouldHandleLiveChannelSurf,
} from '@/features/playback/continuity/playbackContinuity';
import { getLiveTvRowVisualFlags } from './liveTvUiPerfMode';
import { favoriteSurfQueueIds, hydrateFavoriteLiveChannels } from './liveFavoriteHydration';
import { logLivePerformance } from './liveTvDiagnostics';
import { LiveTvChannelListReveal, LiveTvPlanetLoader } from './LiveTvPlanetLoader';
import {
  logLiveChannelPanelLoader,
  resolveLiveChannelPanelLoaderKind,
  shouldShowLiveChannelPanelLoader,
} from './liveTvChannelPanelLoader';
import { patchLiveTvWorkload } from './liveTvWorkload';
import { cancelLiveTvEpgWork } from './liveTvChannelEpg';
import { cancelLiveSearchCatalogBuild } from '@/features/search/liveSearchSqliteCatalog';
import { useLiveTvScreenModel } from './useLiveTvScreenModel';
import { getLiveChannelIndexEntry } from '@/features/search/liveChannelIndex';
import { displayLiveProgramText, isRawLiveStreamValue } from './liveTvProgramText';
import {
  isLiveSearchUiBlockingSurf,
  mergeLiveSearchPlaybackChannels,
  buildLiveSearchResultIds,
  createLiveSearchBrowseSnapshot,
  decideLiveSearchScreenBack,
  getLastLiveSearchBackConsumedAtMs,
  logLiveSearchBack,
  markLiveSearchBackConsumed,
  resolveLivePlaybackChannel,
  resolveLiveSearchSurfQueue,
  restoreLiveSearchBrowseState,
  shouldKeepLiveSearchMounted,
  shouldLiveSearchBlockBackgroundFocus,
  shouldRestoreLiveBrowseFocusAfterFullscreen,
  shouldShowLiveSearchOverlay,
  suppressLiveSearchOverlayClose,
  toLiveSearchPlaybackChannel,
  type LiveSearchBrowseSnapshot,
  type LiveSearchPlaybackChannel,
} from './liveTvSearchSession';
import { logLiveSearchFocus } from '@/features/search/liveSearchResultsScroll';
import { SearchOverlay } from '@/features/search/SearchOverlay';
import { DiscoverZoneOverlay } from '@/features/personalization/DiscoverZoneOverlay';
import { searchLiveChannels } from '@/features/search/repositories/liveSearchRepository';
import type { LiveSearchResult, SearchResult } from '@/features/search/searchTypes';
import { MovieToolbar } from '@/features/movies/components/MovieToolbar';

const androidTextFit = Platform.OS === 'android' ? ({ includeFontPadding: false } as const) : {};

function formatPreviewWindow(channel: ProviderLiveChannel | null) {
  if (!channel) {
    return 'Unknown schedule';
  }

  if (!channel.currentStart && !channel.currentEnd) {
    return 'Live';
  }

  if (isRawLiveStreamValue(channel.currentStart) || isRawLiveStreamValue(channel.currentEnd)) {
    return 'Live';
  }

  return `${channel.currentStart} - ${channel.currentEnd}`;
}

function ChannelLogoBadge({
  channel,
  styles,
}: {
  channel: ProviderLiveChannel | null | undefined;
  styles: ReturnType<typeof createStyles>;
}) {
  if (channel?.logoUrl) {
    return (
      <View style={styles.previewLogoBadge}>
        <Image source={{ uri: channel.logoUrl }} style={styles.previewLogoImage} contentFit="contain" />
      </View>
    );
  }

  return (
    <View style={styles.previewLogoBadge}>
      <Text style={styles.previewLogoText}>{channel?.shortName ?? 'TV'}</Text>
    </View>
  );
}

export function LiveTvScreen() {
  recordLiveTvScreenRender();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ categoryId?: string | string[]; channelId?: string | string[]; returnRoute?: string | string[]; directPlay?: string | string[] }>();
  const { width, height } = useWindowDimensions();
  const tvDensity = getTvDensity(width);
  const navigationGateRef = useRef(createTvNavigationGate());
  // search-live-directplay-v1
  const directPlayConsumedRef = useRef(false);
  const { selectedProvider, selectedProviderLabel, selectedProviderExpiration } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const { state: personalizationState } = usePersonalizationStore(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.liveTv.key);
  const liveMemory = getLiveTvMemory(activeProviderId);
  const routeCategoryId = typeof routeParams.categoryId === 'string' ? routeParams.categoryId : undefined;
  const routeChannelId = typeof routeParams.channelId === 'string' ? routeParams.channelId : undefined;
  const returnRoute =
    routeParams.returnRoute === 'guide'
      ? '/guide'
      : routeParams.returnRoute === 'search'
        ? '/search'
        : TV_HOME_ROUTE;
  const directPlayRequested =
    routeParams.returnRoute === 'search' &&
    routeParams.directPlay === '1' &&
    Boolean(routeChannelId && routeCategoryId);
  const {
    bundle,
    status: loadStatus,
    errorMessage: loadErrorMessage,
    categories,
    categoryTotalCount,
    channels,
    selectedCategoryId,
    channelListPending,
    selectCategory: loadCategoryChannels,
    enrichFocusedChannelEpg,
    resolvePlaybackUrl,
    reload,
    initialChannel,
  } = useLiveTvScreenModel(
    sanitizePersistedLiveCategoryId(routeCategoryId ?? liveMemory.selectedCategoryId),
    routeChannelId ?? liveMemory.selectedChannelId,
  );
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const liveRetryAttemptedRef = useRef(false);
  const livePreviewRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const liveStateRef = useRef<LiveTvState | null>(null);
  const [interactionState, setState] = useState<LiveTvState | null>(null);
  const [previewStreamUrl, setPreviewStreamUrl] = useState<string | null>(null);
  const [fullscreenFrameStatus, setFullscreenFrameStatus] = useState<FullscreenFrameStatus>('pending');
  const [fullscreenChromeVisible, setFullscreenChromeVisible] = useState(true);
  const [focusedAction, setFocusedAction] = useState<'favorite' | 'fullscreen' | 'retry' | 'search' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [discoverZoneOpen, setDiscoverZoneOpen] = useState(false);
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
  const [searchRestoreChannelId, setSearchRestoreChannelId] = useState<string | null>(null);
  const [searchCloseFocusHold, setSearchCloseFocusHold] = useState(false);
  const searchToolbarRef = useRef<View | null>(null);
  const searchCloseHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSearchBrowseSnapshotRef = useRef<LiveSearchBrowseSnapshot | null>(null);
  const liveSearchResultIdsRef = useRef<string[]>([]);
  const liveSearchSurfQueueRef = useRef<string[] | null>(null);
  const liveSearchSelectedIdRef = useRef<string | null>(null);
  const liveSearchPlaybackByIdRef = useRef<Map<string, LiveSearchPlaybackChannel>>(new Map());
  const [fullscreenRetryNodeTag, setFullscreenRetryNodeTag] = useState<number | null>(null);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapState = useMemo(() => {
    if (!channels.length) {
      return null;
    }

    const categoryId = selectedCategoryId || channels[0]?.categoryId || '';
    const channelId = initialChannel?.id ?? channels[0]?.id ?? '';
    // Search direct-play still bootstraps an explicit preview so the existing
    // ready → tuneChannel fullscreen path can run. Normal open stays idle.
    if (directPlayRequested) {
      return createInitialLiveTvState(categoryId, channelId);
    }
    return createLiveTvLandingState(categoryId, channelId);
  }, [channels, directPlayRequested, initialChannel, selectedCategoryId]);
  const liveState = interactionState ?? bootstrapState;
  liveStateRef.current = liveState;
  const shellLiveState = useMemo(() => {
    if (categories.length === 0) {
      return null;
    }

    const categoryId = selectedCategoryId || categories[0]?.id || '';
    return createLiveTvShellState(categoryId);
  }, [categories, selectedCategoryId]);
  const renderState = liveState ?? shellLiveState;
  const searchOverlayVisible = shouldShowLiveSearchOverlay({
    searchSessionOpen: searchOpen,
    fullscreenChannelId: liveState?.fullscreenChannelId,
  });
  const showChannelPanelLoader = shouldShowLiveChannelPanelLoader({
    channelListPending,
    loadStatus,
    channelCount: channels.length,
    searchOverlayVisible,
    fullscreenActive: Boolean(liveState?.fullscreenChannelId),
  });
  const searchOwnsBackgroundFocus = shouldLiveSearchBlockBackgroundFocus(searchOverlayVisible, searchCloseFocusHold);
  const searchOpenRef = useRef(false);
  const searchOverlayVisibleRef = useRef(false);
  searchOpenRef.current = searchOpen;
  searchOverlayVisibleRef.current = searchOverlayVisible;
  const wasFullscreenRef = useRef(false);
  const hadReadyChannelListRef = useRef(false);
  const channelLoaderShownAtRef = useRef(0);
  const channelLoaderVisibleRef = useRef(false);
  const channelLoaderKindRef = useRef<'initial' | 'category'>('initial');
  if (channels.length > 0 && loadStatus === 'ready') {
    hadReadyChannelListRef.current = true;
  }

  useEffect(() => {
    if (showChannelPanelLoader === channelLoaderVisibleRef.current) {
      return;
    }

    if (showChannelPanelLoader) {
      const kind = resolveLiveChannelPanelLoaderKind({
        channelListPending,
        channelCount: channels.length,
        hadReadyChannelList: hadReadyChannelListRef.current,
      });
      channelLoaderKindRef.current = kind;
      channelLoaderShownAtRef.current = Date.now();
      logLiveChannelPanelLoader({
        event: kind === 'initial' ? 'initial-loader-shown' : 'category-loader-shown',
        categoryIdPresent: Boolean(selectedCategoryId),
        channelCount: channels.length,
      });
    } else {
      const kind = channelLoaderKindRef.current;
      const durationMs = channelLoaderShownAtRef.current ? Date.now() - channelLoaderShownAtRef.current : 0;
      logLiveChannelPanelLoader({
        event: kind === 'initial' ? 'initial-loader-hidden' : 'category-loader-hidden',
        categoryIdPresent: Boolean(selectedCategoryId),
        channelCount: channels.length,
        durationMs,
      });
    }
    channelLoaderVisibleRef.current = showChannelPanelLoader;
  }, [channelListPending, channels.length, selectedCategoryId, showChannelPanelLoader]);

  useEffect(() => {
    patchLiveTvWorkload(
      {
        activeScreen: 'live',
        fullscreenActive: Boolean(liveState?.fullscreenChannelId),
        searchOverlayVisible,
      },
      { log: true, reason: 'live-screen-flags' },
    );
    if (searchOverlayVisible || liveState?.fullscreenChannelId) {
      cancelLiveTvEpgWork(searchOverlayVisible ? 'search-overlay' : 'fullscreen');
    }
  }, [liveState?.fullscreenChannelId, searchOverlayVisible]);

  useEffect(() => {
    return () => {
      patchLiveTvWorkload(
        {
          activeScreen: 'other',
          fullscreenActive: false,
          searchOverlayVisible: false,
          searchImeActive: false,
          surfTransitionInFlight: false,
        },
        { log: true, reason: 'live-screen-unmount' },
      );
    };
  }, []);

  const previousLiveProviderIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextId = bundle?.providerId ?? '';
    const previousId = previousLiveProviderIdRef.current;
    if (previousId && previousId !== nextId) {
      cancelLiveSearchCatalogBuild(previousId);
    }
    previousLiveProviderIdRef.current = nextId || null;
  }, [bundle?.providerId]);
  useEffect(() => {
    const isFullscreen = Boolean(liveState?.fullscreenChannelId);
    if (wasFullscreenRef.current && !isFullscreen && !searchOpenRef.current) {
      liveSearchSurfQueueRef.current = null;
    }
    wasFullscreenRef.current = isFullscreen;
  }, [liveState?.fullscreenChannelId]);
  const fullscreenChannelIdRef = useRef<string | null>(null);
  useEffect(() => {
    fullscreenChannelIdRef.current = liveState?.fullscreenChannelId ?? null;
  }, [liveState?.fullscreenChannelId]);
  const { player: liveStreamPlayer, retry: retryLiveStream, hasStream: hasLiveStream } = useNovaStreamPlayer(
    previewStreamUrl,
    {
      onError: () => {
        setFullscreenFrameStatus((current) =>
          fullscreenChannelIdRef.current && current !== 'ready' ? 'error' : current,
        );
      },
    },
  );

  const streamSurfaceInFullscreen = Boolean(liveState?.fullscreenChannelId);
  const livePreviewActive = Boolean(
    liveState?.previewChannelId &&
      !streamSurfaceInFullscreen &&
      (liveState?.previewStatus === 'loading' || liveState?.previewStatus === 'ready'),
  );
  usePlaybackActivity('live-fullscreen', streamSurfaceInFullscreen);
  usePlaybackActivity('live-preview', livePreviewActive);
  const previousFullscreenOpenIdRef = useRef<string | null>(null);
  if (liveState?.fullscreenChannelId !== previousFullscreenOpenIdRef.current) {
    previousFullscreenOpenIdRef.current = liveState?.fullscreenChannelId ?? null;
    if (liveState?.fullscreenChannelId && fullscreenFrameStatus !== 'pending') {
      setFullscreenFrameStatus('pending');
    }
  }

  const selectedChannel = useMemo(
    () =>
      resolveLivePlaybackChannel(liveState?.selectedChannelId, channels, liveSearchPlaybackByIdRef.current) ??
      channels[0] ??
      null,
    [channels, liveState?.selectedChannelId],
  );
  const previewChannel = useMemo(
    () =>
      resolveLivePlaybackChannel(liveState?.previewChannelId, channels, liveSearchPlaybackByIdRef.current) ??
      selectedChannel,
    [channels, selectedChannel, liveState?.previewChannelId],
  );
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(
    liveMemory.focusedChannelId ?? null,
  );
  const focusedChannel = useMemo(
    () => channels.find((channel) => channel.id === focusedChannelId) ?? null,
    [channels, focusedChannelId],
  );
  const rowVisualFlags = getLiveTvRowVisualFlags();
  const frozenPreviewChannelRef = useRef<ProviderLiveChannel | null>(null);
  const frozenPreviewChannelIdRef = useRef<string | null>(null);
  if (
    rowVisualFlags.freezeDetailPanel &&
    liveState?.previewChannelId &&
    frozenPreviewChannelIdRef.current !== liveState.previewChannelId
  ) {
    frozenPreviewChannelIdRef.current = liveState.previewChannelId;
    frozenPreviewChannelRef.current = previewChannel;
  }
  if (!rowVisualFlags.freezeDetailPanel) {
    frozenPreviewChannelIdRef.current = null;
    frozenPreviewChannelRef.current = null;
  }
  const detailPanelChannel = rowVisualFlags.freezeDetailPanel
    ? frozenPreviewChannelRef.current ?? previewChannel
    : (focusedChannel ?? selectedChannel ?? previewChannel);
  const detailChannelIsFavorite = personalizationState.liveFavorites.map((item) => item.contentId).includes(detailPanelChannel?.id ?? '');
  const liveFavoriteContentIds = useMemo(
    () => new Set(personalizationState.liveFavorites.map((item) => item.contentId)),
    [personalizationState.liveFavorites],
  );
  const fullscreenChannel = useMemo(
    () => resolveLivePlaybackChannel(liveState?.fullscreenChannelId, channels, liveSearchPlaybackByIdRef.current),
    [channels, liveState?.fullscreenChannelId],
  );
  const livePlaybackItem = useMemo<PlaybackItem | null>(() => {
    if (!fullscreenChannel || !previewStreamUrl) {
      return null;
    }
    return {
      id: fullscreenChannel.id,
      mediaType: 'live',
      title: fullscreenChannel.name,
      streamUrl: previewStreamUrl,
      isLive: true,
      providerId: activeProviderId,
    };
  }, [activeProviderId, fullscreenChannel, previewStreamUrl]);
  const previousAnalyticsFullscreenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = liveState?.fullscreenChannelId ?? null;
    const previousId = previousAnalyticsFullscreenIdRef.current;
    if (currentId && currentId !== previousId && livePlaybackItem) {
      playbackAnalyticsTracker.request(livePlaybackItem, 'channel');
    }
    if (!currentId && previousId) {
      playbackAnalyticsTracker.stop('user_back');
    }
    previousAnalyticsFullscreenIdRef.current = currentId;
  }, [livePlaybackItem, liveState?.fullscreenChannelId]);
  const categoriesRef = useRef<FlatList<ProviderLiveCategory>>(null);
  const channelsRef = useRef<FlatList<LiveTvChannelRowShellData>>(null);
  // Native refs for imperative focus restoration when fullscreen closes.
  // hasTVPreferredFocus only applies at mount time and cannot re-target an
  // already-mounted row/button, so restoring real Android TV focus after an
  // overlay unmounts requires calling .focus() directly on these refs.
  const channelRowRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const categoryRowRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [categoryNextFocusRightHandle, setCategoryNextFocusRightHandle] = useState<number | undefined>();
  const focusedChannelIdRef = useRef<string | null>(liveMemory.focusedChannelId ?? null);
  const [categoryFocusEpoch, setCategoryFocusEpoch] = useState(0);
  const watchButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenCloseButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenLaunchSourceRef = useRef<FullscreenLaunchSource>(null);
  const previousFullscreenChannelIdRef = useRef<string | null>(null);
  const isRestoringFullscreenFocusRef = useRef(false);
  const fullscreenRetryButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenRetryFocusKeyRef = useRef<string | null>(null);
  const fullscreenInteractionRef = useRef<ElementRef<typeof View>>(null);
  const lastChannelOkPressRef = useRef<LiveTvOkPressRecord | null>(null);
  const preferredCategoryFocusId = useRef(liveMemory.focusedCategoryId ?? categories[0]?.id ?? null);
  const preferredChannelFocusId = useRef(liveMemory.focusedChannelId ?? channels[0]?.id ?? null);
  const preferCategoryFocusRef = useRef(true);
  const preferChannelFocusRef = useRef(true);
  const surfSessionIdRef = useRef<string | null>(null);
  const intendedSurfChannelIdRef = useRef<string | null>(null);

  const registerFullscreenRetryButtonRef = useCallback((instance: ElementRef<typeof View> | null) => {
    fullscreenRetryButtonRef.current = instance;
    const nextTag = instance ? findNodeHandle(instance) : null;
    setFullscreenRetryNodeTag((current) => (current === nextTag ? current : nextTag));
  }, []);

  const syncLiveTvMemory = useCallback(() => {
    if (!liveState) {
      return;
    }

    recordLiveTvMemorySync();
    rememberLiveTvMemory(activeProviderId, {
      selectedCategoryId: liveState.selectedCategoryId,
      selectedChannelId: liveState.selectedChannelId,
      focusedCategoryId: preferredCategoryFocusId.current,
      focusedChannelId: preferredChannelFocusId.current,
    });
  }, [activeProviderId, liveState]);

  const refreshBoundaryFocusHandles = useCallback(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const selectedCategoryId = liveStateRef.current?.selectedCategoryId;
    const categoryRef = selectedCategoryId ? categoryRowRefs.current.get(selectedCategoryId) : null;
    const nextLeft = categoryRef ? findNodeHandle(categoryRef) ?? undefined : undefined;
    setCategoryFocusLeftHandle((current) => (current === nextLeft ? current : nextLeft));

    const channelId = preferredChannelFocusId.current ?? channels[0]?.id ?? null;
    const channelRef = channelId ? channelRowRefs.current.get(channelId) : null;
    const nextRight = channelRef ? findNodeHandle(channelRef) ?? undefined : undefined;
    setCategoryNextFocusRightHandle((current) => (current === nextRight ? current : nextRight));
  }, [channels]);

  const registerChannelRowRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    if (instance) {
      channelRowRefs.current.set(channelId, instance);
    } else {
      channelRowRefs.current.delete(channelId);
    }
  }, []);

  const registerCategoryRowRef = useCallback((categoryId: string, instance: ElementRef<typeof View> | null) => {
    if (instance) {
      categoryRowRefs.current.set(categoryId, instance);
    } else {
      categoryRowRefs.current.delete(categoryId);
    }
  }, []);

  useEffect(() => {
    if (!liveState || liveState.previewStatus !== 'loading' || !liveState.previewChannelId) {
      return;
    }

    const channelId = liveState.previewChannelId;
    const requestId = liveState.previewRequestId;
    const channel = resolveLivePlaybackChannel(channelId, channels, liveSearchPlaybackByIdRef.current);
    const timer = setTimeout(() => {
      const latest = liveStateRef.current;
      const surfSessionActive = Boolean(surfSessionIdRef.current && latest?.fullscreenChannelId);
      if (
        !latest ||
        latest.previewRequestId !== requestId ||
        latest.previewChannelId !== channelId ||
        (surfSessionActive &&
          !shouldApplyLiveSurfResolution({
            requestId,
            latestRequestId: latest.previewRequestId,
            toChannelId: channelId,
            latestChannelId: intendedSurfChannelIdRef.current,
          }))
      ) {
        if (surfSessionActive) {
          logLiveSurf({
            event: 'stale-transition-dropped',
            toChannelId: channelId,
            fromChannelId: latest?.fullscreenChannelId ?? latest?.previewChannelId ?? null,
            requestId,
            surfSessionId: surfSessionIdRef.current,
          });
        }
        logLiveSelection('stale-preview-ignored', {
          focusedChannelId: focusedChannelIdRef.current,
          activePreviewChannelId: latest?.previewChannelId ?? null,
          actionSource: 'preview-resolve',
          requestToken: requestId,
        });
        return;
      }

      const playbackUrl = resolvePlaybackUrl(channel);
      if (!playbackUrl) {
        setPreviewStreamUrl(null);
        setState((current) =>
          resolveLivePreview(current ?? latest, requestId, channelId, 'error', 'This channel is unavailable right now.'),
        );
        return;
      }

      setPreviewStreamUrl(playbackUrl);
      if (surfSessionActive) {
        logLiveSurf({
          event: 'source-resolved',
          toChannelId: channelId,
          requestId,
          surfSessionId: surfSessionIdRef.current,
        });
      }
      logLiveSelection('preview-active', {
        focusedChannelId: focusedChannelIdRef.current,
        activePreviewChannelId: channelId,
        actionSource: 'preview-resolve',
        requestToken: requestId,
      });
      setState((current) => resolveLivePreview(current ?? latest, requestId, channelId, 'ready'));
    }, PREVIEW_FOCUS_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  // The request id and preview channel fields are the intentional debounce
  // boundary; the full state object would restart the timer on every update.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keep preview debounce scoped to its request fields.
  }, [channels, resolvePlaybackUrl, liveState?.previewChannelId, liveState?.previewRequestId, liveState?.previewStatus]);

  useEffect(() => {
    if (liveState?.previewStatus === 'idle' || !liveState?.previewChannelId) {
      setPreviewStreamUrl(null);
    }
  }, [liveState?.previewChannelId, liveState?.previewStatus]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'live-screen',
        () => {
          if (guide.visible) {
            return true;
          }

          const nowMs = Date.now();
          const lastConsumedAtMs = getLastLiveSearchBackConsumedAtMs();
          const searchBack = decideLiveSearchScreenBack({
            searchSessionOpen: searchOpenRef.current,
            overlayVisible: searchOverlayVisibleRef.current,
            fullscreenActive: Boolean(fullscreenChannelIdRef.current),
            nowMs,
            lastConsumedAtMs,
          });
          logLiveSearchBack({
            event: 'live-back-received',
            overlayVisible: searchOverlayVisibleRef.current,
            fullscreenActive: Boolean(fullscreenChannelIdRef.current),
            restoreFocusLiveChannelId: liveSearchSelectedIdRef.current,
            timestampDeltaMs: lastConsumedAtMs > 0 ? nowMs - lastConsumedAtMs : null,
            source: 'LiveTvScreen',
          });

          if (searchBack.action === 'suppress-duplicate') {
            logLiveSearchBack({
              event: 'back-suppressed-duplicate',
              overlayVisible: searchOverlayVisibleRef.current,
              fullscreenActive: Boolean(fullscreenChannelIdRef.current),
              timestampDeltaMs: lastConsumedAtMs > 0 ? nowMs - lastConsumedAtMs : null,
              source: 'LiveTvScreen',
            });
            return true;
          }

          if (searchBack.action === 'swallow-leave-screen') {
            logLiveSearchBack({
              event: 'back-suppressed-duplicate',
              overlayVisible: searchOverlayVisibleRef.current,
              fullscreenActive: false,
              focusedRegion: 'live-browse',
              source: 'LiveTvScreen-search-owns-back',
            });
            return true;
          }

          const action = decideLiveTvBackAction(
            fullscreenChannelIdRef.current,
            isRestoringFullscreenFocusRef.current,
          );

          if (action === 'close-fullscreen') {
            if (searchOpenRef.current) {
              suppressLiveSearchOverlayClose(nowMs);
              markLiveSearchBackConsumed(nowMs);
            }
            if (directPlayRequested) {
              playbackAnalyticsTracker.stop('user_back');
              router.replace(returnRoute);
              return true;
            }
            setState((current) => closeLiveFullscreen(current ?? liveState ?? bootstrapState ?? createInitialLiveTvState('', '')));
            return true;
          }

          if (action === 'swallow') {
            // Native focus is still being restored onto the control that launched
            // fullscreen (bounded animation frames via requestTvFocus).
            // fullscreenChannelId is already cleared at this instant, so without this
            // guard a stray/rapid second Back during that brief window would open the
            // Content Hub instead of leaving focus to settle on this screen.
            return true;
          }

          if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
            return true;
          }

          router.replace(returnRoute);
          return true;
        },
        () => ({
          screen: 'LiveTvScreen',
          guideVisible: guide.visible,
          fullscreenChannelId: fullscreenChannelIdRef.current,
        }),
      ),
    );

    return () => subscription.remove();
  }, [bootstrapState, directPlayRequested, guide.visible, liveState, returnRoute, router]);

  // Imperatively owns native TV focus across both fullscreen transitions,
  // because `hasTVPreferredFocus` is only a mount-time hint: it does not
  // reliably move real Android focus onto newly-shown overlay content when
  // the previously-focused row/button is still mounted underneath (opening),
  // and it cannot re-target an already-mounted screen at all (closing).
  // Leaving either transition to native defaults is what let a stray D-pad
  // press resolve via Android's own fallback focus search instead of the app.
  useEffect(() => {
    const currentFullscreenChannelId = liveState?.fullscreenChannelId ?? null;
    const previousFullscreenChannelId = previousFullscreenChannelIdRef.current;
    previousFullscreenChannelIdRef.current = currentFullscreenChannelId;

    const opening = didFullscreenJustOpen(previousFullscreenChannelId, currentFullscreenChannelId);
    const closing = didFullscreenJustClose(previousFullscreenChannelId, currentFullscreenChannelId);
    if (!opening && !closing) {
      return;
    }

    const targetChannelId = liveState?.selectedChannelId ?? null;
    if (closing && !shouldRestoreLiveBrowseFocusAfterFullscreen(searchOpen)) {
      setSearchRestoreChannelId(liveSearchSelectedIdRef.current ?? targetChannelId);
      isRestoringFullscreenFocusRef.current = true;
      const timer = setTimeout(() => {
        isRestoringFullscreenFocusRef.current = false;
      }, 120);
      return () => clearTimeout(timer);
    }

    const source = fullscreenLaunchSourceRef.current;
    isRestoringFullscreenFocusRef.current = true;

    const cancel = requestTvFocus({
      screen: 'live',
      source: 'LiveTvScreen',
      region: opening ? 'fullscreen-chrome' : 'browse-restore',
      itemId: opening ? currentFullscreenChannelId : targetChannelId,
      reason: opening ? 'fullscreen-open' : 'fullscreen-close-restore',
      getTarget: () => {
        if (opening) {
          return fullscreenCloseButtonRef.current;
        }
        return source === 'button' ? watchButtonRef.current : targetChannelId ? channelRowRefs.current.get(targetChannelId) : null;
      },
      onSettled: () => {
        isRestoringFullscreenFocusRef.current = false;
        if (closing) {
          fullscreenLaunchSourceRef.current = null;
        }
      },
    });

    return cancel;
  }, [liveState?.fullscreenChannelId, liveState?.selectedChannelId, searchOpen]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId || fullscreenFrameStatus !== 'pending') {
      return;
    }

    const timer = setTimeout(() => {
      setFullscreenFrameStatus((current) => (current === 'ready' ? current : 'timeout'));
    }, FULLSCREEN_FIRST_FRAME_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [liveState?.fullscreenChannelId, fullscreenFrameStatus]);

  const handleFullscreenFirstFrame = () => {
    playbackAnalyticsTracker.firstFrame();
    setFullscreenFrameStatus('ready');
  };
  const handleLivePlayerPlayingChange = useCallback(({ isPlaying }: PlayingChangeEventPayload) => {
    if (liveStateRef.current?.fullscreenChannelId && isPlaying && liveStreamPlayer.status === 'readyToPlay') {
      playbackAnalyticsTracker.firstFrame('playing_transition');
    }
  }, [liveStreamPlayer]);
  const handleLivePlayerTimeUpdate = useCallback(({ currentTime }: TimeUpdateEventPayload) => {
    if (
      liveStateRef.current?.fullscreenChannelId &&
      currentTime > 0 &&
      liveStreamPlayer.status === 'readyToPlay' &&
      liveStreamPlayer.playing
    ) {
      playbackAnalyticsTracker.firstFrame('current_time_progress');
    }
  }, [liveStreamPlayer]);
  const retryFullscreenPlayback = () => {
    setFullscreenFrameStatus('pending');
    setFullscreenChromeVisible(true);
    if (livePlaybackItem) {
      playbackAnalyticsTracker.request(livePlaybackItem, 'channel', true);
    }
    retryLiveStream();
  };

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current) {
      clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeHideTimer();
    if (!shouldAutoHideFullscreenChrome(fullscreenFrameStatus)) {
      return;
    }

    chromeHideTimerRef.current = setTimeout(() => {
      setFullscreenChromeVisible(false);
    }, FULLSCREEN_CHROME_AUTO_HIDE_MS);
  }, [clearChromeHideTimer, fullscreenFrameStatus]);

  const revealFullscreenChrome = useCallback(() => {
    setFullscreenChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId) {
      clearChromeHideTimer();
      // Chrome visibility is synchronized with the fullscreen lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this reset prevents stale fullscreen controls after close.
      setFullscreenChromeVisible(true);
      surfSessionIdRef.current = null;
      intendedSurfChannelIdRef.current = null;
      return;
    }

    if (!surfSessionIdRef.current) {
      // Fresh fullscreen open may show chrome; in-session channel surf must not.
      setFullscreenChromeVisible(true);
      surfSessionIdRef.current = createLiveSurfSessionId();
    }
    intendedSurfChannelIdRef.current = liveState.fullscreenChannelId;
  }, [clearChromeHideTimer, liveState?.fullscreenChannelId]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId || !fullscreenChromeVisible) {
      return;
    }

    if (shouldAutoHideFullscreenChrome(fullscreenFrameStatus)) {
      scheduleChromeHide();
    }

    return clearChromeHideTimer;
  }, [
    clearChromeHideTimer,
    fullscreenChromeVisible,
    fullscreenFrameStatus,
    liveState?.fullscreenChannelId,
    scheduleChromeHide,
  ]);

  const showFullscreenChrome = shouldRenderFullscreenChrome(fullscreenChromeVisible, fullscreenFrameStatus);
  const fullscreenFallbackVisible = Boolean(
    liveState?.fullscreenChannelId &&
      fullscreenChannel &&
      hasLiveStream &&
      shouldShowFullscreenFallback(fullscreenFrameStatus),
  );

  useEffect(() => {
    if (!fullscreenFallbackVisible || !liveState?.fullscreenChannelId) {
      fullscreenRetryFocusKeyRef.current = null;
      return;
    }

    if (surfRequestIdRef.current > 0) {
      return;
    }

    const focusKey = `${liveState.fullscreenChannelId}:${fullscreenFrameStatus}`;
    if (fullscreenRetryFocusKeyRef.current === focusKey) {
      return;
    }

    fullscreenRetryFocusKeyRef.current = focusKey;
    return requestTvFocus({
      screen: 'live',
      source: 'LiveTvScreen',
      region: 'fullscreen-retry',
      itemId: liveState.fullscreenChannelId,
      reason: 'fullscreen-fallback-retry',
      getTarget: () => fullscreenRetryButtonRef.current,
    });
  }, [fullscreenFallbackVisible, fullscreenFrameStatus, liveState?.fullscreenChannelId]);

  useEffect(() => {
    syncLiveTvMemory();
  }, [syncLiveTvMemory]);

  const scrollCategoryIntoView = useCallback(
    (categoryId: string) => {
      const index = categories.findIndex((category) => category.id === categoryId);
      if (index < 0) {
        return;
      }

      recordLiveTvManualScroll();
      categoriesRef.current?.scrollToIndex({
        index,
        animated: false,
        viewPosition: 0.45,
      });
    },
    [categories],
  );

  useEffect(() => {
    refreshBoundaryFocusHandles();
  }, [refreshBoundaryFocusHandles, renderState?.selectedCategoryId, renderState?.selectedChannelId, channels.length]);

  const focusCategoryRow = useCallback(
    (categoryId: string) => {
      preferredCategoryFocusId.current = categoryId;
      preferCategoryFocusRef.current = false;
      // Avoid FlatList epoch bumps on every category D-pad move.
    },
    [],
  );

  const focusChannelRow = useCallback(
    (channelId: string) => {
      const previousFocusedId = focusedChannelIdRef.current;
      preferredChannelFocusId.current = channelId;
      focusedChannelIdRef.current = channelId;
      preferChannelFocusRef.current = false;
      recordLiveTvFocusEvent(channelId);
      enrichFocusedChannelEpg(channelId);
      setFocusedChannelId((current) => (current === channelId ? current : channelId));

      if (previousFocusedId !== channelId) {
        logLiveSelection('focus-changed', {
          focusedChannelId: channelId,
          activePreviewChannelId: liveStateRef.current?.previewChannelId ?? null,
          actionSource: 'channel-focus',
        });
      }

      setState((current) => {
        const base = current ?? liveStateRef.current;
        if (!base) {
          return current;
        }
        const next = focusLiveChannel(base, channelId);
        return next === base ? current : next;
      });
    },
    [enrichFocusedChannelEpg],
  );

  const closeLiveSearch = useCallback(() => {
    if (!searchOpenRef.current) {
      return;
    }
    const snapshot = liveSearchBrowseSnapshotRef.current;
    liveSearchSurfQueueRef.current = null;
    liveSearchSelectedIdRef.current = null;
    liveSearchBrowseSnapshotRef.current = null;
    setSearchRestoreChannelId(null);
    setSearchOpen(false);
    searchOpenRef.current = false;
    setSearchOverlayReady(false);
    setSearchCloseFocusHold(true);
    if (searchCloseHoldTimerRef.current) {
      clearTimeout(searchCloseHoldTimerRef.current);
    }
    searchCloseHoldTimerRef.current = setTimeout(() => {
      setSearchCloseFocusHold(false);
    }, 240);
    setState((current) => restoreLiveSearchBrowseState(current ?? liveStateRef.current, snapshot));
    logLiveSearchBack({
      event: 'overlay-close-complete',
      overlayVisible: false,
      searchQueryPresent: false,
      source: 'LiveTvScreen',
    });
    logLiveSearchFocus({
      event: 'close-focus-request',
      overlayVisible: false,
      source: 'LiveTvScreen',
    });

    if (snapshot?.categoryId) {
      scrollCategoryIntoView(snapshot.categoryId);
    }

    requestTvFocus({
      screen: 'live',
      source: 'LiveTvScreen',
      region: 'search-toolbar',
      itemId: 'live-search',
      reason: 'restore-after-search-close',
      getTarget: () => searchToolbarRef.current,
      onSettled: (status) => {
        logLiveSearchFocus({
          event: 'close-focus-confirmed',
          overlayVisible: false,
          source: `LiveTvScreen:${status}`,
        });
        if (searchCloseHoldTimerRef.current) {
          clearTimeout(searchCloseHoldTimerRef.current);
          searchCloseHoldTimerRef.current = null;
        }
        setSearchCloseFocusHold(false);
      },
    });
  }, [scrollCategoryIntoView]);

  const openLiveSearch = useCallback(() => {
    if (searchOpen) {
      closeLiveSearch();
      return;
    }

    liveSearchBrowseSnapshotRef.current = createLiveSearchBrowseSnapshot({
      categoryId: liveStateRef.current?.selectedCategoryId ?? selectedCategoryId,
      channelId: liveStateRef.current?.selectedChannelId ?? null,
    });
    liveSearchSurfQueueRef.current = null;
    setSearchRestoreChannelId(null);
    setSearchOpen(true);
  }, [closeLiveSearch, searchOpen, selectedCategoryId]);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.type !== 'live') {
        return;
      }

      liveSearchSelectedIdRef.current = result.id;
      liveSearchSurfQueueRef.current = liveSearchResultIdsRef.current.slice();
      liveSearchPlaybackByIdRef.current.set(result.id, toLiveSearchPlaybackChannel(result));
      preferredChannelFocusId.current = result.id;
      preferChannelFocusRef.current = true;
      const channel = resolveLivePlaybackChannel(result.id, channels, liveSearchPlaybackByIdRef.current);
      if (channel) {
        void recordRecentItem({
          providerId: activeProviderId,
          mediaType: 'live',
          contentId: channel.id,
          title: channel.name,
          artworkUrl: channel.logoUrl,
          categoryId: channel.categoryId,
        });
      }
      setState((current) => chooseLiveChannel(current ?? liveState ?? createInitialLiveTvState(undefined, result.id), result.id, { origin: 'search' }));
      syncLiveTvMemory();
    },
    [activeProviderId, channels, liveState, syncLiveTvMemory],
  );

  const playFavoriteFromDiscoverZone = useCallback(
    async (channelId: string) => {
      if (!bundle) {
        return;
      }
      const browseCategoryId = selectedCategoryId;
      setDiscoverZoneOpen(false);
      const savedFavoriteIds = [
        ...new Set([
          ...personalizationState.liveFavorites.map((item) => item.contentId).filter(Boolean),
          channelId,
        ]),
      ];
      const hydrated = hydrateFavoriteLiveChannels({
        favoriteIds: savedFavoriteIds,
        loadedChannels: channels,
        getIndexEntry: (id) => getLiveChannelIndexEntry(activeProviderId, id),
        favoriteRecords: personalizationState.liveFavorites,
      });
      const favoriteIds = favoriteSurfQueueIds(savedFavoriteIds, hydrated.channels);
      liveSearchSurfQueueRef.current = favoriteIds;
      preferredChannelFocusId.current = channelId;
      preferChannelFocusRef.current = true;
      for (const favorite of hydrated.channels) {
        liveSearchPlaybackByIdRef.current.set(favorite.id, favorite);
      }
      const channel = resolveLivePlaybackChannel(channelId, channels, liveSearchPlaybackByIdRef.current);
      if (!channel) {
        return;
      }
      void recordRecentItem({
        providerId: activeProviderId,
        mediaType: 'live',
        contentId: channel.id,
        title: channel.name,
        artworkUrl: channel.logoUrl,
        categoryId: channel.categoryId,
      });
      setState((current) =>
        chooseLiveChannel(current ?? liveState ?? createLiveTvLandingState(browseCategoryId, channelId), channelId, {
          origin: 'search',
        }),
      );
      syncLiveTvMemory();
    },
    [activeProviderId, bundle, channels, liveState, personalizationState.liveFavorites, selectedCategoryId, syncLiveTvMemory],
  );

  const selectCategory = (categoryId: string) => {
    liveSearchSurfQueueRef.current = null;
    liveRetryAttemptedRef.current = false;
    preferredCategoryFocusId.current = categoryId;
    setCategoryFocusEpoch((value) => value + 1);
    scrollCategoryIntoView(categoryId);
    void loadCategoryChannels(categoryId).then((nextChannels) => {
      const nextChannelId = nextChannels[0]?.id ?? '';
      preferredCategoryFocusId.current = categoryId;
      preferredChannelFocusId.current = nextChannelId;
      // Category OK must leave the category rail and land in the channel list.
      preferCategoryFocusRef.current = false;
      preferChannelFocusRef.current = Boolean(nextChannelId);
      if (nextChannelId) {
        setFocusedChannelId(nextChannelId);
      }
      setState((current) =>
        current ? selectLiveCategory(current, categoryId, nextChannelId) : createLiveTvLandingState(categoryId, nextChannelId),
      );
      syncLiveTvMemory();
      if (nextChannelId) {
        requestTvFocus({
          screen: 'live',
          source: 'LiveTvScreen',
          region: 'channel-list',
          itemId: nextChannelId,
          reason: 'category-ok-to-channels',
          getTarget: () => channelRowRefs.current.get(nextChannelId),
        });
      }
    });
  };

  const handleCategoryFocus = useCallback(
    (categoryId: string) => {
      focusCategoryRow(categoryId);
      if (shouldLoadCategoryOnFocusAlone()) {
        // Pass 2: category focus must not load/tune/preview.
      }
    },
    [focusCategoryRow],
  );

  const tuneChannel = useCallback(
    (channelId: string) => {
      const now = Date.now();
      if (!shouldAcceptLiveTvOkPress(channelId, lastChannelOkPressRef.current, now)) {
        return;
      }

      lastChannelOkPressRef.current = { channelId, at: now };
      const base = interactionState ?? liveState;
      const nextState = chooseLiveChannel(base ?? createLiveTvLandingState(undefined, channelId), channelId);
      if (isChannelPressEnteringFullscreen(base, channelId)) {
        fullscreenLaunchSourceRef.current = 'channel';
        logLiveSelection('fullscreen-requested', {
          focusedChannelId: focusedChannelIdRef.current,
          activePreviewChannelId: channelId,
          actionSource: 'channel-ok',
          requestToken: nextState.previewRequestId,
        });
      } else if ((base?.previewRequestId ?? 0) !== nextState.previewRequestId) {
        logLiveSelection('preview-requested', {
          focusedChannelId: focusedChannelIdRef.current,
          activePreviewChannelId: channelId,
          actionSource: 'channel-ok',
          requestToken: nextState.previewRequestId,
        });
      }

      recordLiveTvChannelTune();
      preferredChannelFocusId.current = channelId;
      enrichFocusedChannelEpg(channelId);
      const channel = channels.find((item) => item.id === channelId);
      if (channel) {
        void recordRecentItem({
          providerId: activeProviderId,
          mediaType: 'live',
          contentId: channel.id,
          title: channel.name,
          artworkUrl: channel.logoUrl,
          categoryId: channel.categoryId,
        });
      }
      if (shouldClearPreviewStreamUrl(liveState?.previewChannelId ?? null, channelId)) {
        setPreviewStreamUrl(null);
      }
      setState((current) => chooseLiveChannel(current ?? liveState ?? createLiveTvLandingState(undefined, channelId), channelId));
      syncLiveTvMemory();
    },
    [activeProviderId, channels, enrichFocusedChannelEpg, interactionState, liveState, syncLiveTvMemory],
  );

  useEffect(() => {
    if (
      !directPlayRequested ||
      directPlayConsumedRef.current ||
      !routeChannelId ||
      liveState?.selectedChannelId !== routeChannelId ||
      liveState.previewChannelId !== routeChannelId ||
      liveState.previewStatus !== 'ready' ||
      liveState.fullscreenChannelId
    ) {
      return;
    }

    // Reuse the normal Live OK/tune path once the requested channel's preview is actually ready.
    // This preserves normal playback URL resolution, recents, analytics, focus, and fullscreen behavior.
    directPlayConsumedRef.current = true;
    tuneChannel(routeChannelId);
  }, [directPlayRequested, liveState, routeChannelId, tuneChannel]);

  const liveSurfRouterRef = useRef<LiveTvFocusRouterHandle | null>(null);
  const lastSettledSurfRequestIdRef = useRef(0);
  const [surfOverlay, setSurfOverlay] = useState<{ channelId: string; name: string; number?: string } | null>(null);
  const [liveSurfHandles, setLiveSurfHandles] = useState<{
    anchor: number | null;
    left: number | null;
    right: number | null;
  }>({
    anchor: null,
    left: null,
    right: null,
  });
  const surfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfTokenRef = useRef(0);
  const surfRequestIdRef = useRef(0);

  const surfLiveChannel = useCallback(
    (delta: 1 | -1): boolean => {
      if (
        !shouldHandleLiveChannelSurf({
          isLive: true,
          fullscreenActive: Boolean(liveStateRef.current?.fullscreenChannelId),
          modalOpen: isLiveSearchUiBlockingSurf(searchOverlayVisible) || guide.visible,
        })
      ) {
        return false;
      }

      const currentId = liveStateRef.current?.fullscreenChannelId ?? liveStateRef.current?.previewChannelId ?? null;
      const adjacent = resolveLiveSurfAdjacent({
        channelIds: resolveLiveSearchSurfQueue(
          liveSearchSurfQueueRef.current,
          channels.map((channel) => channel.id),
        ),
        currentId,
        direction: delta,
      });
      const requestId = surfRequestIdRef.current + 1;
      surfRequestIdRef.current = requestId;

      if (adjacent.kind === 'noop') {
        logLiveSurf({
          event: 'single-channel-noop',
          direction: delta,
          fromChannelId: adjacent.fromChannelId,
          fromIndex: adjacent.fromIndex,
          toIndex: adjacent.toIndex,
          queueLength: adjacent.queueLength,
          surfSessionId: surfSessionIdRef.current,
          requestId,
        });
        return false;
      }

      patchLiveTvWorkload({ surfTransitionInFlight: true }, { log: true, reason: 'surf-start' });
      cancelLiveTvEpgWork('surf-priority');
      logLiveSurf({
        event: 'adjacent-resolved',
        direction: delta,
        fromChannelId: adjacent.fromChannelId,
        toChannelId: adjacent.toChannelId,
        fromIndex: adjacent.fromIndex,
        toIndex: adjacent.toIndex,
        queueLength: adjacent.queueLength,
        surfSessionId: surfSessionIdRef.current,
        requestId,
      });

      const nextId = adjacent.toChannelId;
      intendedSurfChannelIdRef.current = nextId;
      const nextChannel = resolveLivePlaybackChannel(nextId, channels, liveSearchPlaybackByIdRef.current);
      setSurfOverlay({
        channelId: nextId,
        name: nextChannel?.name ?? 'Channel',
        number: nextChannel?.number ? String(nextChannel.number) : undefined,
      });
      if (surfOverlayTimerRef.current) {
        clearTimeout(surfOverlayTimerRef.current);
      }
      surfOverlayTimerRef.current = setTimeout(() => {
        setSurfOverlay((current) => (current?.channelId === nextId ? null : current));
      }, LIVE_SURF_OVERLAY_HIDE_MS);
      preferredChannelFocusId.current = nextId;
      focusedChannelIdRef.current = nextId;

      if (surfTimerRef.current) {
        clearTimeout(surfTimerRef.current);
      }
      const token = surfTokenRef.current + 1;
      surfTokenRef.current = token;
      surfTimerRef.current = setTimeout(() => {
        if (surfTokenRef.current !== token || intendedSurfChannelIdRef.current !== nextId) {
          logLiveSurf({
            event: 'stale-transition-dropped',
            direction: delta,
            toChannelId: nextId,
            surfSessionId: surfSessionIdRef.current,
            requestId,
          });
          return;
        }
        logLiveSurf({
          event: 'source-requested',
          direction: delta,
          fromChannelId: adjacent.fromChannelId,
          toChannelId: nextId,
          fromIndex: adjacent.fromIndex,
          toIndex: adjacent.toIndex,
          queueLength: adjacent.queueLength,
          surfSessionId: surfSessionIdRef.current,
          requestId,
        });
        logLiveSurf({
          event: 'transition-start',
          direction: delta,
          fromChannelId: adjacent.fromChannelId,
          toChannelId: nextId,
          surfSessionId: surfSessionIdRef.current,
          requestId,
        });
        setState((current) => {
          const base = current ?? liveStateRef.current;
          if (!base) {
            return current;
          }
          if (shouldClearPreviewStreamUrl(base.previewChannelId, nextId)) {
            setPreviewStreamUrl(null);
          }
          return surfLiveFullscreenChannel(base, nextId);
        });
        logLiveSelection('preview-requested', {
          focusedChannelId: nextId,
          activePreviewChannelId: nextId,
          actionSource: 'live-surf',
          requestToken: (liveStateRef.current?.previewRequestId ?? 0) + 1,
        });
      }, LIVE_CHANNEL_SURF_DEBOUNCE_MS);
      return true;
    },
    [channels, guide.visible, searchOverlayVisible],
  );

  const visibleSurfOverlay = surfOverlay;

  useEffect(() => {
    if (
      surfRequestIdRef.current > 0 &&
      liveState?.previewStatus === 'ready' &&
      liveState.fullscreenChannelId &&
      liveState.fullscreenChannelId === intendedSurfChannelIdRef.current &&
      lastSettledSurfRequestIdRef.current !== surfRequestIdRef.current
    ) {
      lastSettledSurfRequestIdRef.current = surfRequestIdRef.current;
      patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-complete' });
      logLiveSurf({
        event: 'transition-complete',
        toChannelId: liveState.fullscreenChannelId,
        surfSessionId: surfSessionIdRef.current,
        requestId: surfRequestIdRef.current,
      });
      liveSurfRouterRef.current?.notifyTransitionSettled();
    }
  }, [liveState?.fullscreenChannelId, liveState?.previewStatus]);

  useEffect(() => {
    if (
      surfRequestIdRef.current > 0 &&
      liveState?.previewStatus === 'error' &&
      liveState.fullscreenChannelId &&
      liveState.fullscreenChannelId === intendedSurfChannelIdRef.current &&
      lastSettledSurfRequestIdRef.current !== surfRequestIdRef.current
    ) {
      lastSettledSurfRequestIdRef.current = surfRequestIdRef.current;
      patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-failed' });
      logLiveSurf({
        event: 'transition-failed',
        toChannelId: liveState.fullscreenChannelId,
        surfSessionId: surfSessionIdRef.current,
        requestId: surfRequestIdRef.current,
      });
      liveSurfRouterRef.current?.notifyTransitionSettled();
    }
  }, [liveState?.fullscreenChannelId, liveState?.previewStatus]);

  const handleLiveSurfSentinelFocus = useCallback(
    (direction: 1 | -1) => {
      const started = surfLiveChannel(direction);
      if (!started) {
        liveSurfRouterRef.current?.notifyTransitionSettled();
      }
    },
    [surfLiveChannel],
  );

  const watchFullScreen = () => {
    if (!liveState?.previewChannelId || liveState.previewStatus !== 'ready') {
      return;
    }

    fullscreenLaunchSourceRef.current = 'button';
    logLiveSelection('fullscreen-requested', {
      focusedChannelId: focusedChannelIdRef.current,
      activePreviewChannelId: liveState.previewChannelId,
      actionSource: 'watch-button',
      requestToken: liveState.previewRequestId,
    });
    setState((current) => {
      const base = current ?? liveState;
      return {
        ...base,
        fullscreenChannelId: base.previewChannelId,
      };
    });
  };

  const executeLiveSearch = useCallback(
    async (request: Parameters<typeof searchLiveChannels>[2]) => {
      const page = await searchLiveChannels(activeProviderId, bundle, request);
      const liveItems = page.items.filter((item): item is LiveSearchResult => item.type === 'live');
      liveSearchResultIdsRef.current = buildLiveSearchResultIds(
        liveItems,
        liveSearchResultIdsRef.current,
        request.offset > 0,
      );
      liveSearchPlaybackByIdRef.current = mergeLiveSearchPlaybackChannels(
        liveSearchPlaybackByIdRef.current,
        liveItems,
        request.offset <= 0,
      );
      return page;
    },
    [activeProviderId, bundle],
  );

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    liveRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handlePreviewRetry = useCallback(() => {
    const channelId = liveStateRef.current?.previewChannelId;
    if (!channelId) {
      return;
    }

    livePreviewRetryAttemptedRef.current = true;
    setState((current) => {
      const base = current ?? bootstrapState;
      if (!base) {
        return null;
      }

      return chooseLiveChannel(base, channelId);
    });
  }, [bootstrapState]);

  useEffect(() => {
    if (loadStatus === 'ready') {
      liveRetryAttemptedRef.current = false;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (liveState?.previewStatus === 'ready') {
      livePreviewRetryAttemptedRef.current = false;
    }
  }, [liveState?.previewStatus]);

  useEffect(() => {
    if (!bundle || categories.length === 0) {
      dismissNotification(LIVE_TV_LOAD_NOTIFICATION_ID);
      return;
    }

    const spec = resolveLiveTvNotificationForStatus(loadStatus, liveRetryAttemptedRef.current, loadErrorMessage);
    if (!spec) {
      dismissNotification(LIVE_TV_LOAD_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: LIVE_TV_LOAD_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: LIVE_TV_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'live-tv',
    });
  }, [bundle, categories.length, dismissNotification, handleReload, loadErrorMessage, loadStatus, showNotification]);

  useEffect(() => {
    if (!liveState || liveState.previewStatus !== 'error') {
      dismissNotification(LIVE_TV_PREVIEW_NOTIFICATION_ID);
      return;
    }

    const spec = resolveLiveTvPreviewNotification(livePreviewRetryAttemptedRef.current, liveState.previewError);
    showNotification({
      id: LIVE_TV_PREVIEW_NOTIFICATION_ID,
      type: 'warning',
      title: spec.title,
      message: spec.message,
      duration: LIVE_TV_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'top-right',
      scope: 'live-tv',
    });
  }, [dismissNotification, handlePreviewRetry, liveState, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('live-tv');
    };
  }, [clearScope]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchOverlayReady(false);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOverlayVisible) {
      return;
    }
    logLiveSearchFocus({
      event: 'modal-focus-owned',
      overlayVisible: true,
      queryLength: null,
      source: searchOverlayReady ? 'overlay-ready' : 'overlay-visible',
    });
    logLiveSearchFocus({
      event: 'background-focus-blocked',
      overlayVisible: true,
      source: 'LiveTvScreen',
    });
  }, [searchOverlayReady, searchOverlayVisible]);

  const showFatalPanel = !bundle || (categories.length === 0 && loadStatus !== 'loading');

  if (loadStatus === 'loading' && categories.length === 0) {
    return (
      <NovaTvShell activeId="live" title="Live TV" subtitle="Browse channels without losing the picture." preferActiveNavigationFocus={false} compactNavigationRail expirationLabel={selectedProviderExpiration}>
        <View style={styles.statePanel}>
          <LiveTvPlanetLoader label="Loading channels…" />
        </View>
      </NovaTvShell>
    );
  }

  if (showFatalPanel) {
    return (
      <NovaTvShell activeId="live" title="Live TV" subtitle="Browse channels without losing the picture." preferActiveNavigationFocus={false} compactNavigationRail expirationLabel={selectedProviderExpiration}>
        <View style={styles.statePanel}>
          {!bundle || loadStatus === 'error' ? (
            <>
              <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
              <Text style={styles.stateTitle}>Live TV unavailable</Text>
              <Text style={styles.stateCopy}>{loadErrorMessage ?? 'Unable to connect to your provider.'}</Text>
              <Pressable
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Retry Live TV"
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={handleReload}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="television-off" size={34} color={theme.colors.textMuted} />
              <Text style={styles.stateTitle}>No channels available</Text>
              <Text style={styles.stateCopy}>Your provider did not return any live channels.</Text>
              <Pressable
                focusable
                hasTVPreferredFocus
                accessibilityRole="button"
                accessibilityLabel="Retry Live TV"
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={handleReload}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          )}
        </View>
      </NovaTvShell>
    );
  }

  if (!renderState) {
    return (
      <NovaTvShell activeId="live" title="Live TV" subtitle="Browse channels without losing the picture." preferActiveNavigationFocus={false} compactNavigationRail expirationLabel={selectedProviderExpiration}>
        <View style={styles.statePanel}>
          <LiveTvPlanetLoader label="Loading channels…" />
        </View>
      </NovaTvShell>
    );
  }

  return (
    <View style={styles.root}>
      {!renderState.fullscreenChannelId ? (
      <NovaTvShell
        activeId="live"
        title="Live TV"
        subtitle="Browse channels without losing the picture."
        providerLabel={selectedProviderLabel}
        preferActiveNavigationFocus={false}
        navigationFocusable={!searchOwnsBackgroundFocus}
        compactNavigationRail
        headerSupplement={
          <MovieToolbar
            accessibilityLabel="Search Live TV"
            buttonRef={searchToolbarRef}
            focusable={!searchOverlayVisible && !renderState.fullscreenChannelId}
            onSearchFocus={() => setFocusedAction('search')}
            onSearchPress={openLiveSearch}
            discoverZoneOpen={discoverZoneOpen}
            onDiscoverPress={() => {
              if (searchOpen) {
                closeLiveSearch();
              }
              logLivePerformance({
                event: 'discover-zone-open',
                elapsedMs: 0,
                providerIdPresent: Boolean(activeProviderId && activeProviderId !== 'no-provider'),
                categoryCount: categories.length,
                channelCount: channels.length,
                selectedCategoryIdPresent: Boolean(selectedCategoryId),
                source: 'memory',
                epgPending: false,
                discoverPending: true,
              });
              setDiscoverZoneOpen(true);
            }}
          />
        }>
        <View
          style={styles.screen}
          pointerEvents={searchOwnsBackgroundFocus ? 'none' : 'auto'}
          importantForAccessibility={searchOwnsBackgroundFocus ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={searchOwnsBackgroundFocus}>
        <View
          style={[
            styles.mainGrid,
            tvDensity === 'compact' && styles.mainGridCompact,
            tvDensity === 'normal' && styles.mainGridNormal,
            tvDensity === 'comfortable' && styles.mainGridComfortable,
          ]}>
          <View
            style={[
              styles.categoriesPanel,
              tvDensity === 'compact' && styles.categoriesPanelCompact,
              tvDensity === 'normal' && styles.categoriesPanelNormal,
              tvDensity === 'comfortable' && styles.categoriesPanelComfortable,
            ]}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Categories</Text>
              <Text style={styles.panelCount}>{formatLiveTvCategoryCount(categoryTotalCount)}</Text>
            </View>
            <FlatList
              ref={categoriesRef}
              data={categories}
              keyExtractor={(item) => item.renderKey}
              extraData={`${categoryFocusEpoch}:${renderState.selectedCategoryId}:${categoryNextFocusRightHandle ?? ''}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.categoryList}
              removeClippedSubviews={false}
              windowSize={5}
              maxToRenderPerBatch={8}
              initialNumToRender={Math.min(categories.length, 12)}
              onScrollToIndexFailed={(info) => {
                recordLiveTvManualScroll();
                categoriesRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              }}
              renderItem={({ item }) => (
                <LiveTvCategoryRow
                  category={item}
                  selected={item.id === renderState.selectedCategoryId}
                  preferFocus={preferCategoryFocusRef.current && item.id === preferredCategoryFocusId.current}
                  nextFocusRight={
                    item.id === renderState.selectedCategoryId ? categoryNextFocusRightHandle : undefined
                  }
                  registerRef={(instance) => registerCategoryRowRef(item.id, instance)}
                  onFocus={() => handleCategoryFocus(item.id)}
                  onPress={() => selectCategory(item.id)}
                />
              )}
            />
          </View>

          <View
            style={[
              styles.channelsPanel,
              tvDensity === 'compact' && styles.channelsPanelCompact,
              tvDensity === 'normal' && styles.channelsPanelNormal,
              tvDensity === 'comfortable' && styles.channelsPanelComfortable,
            ]}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Channels</Text>
              <Text style={styles.panelCount}>
                {showChannelPanelLoader ? '...' : channels.length.toLocaleString()}
              </Text>
            </View>
            {showChannelPanelLoader ? (
              <LiveTvPlanetLoader label="Loading channels…" />
            ) : channels.length === 0 && loadStatus === 'error' ? (
              <View style={styles.inlineStateNotice}>
                <MaterialCommunityIcons name="cloud-off-outline" size={22} color={theme.colors.textMuted} />
                <Text style={styles.inlineStateText}>No channels to display right now.</Text>
              </View>
            ) : channels.length === 0 && loadStatus === 'empty' ? (
              <View style={styles.inlineStateNotice}>
                <MaterialCommunityIcons name="television-off" size={22} color={theme.colors.textMuted} />
                <Text style={styles.inlineStateText}>No channels in this category.</Text>
              </View>
            ) : (
              <LiveTvChannelListReveal revealKey={renderState.selectedCategoryId || selectedCategoryId}>
                <LiveTvChannelList
                  channels={channels}
                  selectedChannelId={renderState.selectedChannelId}
                  previewChannelId={renderState.previewChannelId}
                  preferFocusChannelId={preferChannelFocusRef.current ? preferredChannelFocusId.current : null}
                  categoryFocusLeftHandle={categoryFocusLeftHandle}
                  listRef={channelsRef}
                  onTuneChannel={tuneChannel}
                  onChannelFocus={focusChannelRow}
                  registerRowRef={registerChannelRowRef}
                />
              </LiveTvChannelListReveal>
            )}
          </View>

          {shouldKeepPreviewAlive(renderState.fullscreenChannelId ?? null, fullscreenFrameStatus) ? (
            <View
              style={[
                styles.previewPanel,
                tvDensity === 'compact' && styles.previewPanelCompact,
                tvDensity === 'normal' && styles.previewPanelNormal,
                tvDensity === 'comfortable' && styles.previewPanelComfortable,
              ]}>
              <View style={styles.previewFrame}>
                {renderState.previewStatus === 'loading' ? (
                  <View style={styles.previewLoading}>
                    <NovaSpaceLoader label="Loading preview…" />
                    <Text style={styles.previewLoadingCopy}>{detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Unknown channel'}</Text>
                  </View>
                ) : renderState.previewStatus === 'error' ? (
                  <View style={styles.previewLoading}>
                    <MaterialCommunityIcons name="television" size={34} color={theme.colors.textMuted} />
                    <Text style={styles.previewLoadingTitle}>Preview unavailable</Text>
                    <Text style={styles.previewLoadingCopy}>
                      {detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Try another channel'}
                    </Text>
                    <Pressable
                      focusable
                      accessibilityRole="button"
                      accessibilityLabel="Retry preview"
                      onPress={handlePreviewRetry}
                      style={[styles.watchButton, novaTvFocus.base]}>
                      <Text style={styles.watchButtonText}>Retry</Text>
                    </Pressable>
                  </View>
                ) : renderState.previewStatus === 'idle' || streamSurfaceInFullscreen || !hasLiveStream ? (
                  <View style={styles.previewLoading}>
                    <MaterialCommunityIcons name="television" size={34} color={theme.colors.accentHover} />
                    <Text style={styles.previewLoadingTitle}>
                      {streamSurfaceInFullscreen
                        ? 'Playing full screen'
                        : renderState.previewStatus === 'idle'
                          ? 'Select a channel'
                          : 'Preparing stream'}
                    </Text>
                    <Text style={styles.previewLoadingCopy}>{detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Unknown channel'}</Text>
                  </View>
                ) : (
                  <NovaStreamSurface player={liveStreamPlayer} style={styles.previewPlayer} />
                )}
              </View>

              <View style={styles.previewDetails}>
                <LiveTvProgramDetailPanel
                  channel={detailPanelChannel}
                  previewWindow={formatPreviewWindow(detailPanelChannel)}
                  upNext={detailPanelChannel?.next}
                />

                <View style={styles.actionRow}>
                  <View style={styles.actionButtons}>
                    <Pressable
                      focusable
                      accessibilityRole="button"
                      accessibilityLabel={detailChannelIsFavorite ? 'Favorited' : 'Favorite'}
                      onFocus={() => setFocusedAction('favorite')}
                      onBlur={() => setFocusedAction(null)}
                      onPress={() => {
                        if (detailPanelChannel) {
                          void toggleLiveFavorite(activeProviderId, detailPanelChannel);
                        }
                      }}
                      style={[styles.favoriteButton, novaTvFocus.base, focusedAction === 'favorite' && styles.textFocusActive]}>
                      <MaterialCommunityIcons
                        name={detailChannelIsFavorite ? 'star' : 'star-outline'}
                        size={18}
                        color={theme.colors.accentHover}
                      />
                    </Pressable>
                    <Pressable
                      ref={watchButtonRef}
                      focusable={Boolean(renderState.previewChannelId) && !renderState.fullscreenChannelId}
                      hasTVPreferredFocus={false}
                      accessibilityRole="button"
                      accessibilityLabel="Watch Full Screen"
                      {...(renderState.selectedChannelId
                        ? { nextFocusLeft: findNodeHandle(channelRowRefs.current.get(renderState.selectedChannelId) ?? null) ?? undefined }
                        : null)}
                      onFocus={() => setFocusedAction('fullscreen')}
                      onBlur={() => setFocusedAction(null)}
                      onPress={watchFullScreen}
                      style={[
                        styles.watchButton,
                        novaTvFocus.base,
                        renderState.previewStatus !== 'ready' && styles.watchButtonDisabled,
                        focusedAction === 'fullscreen' && styles.textFocusActive,
                      ]}>
                      <MaterialCommunityIcons name="play" size={20} color={theme.colors.textPrimary} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>
        </View>
      </NovaTvShell>
      ) : null}

      {fullscreenChannel ? (
        <View style={[styles.fullscreenOverlay, { width, height }]}>
          <LiveTvFocusRouter
            ref={liveSurfRouterRef}
            enabled
            chromeVisible={showFullscreenChrome || fullscreenFallbackVisible}
            fromChannelId={fullscreenChannel.id}
            surfSessionId={surfSessionIdRef.current}
            onAnchorPress={revealFullscreenChrome}
            onSentinelFocus={handleLiveSurfSentinelFocus}
            onHandlesChange={(next) => {
              setLiveSurfHandles((current) => {
                if (
                  current.anchor === next.anchor &&
                  current.left === next.left &&
                  current.right === next.right
                ) {
                  return current;
                }
                return { anchor: next.anchor, left: next.left, right: next.right };
              });
            }}
          />
          {hasLiveStream ? (
          <NovaStreamSurface
            player={liveStreamPlayer}
            contentFit="cover"
            style={[styles.fullscreenPlayer, fullscreenFrameStatus !== 'ready' && styles.hiddenStreamSurface]}
            onFirstFrameRender={handleFullscreenFirstFrame}
            onPlayingChange={handleLivePlayerPlayingChange}
            onTimeUpdate={handleLivePlayerTimeUpdate}
          />
          ) : null}
          {visibleSurfOverlay ? (
            <View pointerEvents="none" style={styles.fullscreenStatusOverlay}>
              <Text style={styles.fullscreenEyebrow}>
                {visibleSurfOverlay.number ? `Channel ${visibleSurfOverlay.number}` : 'Live'}
              </Text>
              <Text style={styles.fullscreenTitle}>{displayStreamTitle(visibleSurfOverlay.name)}</Text>
              {liveState?.previewStatus === 'loading' && liveState.previewChannelId === visibleSurfOverlay.channelId ? (
                <Text style={styles.previewLoadingCopy}>Loading...</Text>
              ) : null}
            </View>
          ) : null}
          {shouldShowFullscreenLoadingOverlay(fullscreenFrameStatus) && !visibleSurfOverlay ? (
            <View style={styles.fullscreenStatusOverlay}>
              <NovaSpaceLoader label="Starting playback…" />
              <Text style={styles.previewLoadingCopy}>{displayStreamTitle(fullscreenChannel.name)}</Text>
            </View>
          ) : null}
          {fullscreenFallbackVisible ? (
            <View pointerEvents="auto" style={[styles.fullscreenStatusOverlay, styles.fullscreenFallbackOverlay]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
              <Text style={styles.previewErrorTitle}>
                {fullscreenFrameStatus === 'error' ? 'Playback error' : 'This channel is taking too long to start'}
              </Text>
              <Text style={styles.previewErrorCopy}>Try again, or go back to the preview.</Text>
              <Pressable
                ref={registerFullscreenRetryButtonRef}
                focusable
                hasTVPreferredFocus={fullscreenRetryFocusKeyRef.current === null && surfRequestIdRef.current === 0}
                accessibilityRole="button"
                accessibilityLabel="Retry"
                {...(liveSurfHandles.anchor != null
                  ? {
                      nextFocusLeft: liveSurfHandles.anchor,
                      nextFocusRight: liveSurfHandles.anchor,
                      ...(fullscreenRetryNodeTag
                        ? { nextFocusUp: fullscreenRetryNodeTag, nextFocusDown: fullscreenRetryNodeTag }
                        : {}),
                    }
                  : fullscreenRetryNodeTag
                    ? {
                        nextFocusLeft: fullscreenRetryNodeTag,
                        nextFocusRight: fullscreenRetryNodeTag,
                        nextFocusUp: fullscreenRetryNodeTag,
                        nextFocusDown: fullscreenRetryNodeTag,
                      }
                    : null)}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={retryFullscreenPlayback}
                style={[styles.watchButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.watchButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {showFullscreenChrome && !fullscreenFallbackVisible ? (
            <>
              <View style={[styles.fullscreenBadgeRow, styles.fullscreenChromeTopRow]}>
                <View style={styles.fullscreenBadgeLeading}>
                  <ChannelLogoBadge channel={fullscreenChannel} styles={styles} />
                </View>
                <Pressable
                  ref={fullscreenCloseButtonRef}
                  focusable
                  hasTVPreferredFocus={false}
                  {...(liveSurfHandles.anchor != null
                    ? { nextFocusLeft: liveSurfHandles.anchor, nextFocusRight: liveSurfHandles.anchor }
                    : {})}
                  onPress={() => {
                    setState((current) => closeLiveFullscreen(current ?? renderState));
                  }}
                  style={styles.closeButton}>
                  <MaterialCommunityIcons name="close" size={18} color="#FFFFFF" />
                  <Text style={styles.closeButtonText}>Back to Live TV</Text>
                </Pressable>
              </View>
              <View style={[styles.fullscreenMetaPanel, styles.fullscreenChromeMetaPanel]}>
                <Text style={styles.fullscreenEyebrow}>WATCHING LIVE</Text>
                <Text numberOfLines={1} style={styles.fullscreenTitle}>
                  {displayLiveProgramText(fullscreenChannel.current, 'No program information available.')}
                </Text>
                <Text numberOfLines={1} style={styles.fullscreenMeta}>
                  {displayStreamTitle(fullscreenChannel.name)} · {formatPreviewWindow(fullscreenChannel)}
                </Text>
                {fullscreenChannel.description ? (
                  <Text numberOfLines={2} style={styles.fullscreenDescription}>
                    {displayLiveProgramText(fullscreenChannel.description, '')}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}
          {!showFullscreenChrome && !fullscreenFallbackVisible ? (
            <Pressable
              ref={fullscreenInteractionRef}
              focusable={false}
              hasTVPreferredFocus={false}
              onPress={revealFullscreenChrome}
              style={styles.fullscreenInteractionLayer}
            />
          ) : null}
        </View>
      ) : null}

      <DiscoverZoneOverlay
        visible={discoverZoneOpen && !liveState?.fullscreenChannelId}
        providerId={activeProviderId}
        scope="live"
        onClose={() => setDiscoverZoneOpen(false)}
        onSelectItem={(item) => {
          void playFavoriteFromDiscoverZone(item.id);
        }}
      />
      <SearchOverlay
        visible={searchOverlayVisible}
        retainMounted={shouldKeepLiveSearchMounted(searchOpen)}
        restoreFocusLiveChannelId={searchRestoreChannelId}
        onRestoreFocusHandled={() => setSearchRestoreChannelId(null)}
        scope="live"
        providerId={activeProviderId}
        title="Search Live TV"
        placeholder="Search Live TV channels"
        executeSearch={executeLiveSearch}
        onReady={() => setSearchOverlayReady(true)}
        onClose={closeLiveSearch}
        onSelectResult={handleSearchSelect}
        favoriteContentIds={liveFavoriteContentIds}
      />

      <WalkthroughOverlay
        key={guide.visible ? 'live-guide-open' : 'live-guide-closed'}
        visible={guide.visible}
        title={ONBOARDING_GUIDES.liveTv.title}
        steps={ONBOARDING_GUIDES.liveTv.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  screen: {
    flex: 1,
    minHeight: 0,
    gap: 10,
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  stateCopy: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inlineStateNotice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  inlineStateText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
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
  previewPlayer: {
    flex: 1,
    minHeight: 0,
  },
  fullscreenPlayer: {
    ...StyleSheet.absoluteFill,
  },
  hiddenStreamSurface: {
    opacity: 0,
  },
  fullscreenStatusOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(3,7,12,0.85)',
    zIndex: 2,
  },
  fullscreenFallbackOverlay: {
    zIndex: 3,
  },
  fullscreenMetaPanel: {
    position: 'absolute',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  mainGrid: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 0,
  },
  mainGridCompact: {
    gap: 0,
  },
  mainGridNormal: {
    gap: 0,
  },
  mainGridComfortable: {
    gap: 0,
  },
  categoriesPanel: {
    flex: 22,
    minWidth: 260,
    minHeight: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderRightWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: 'transparent',
    padding: 0,
    paddingRight: 14,
  },
  categoriesPanelCompact: {
    flex: 22,
    minWidth: 200,
    padding: 0,
    paddingRight: 12,
  },
  categoriesPanelNormal: {
    flex: 22,
    minWidth: 260,
  },
  categoriesPanelComfortable: {
    flex: 22,
    minWidth: 280,
  },
  channelsPanel: {
    flex: 53,
    minWidth: 300,
    minHeight: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderRightWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: 'transparent',
    padding: 0,
    paddingHorizontal: 14,
  },
  channelsPanelCompact: {
    flex: 53,
    minWidth: 260,
    padding: 0,
    paddingHorizontal: 12,
  },
  channelsPanelNormal: {
    flex: 53,
    minWidth: 320,
  },
  channelsPanelComfortable: {
    flex: 53,
    minWidth: 380,
  },
  panelHeader: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  panelTitle: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  panelCount: {
    minWidth: 28,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
  },
  categoryList: {
    gap: 3,
    paddingTop: 2,
    paddingBottom: 8,
  },
  categoryRow: {
    minHeight: 60,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
  },
  categoryIcon: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  categoryName: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  categoryCount: {
    marginTop: 2,
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  selectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.accentHover,
  },
  channelList: {
    gap: 3,
    paddingTop: 2,
    paddingBottom: 8,
  },
  channelRow: {
    minHeight: 66,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
  },
  previewingRow: {
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  channelNumber: {
    width: 30,
    color: theme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  channelLogo: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLogoText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  channelCopy: {
    flex: 1,
    minWidth: 0,
  },
  channelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  channelName: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  resolution: {
    color: theme.colors.accentHover,
    fontSize: 9,
    fontWeight: '900',
  },
  nowPlaying: {
    marginTop: 2,
    color: theme.colors.textSecondary,
    fontSize: 11,
  },
  progressTrack: {
    height: 3,
    marginTop: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  selectedRow: {
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
  previewPanel: {
    flex: 25,
    minWidth: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    minHeight: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    padding: 0,
    paddingLeft: 14,
    gap: 12,
  },
  previewPanelCompact: {
    flex: 25,
    minWidth: 260,
    padding: 0,
    paddingLeft: 12,
    gap: 10,
  },
  previewPanelNormal: {
    flex: 25,
    minWidth: 300,
  },
  previewPanelComfortable: {
    flex: 25,
    minWidth: 380,
  },
  previewFrame: {
    flexShrink: 0,
    width: '100%',
    aspectRatio: 16 / 9,
    minHeight: 0,
    maxHeight: 220,
    borderRadius: 0,
    overflow: 'hidden',
  },
  previewDetails: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: 10,
  },
  previewCanvas: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: 20,
    justifyContent: 'space-between',
  },
  previewLoading: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  previewLoadingTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  previewLoadingCopy: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  previewError: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 18,
  },
  previewErrorTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  previewErrorCopy: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  previewOrbLarge: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    right: -80,
    top: -110,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  previewOrbSmall: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    left: -45,
    bottom: -60,
    backgroundColor: 'rgba(59,130,246,0.22)',
  },
  previewHorizon: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '34%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  previewLogoBadge: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(5,9,15,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewLogoText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  previewLogoImage: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
  },
  previewPlayButton: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(4,8,14,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programInfo: {
    minHeight: 0,
    flexShrink: 1,
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  programTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  programCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewChannelName: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  previewProgram: {
    marginTop: 3,
    color: '#D2DCEC',
    fontSize: 15,
    fontWeight: '600',
  },
  previewWindow: {
    marginTop: 3,
    color: theme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  badge: {
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceMuted,
    color: '#CCD8EB',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  description: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    width: '100%',
    flexShrink: 0,
    marginTop: 'auto',
  },
  actionButtons: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  favoriteButton: {
    width: 44,
    height: 40,
    minHeight: 40,
    borderRadius: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchButton: {
    width: 44,
    height: 40,
    minHeight: 40,
    borderRadius: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchButtonDisabled: {
    opacity: 0.56,
  },
  textFocusActive: focusChrome.active,
  fullscreenChromeTopRow: {
    top: theme.safeArea.top,
    left: theme.safeArea.left,
    right: theme.safeArea.right,
  },
  fullscreenChromeMetaPanel: {
    left: theme.safeArea.left,
    right: theme.safeArea.right,
    bottom: theme.safeArea.bottom + 8,
  },
  watchButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  fullscreenOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: '#000000',
  },
  fullscreenInteractionLayer: {
    ...StyleSheet.absoluteFill,
  },
  fullscreenBadgeRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fullscreenBadgeLeading: {
    flex: 1,
    minWidth: 0,
  },
  closeButton: {
    flexShrink: 0,
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(4,8,14,0.56)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    ...androidTextFit,
  },
  fullscreenEyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    ...androidTextFit,
  },
  fullscreenTitle: {
    marginTop: 4,
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: -0.3,
    ...androidTextFit,
  },
  fullscreenMeta: {
    marginTop: 4,
    color: '#D9E2F0',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    ...androidTextFit,
  },
  fullscreenDescription: {
    marginTop: 6,
    maxWidth: '92%',
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    ...androidTextFit,
  },
  fullscreenHint: {
    marginTop: 12,
    color: theme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  miniGuide: {
    minHeight: 62,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    paddingHorizontal: 0,
  },
  guideItem: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
  },
  guideLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  guideValue: {
    marginTop: 3,
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  guideDivider: {
    width: 1,
    height: 28,
    backgroundColor: theme.colors.borderSubtle,
  },
  guideAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 14,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.borderSubtle,
  },
  guideActionText: {
    color: theme.colors.accentHover,
    fontSize: 13,
    fontWeight: '700',
  },
  });
}
