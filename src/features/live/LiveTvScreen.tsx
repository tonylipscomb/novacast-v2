// TODO(stage-live): migrate preview/fullscreen playback to useUnifiedPlayer via UnifiedPlayerHost.
/* eslint-disable react-hooks/refs -- Android TV focus restoration, list handles, and Animated values are intentionally imperative. */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  DeviceEventEmitter,
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
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { usePlaybackActivity } from '@/features/playback/usePlaybackActivity';
import type { PlayingChangeEventPayload, StatusChangeEventPayload, TimeUpdateEventPayload } from 'expo-video';
import { NovaStreamSurface, useNovaStreamPlayer } from '@/features/playback/NovaStreamPlayer';
import { NovaViewProbe } from './NovaViewProbe';
import type { LivePlaybackSource } from '@/features/providers/providerPlayback';
import type { PlaybackItem } from '@/features/playback/unified/types';
import { playbackAnalyticsTracker } from '@/features/analytics/playbackAnalytics';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { novacastTrace } from '@/features/diagnostics/novacastLogPolicy';
import { beginLivePerformanceSession, completeLivePerformanceSummary, recordLivePerformanceEvent, recordLiveRenderChurn, startLiveJsStallMonitor } from '@/features/diagnostics/livePerformanceTelemetry';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { classifyProviderBoundaryError, logProviderBoundary } from '@/features/providers/providerBoundaryDiagnostics';
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
  openResolvedLiveChannelFullscreen,
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
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveMyChannelsCategoryId,
  isSyntheticLiveRecentsCategoryId,
  sanitizePersistedLiveCategoryId,
} from '@/features/providers/liveCategoryIdSafety';
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
import { logLiveEpgPerformance } from './liveTvChannelEpg';
import {
  recordLiveTvFocusEvent,
} from './liveTvFocusDiagnostics';
import { LiveTvFocusRouter, type LiveTvFocusRouterHandle } from './LiveTvFocusRouter';
import {
  clearFullscreenSurfOverlay,
  FullscreenSurfOverlay,
  publishFullscreenSurfOverlay,
} from './FullscreenSurfOverlay';
import {
  setFullscreenSurfEnabled,
  subscribeFullscreenSurfKeys,
  type FullscreenSurfKeyEvent,
} from './fullscreenSurfNative';
import { logLiveSelection } from './liveTvSelectionDiagnostics';
import { createLiveTimeshiftProbe, type LiveTimeshiftProbe } from './liveTimeshiftDiagnostics';
import { createLivePlaybackWatchdog, type LivePlaybackWatchdog } from './livePlaybackWatchdog';
import { logLivePlaybackSurfaceSelection, type LivePlaybackLaunchSource } from './livePlaybackLaunchDiagnostics';
import { markLiveCatalogInteraction } from '@/features/catalog/catalogForegroundPriority';
import {
  LIVE_SURF_OVERLAY_HIDE_MS,
  createLiveSurfSessionId,
  logLiveSurf,
  resolveLiveSurfAdjacent,
  resolveLiveSurfTarget,
  shouldApplyLiveSurfResolution,
} from './liveTvSurf';
import {
  LIVE_CHANNEL_SURF_DEBOUNCE_MS,
  shouldHandleLiveChannelSurf,
} from '@/features/playback/continuity/playbackContinuity';
import { getLiveTvRowVisualFlags } from './liveTvUiPerfMode';
import { hydrateFavoriteLiveChannels } from './liveFavoriteHydration';
import { logLiveCategoryOrderAudit, logLiveStabilityLoader, logLivePerformance, logLiveNavPerf, recordLiveNavigationMetric } from './liveTvDiagnostics';
import { resolveChannelFocusRetentionTarget, shouldRetainChannelFocus, type LiveFocusNavigationIntent } from './liveTvFocusRetention';
import { LiveTvChannelListReveal, LiveTvPlanetLoader } from './LiveTvPlanetLoader';
import {
  logLiveChannelPanelLoader,
  resolveLiveChannelPanelLoaderKind,
  shouldShowLiveChannelPanelLoader,
} from './liveTvChannelPanelLoader';
import { getLiveTvWorkload, patchLiveTvWorkload } from './liveTvWorkload';
import { cancelLiveTvEpgWork } from './liveTvChannelEpg';
import {
  cancelLiveSearchCatalogBuild,
  findPublishedLiveChannelsByTitle,
  getPublishedLiveChannelById,
  getPublishedLiveCatalogState,
} from '@/features/search/liveSearchSqliteCatalog';
import { useLiveTvScreenModel } from './useLiveTvScreenModel';
import { getLiveChannelIndexEntry } from '@/features/search/liveChannelIndex';
import { displayLiveChannelName, displayLiveProgramText, isRawLiveStreamValue } from './liveTvProgramText';
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
  shouldPopToRetainedSearch,
  shouldLiveSearchBlockBackgroundFocus,
  shouldRestoreLiveBrowseFocusAfterFullscreen,
  shouldShowLiveSearchOverlay,
  suppressLiveSearchOverlayClose,
  toLiveSearchPlaybackChannel,
  consumeLiveSearchNavigationHandoff,
  createLiveSearchPlaybackSession,
  type LiveSearchPlaybackSession,
  type LiveSearchBrowseSnapshot,
  type LiveSearchPlaybackChannel,
} from './liveTvSearchSession';
import { logLiveSearchFocus } from '@/features/search/liveSearchResultsScroll';
import { SearchOverlay } from '@/features/search/SearchOverlay';
import { DiscoverZoneOverlay } from '@/features/personalization/DiscoverZoneOverlay';
import { searchLiveChannels } from '@/features/search/repositories/liveSearchRepository';
import type { LiveSearchResult, SearchResult } from '@/features/search/searchTypes';
import { MovieToolbar } from '@/features/movies/components/MovieToolbar';
import { createFavoriteHoldDetector } from './liveFavoriteHold';

const androidTextFit = Platform.OS === 'android' ? ({ includeFontPadding: false } as const) : {};
const FULLSCREEN_EXIT_FOCUS_SAFETY_TIMEOUT_MS = 5_000;
const FULLSCREEN_EXIT_FOCUS_STABILIZATION_MS = 650;

declare const __DEV__: boolean | undefined;

function liveLoadAuditNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// TEMPORARY: release-visible diagnostics for Discover Live handoff only.
// Do not use novacastTrace here: it is intentionally suppressed in release.
function discoverLiveAudit(event: string, data: Record<string, unknown> = {}) {
  console.info(
    '[NovaCast Discover Live Release Audit]',
    JSON.stringify({ timestamp: Date.now(), event, ...data }),
  );
}

function safeDiscoverLiveError(error: unknown) {
  return String(error)
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(password|token|secret|authorization|bearer|apikey|api[_-]?key|credential|cookie|jwt)=\S+/gi, '$1=[redacted]')
    .slice(0, 240);
}

type DiscoverLivePlaybackContext = {
  providerId: string;
  source: 'favorites' | 'recent';
  channels: ProviderLiveChannel[];
  currentIndex: number;
  focusedItemId?: string;
};

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

function FullscreenSurfInput({
  enabled,
  onEvent,
  onNativeReady,
}: {
  enabled: boolean;
  onEvent: (event: FullscreenSurfKeyEvent) => void;
  onNativeReady: (ready: boolean) => void;
}) {
  const onEventRef = useRef(onEvent);
  const nativeEventCountRef = useRef(0);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android' || !Platform.isTV) {
      onNativeReady(false);
      return;
    }

    console.info('[NovaCast Surf Bridge] enable-requested');
    const nativeReady = setFullscreenSurfEnabled(true);
    onNativeReady(nativeReady);
    if (!nativeReady) {
      return;
    }

    const subscription = subscribeFullscreenSurfKeys((event: FullscreenSurfKeyEvent) => {
      const direction = event.keyCode === 21 ? -1 : event.keyCode === 22 ? 1 : null;
      if (direction == null) {
        return;
      }
      nativeEventCountRef.current += 1;
      if (event.action === 1 || !event.repeatCount || event.repeatCount % 10 === 0) {
        console.info('[NovaCast Fullscreen Raw Key] received', {
          keyCode: event.keyCode ?? null,
          action: event.action ?? null,
          repeatCount: event.repeatCount ?? 0,
          eventTime: event.eventTime ?? null,
          downTime: event.downTime ?? null,
          eventCount: nativeEventCountRef.current,
        });
      }
      // The existing surf intent path coalesces repeated directional input and
      // settles once the input stops. ACTION_UP therefore only ends the hold;
      // it must not advance the virtual cursor a second time.
      onEventRef.current(event);
    });

    if (!subscription) {
      setFullscreenSurfEnabled(false);
      onNativeReady(false);
      return;
    }

    return () => {
      subscription.remove();
      console.info('[NovaCast Surf Bridge] disable-requested');
      clearFullscreenSurfOverlay();
      setFullscreenSurfEnabled(false);
      onNativeReady(false);
    };
  }, [enabled, onNativeReady]);

  return null;
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
  const liveScreenRenderCountRef = useRef(0);
  liveScreenRenderCountRef.current += 1;
  recordLiveTvScreenRender();
  recordLiveRenderChurn('LiveTvScreen');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ categoryId?: string | string[]; channelId?: string | string[]; returnRoute?: string | string[]; directPlay?: string | string[]; launchSource?: string | string[] }>();
  const { width, height } = useWindowDimensions();
  const tvDensity = getTvDensity(width);
  const navigationGateRef = useRef(createTvNavigationGate());
  // search-live-directplay-v1
  const directPlayConsumedRef = useRef(false);
  const { selectedProvider, selectedProviderLabel, selectedProviderExpiration } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const liveLoadSessionIdRef = useRef(`live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const liveLoadStartedAtRef = useRef(liveLoadAuditNow());
  const liveLoadAudit = useCallback((event: string, fields: Record<string, unknown> = {}) => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
      return;
    }
    console.info('[NovaCast Live Load Audit]', {
      loadSessionId: liveLoadSessionIdRef.current,
      event,
      elapsedMs: Math.round(liveLoadAuditNow() - liveLoadStartedAtRef.current),
      ...fields,
    });
  }, []);
  const liveListStageLayoutRef = useRef<string | null>(null);
  const liveFlatListLayoutRef = useRef<string | null>(null);
  const liveHeaderLayoutRef = useRef<string | null>(null);
  const liveFirstChannelsLoggedRef = useRef(false);
  const liveFirstFocusLoggedRef = useRef(false);
  const { state: personalizationState } = usePersonalizationStore(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.liveTv.key);
  const liveMemory = getLiveTvMemory(activeProviderId);
  const routeValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const routeCategoryId = routeValue(routeParams.categoryId);
  const routeChannelId = routeValue(routeParams.channelId);
  const routeReturnRoute = routeValue(routeParams.returnRoute);
  const routeDirectPlay = routeValue(routeParams.directPlay);
  const routeLaunchSource = routeValue(routeParams.launchSource);
  const returnRoute =
    routeReturnRoute === 'guide'
      ? '/guide'
      : routeReturnRoute === 'search'
        ? '/search'
        : TV_HOME_ROUTE;
  const directPlayRequested =
    routeDirectPlay === '1' &&
    Boolean(routeChannelId);
  const directPlayLaunchSource: LivePlaybackLaunchSource =
    routeLaunchSource === 'novapulse' || routeLaunchSource === 'recommendations' || routeLaunchSource === 'favorites' || routeLaunchSource === 'recent'
      ? routeLaunchSource
      : routeReturnRoute === 'search'
        ? 'live_screen'
        : 'home_rail';
  const {
    bundle,
    status: loadStatus,
    errorMessage: loadErrorMessage,
    categories,
    categoryTotalCount,
    channels,
    epgByChannelId,
    epgRevision,
    epgPendingChannelIds,
    selectedCategoryId,
    channelListPending,
    selectCategory: loadCategoryChannels,
    enrichFocusedChannelEpg,
    resolvePlaybackUrl,
    resolvePlaybackSource,
    reload,
    initialChannel,
  } = useLiveTvScreenModel(
    sanitizePersistedLiveCategoryId(routeCategoryId ?? liveMemory.selectedCategoryId),
    routeChannelId ?? liveMemory.selectedChannelId,
    { onLoadAudit: liveLoadAudit },
  );
  // The synthetic My Channels / Recents rows sit at the top of `categories`, so
  // every cold-start / focus default must resolve to the first REAL provider
  // category — never index 0.
  const firstProviderCategoryId = useMemo(
    () => categories.find((category) => isRealProviderLiveCategoryId(category.id))?.id ?? null,
    [categories],
  );
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const liveRetryAttemptedRef = useRef(false);
  const livePreviewRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const liveStateRef = useRef<LiveTvState | null>(null);
  const [interactionState, setState] = useState<LiveTvState | null>(null);
  const [fullscreenSurfNativeActive, setFullscreenSurfNativeActive] = useState(false);
  const fullscreenSurfIntentGenerationRef = useRef(0);
  const activeSurfCommitGenerationRef = useRef<number | null>(null);
  const surfCommitGenerationByRequestRef = useRef(new Map<number, number>());
  const surfCommitGenerationByChannelRef = useRef(new Map<string, number>());
  const surfCommitIdByRequestRef = useRef(new Map<number, number>());
  const activeSurfCommitIdRef = useRef<number | null>(null);
  const [previewStreamSource, setPreviewStreamSource] = useState<LivePlaybackSource | null>(null);
  const previewStreamUrl = previewStreamSource?.uri ?? null;
  const [fullscreenFrameStatus, setFullscreenFrameStatus] = useState<FullscreenFrameStatus>('pending');
  const [fullscreenChromeVisible, setFullscreenChromeVisible] = useState(true);
  const [focusedAction, setFocusedAction] = useState<'favorite' | 'fullscreen' | 'retry' | 'search' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [discoverZoneOpen, setDiscoverZoneOpen] = useState(false);
  const [discoverRestoreItemId, setDiscoverRestoreItemId] = useState<string | null>(null);
  const [pendingDiscoverLiveLaunch, setPendingDiscoverLiveLaunch] = useState<{
    channel: ProviderLiveChannel;
    rail: 'favorites' | 'recent';
  } | null>(null);
  const pendingDiscoverLiveLaunchRef = useRef<typeof pendingDiscoverLiveLaunch>(null);
  const discoverHandoffFrameRef = useRef<number | null>(null);
  const discoverLiveLaunchConsumedRef = useRef(false);
  const discoverLivePlaybackContextRef = useRef<DiscoverLivePlaybackContext | null>(null);
  const discoverRestoreItemIdRef = useRef<string | null>(null);
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
  const [searchRestoreChannelId, setSearchRestoreChannelId] = useState<string | null>(null);
  const [searchCloseFocusHold, setSearchCloseFocusHold] = useState(false);
  const searchToolbarRef = useRef<View | null>(null);
  const searchCloseHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSearchBrowseSnapshotRef = useRef<LiveSearchBrowseSnapshot | null>(null);
  const liveSearchResultIdsRef = useRef<string[]>([]);
  const liveSearchSurfQueueRef = useRef<string[] | null>(null);
  const liveSearchQueueActiveRef = useRef(false);
  const [searchPlaybackSessionActive, setSearchPlaybackSessionActive] = useState(false);
  const liveSearchSelectedIdRef = useRef<string | null>(null);
  const liveSearchPlaybackByIdRef = useRef<Map<string, LiveSearchPlaybackChannel>>(new Map());
  const liveSearchPlaybackSessionRef = useRef<LiveSearchPlaybackSession | null>(null);
  useEffect(() => {
    const handoff = consumeLiveSearchNavigationHandoff(activeProviderId);
    if (!handoff) {
      return;
    }
    console.info('[NovaCast Search Direct Play]', 'session-found', {
      resultCount: handoff.resultIds.length,
      selectedChannelId: handoff.selected.id,
    });
    liveSearchSurfQueueRef.current = handoff.resultIds;
    liveSearchQueueActiveRef.current = true;
    setSearchPlaybackSessionActive(true);
    liveSearchSelectedIdRef.current = handoff.selected.id;
    liveSearchPlaybackByIdRef.current = new Map(handoff.channels.map((channel) => [channel.id, channel]));
    liveSearchPlaybackSessionRef.current = createLiveSearchPlaybackSession({
      providerId: handoff.providerId,
      resultIds: handoff.resultIds,
      channels: handoff.channels,
      selectedId: handoff.selected.id,
    });
  }, [activeProviderId]);

  useEffect(() => {
    if (!directPlayRequested) {
      return;
    }
    console.info('[NovaCast Search Direct Play]', 'first-render-playback-mode', {
      channelId: routeChannelId,
      directPlaySessionPresent: Boolean(liveSearchPlaybackSessionRef.current),
      isSearchOrigin: returnRoute === '/search',
      suppressBrowseShell: true,
      firstRenderMode: 'playback-only',
      playbackStartupState: 'awaiting-preview',
    });
  }, [directPlayRequested, returnRoute, routeChannelId]);
  const [fullscreenRetryNodeTag, setFullscreenRetryNodeTag] = useState<number | null>(null);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapState = useMemo(() => {
    if (!channels.length) {
      return null;
    }

    const categoryId = selectedCategoryId || channels[0]?.categoryId || '';
    const channelId = directPlayRequested ? routeChannelId ?? initialChannel?.id ?? channels[0]?.id ?? '' : initialChannel?.id ?? channels[0]?.id ?? '';
    // Search direct-play still bootstraps an explicit preview so the existing
    // ready → tuneChannel fullscreen path can run. Normal open stays idle.
    if (directPlayRequested) {
      return createInitialLiveTvState(categoryId, channelId);
    }
    return createLiveTvLandingState(categoryId, channelId);
  }, [channels, directPlayRequested, initialChannel, routeChannelId, selectedCategoryId]);
  const liveState = interactionState ?? bootstrapState;
  liveStateRef.current = liveState;
  const shellLiveState = useMemo(() => {
    if (categories.length === 0) {
      return null;
    }

    const categoryId = selectedCategoryId || firstProviderCategoryId || '';
    return createLiveTvShellState(categoryId);
  }, [categories, selectedCategoryId]);
  const renderState = liveState ?? shellLiveState;
  // Live startup stability gate: the category/channel UI must stay hidden behind
  // the loader until the final US-first sorted array is committed, the selection
  // is resolved from it, and a focus target is therefore known. Derived only —
  // no timers. `categories` is committed exactly once (sorted, real names), so a
  // non-empty list here already means the order is final.
  const liveCategoryStartupReady =
    categories.length > 0 &&
    Boolean(selectedCategoryId) &&
    categories.some((category) => category.id === selectedCategoryId);
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
  useEffect(() => {
    logLivePlaybackSurfaceSelection({
      launchSource: directPlayRequested ? directPlayLaunchSource : 'live_screen',
      playbackSurface: 'modern_live',
      routeName: '/live',
    });
  }, [directPlayLaunchSource, directPlayRequested]);

  useEffect(() => {
    beginLivePerformanceSession('live_tv', { providerId: activeProviderId });
    startLiveJsStallMonitor('live_tv');
    liveLoadAudit('screen-mounted', {
      component: 'src/features/live/LiveTvScreen.tsx:LiveTvScreen',
      windowWidth: width,
      windowHeight: height,
      providerId: activeProviderId,
      route: {
        categoryIdPresent: Boolean(routeCategoryId),
        channelIdPresent: Boolean(routeChannelId),
        returnRoute,
        directPlay: directPlayRequested,
      },
    });
    liveLoadAudit('model-initialized', {
      providerId: activeProviderId,
      status: loadStatus,
      categoryCount: categories.length,
      channelCount: channels.length,
    });
    return () => {
      completeLivePerformanceSummary('live-screen-unmount');
      liveLoadAudit('screen-unmounted');
    };
  }, []);
  useEffect(() => {
    liveLoadAudit('active-provider', { providerId: activeProviderId });
  }, [activeProviderId, liveLoadAudit]);
  useEffect(() => {
    liveLoadAudit('catalog-readiness', {
      status: loadStatus,
      channelListPending,
      categoryCount: categories.length,
      channelCount: channels.length,
      selectedCategoryId: selectedCategoryId || null,
      source: channels.length > 0 ? 'catalog-or-provider' : 'pending',
    });
  }, [categories.length, channelListPending, channels.length, loadStatus, liveLoadAudit, selectedCategoryId]);
  useEffect(() => {
    if (!liveFirstChannelsLoggedRef.current && channels.length > 0) {
      liveFirstChannelsLoggedRef.current = true;
      liveLoadAudit('first-non-empty-channels-committed', {
        channelCount: channels.length,
        categoryCount: categories.length,
        selectedCategoryId: selectedCategoryId || null,
      });
    }
  }, [categories.length, channels.length, liveLoadAudit, selectedCategoryId]);
  useEffect(() => {
    liveLoadAudit('favorites-hydration-complete', {
      favoriteCount: personalizationState.liveFavorites.length,
      source: 'personalization-store',
    });
    liveLoadAudit('recents-hydration-complete', { source: 'personalization-store' });
  }, [liveLoadAudit, personalizationState.liveFavorites.length]);
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
      liveSearchQueueActiveRef.current = false;
      setSearchPlaybackSessionActive(false);
    }
    wasFullscreenRef.current = isFullscreen;
  }, [liveState?.fullscreenChannelId]);
  const fullscreenChannelIdRef = useRef<string | null>(null);
  useEffect(() => {
    fullscreenChannelIdRef.current = liveState?.fullscreenChannelId ?? null;
  }, [liveState?.fullscreenChannelId]);
  const shouldAcceptLiveSurfPlayerCommit = useCallback(
    () => activeSurfCommitGenerationRef.current === null ||
      activeSurfCommitGenerationRef.current === fullscreenSurfIntentGenerationRef.current,
    [],
  );
  const singleHlsProbeEnabled = process.env.EXPO_PUBLIC_NOVASHIFT_SINGLE_HLS_PROBE === 'true';
  const singleHlsProbeTargetIdRef = useRef<string | null>(null);
  const singleHlsProbeActiveRef = useRef(false);
  const currentFullscreenId = liveState?.fullscreenChannelId ?? null;
  if (!singleHlsProbeEnabled || !currentFullscreenId) {
    singleHlsProbeTargetIdRef.current = null;
    singleHlsProbeActiveRef.current = false;
  } else if (!singleHlsProbeTargetIdRef.current) {
    // Capture only the first fullscreen tune in this diagnostic session. A
    // later surf returns to the ordinary Live source and never starts another
    // HLS probe automatically.
    singleHlsProbeTargetIdRef.current = currentFullscreenId;
    singleHlsProbeActiveRef.current = true;
  } else if (singleHlsProbeTargetIdRef.current !== currentFullscreenId) {
    singleHlsProbeActiveRef.current = false;
  }
  const singleHlsProbeChannel = useMemo(
    () => currentFullscreenId
      ? liveSearchPlaybackSessionRef.current?.channelsById.get(currentFullscreenId) ??
        resolveLivePlaybackChannel(currentFullscreenId, channels, liveSearchPlaybackByIdRef.current)
      : null,
    [channels, currentFullscreenId, searchPlaybackSessionActive],
  );
  const singleHlsProbeUrl = useMemo(() => {
    if (
      !singleHlsProbeEnabled ||
      !singleHlsProbeActiveRef.current ||
      !currentFullscreenId ||
      singleHlsProbeTargetIdRef.current !== currentFullscreenId ||
      !bundle?.streamUrlBuilder ||
      !singleHlsProbeChannel
    ) {
      return null;
    }
    return bundle.streamUrlBuilder.buildLiveStreamUrl(singleHlsProbeChannel.id, 'm3u8');
  }, [bundle, currentFullscreenId, singleHlsProbeChannel, singleHlsProbeEnabled]);
  const playerStreamSource = singleHlsProbeUrl
    ? { uri: singleHlsProbeUrl, contentType: 'hls' as const, headers: { 'User-Agent': 'NovaCast NovaShift Probe' } }
    : previewStreamUrl;
  const playerStreamUrl = typeof playerStreamSource === 'string' ? playerStreamSource : playerStreamSource?.uri ?? null;
  const { player: liveStreamPlayer, retry: retryLiveStream, hasStream: hasLiveStream, playerGenerationId } = useNovaStreamPlayer(
    playerStreamSource,
    {
      persistentPlayer: true,
      shouldAcceptAsyncCommit: shouldAcceptLiveSurfPlayerCommit,
      onError: (message) => {
        if (!shouldAcceptLiveSurfPlayerCommit()) {
          console.info('[NovaCast Live Surf Playback]', {
            event: 'stale-commit-dropped',
            surfCommitId: activeSurfCommitIdRef.current,
            commitGeneration: activeSurfCommitGenerationRef.current,
            currentGeneration: fullscreenSurfIntentGenerationRef.current,
            stage: 'player-error',
          });
          return;
        }
        logProviderBoundary('[NovaCast Live Provider Request]', {
          event: 'source-error',
          channelId: fullscreenChannelIdRef.current,
          providerIdPresent: Boolean(activeProviderId),
          credentialsPresent: Boolean(bundle?.connectionType === 'xtream'),
          providerBasePresent: Boolean(bundle?.connectionType),
          sourceScheme: playerStreamUrl ? playerStreamUrl.split(':', 1)[0] : null,
          extension: playerStreamUrl?.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? null,
          userAgentPresent: false,
          ...classifyProviderBoundaryError(message),
          playerMounted: true,
          playbackStarted: false,
        });
        setFullscreenFrameStatus((current) =>
          fullscreenChannelIdRef.current && current !== 'ready' ? 'error' : current,
        );
      },
    },
  );

  const rebindLiveStream = useCallback(() => {
    const channelId = fullscreenChannelIdRef.current;
    if (!previewStreamSource || !channelId || !shouldAcceptLiveSurfPlayerCommit()) return;
    console.info('[NOVACAST_PLAYBACK_RECOVERY]', 'same-player-rebind', {
      channelId,
      attempt: 2,
      sourceIdentitySame: true,
      reason: 'watchdog-stall',
    });
    retryLiveStream();
  }, [previewStreamSource, retryLiveStream, shouldAcceptLiveSurfPlayerCommit]);
  const watchdogRecoveryRef = useRef<(attempt: 1 | 2) => void>(() => {});
  const livePlaybackWatchdogRef = useRef<LivePlaybackWatchdog | null>(null);
  if (!livePlaybackWatchdogRef.current) {
    livePlaybackWatchdogRef.current = createLivePlaybackWatchdog({
      recover: (attempt) => watchdogRecoveryRef.current(attempt),
      emit: (event, fields) => {
        recordLivePerformanceEvent(event, fields);
        const diagnosticEvent = event === 'live_watchdog_stall_detected'
          ? 'stall-detected'
          : event === 'live_watchdog_recovery_attempt'
            ? `recovery-attempt-${String(fields.attempt ?? '')}`
            : event === 'live_watchdog_recovered'
              ? 'recovery-success'
              : 'recovery-failed';
        console.info('[NOVACAST_PLAYBACK_RECOVERY]', diagnosticEvent, {
          channelId: fields.channelId ?? null,
          attempt: fields.attempt ?? fields.attempts ?? null,
          elapsedSinceProgressMs: fields.elapsedSinceProgressMs ?? null,
          playerGenerationId: fields.playerGenerationId ?? null,
          sourceIdentitySame: fields.sourceIdentitySame === true,
          reason: fields.reason ?? null,
        });
      },
    });
  }
  const livePlaybackWatchdog = livePlaybackWatchdogRef.current;
  watchdogRecoveryRef.current = (attempt) => {
    if (attempt === 1) retryLiveStream();
    else rebindLiveStream();
  };
  useEffect(() => {
    livePlaybackWatchdog.setContext({
      channelId: currentFullscreenId,
      playerGeneration: playerGenerationId,
      streamKey: playerStreamUrl,
      streamPresent: hasLiveStream,
      expectedActive: Boolean(currentFullscreenId && hasLiveStream),
      channelChanging: Boolean(surfTransactionRef.current),
      userPaused: false,
      playbackState: String(liveStreamPlayer.status),
      isPlaying: liveStreamPlayer.playing,
      isBuffering: liveStreamPlayer.status === 'loading',
      firstFrameSeen: fullscreenFrameStatus === 'ready',
    });
  }, [currentFullscreenId, fullscreenFrameStatus, hasLiveStream, livePlaybackWatchdog, liveStreamPlayer.playing, liveStreamPlayer.status, playerGenerationId, playerStreamUrl]);
  useEffect(() => () => {
    livePlaybackWatchdog.dispose();
  }, [livePlaybackWatchdog]);

  const streamSurfaceInFullscreen = Boolean(liveState?.fullscreenChannelId);
  const liveTimeshiftProbeRef = useRef<LiveTimeshiftProbe | null>(null);
  useEffect(() => {
    liveTimeshiftProbeRef.current?.dispose();
    liveTimeshiftProbeRef.current = null;
    if (
      !singleHlsProbeEnabled ||
      !streamSurfaceInFullscreen ||
      !currentFullscreenId ||
      !singleHlsProbeUrl
    ) {
      return;
    }
    const probe = createLiveTimeshiftProbe({
      player: liveStreamPlayer,
      channelKey: currentFullscreenId,
      providerId: activeProviderId,
      sharedPlayerMode: true,
    });
    liveTimeshiftProbeRef.current = probe;
    let cancelled = false;
    let started = false;
    const startWhenReady = () => {
      if (cancelled || started || liveStreamPlayer.status === 'error') return;
      if (liveStreamPlayer.status === 'readyToPlay') {
        started = true;
        probe.start();
      }
    };
    const statusSubscription = liveStreamPlayer.addListener('statusChange', startWhenReady);
    startWhenReady();
    return () => {
      cancelled = true;
      statusSubscription.remove();
      probe.dispose('channel-change');
      if (liveTimeshiftProbeRef.current === probe) {
        liveTimeshiftProbeRef.current = null;
      }
    };
  }, [activeProviderId, currentFullscreenId, liveStreamPlayer, singleHlsProbeEnabled, singleHlsProbeUrl, streamSurfaceInFullscreen]);
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
    () => {
      const session = liveSearchPlaybackSessionRef.current;
      const resolved = session
        ? session.channelsById.get(liveState?.selectedChannelId ?? '') ?? null
        : resolveLivePlaybackChannel(liveState?.selectedChannelId, channels, liveSearchPlaybackByIdRef.current);
      return resolved ?? (session ? null : channels[0] ?? null);
    },
    [channels, liveState?.selectedChannelId, searchPlaybackSessionActive],
  );
  const previewChannel = useMemo(
    () => {
      const session = liveSearchPlaybackSessionRef.current;
      return (session
        ? session.channelsById.get(liveState?.previewChannelId ?? '') ?? null
        : resolveLivePlaybackChannel(liveState?.previewChannelId, channels, liveSearchPlaybackByIdRef.current)) ?? selectedChannel;
    },
    [channels, selectedChannel, liveState?.previewChannelId, searchPlaybackSessionActive],
  );
  useEffect(() => {
    if (!previewStreamUrl) {
      return;
    }
    logProviderBoundary('[NovaCast Live Provider Request]', {
      event: 'source-built',
      channelId: liveState?.fullscreenChannelId ?? liveState?.previewChannelId ?? null,
      providerIdPresent: Boolean(activeProviderId),
      credentialsPresent: Boolean(bundle?.connectionType === 'xtream'),
      providerBasePresent: Boolean(bundle?.connectionType),
      sourceScheme: previewStreamUrl.split(':', 1)[0],
      extension: previewStreamUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? null,
      userAgentPresent: false,
      httpStatus: null,
      errorCategory: null,
      playerMounted: false,
      playbackStarted: false,
    });
  }, [activeProviderId, bundle?.connectionType, liveState?.fullscreenChannelId, liveState?.previewChannelId, previewStreamUrl]);

  useEffect(() => {
    if (!hasLiveStream || !liveState?.fullscreenChannelId) {
      return;
    }
    liveLoadAudit('player-ready', {
      channelId: liveState.fullscreenChannelId,
      playerStatus: liveStreamPlayer.status,
      playing: liveStreamPlayer.playing,
      currentTime: liveStreamPlayer.currentTime,
    });
    logProviderBoundary('[NovaCast Live Provider Request]', {
      event: 'player-mounted',
      channelId: liveState.fullscreenChannelId,
      providerIdPresent: Boolean(activeProviderId),
      credentialsPresent: Boolean(bundle?.connectionType === 'xtream'),
      providerBasePresent: Boolean(bundle?.connectionType),
      sourceScheme: previewStreamUrl?.split(':', 1)[0] ?? null,
      extension: previewStreamUrl?.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? null,
      userAgentPresent: false,
      httpStatus: null,
      errorCategory: null,
      playerMounted: true,
      playbackStarted: false,
    });
  }, [activeProviderId, bundle?.connectionType, hasLiveStream, liveLoadAudit, liveState?.fullscreenChannelId, liveStreamPlayer, previewStreamUrl]);
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
    : (selectedChannel ?? previewChannel);
  const detailChannelIsFavorite = personalizationState.liveFavorites.map((item) => item.contentId).includes(detailPanelChannel?.id ?? '');
  const liveFavoriteContentIds = useMemo(
    () => new Set(personalizationState.liveFavorites.map((item) => item.contentId)),
    [personalizationState.liveFavorites],
  );
  const fullscreenChannel = useMemo(
    () => liveSearchPlaybackSessionRef.current?.channelsById.get(liveState?.fullscreenChannelId ?? '') ??
      resolveLivePlaybackChannel(liveState?.fullscreenChannelId, channels, liveSearchPlaybackByIdRef.current),
    [channels, liveState?.fullscreenChannelId, searchPlaybackSessionActive],
  );
  const novaViewProbeEnabled = process.env.EXPO_PUBLIC_NOVAVIEW_PROBE === 'true';
  const novaViewProbeChannel = useMemo(() => {
    if (!novaViewProbeEnabled || !fullscreenChannel) return null;
    const index = channels.findIndex((channel) => channel.id === fullscreenChannel.id);
    return channels.slice(index + 1).find((channel) => channel.id !== fullscreenChannel.id && Boolean(String(channel.id).trim())) ?? null;
  }, [channels, fullscreenChannel, novaViewProbeEnabled]);
  const novaViewProbeActive = Boolean(novaViewProbeEnabled && fullscreenChannel && novaViewProbeChannel && bundle);
  useEffect(() => {
    if (!liveState?.fullscreenChannelId) {
      return;
    }

    novacastTrace('[NovaCast Live Fullscreen Bind] ' + JSON.stringify({
      channelId: liveState.fullscreenChannelId,
      fullscreenActive: true,
      previewStreamUrlPresent: Boolean(previewStreamUrl),
      resolvedPlaybackChannelPresent: Boolean(fullscreenChannel),
    }));
    novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
      phase: 'fullscreen-entered',
      canonicalContentId: liveState.fullscreenChannelId,
      channelId: liveState.fullscreenChannelId,
      streamUrlPresent: Boolean(previewStreamUrl),
      fullscreenActive: true,
      previewStreamUrlPresent: Boolean(previewStreamUrl),
    }));
  }, [fullscreenChannel, liveState?.fullscreenChannelId, previewStreamUrl]);
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
    const trackedId = previousAnalyticsFullscreenIdRef.current;

    if (!currentId) {
      if (trackedId) {
        playbackAnalyticsTracker.stop('user_back');
        previousAnalyticsFullscreenIdRef.current = null;
      }
      return;
    }

    // The fullscreen id can update before the new source item. Do not consume
    // that id until the item and fullscreen destination are the same channel.
    if (!livePlaybackItem || livePlaybackItem.id !== currentId) {
      return;
    }

    if (currentId !== trackedId) {
      if (trackedId) {
        playbackAnalyticsTracker.stop('channel_change');
      }
      playbackAnalyticsTracker.request(livePlaybackItem, 'channel');
      previousAnalyticsFullscreenIdRef.current = currentId;
    }
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
  const [channelNextFocusUpHandle, setChannelNextFocusUpHandle] = useState<number | undefined>();
  const focusedChannelIdRef = useRef<string | null>(liveMemory.focusedChannelId ?? null);
  const focusedActionChannelIdRef = useRef<string | null>(null);
  const favoriteHoldRef = useRef<ReturnType<typeof createFavoriteHoldDetector> | null>(null);
  const focusOwnerRef = useRef<'categories' | 'channels' | null>(null);
  const lastNavigationIntentRef = useRef<{ intent: LiveFocusNavigationIntent; at: number }>({ intent: 'none', at: 0 });
  const lastDpadDirectionRef = useRef<'left' | 'right' | null>(null);
  const verticalNavigationRef = useRef<{
    previousNativeDownEventTime: number | null;
    lastLogAt: number;
    direction: 'up' | 'down' | null;
    repeatCount: number;
    eventTime: number | null;
  }>({ previousNativeDownEventTime: null, lastLogAt: 0, direction: null, repeatCount: 0, eventTime: null });
  const channelsForFocusRef = useRef(channels);
  channelsForFocusRef.current = channels;
  const lastShellFocusEscapeLogRef = useRef<number | null>(null);
  const liveFocusRenderStateRef = useRef<{
    focusedIndex: number | null;
    bandFirst: number | null;
    bandLast: number | null;
    visibleRange: { first: number; last: number } | null;
  }>({ focusedIndex: null, bandFirst: null, bandLast: null, visibleRange: null });
  const focusRestoreInFlightRef = useRef<{
    targetChannelId: string;
    startedAt: number;
    retryCount: number;
    focusRequestIssued: boolean;
    timeoutTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const restoreInFlightCategoryLogRef = useRef<{ categoryId: string; at: number } | null>(null);
  const lastEpgCommitAtRef = useRef(0);
  const lastUnexpectedFocusLogRef = useRef<{ categoryId: string; at: number } | null>(null);
  const favoriteChannelRef = useRef<(channelId: string) => void>(() => undefined);
  const [categoryFocusEpoch, setCategoryFocusEpoch] = useState(0);
  const watchButtonRef = useRef<ElementRef<typeof View>>(null);
  const favoriteButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenCloseButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenLaunchSourceRef = useRef<FullscreenLaunchSource>(null);
  const previousFullscreenChannelIdRef = useRef<string | null>(null);
  const lastReadyFullscreenChannelIdRef = useRef<string | null>(null);
  const fullscreenExitFocusChannelIdRef = useRef<string | null>(null);
  const fullscreenExitFocusPendingRef = useRef(false);
  const fullscreenExitFocusPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenExitFocusStabilizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenExitFocusPhaseRef = useRef<'idle' | 'pending' | 'channel-focused-candidate' | 'stable'>('idle');
  const fullscreenExitFocusReassertedRef = useRef(false);
  const isRestoringFullscreenFocusRef = useRef(false);
  const fullscreenRetryButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenRetryFocusKeyRef = useRef<string | null>(null);
  const fullscreenInteractionRef = useRef<ElementRef<typeof View>>(null);
  const lastChannelOkPressRef = useRef<LiveTvOkPressRecord | null>(null);
  const preferredCategoryFocusId = useRef(liveMemory.focusedCategoryId ?? firstProviderCategoryId ?? null);
  const preferredChannelFocusId = useRef(liveMemory.focusedChannelId ?? channels[0]?.id ?? null);
  // Fresh Live entry must not compete with the TV focus system. These are
  // re-armed only by explicit navigation or fullscreen restoration.
  const preferCategoryFocusRef = useRef(false);
  const preferChannelFocusRef = useRef(false);
  // True only when the current category reflects a real user/route/persisted
  // choice. A provisional startup auto-default must never be written back to
  // Live memory as if it were a user preference.
  const categorySelectionIsUserRef = useRef(
    Boolean(sanitizePersistedLiveCategoryId(routeCategoryId ?? liveMemory.selectedCategoryId)),
  );
  const firstCategoryFocusLoggedRef = useRef(false);
  const categoryFocusTargetLoggedRef = useRef(false);
  const stabilityLoaderShownAtRef = useRef<number | null>(null);
  const surfSessionIdRef = useRef<string | null>(null);
  const intendedSurfChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onTVRemoteEvent', (event: {
      eventType?: string;
      action?: string;
      repeatCount?: number;
      eventTime?: number;
      downTime?: number;
    }) => {
      const eventType = String(event?.eventType ?? '').trim().toLowerCase();
      if (eventType === 'left' || eventType === 'arrowleft') {
        const at = Date.now();
        lastDpadDirectionRef.current = 'left';
        lastNavigationIntentRef.current = { intent: 'left', at };
        console.info('[NOVACAST_FOCUS]', 'navigation-intent', {
          direction: 'left',
          source: 'native-dpad',
          previousOwner: focusOwnerRef.current,
          timestamp: at,
        });
      } else if (eventType === 'right' || eventType === 'arrowright') {
        lastDpadDirectionRef.current = 'right';
      } else if (eventType === 'up' || eventType === 'down') {
        const now = Date.now();
        const direction = eventType as 'up' | 'down';
        const isDown = event.action === 'down' || event.action === '0';
        const previousDirection = verticalNavigationRef.current.direction;
        const previousNativeDownEventTime = verticalNavigationRef.current.previousNativeDownEventTime;
        const nativeDeltaMs = isDown && event.eventTime != null && previousNativeDownEventTime != null
          ? event.eventTime - previousNativeDownEventTime
          : null;
        verticalNavigationRef.current = {
          previousNativeDownEventTime: isDown && event.eventTime != null
            ? event.eventTime
            : previousNativeDownEventTime,
          lastLogAt: verticalNavigationRef.current.lastLogAt,
          direction,
          repeatCount: event.repeatCount ?? 0,
          eventTime: event.eventTime ?? null,
        };
        if (isDown) {
          recordLiveNavigationMetric('vertical-key-down', { direction, nativeDeltaMs });
        }
        if (isDown && (now - verticalNavigationRef.current.lastLogAt > 1_000 || (event.repeatCount ?? 0) === 0 || direction !== previousDirection)) {
          verticalNavigationRef.current.lastLogAt = now;
          const focusedIndex = channelsForFocusRef.current.findIndex((channel) => channel.id === focusedChannelIdRef.current);
          console.info('[NOVACAST_FOCUS]', 'vertical-navigation-intent', {
            direction,
            repeatCount: event.repeatCount ?? 0,
            nativeEventTime: event.eventTime ?? null,
            nativeDeltaMs,
            previousOwner: focusOwnerRef.current,
            focusedChannelId: focusedChannelIdRef.current,
            focusedIndex: focusedIndex >= 0 ? focusedIndex : null,
          });
        }
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    lastEpgCommitAtRef.current = Date.now();
  }, [epgRevision]);

  const logFocusAudit = useCallback((event: string, details: Record<string, unknown> = {}) => {
    const current = liveStateRef.current;
    console.log('[NOVACAST_FOCUS]', event, {
      selectedCategoryId: current?.selectedCategoryId ?? selectedCategoryId ?? null,
      selectedChannelId: current?.selectedChannelId ?? null,
      focusedChannelId: focusedChannelIdRef.current,
      preferredChannelId: preferredChannelFocusId.current,
      currentFocusRegion: current?.fullscreenChannelId ? 'fullscreen' : 'live-browse',
      ...details,
    });
  }, [selectedCategoryId]);

  const updateLiveFocusRenderState = useCallback((state: {
    focusedIndex: number;
    bandFirst: number;
    bandLast: number;
    visibleRange: { first: number; last: number } | null;
  }) => {
    liveFocusRenderStateRef.current = state;
  }, []);

  const getLastNavigationIntent = useCallback(() => lastNavigationIntentRef.current.intent, []);

  const clearFocusRestoreInFlight = useCallback((reason: string) => {
    const active = focusRestoreInFlightRef.current;
    if (!active) {
      return;
    }
    if (active.timeoutTimer) {
      clearTimeout(active.timeoutTimer);
    }
    focusRestoreInFlightRef.current = null;
    console.info('[NOVACAST_FOCUS]', 'channel-focus-restore-cleared', {
      targetChannelId: active.targetChannelId,
      retryCount: active.retryCount,
      elapsedMs: Date.now() - active.startedAt,
      reason,
    });
  }, []);

  const requestNativeRestoreFocus = useCallback((targetChannelId: string) => {
    const active = focusRestoreInFlightRef.current;
    if (!active || active.targetChannelId !== targetChannelId || active.focusRequestIssued) {
      return;
    }
    active.focusRequestIssued = true;
    requestTvFocus({
      screen: 'live',
      source: 'LiveTvScreen',
      region: 'channel-list',
      itemId: targetChannelId,
      reason: active.retryCount > 0 ? 'unexpected-category-focus-retain-channel-retry' : 'unexpected-category-focus-retain-channel',
      getTarget: () => channelRowRefs.current.get(targetChannelId),
    });
  }, []);

  const requestFocusRestore = useCallback((targetChannelId: string, retryCount: number) => {
    recordLiveNavigationMetric('restore');
    const active = focusRestoreInFlightRef.current;
    if (active?.targetChannelId === targetChannelId && active.retryCount >= retryCount) {
      return;
    }
    if (active?.timeoutTimer) {
      clearTimeout(active.timeoutTimer);
    }
    const nextState = {
      targetChannelId,
      startedAt: active?.targetChannelId === targetChannelId ? active.startedAt : Date.now(),
      retryCount,
      focusRequestIssued: false,
      timeoutTimer: null as ReturnType<typeof setTimeout> | null,
    };
    focusRestoreInFlightRef.current = nextState;
    if (channelRowRefs.current.has(targetChannelId)) {
      requestNativeRestoreFocus(targetChannelId);
    } else {
      const targetIndex = channels.findIndex((channel) => channel.id === targetChannelId);
      if (targetIndex >= 0) {
        channelsRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.5 });
      }
    }
    nextState.timeoutTimer = setTimeout(() => {
      const current = focusRestoreInFlightRef.current;
      if (!current || current.targetChannelId !== targetChannelId || current.retryCount !== retryCount) {
        return;
      }
      if (retryCount === 0) {
        console.info('[NOVACAST_FOCUS]', 'channel-focus-restore-timeout-retry', {
          targetChannelId,
          timeoutMs: 350,
        });
        requestFocusRestore(targetChannelId, 1);
        return;
      }
      clearFocusRestoreInFlight('bounded-timeout');
    }, 350);
  }, [channels, clearFocusRestoreInFlight, requestNativeRestoreFocus]);

  useEffect(() => () => clearFocusRestoreInFlight('screen-unmount'), [clearFocusRestoreInFlight]);

  const setPreferredChannelFocus = useCallback(
    (channelId: string, preferred: boolean, reason: string) => {
      const changed = preferredChannelFocusId.current !== channelId || preferChannelFocusRef.current !== preferred;
      if (!changed) {
        console.info('[NOVACAST_FOCUS]', 'redundant-focus-state-skipped', {
          region: 'channel',
          id: channelId,
          reason,
        });
        return;
      }
      preferredChannelFocusId.current = channelId;
      preferChannelFocusRef.current = preferred;
      if (changed) {
        logFocusAudit('preferred-channel-changed', {
          reason,
          targetType: 'channel',
          targetId: channelId,
          preferChannelFocus: preferred,
        });
      }
    },
    [logFocusAudit],
  );

  useEffect(() => {
    console.log('[NOVACAST_PLAYER_FOCUS]', 'live-screen-mount', {
      selectedCategoryId: liveState?.selectedCategoryId ?? null,
      selectedChannelId: liveState?.selectedChannelId ?? null,
      fullscreenChannelId: liveState?.fullscreenChannelId ?? null,
    });
    return () => {
      console.log('[NOVACAST_PLAYER_FOCUS]', 'live-screen-unmount', {
        selectedCategoryId: liveStateRef.current?.selectedCategoryId ?? null,
        selectedChannelId: liveStateRef.current?.selectedChannelId ?? null,
        fullscreenChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
      });
    };
  }, []);

  useEffect(() => {
    logLiveNavPerf('screen-mount', { reason: 'live-screen-mounted' });
  }, []);

  useEffect(() => {
    console.log('[NOVACAST_PLAYER_PERF]', 'fullscreen-state', {
      elapsedMs: 0,
      selectedChannelId: liveState?.selectedChannelId ?? null,
      fullscreenChannelId: liveState?.fullscreenChannelId ?? null,
      reason: 'fullscreen-state-change',
    });
  }, [liveState?.fullscreenChannelId, liveState?.selectedChannelId]);

  const previousAuditCategoryIdRef = useRef<string | null>(liveState?.selectedCategoryId ?? null);
  const previousAuditChannelIdRef = useRef<string | null>(liveState?.selectedChannelId ?? null);
  useEffect(() => {
    const nextCategoryId = liveState?.selectedCategoryId ?? null;
    if (previousAuditCategoryIdRef.current !== nextCategoryId) {
      logFocusAudit('selected-category-changed', {
        previousId: previousAuditCategoryIdRef.current,
        targetType: 'category',
        targetId: nextCategoryId,
      });
      previousAuditCategoryIdRef.current = nextCategoryId;
    }
    const nextChannelId = liveState?.selectedChannelId ?? null;
    if (previousAuditChannelIdRef.current !== nextChannelId) {
      logFocusAudit('selected-channel-changed', {
        previousId: previousAuditChannelIdRef.current,
        targetType: 'channel',
        targetId: nextChannelId,
      });
      previousAuditChannelIdRef.current = nextChannelId;
    }
  }, [liveState?.selectedCategoryId, liveState?.selectedChannelId, logFocusAudit]);

  const handleLiveLayoutAudit = useCallback(
    (event: 'list-stage-layout' | 'flatlist-layout' | 'header-layout', layout: { width: number; height: number; x: number; y: number }) => {
      const key = `${event}:${layout.width}:${layout.height}:${layout.x}:${layout.y}`;
      const ref = event === 'list-stage-layout' ? liveListStageLayoutRef : event === 'flatlist-layout' ? liveFlatListLayoutRef : liveHeaderLayoutRef;
      if (ref.current === key) {
        return;
      }
      ref.current = key;
      liveLoadAudit(event, layout);
    },
    [liveLoadAudit],
  );
  const handleLiveListLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number; x: number; y: number } } }) => {
      handleLiveLayoutAudit('flatlist-layout', event.nativeEvent.layout);
    },
    [handleLiveLayoutAudit],
  );

  const registerFavoriteActionRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    if (focusedChannelIdRef.current === channelId) {
      favoriteButtonRef.current = instance;
    }
  }, []);

  const registerPlayActionRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    if (focusedChannelIdRef.current === channelId) {
      watchButtonRef.current = instance;
    }
  }, []);

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
      // Only persist the category as a preference once it is user-owned;
      // a provisional startup auto-default is intentionally omitted so it
      // cannot masquerade as a user choice on the next cold start.
      ...(categorySelectionIsUserRef.current
        ? {
            selectedCategoryId: liveState.selectedCategoryId,
            focusedCategoryId: preferredCategoryFocusId.current,
          }
        : {}),
      selectedChannelId: liveState.selectedChannelId,
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

    const searchHandle = searchToolbarRef.current ? findNodeHandle(searchToolbarRef.current) ?? undefined : undefined;
    setChannelNextFocusUpHandle((current) => (current === searchHandle ? current : searchHandle));
  }, [channels]);

  const registerChannelRowRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    if (instance) {
      channelRowRefs.current.set(channelId, instance);
      requestNativeRestoreFocus(channelId);
    } else {
      channelRowRefs.current.delete(channelId);
    }
  }, [requestNativeRestoreFocus]);

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
    const channel = liveSearchPlaybackSessionRef.current
      ? liveSearchPlaybackSessionRef.current.channelsById.get(channelId) ?? null
      : resolveLivePlaybackChannel(channelId, channels, liveSearchPlaybackByIdRef.current);
    const timer = setTimeout(() => {
      const latest = liveStateRef.current;
      const surfSessionActive = Boolean(surfSessionIdRef.current && latest?.fullscreenChannelId);
      const commitGeneration = surfCommitGenerationByRequestRef.current.get(requestId) ??
        surfCommitGenerationByChannelRef.current.get(channelId);
      if (
        surfSessionActive &&
        commitGeneration !== undefined &&
        commitGeneration !== fullscreenSurfIntentGenerationRef.current
      ) {
        console.info('[NovaCast Live Surf Playback]', {
          event: 'stale-commit-dropped',
          surfCommitId: requestId,
          commitGeneration,
          currentGeneration: fullscreenSurfIntentGenerationRef.current,
          stage: 'preview-resolution',
        });
        surfCommitGenerationByRequestRef.current.delete(requestId);
        surfCommitGenerationByChannelRef.current.delete(channelId);
        return;
      }
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

      const playbackSource = resolvePlaybackSource(channel);
      if (!playbackSource) {
        if (!surfSessionActive) {
          setPreviewStreamSource(null);
        }
        surfCommitGenerationByRequestRef.current.delete(requestId);
        surfCommitGenerationByChannelRef.current.delete(channelId);
        setState((current) =>
          resolveLivePreview(current ?? latest, requestId, channelId, 'error', 'This channel is unavailable right now.'),
        );
        return;
      }

      setPreviewStreamSource(playbackSource);
      surfCommitGenerationByRequestRef.current.delete(requestId);
      surfCommitGenerationByChannelRef.current.delete(channelId);
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
  }, [channels, directPlayRequested, resolvePlaybackSource, liveState?.previewChannelId, liveState?.previewRequestId, liveState?.previewStatus, searchPlaybackSessionActive]);

  useEffect(() => {
    if (liveState?.previewStatus === 'idle' || !liveState?.previewChannelId) {
      if (liveState?.fullscreenChannelId) {
        return;
      }
      setPreviewStreamSource(null);
    }
  }, [liveState?.previewChannelId, liveState?.previewStatus]);

  const captureFullscreenExitTarget = useCallback(() => {
    const candidates = [
      { id: lastReadyFullscreenChannelIdRef.current, reason: 'ready-channel' },
      { id: fullscreenChannelIdRef.current, reason: 'committed-channel' },
      { id: liveStateRef.current?.selectedChannelId ?? null, reason: 'fallback' },
    ] as const;
    const selected = candidates.find((candidate) => candidate.id && channels.some((channel) => channel.id === candidate.id));
    const fallback = selected ?? (channels[0] ? { id: channels[0].id, reason: 'fallback' as const } : null);
    const index = fallback ? channels.findIndex((channel) => channel.id === fallback.id) : -1;
    fullscreenExitFocusChannelIdRef.current = fallback?.id ?? null;
    fullscreenExitFocusPendingRef.current = Boolean(fallback?.id);
    preferCategoryFocusRef.current = false;
    preferChannelFocusRef.current = Boolean(fallback?.id);
    focusOwnerRef.current = fallback?.id ? 'channels' : focusOwnerRef.current;
    fullscreenExitFocusPhaseRef.current = fallback?.id ? 'pending' : 'idle';
    fullscreenExitFocusReassertedRef.current = false;
    if (fullscreenExitFocusPendingTimerRef.current) {
      clearTimeout(fullscreenExitFocusPendingTimerRef.current);
    }
    if (fallback?.id) {
      fullscreenExitFocusPendingTimerRef.current = setTimeout(() => {
        fullscreenExitFocusPendingRef.current = false;
        fullscreenExitFocusPhaseRef.current = 'stable';
        fullscreenExitFocusChannelIdRef.current = null;
        fullscreenExitFocusPendingTimerRef.current = null;
      }, FULLSCREEN_EXIT_FOCUS_SAFETY_TIMEOUT_MS);
    }
    console.log('[NOVACAST_FOCUS]', 'fullscreen-exit-focus-pending', {
      channelId: fallback?.id ?? null,
      index,
      reason: fallback?.reason ?? 'fallback',
    });
    console.log('[NOVACAST_FOCUS]', 'fullscreen-exit-target', {
      channelId: fallback?.id ?? null,
      index,
      reason: fallback?.reason ?? 'fallback',
    });
    return fallback?.id ?? null;
  }, [channels]);

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
          console.info('[NovaCast Live Back Perf]', 'back-key-received', { monotonicMs: nowMs, fullscreen: Boolean(fullscreenChannelIdRef.current) });
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
            console.info('[NovaCast Live Back Perf]', 'fullscreen-close-requested', { monotonicMs: Date.now() });
            if (searchOpenRef.current) {
              suppressLiveSearchOverlayClose(nowMs);
              markLiveSearchBackConsumed(nowMs);
            }
            if (directPlayRequested) {
              playbackAnalyticsTracker.stop('user_back');
              if (shouldPopToRetainedSearch(returnRoute, directPlayRequested)) {
                router.back();
              } else {
                router.replace(returnRoute);
              }
              return true;
            }
            if (fullscreenLaunchSourceRef.current === 'discover') {
              const context = discoverLivePlaybackContextRef.current;
              const current = context?.channels[context.currentIndex];
              discoverRestoreItemIdRef.current = current?.id ?? null;
              setDiscoverRestoreItemId(current?.id ?? null);
              discoverLiveAudit('back-restore-requested', {
                source: context?.source ?? 'recent',
                currentIndex: context?.currentIndex ?? 0,
              });
            }
            captureFullscreenExitTarget();
            console.info('[NovaCast Fullscreen Close Origin]', {
              reason: 'hardware-back',
              origin: 'LiveTvScreen.back-handler',
              keyCode: null,
              rawAction: null,
              repeatCount: null,
              fullscreenChannelId: fullscreenChannelIdRef.current,
              nativeSurfActive: fullscreenSurfNativeActive,
            });
            clearFullscreenSurfOverlay();
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
  }, [bootstrapState, captureFullscreenExitTarget, directPlayRequested, fullscreenSurfNativeActive, guide.visible, liveState, returnRoute, router]);

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
    if (closing) {
      pendingSurfDeltaRef.current = 0;
      if (pendingSurfDrainTimerRef.current) {
        clearTimeout(pendingSurfDrainTimerRef.current);
        pendingSurfDrainTimerRef.current = null;
      }
      desiredSurfTargetIdRef.current = null;
      if (surfSettleTimerRef.current) {
        clearTimeout(surfSettleTimerRef.current);
        surfSettleTimerRef.current = null;
      }
      console.info('[NovaCast Live Back Perf]', 'fullscreen-state-cleared', { monotonicMs: Date.now() });
      console.info('[NovaCast Live Back Perf]', 'fullscreen-hidden', { monotonicMs: Date.now() });
      console.info('[NovaCast Live Back Perf]', 'channel-list-visible', { monotonicMs: Date.now() });
    }
    if (opening) {
      lastReadyFullscreenChannelIdRef.current = null;
      fullscreenExitFocusChannelIdRef.current = null;
      fullscreenExitFocusPendingRef.current = false;
      fullscreenExitFocusPhaseRef.current = 'idle';
      fullscreenExitFocusReassertedRef.current = false;
    }

    console.log('[NOVACAST_PLAYER_FOCUS]', opening ? 'fullscreen-open' : 'fullscreen-close', {
      reason: 'fullscreen-transition',
      selectedChannelId: liveState?.selectedChannelId ?? null,
      targetType: 'fullscreen',
      targetId: currentFullscreenChannelId,
    });
    console.log('[NOVACAST_PLAYER_PERF]', opening ? 'fullscreen-open' : 'fullscreen-close', {
      elapsedMs: 0,
      focusedChannelId: currentFullscreenChannelId,
      reason: 'fullscreen-transition',
    });
    console.info('[NovaCast Live Browse Retention]', opening ? 'fullscreen-open' : 'fullscreen-close', {
      selectedCategoryId: liveState?.selectedCategoryId ?? null,
      selectedChannelId: liveState?.selectedChannelId ?? null,
    });

    const preferredExitChannelId = fullscreenExitFocusChannelIdRef.current;
    const targetChannelId = closing
      ? preferredExitChannelId ?? liveState?.selectedChannelId ?? null
      : liveState?.selectedChannelId ?? null;
    logFocusAudit(opening ? 'fullscreen-opened' : 'fullscreen-closed', {
      reason: opening ? 'fullscreen-transition' : 'fullscreen-transition',
      targetType: 'fullscreen',
      targetId: currentFullscreenChannelId ?? targetChannelId,
    });
    if (closing && !shouldRestoreLiveBrowseFocusAfterFullscreen(searchOpen)) {
      setSearchRestoreChannelId(liveSearchSelectedIdRef.current ?? targetChannelId);
      isRestoringFullscreenFocusRef.current = true;
      const timer = setTimeout(() => {
        isRestoringFullscreenFocusRef.current = false;
      }, 120);
      return () => clearTimeout(timer);
    }

    const source = fullscreenLaunchSourceRef.current;
    if (closing && source === 'discover') {
      setDiscoverZoneOpen(true);
      discoverLiveAudit('discover-restored', {
        source: discoverLivePlaybackContextRef.current?.source ?? 'recent',
        focusedItemFound: Boolean(discoverRestoreItemIdRef.current),
      });
      return;
    }
    isRestoringFullscreenFocusRef.current = true;
    logFocusAudit('focus-requested', {
      reason: opening ? 'fullscreen-open' : 'fullscreen-close-restore',
      targetType: opening ? 'fullscreen' : 'channel',
      targetId: opening ? currentFullscreenChannelId : targetChannelId,
    });
    if (closing) {
      const targetIndex = channels.findIndex((channel) => channel.id === targetChannelId);
      const targetNativeRef = targetChannelId ? channelRowRefs.current.get(targetChannelId) : null;
      if (!targetNativeRef && targetIndex >= 0) {
        try {
          channelsRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.5 });
        } catch {
          // The bounded focus request below will retry after the row mounts.
        }
      }
      if (targetNativeRef) {
        console.info('[NovaCast Live Browse Retention]', 'focus-restore-direct-native-ref', { channelId: targetChannelId });
      }
      console.info('[NovaCast Live Browse Retention]', 'focus-restore-requested', { channelId: targetChannelId });
      console.info('[NovaCast Live Back Perf]', 'channel-focus-requested', { monotonicMs: Date.now(), channelId: targetChannelId });
      console.log('[NOVACAST_PLAYER_FOCUS]', 'fullscreen-close-restore', {
        reason: 'fullscreen-close-restore',
        targetType: 'channel',
        targetId: targetChannelId,
      });
      logFocusAudit('fullscreen-close-restore-requested', {
        reason: 'fullscreen-close-restore',
        targetType: 'channel',
        targetId: targetChannelId,
      });
    }

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
      onSettled: (status) => {
        isRestoringFullscreenFocusRef.current = false;
        if (closing) {
          console.log('[NOVACAST_FOCUS]', status === 'executed' ? 'fullscreen-exit-focus-success' : 'fullscreen-exit-focus-fallback', {
            channelId: targetChannelId,
            index: channels.findIndex((channel) => channel.id === targetChannelId),
            status,
          });
          console.info('[NovaCast Live Browse Retention]', 'focus-restore-confirmed', {
            channelId: targetChannelId,
            status,
          });
          console.info('[NovaCast Live Back Perf]', 'channel-focus-received', { monotonicMs: Date.now(), channelId: targetChannelId, status });
          fullscreenLaunchSourceRef.current = null;
          if (status !== 'executed') {
            fullscreenExitFocusPendingRef.current = false;
            fullscreenExitFocusPhaseRef.current = 'idle';
            fullscreenExitFocusChannelIdRef.current = null;
            if (fullscreenExitFocusStabilizationTimerRef.current) {
              clearTimeout(fullscreenExitFocusStabilizationTimerRef.current);
              fullscreenExitFocusStabilizationTimerRef.current = null;
            }
            if (fullscreenExitFocusPendingTimerRef.current) {
              clearTimeout(fullscreenExitFocusPendingTimerRef.current);
              fullscreenExitFocusPendingTimerRef.current = null;
            }
          }
        }
      },
      maxFrames: 3,
    });

    return cancel;
  }, [channels, liveState?.fullscreenChannelId, liveState?.selectedChannelId, logFocusAudit, searchOpen]);

  useEffect(() => {
    if (directPlayRequested) {
      return;
    }
    console.info('[NovaCast Live Browse Retention]', 'browse-mounted');
    return () => console.info('[NovaCast Live Browse Retention]', 'browse-unmounted');
  }, [directPlayRequested]);

  useEffect(() => {
    if (directPlayRequested) {
      return;
    }
    const fullscreenActive = Boolean(liveState?.fullscreenChannelId);
    if (fullscreenActive) {
      console.info('[NovaCast Live Browse Retention]', 'browse-suspended', {
        selectedCategoryId: liveState?.selectedCategoryId ?? null,
        selectedChannelId: liveState?.selectedChannelId ?? null,
      });
    } else {
      console.info('[NovaCast Live Browse Retention]', 'browse-resumed', {
        selectedCategoryId: liveState?.selectedCategoryId ?? null,
        selectedChannelId: liveState?.selectedChannelId ?? null,
      });
    }
  }, [directPlayRequested, liveState?.fullscreenChannelId, liveState?.selectedCategoryId, liveState?.selectedChannelId]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId || fullscreenFrameStatus !== 'pending') {
      return;
    }
    const timeoutChannelId = liveState.fullscreenChannelId;
    const timeoutGeneration = fullscreenSurfIntentGenerationRef.current;

    const timer = setTimeout(() => {
      if (
        liveStateRef.current?.fullscreenChannelId !== timeoutChannelId ||
        fullscreenSurfIntentGenerationRef.current !== timeoutGeneration
      ) {
        console.info('[NovaCast Playback Overlay]', {
          event: 'ignored-stale',
          type: 'timeout',
          channelId: timeoutChannelId,
          generation: timeoutGeneration,
          fullscreenActive: Boolean(liveStateRef.current?.fullscreenChannelId),
          nativeSurfActive: fullscreenSurfNativeActive,
        });
        return;
      }
      setFullscreenFrameStatus((current) => (current === 'ready' ? current : 'timeout'));
    }, FULLSCREEN_FIRST_FRAME_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [fullscreenFrameStatus, fullscreenSurfNativeActive, liveState?.fullscreenChannelId]);

  const handleFullscreenFirstFrame = () => {
    if (!shouldAcceptLiveSurfPlayerCommit()) {
      console.info('[NovaCast Live Surf Playback]', {
        event: 'stale-commit-dropped',
        surfCommitId: activeSurfCommitIdRef.current,
        commitGeneration: activeSurfCommitGenerationRef.current,
        currentGeneration: fullscreenSurfIntentGenerationRef.current,
        stage: 'first-frame',
      });
      return;
    }
    console.log('[NOVACAST_PLAYER_PERF]', 'first-frame-ready', {
      elapsedMs: 0,
      focusedChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
      surfCommitId: activeSurfCommitIdRef.current,
      reason: 'fullscreen-first-frame',
    });
    recordLivePerformanceEvent('tune_first_frame', {
      channelId: liveStateRef.current?.fullscreenChannelId ?? null,
      transactionId: activeSurfCommitIdRef.current,
    });
    liveLoadAudit('first-frame', {
      channelId: liveStateRef.current?.fullscreenChannelId ?? null,
      playerStatus: liveStreamPlayer.status,
      playing: liveStreamPlayer.playing,
    });
    lastReadyFullscreenChannelIdRef.current = liveStateRef.current?.fullscreenChannelId ?? null;
    livePlaybackWatchdog.markPlayable();
    playbackAnalyticsTracker.firstFrame();
    setFullscreenFrameStatus('ready');
  };
  const handleLivePlayerPlayingChange = useCallback(({ isPlaying }: PlayingChangeEventPayload) => {
    if (!shouldAcceptLiveSurfPlayerCommit()) {
      console.info('[NovaCast Live Surf Playback]', {
        event: 'stale-commit-dropped',
        surfCommitId: activeSurfCommitIdRef.current,
        commitGeneration: activeSurfCommitGenerationRef.current,
        currentGeneration: fullscreenSurfIntentGenerationRef.current,
        stage: 'player-playing',
      });
      return;
    }
    livePlaybackWatchdog.onPlaying(isPlaying);
    if (isPlaying) {
      liveTimeshiftProbeRef.current?.markPlaying();
    }
    liveLoadAudit('player-playing-change', {
      channelId: liveStateRef.current?.fullscreenChannelId ?? null,
      playerStatus: liveStreamPlayer.status,
      playing: isPlaying,
      currentTime: liveStreamPlayer.currentTime,
    });
    if (liveStateRef.current?.fullscreenChannelId && isPlaying && liveStreamPlayer.status === 'readyToPlay') {
      logProviderBoundary('[NovaCast Live Provider Request]', {
        event: 'playback-started',
        channelId: liveStateRef.current.fullscreenChannelId,
        providerIdPresent: Boolean(activeProviderId),
        credentialsPresent: Boolean(bundle?.connectionType === 'xtream'),
        providerBasePresent: Boolean(bundle?.connectionType),
        sourceScheme: previewStreamUrl?.split(':', 1)[0] ?? null,
        extension: previewStreamUrl?.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? null,
        userAgentPresent: false,
        httpStatus: null,
        errorCategory: null,
        playerMounted: true,
        playbackStarted: true,
      });
      playbackAnalyticsTracker.firstFrame('playing_transition');
    }
  }, [activeProviderId, bundle?.connectionType, liveLoadAudit, livePlaybackWatchdog, liveStreamPlayer, previewStreamUrl, shouldAcceptLiveSurfPlayerCommit]);
  const handleLivePlayerStatusChange = useCallback(({ status }: StatusChangeEventPayload) => {
    livePlaybackWatchdog.onStatus(String(status));
  }, [livePlaybackWatchdog]);
  const handleLivePlayerTimeUpdate = useCallback(({ currentTime, currentLiveTimestamp, bufferedPosition }: TimeUpdateEventPayload) => {
    livePlaybackWatchdog.onTimeUpdate(currentTime, { currentLiveTimestamp, bufferedPosition });
    if (
      liveStateRef.current?.fullscreenChannelId &&
      currentTime > 0 &&
      liveStreamPlayer.status === 'readyToPlay' &&
      liveStreamPlayer.playing
    ) {
      playbackAnalyticsTracker.firstFrame('current_time_progress');
    }
  }, [livePlaybackWatchdog, liveStreamPlayer]);
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
    const focusKey = `${liveState.fullscreenChannelId}:${fullscreenFrameStatus}`;
    if (fullscreenRetryFocusKeyRef.current === focusKey) {
      return;
    }
    fullscreenRetryFocusKeyRef.current = focusKey;
    console.info('[NovaCast Playback Overlay]', {
      event: 'shown',
      type: fullscreenFrameStatus === 'error' ? 'error' : 'timeout',
      channelId: liveState.fullscreenChannelId,
      surfCommitId: activeSurfCommitIdRef.current,
      attemptId: liveState.previewRequestId,
      generation: fullscreenSurfIntentGenerationRef.current,
      fullscreenActive: true,
      nativeSurfActive: fullscreenSurfNativeActive,
    });
  }, [fullscreenFallbackVisible, fullscreenFrameStatus, fullscreenSurfNativeActive, liveState?.fullscreenChannelId, liveState?.previewRequestId]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId || fullscreenFallbackVisible) {
      return;
    }
    if (fullscreenFrameStatus === 'pending' || fullscreenFrameStatus === 'ready') {
      console.info('[NovaCast Playback Overlay]', {
        event: 'cleared',
        type: fullscreenFrameStatus === 'pending' ? 'loading' : 'error',
        channelId: liveState.fullscreenChannelId,
        surfCommitId: activeSurfCommitIdRef.current,
        attemptId: liveState.previewRequestId,
        generation: fullscreenSurfIntentGenerationRef.current,
        fullscreenActive: true,
        nativeSurfActive: fullscreenSurfNativeActive,
      });
    }
  }, [fullscreenFallbackVisible, fullscreenFrameStatus, fullscreenSurfNativeActive, liveState?.fullscreenChannelId, liveState?.previewRequestId]);

  useEffect(() => {
    // Provider change invalidates any prior user-selection ownership; re-seed
    // from the new provider's route/persisted choice (if any).
    categorySelectionIsUserRef.current = Boolean(
      sanitizePersistedLiveCategoryId(routeCategoryId ?? getLiveTvMemory(activeProviderId).selectedCategoryId),
    );
    firstCategoryFocusLoggedRef.current = false;
    categoryFocusTargetLoggedRef.current = false;
  }, [activeProviderId, routeCategoryId]);

  useEffect(() => {
    // PHASE 1 audit: record the focus target only after the (always-sorted)
    // category order is committed and a selection is resolved.
    if (categoryFocusTargetLoggedRef.current || categories.length === 0 || !renderState?.selectedCategoryId) {
      return;
    }
    categoryFocusTargetLoggedRef.current = true;
    const focusTarget =
      preferredCategoryFocusId.current ?? renderState.selectedCategoryId ?? firstProviderCategoryId ?? null;
    logLiveCategoryOrderAudit('category-focus-target-chosen', {
      providerId: activeProviderId,
      categoryCount: categories.length,
      sample: categories,
      selectedCategoryId: renderState.selectedCategoryId ?? null,
      selectedCategoryName: categories.find((category) => category.id === focusTarget)?.name ?? null,
      selectionSource: categorySelectionIsUserRef.current ? 'persisted-user' : 'auto-default',
      orderReady: true,
    });
  }, [activeProviderId, categories, firstProviderCategoryId, renderState?.selectedCategoryId]);

  useEffect(() => {
    // Stability loader lifecycle telemetry (DEV-only inside the logger).
    if (!liveCategoryStartupReady) {
      if (stabilityLoaderShownAtRef.current == null) {
        stabilityLoaderShownAtRef.current = Date.now();
        logLiveStabilityLoader('shown', {
          elapsedMs: 0,
          namesResolved: false,
          categoryOrderReady: false,
          selectionResolved: false,
          focusTargetReady: false,
          categoryCount: categories.length,
        });
      }
      return;
    }
    if (stabilityLoaderShownAtRef.current != null) {
      const elapsedMs = Date.now() - stabilityLoaderShownAtRef.current;
      stabilityLoaderShownAtRef.current = null;
      const focusTarget =
        preferredCategoryFocusId.current ?? selectedCategoryId ?? firstProviderCategoryId ?? null;
      logLiveStabilityLoader('focus-target-ready', {
        elapsedMs,
        namesResolved: true,
        categoryOrderReady: true,
        selectionResolved: true,
        focusTargetReady: Boolean(focusTarget),
        categoryCount: categories.length,
        selectedCategoryId: selectedCategoryId ?? null,
      });
      logLiveStabilityLoader('hidden', {
        elapsedMs,
        namesResolved: true,
        categoryOrderReady: true,
        selectionResolved: true,
        focusTargetReady: Boolean(focusTarget),
        categoryCount: categories.length,
        selectedCategoryId: selectedCategoryId ?? null,
      });
    }
  }, [liveCategoryStartupReady, categories, selectedCategoryId]);

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
      logLiveNavPerf('category-focus', {
        categoryId,
        channelCount: channels.length,
        focusedChannelId: focusedChannelIdRef.current,
        reason: 'category-row-focus',
      });
      if (liveStateRef.current?.fullscreenChannelId) {
        console.info('[NovaCast Surf ASSERT]', {
          event: 'background-focus-during-fullscreen',
          region: 'category',
          fullscreenChannelId: liveStateRef.current.fullscreenChannelId,
          nativeSurfActive: fullscreenSurfNativeActive,
        });
        return;
      }
      if (fullscreenExitFocusPendingRef.current) {
        console.log('[NOVACAST_FOCUS]', 'fullscreen-exit-category-focus-ignored', {
          reason: 'fullscreen-exit-channel-restore-pending',
          targetType: 'category',
          targetId: categoryId,
          preferredChannelId: fullscreenExitFocusChannelIdRef.current,
        });
        console.log('[NOVACAST_FOCUS]', 'event=post-exit-focus-owner', {
          owner: 'category',
          channelId: fullscreenExitFocusChannelIdRef.current,
          categoryId,
          restorePhase: fullscreenExitFocusPhaseRef.current,
          timestamp: Date.now(),
        });
        if (
          fullscreenExitFocusPhaseRef.current === 'channel-focused-candidate' &&
          !fullscreenExitFocusReassertedRef.current
        ) {
          const targetChannelId = fullscreenExitFocusChannelIdRef.current;
          const target = targetChannelId ? channelRowRefs.current.get(targetChannelId) : null;
          fullscreenExitFocusReassertedRef.current = true;
          requestTvFocus({
            screen: 'live',
            source: 'LiveTvScreen',
            region: 'browse-restore',
            itemId: targetChannelId,
            reason: 'fullscreen-close-restore-reassert',
            getTarget: () => target,
            onSettled: (status) => {
              if (status !== 'executed') {
                fullscreenExitFocusPendingRef.current = false;
                fullscreenExitFocusPhaseRef.current = 'idle';
                fullscreenExitFocusChannelIdRef.current = null;
                if (fullscreenExitFocusStabilizationTimerRef.current) {
                  clearTimeout(fullscreenExitFocusStabilizationTimerRef.current);
                  fullscreenExitFocusStabilizationTimerRef.current = null;
                }
              }
            },
            maxFrames: 3,
          });
        }
        return;
      }
      const previousOwner = focusOwnerRef.current;
      const navigationIntent = lastNavigationIntentRef.current;
      const intentAgeMs = Date.now() - navigationIntent.at;
      const isRecentLeftIntent = previousOwner === 'channels' && navigationIntent.intent === 'left' && intentAgeMs <= 500;
      if (isRecentLeftIntent) {
        clearFocusRestoreInFlight('legitimate-left');
        lastNavigationIntentRef.current = { intent: 'none', at: 0 };
        console.info('[NOVACAST_FOCUS]', 'region-transition-allowed', {
          from: 'channels',
          to: 'categories',
          reason: 'native-dpad-left',
          intentAgeMs,
        });
      }
      const restoreInFlight = focusRestoreInFlightRef.current;
      if (restoreInFlight && !isRecentLeftIntent) {
        const now = Date.now();
        const previousLog = restoreInFlightCategoryLogRef.current;
        if (!previousLog || previousLog.categoryId !== categoryId || now - previousLog.at > 500) {
          restoreInFlightCategoryLogRef.current = { categoryId, at: now };
          console.info('[NOVACAST_FOCUS]', 'restore-in-flight-category-fallback', {
            categoryId,
            targetChannelId: restoreInFlight.targetChannelId,
            restoreAgeMs: now - restoreInFlight.startedAt,
            retryCount: restoreInFlight.retryCount,
          });
        }
        return;
      }
      if (!searchOverlayVisible && shouldRetainChannelFocus({
        previousOwner,
        navigationIntent: navigationIntent.intent,
        intentAgeMs,
        focusedChannelId: focusedChannelIdRef.current,
        preferredChannelId: preferredChannelFocusId.current,
        selectedChannelId: liveStateRef.current?.selectedChannelId,
      })) {
        const targetChannelId = resolveChannelFocusRetentionTarget({
          focusedChannelId: focusedChannelIdRef.current,
          preferredChannelId: preferredChannelFocusId.current,
          selectedChannelId: liveStateRef.current?.selectedChannelId,
        });
        const target = targetChannelId ? channelRowRefs.current.get(targetChannelId) : null;
        const previousLog = lastUnexpectedFocusLogRef.current;
        if (!previousLog || previousLog.categoryId !== categoryId || Date.now() - previousLog.at > 500) {
          recordLiveNavigationMetric('unexpected-region-transition');
          lastUnexpectedFocusLogRef.current = { categoryId, at: Date.now() };
          console.warn('[NOVACAST_FOCUS] unexpected-region-transition', {
            previousNativeTarget: 'channel',
            nextNativeTarget: 'category',
            previousChannelId: focusedChannelIdRef.current,
            categoryId,
            currentFocusRegion: liveStateRef.current?.fullscreenChannelId ? 'fullscreen' : 'live-browse',
            preferredChannelId: preferredChannelFocusId.current,
            selectedChannelId: liveStateRef.current?.selectedChannelId ?? null,
            lastNavigationIntent: navigationIntent.intent,
            millisecondsSinceLastEpgStateCommit: lastEpgCommitAtRef.current ? Date.now() - lastEpgCommitAtRef.current : null,
            millisecondsSinceLastMarqueeUpdate: null,
          });
        }
        if (targetChannelId && target) {
          requestFocusRestore(targetChannelId, 0);
        }
        return;
      }
      if (previousOwner === 'categories' && preferredCategoryFocusId.current === categoryId) {
        console.info('[NOVACAST_FOCUS]', 'redundant-focus-state-skipped', {
          region: 'category',
          id: categoryId,
          reason: 'category-row-focus',
        });
        return;
      }
      focusOwnerRef.current = 'categories';
      console.info('[NovaCast Live Focus Owner]', 'focus-owner-changed', {
        from: previousOwner,
        to: 'categories',
        reason: 'category-row-focus',
        channelId: null,
        categoryId,
      });
      logFocusAudit('category-received-focus', {
        reason: 'category-row-onFocus',
        targetType: 'category',
        targetId: categoryId,
      });
      preferredCategoryFocusId.current = categoryId;
      preferCategoryFocusRef.current = false;
      // Avoid FlatList epoch bumps on every category D-pad move.
    },
    [channels.length, clearFocusRestoreInFlight, fullscreenSurfNativeActive, logFocusAudit, requestFocusRestore, searchOverlayVisible],
  );

  const focusChannelRow = useCallback(
    (channelId: string) => {
      recordLiveNavigationMetric('channel-focus');
      if (liveStateRef.current?.fullscreenChannelId) {
        console.info('[NovaCast Surf ASSERT]', {
          event: 'background-focus-during-fullscreen',
          region: 'channel',
          fullscreenChannelId: liveStateRef.current.fullscreenChannelId,
          nativeSurfActive: fullscreenSurfNativeActive,
        });
        return;
      }
      if (fullscreenExitFocusPendingRef.current) {
        if (fullscreenExitFocusChannelIdRef.current !== channelId) {
          return;
        }
        if (fullscreenExitFocusPhaseRef.current === 'pending') {
          fullscreenExitFocusPhaseRef.current = 'channel-focused-candidate';
          if (fullscreenExitFocusStabilizationTimerRef.current) {
            clearTimeout(fullscreenExitFocusStabilizationTimerRef.current);
          }
          fullscreenExitFocusStabilizationTimerRef.current = setTimeout(() => {
            fullscreenExitFocusPendingRef.current = false;
            fullscreenExitFocusPhaseRef.current = 'stable';
            fullscreenExitFocusChannelIdRef.current = null;
            fullscreenExitFocusStabilizationTimerRef.current = null;
            if (fullscreenExitFocusPendingTimerRef.current) {
              clearTimeout(fullscreenExitFocusPendingTimerRef.current);
              fullscreenExitFocusPendingTimerRef.current = null;
            }
            console.log('[NOVACAST_FOCUS]', 'fullscreen-exit-focus-confirmed', {
              reason: 'channel-row-stabilized',
              targetType: 'channel',
              targetId: channelId,
            });
          }, FULLSCREEN_EXIT_FOCUS_STABILIZATION_MS);
          console.log('[NOVACAST_FOCUS]', 'event=post-exit-focus-owner', {
            owner: 'channel',
            channelId,
            categoryId: liveStateRef.current?.selectedCategoryId ?? null,
            restorePhase: 'channel-focused-candidate',
            timestamp: Date.now(),
          });
        }
        console.log('[NOVACAST_FOCUS]', 'fullscreen-exit-focus-candidate', {
          reason: 'channel-row-onFocus',
          targetType: 'channel',
          targetId: channelId,
        });
      }
      const previousOwner = focusOwnerRef.current;
      const previousFocusedId = focusedChannelIdRef.current;
      if (focusRestoreInFlightRef.current?.targetChannelId === channelId) {
        clearFocusRestoreInFlight('target-channel-focused');
      }
      if (previousOwner === 'channels' && previousFocusedId === channelId) {
        console.info('[NOVACAST_FOCUS]', 'redundant-focus-state-skipped', {
          region: 'channel',
          id: channelId,
          reason: 'channel-row-focus',
        });
        return;
      }
      focusOwnerRef.current = 'channels';
      preferCategoryFocusRef.current = false;
      if (previousOwner !== 'channels') {
        console.info('[NovaCast Live Focus Owner]', 'focus-owner-changed', {
          from: previousOwner,
          to: 'channels',
          reason: 'channel-row-focus',
          channelId,
          categoryId: liveStateRef.current?.selectedCategoryId ?? null,
        });
      }
      logLiveEpgPerformance('focus', {
        elapsedMs: 0,
        selectedCategoryId: liveStateRef.current?.selectedCategoryId ?? selectedCategoryId ?? null,
        focusedChannelId: channelId,
        batchIndex: null,
        batchSize: null,
        requestGeneration: null,
        cacheHits: null,
        cacheMisses: null,
        responseCount: null,
        reason: 'channel-focus-start',
      });
      logFocusAudit('channel-received-focus', {
        reason: 'channel-row-onFocus',
        targetType: 'channel',
        targetId: channelId,
      });
      if (previousFocusedId !== channelId) {
        favoriteHoldRef.current?.cancel('focus_lost');
      }
      setPreferredChannelFocus(channelId, false, 'channel-row-focus');
      focusedChannelIdRef.current = channelId;
      if (!liveFirstFocusLoggedRef.current) {
        liveFirstFocusLoggedRef.current = true;
        liveLoadAudit('first-visible-focused-row', { channelId });
      }
      recordLiveTvFocusEvent(channelId);
      enrichFocusedChannelEpg(channelId);
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
    [channels.length, clearFocusRestoreInFlight, enrichFocusedChannelEpg, fullscreenSurfNativeActive, liveLoadAudit, logFocusAudit, selectedCategoryId, setPreferredChannelFocus],
  );

  const closeLiveSearch = useCallback(() => {
    if (!searchOpenRef.current) {
      return;
    }
    const snapshot = liveSearchBrowseSnapshotRef.current;
    liveSearchSurfQueueRef.current = null;
    liveSearchQueueActiveRef.current = false;
    liveSearchPlaybackSessionRef.current = null;
    setSearchPlaybackSessionActive(false);
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
    liveSearchQueueActiveRef.current = false;
    setSearchPlaybackSessionActive(false);
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
      liveSearchQueueActiveRef.current = true;
      const selectedPlaybackChannel = toLiveSearchPlaybackChannel(result);
      liveSearchPlaybackByIdRef.current.set(result.id, selectedPlaybackChannel);
      liveSearchPlaybackSessionRef.current = createLiveSearchPlaybackSession({
        providerId: activeProviderId,
        resultIds: liveSearchResultIdsRef.current,
        channels: [...liveSearchPlaybackByIdRef.current.values()],
        selectedId: result.id,
      });
      setPreferredChannelFocus(result.id, true, 'live-search-result');
      setSearchPlaybackSessionActive(true);
      const channel = liveSearchPlaybackSessionRef.current?.channelsById.get(result.id) ?? selectedPlaybackChannel;
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

  const playDiscoverLiveChannel = useCallback(
    async (
      item: { id: string; contentId?: string; providerId?: string; title?: string; streamId?: string },
      rail: 'favorites' | 'recent',
      railItems: Array<{ id: string; contentId?: string; providerId?: string; title?: string; streamId?: string }> = [item],
    ) => {
      if (!bundle) {
        return;
      }
      const canonicalContentId = item.contentId?.trim() || item.id.trim();
      const providerId = item.providerId ?? activeProviderId;
      const providerMatches = !item.providerId || item.providerId === activeProviderId;
      const currentCategoryContainsChannel = channels.some((candidate) => candidate.id === canonicalContentId);
      const providerNativeId = item.streamId?.trim() || '';
      const legacyIdentityDetected = Boolean(item.title?.trim() && item.title.trim() !== canonicalContentId);
      novacastTrace('[NovaCast Discover Live Identity] ' + JSON.stringify({
        source: rail === 'favorites' ? 'favorite' : 'recent',
        savedContentId: canonicalContentId || null,
        savedProviderMatchesCurrent: providerMatches,
        currentProviderIdPresent: Boolean(activeProviderId),
        directCanonicalLookupFound: false,
        providerNativeIdPresent: Boolean(providerNativeId),
        legacyIdentityDetected,
      }));
      const pendingLaunchAlreadyPresent = pendingDiscoverLiveLaunchRef.current != null;
      novacastTrace('[NovaCast Discover Live Selection] ' + JSON.stringify({
        source: rail === 'favorites' ? 'favorite' : 'recent',
        contentIdPresent: Boolean(item.contentId),
        providerIdPresent: Boolean(item.providerId),
        canonicalIdPresent: Boolean(canonicalContentId),
        canonicalChannelFound: false,
        pendingLaunchAlreadyPresent,
      }));
      novacastTrace('[NovaCast Discover Live Press] ' + JSON.stringify({
        rail,
        itemId: item.id,
        canonicalContentId,
        mediaType: 'live',
        providerId,
      }));
      if (pendingLaunchAlreadyPresent) {
        return;
      }
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'selection-received',
        rail,
        canonicalContentId,
        source: rail === 'favorites' ? 'favorite' : 'recent',
        channelIdPresent: Boolean(canonicalContentId),
        providerIdPresent: Boolean(providerId),
        pendingPresent: false,
        modalOpen: discoverZoneOpen,
        channelId: null,
      }));
      let channel: ProviderLiveChannel | null = null;
      let globalLookupAttempted = false;
      let globalLookupFound = false;
      let providerNativeFallbackAttempted = false;
      let providerNativeFallbackFound = false;
      let legacyFallbackAttempted = false;
      let publishedCatalogReady = false;
      if (providerMatches && canonicalContentId) {
        globalLookupAttempted = true;
        publishedCatalogReady = (await getPublishedLiveCatalogState(activeProviderId).catch(() => null))?.ready === true;
        channel = await getPublishedLiveChannelById(activeProviderId, canonicalContentId).catch(() => null);
        globalLookupFound = Boolean(channel);
      }
      if (!channel && providerMatches && providerNativeId && providerNativeId !== canonicalContentId) {
        providerNativeFallbackAttempted = true;
        channel = await getPublishedLiveChannelById(activeProviderId, providerNativeId).catch(() => null);
        providerNativeFallbackFound = Boolean(channel);
      }
      if (!channel && providerMatches && item.title) {
        legacyFallbackAttempted = true;
        const titleMatches = await findPublishedLiveChannelsByTitle(activeProviderId, item.title).catch(() => []);
        if (titleMatches.length === 1) channel = titleMatches[0];
      }
      if (!channel && providerMatches && !publishedCatalogReady) {
        channel = await bundle.live.getChannel(canonicalContentId).catch(() => null);
      }
      novacastTrace('[NovaCast Discover Live Identity] ' + JSON.stringify({
        source: rail === 'favorites' ? 'favorite' : 'recent',
        savedContentId: canonicalContentId || null,
        savedProviderMatchesCurrent: providerMatches,
        currentProviderIdPresent: Boolean(activeProviderId),
        directCanonicalLookupFound: globalLookupFound,
        providerNativeIdPresent: Boolean(providerNativeId),
        legacyIdentityDetected,
        canonicalRehydrated: Boolean(channel && channel.id !== canonicalContentId),
      }));
      novacastTrace('[NovaCast Discover Live Selection] ' + JSON.stringify({
        source: rail === 'favorites' ? 'favorite' : 'recent',
        contentIdPresent: Boolean(item.contentId),
        providerIdPresent: Boolean(item.providerId),
        canonicalIdPresent: Boolean(canonicalContentId),
        canonicalChannelFound: Boolean(channel),
        providerMatches,
        currentCategoryContainsChannel,
        globalLookupAttempted,
        globalLookupFound,
        providerNativeFallbackAttempted,
        providerNativeFallbackFound,
        legacyFallbackAttempted,
        finalCanonicalChannelFound: Boolean(channel),
        pendingLaunchAlreadyPresent: pendingDiscoverLiveLaunchRef.current != null,
      }));
      novacastTrace('[NovaCast Discover Live Resolve] ' + JSON.stringify({
        rail,
        canonicalContentId,
        resolved: Boolean(channel),
        resolvedChannelId: channel?.id ?? null,
      }));
      if (!channel) {
        discoverLiveAudit('handoff-aborted', {
          reason: 'canonical-missing',
          source: rail === 'favorites' ? 'favorite' : 'recent',
          channelIdPresent: Boolean(canonicalContentId),
          providerIdPresent: Boolean(providerId),
        });
        novacastTrace('[NovaCast Discover Live Resolve Failed] ' + JSON.stringify({
          rail,
          itemId: item.id,
          contentId: item.contentId ?? null,
          providerId: item.providerId ?? activeProviderId,
        }));
        showNotification({
          type: 'error',
          title: 'Channel unavailable',
          message: 'This channel is no longer available.',
          duration: 6000,
          scope: 'live',
        });
        return;
      }

      if (pendingDiscoverLiveLaunchRef.current) {
        return;
      }

      discoverLiveAudit('canonical-ready', {
        source: rail === 'favorites' ? 'favorite' : 'recent',
        channelIdPresent: Boolean(channel.id),
        providerIdPresent: Boolean(providerId),
      });

      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'canonical-resolved',
        rail,
        canonicalContentId,
        source: rail === 'favorites' ? 'favorite' : 'recent',
        channelIdPresent: true,
        providerIdPresent: Boolean(providerId),
        pendingPresent: false,
        modalOpen: discoverZoneOpen,
        channelId: channel.id,
      }));

      const savedFavoriteIds = [
        ...new Set([
          ...personalizationState.liveFavorites.map((item) => item.contentId).filter(Boolean),
          channel.id,
        ]),
      ];
      const hydrated = hydrateFavoriteLiveChannels({
        favoriteIds: savedFavoriteIds,
        loadedChannels: channels,
        getIndexEntry: (id) => getLiveChannelIndexEntry(activeProviderId, id),
        favoriteRecords: personalizationState.liveFavorites,
      });
      const queue =
        rail === 'favorites'
          ? railItems
              .map((candidate) => candidate.contentId?.trim() || candidate.id.trim())
              .map((id) => hydrated.channels.find((candidate) => candidate.id === id))
              .filter((candidate): candidate is ProviderLiveChannel => Boolean(candidate))
          : (
              await Promise.all(
                railItems.map(async (candidate) => {
                  if (candidate.providerId && candidate.providerId !== activeProviderId) {
                    return null;
                  }
                  return (
                    (await getPublishedLiveChannelById(activeProviderId, candidate.contentId?.trim() || candidate.id.trim()).catch(() => null)) ??
                    (candidate.id === channel.id ? channel : null)
                  );
                }),
              )
            ).filter((candidate): candidate is ProviderLiveChannel => Boolean(candidate));
      const canonicalQueue = queue.some((candidate) => candidate.id === channel.id) ? queue : [channel, ...queue];
      liveSearchSurfQueueRef.current = canonicalQueue.map((candidate) => candidate.id);
      discoverLivePlaybackContextRef.current = {
        providerId: activeProviderId,
        source: rail,
        channels: canonicalQueue,
        currentIndex: Math.max(0, canonicalQueue.findIndex((candidate) => candidate.id === channel.id)),
        focusedItemId: channel.id,
      };
      // Discover surf destinations use the same fullscreen resolver as normal
      // Live TV. Register the complete canonical queue before fullscreen
      // state can move to any destination.
      for (const queueChannel of canonicalQueue) {
        const canonicalId = queueChannel.id.trim();
        if (canonicalId) {
          liveSearchPlaybackByIdRef.current.set(canonicalId, queueChannel);
        }
      }
      fullscreenLaunchSourceRef.current = 'discover';
      discoverLiveAudit('surf-context-created', {
        source: rail,
        queueCount: canonicalQueue.length,
        currentIndex: discoverLivePlaybackContextRef.current.currentIndex,
      });
      setPreferredChannelFocus(channel.id, true, 'discover-channel');
      for (const favorite of hydrated.channels) {
        liveSearchPlaybackByIdRef.current.set(favorite.id, favorite);
      }
      void recordRecentItem({
        providerId: activeProviderId,
        mediaType: 'live',
        contentId: channel.id,
        title: channel.name,
        artworkUrl: channel.logoUrl,
        categoryId: channel.categoryId,
      });
      pendingDiscoverLiveLaunchRef.current = { channel, rail };
      discoverLiveLaunchConsumedRef.current = false;
      setPendingDiscoverLiveLaunch({ channel, rail });
      discoverLiveAudit('pending-stored', {
        pendingPresent: true,
        modalOpen: discoverZoneOpen,
      });
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'pending-stored',
        rail,
        canonicalContentId,
        source: rail === 'favorites' ? 'favorite' : 'recent',
        channelIdPresent: true,
        providerIdPresent: Boolean(providerId),
        pendingPresent: true,
        modalOpen: discoverZoneOpen,
        channelId: channel.id,
      }));
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'modal-close-requested',
        rail,
        source: rail === 'favorites' ? 'favorite' : 'recent',
        channelIdPresent: true,
        providerIdPresent: Boolean(providerId),
        pendingPresent: true,
        modalOpen: discoverZoneOpen,
        channelId: channel.id,
      }));
      discoverLiveAudit('modal-close-requested');
      setDiscoverZoneOpen(false);
    },
    [activeProviderId, bundle, channels, discoverZoneOpen, personalizationState.liveFavorites, showNotification],
  );

  useEffect(() => {
    const pending = pendingDiscoverLiveLaunchRef.current;
    if (!pending || discoverZoneOpen || discoverLiveLaunchConsumedRef.current) {
      return;
    }

    if (discoverHandoffFrameRef.current != null) {
      return;
    }

    discoverLiveAudit('modal-closed-observed', { pendingPresent: true });
    discoverLiveAudit('pending-read', { pendingPresent: true });
    novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
      event: 'modal-closed',
      phase: 'overlay-closed',
      rail: pending.rail,
      source: pending.rail === 'favorites' ? 'favorite' : 'recent',
      canonicalContentId: pending.channel.id,
      channelIdPresent: true,
      providerIdPresent: Boolean(activeProviderId),
      pendingPresent: true,
      modalOpen: false,
      channelId: pending.channel.id,
    }));

    discoverLiveAudit('raf-scheduled');
    discoverHandoffFrameRef.current = requestAnimationFrame(() => {
      discoverHandoffFrameRef.current = null;
      discoverLiveAudit('raf-fired');
      const pending = pendingDiscoverLiveLaunchRef.current;
      discoverLiveAudit('pending-read', { pendingPresent: Boolean(pending) });
      if (!pending) {
        discoverLiveAudit('handoff-aborted', { reason: 'pending-missing' });
        return;
      }

      discoverLiveLaunchConsumedRef.current = true;
      pendingDiscoverLiveLaunchRef.current = null;
      setPendingDiscoverLiveLaunch(null);
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'pending-consumed',
        phase: 'launch-requested',
        rail: pending.rail,
        source: pending.rail === 'favorites' ? 'favorite' : 'recent',
        canonicalContentId: pending.channel.id,
        channelIdPresent: true,
        providerIdPresent: Boolean(activeProviderId),
        pendingPresent: false,
        modalOpen: false,
        channelId: pending.channel.id,
      }));
      discoverLiveAudit('pending-consumed');
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'stream-resolve-requested',
        phase: 'stream-resolve-start',
        rail: pending.rail,
        source: pending.rail === 'favorites' ? 'favorite' : 'recent',
        canonicalContentId: pending.channel.id,
        channelIdPresent: true,
        providerIdPresent: Boolean(activeProviderId),
        pendingPresent: false,
        modalOpen: false,
        channelId: pending.channel.id,
      }));
      discoverLiveAudit('stream-resolve-start');
      let streamUrl: string | null | undefined;
      try {
        streamUrl = resolvePlaybackUrl(pending.channel);
      } catch (error) {
        discoverLiveAudit('stream-resolve-error', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: safeDiscoverLiveError(error),
        });
        discoverLiveAudit('handoff-aborted', { reason: 'stream-error' });
        throw error;
      }
      if (!streamUrl) {
        discoverLiveAudit('stream-resolve-empty', {
          resultType: typeof streamUrl,
          urlPresent: false,
        });
        discoverLiveAudit('handoff-aborted', { reason: 'stream-empty' });
        novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
          phase: 'stream-resolve-failed',
          rail: pending.rail,
          canonicalContentId: pending.channel.id,
          channelId: pending.channel.id,
          streamUrlPresent: false,
          fullscreenActive: false,
          previewStreamUrlPresent: false,
        }));
        showNotification({
          type: 'error',
          title: 'Channel unavailable',
          message: 'This channel is no longer available.',
          duration: 6000,
          scope: 'live',
        });
        return;
      }

      liveSearchPlaybackByIdRef.current.set(pending.channel.id, pending.channel);
      setPreviewStreamSource(resolvePlaybackSource(pending.channel));
      discoverLiveAudit('stream-resolve-success', {
        urlPresent: true,
        urlLength: streamUrl.length,
      });
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        phase: 'stream-resolve-success',
        rail: pending.rail,
        canonicalContentId: pending.channel.id,
        discoverZoneOpen: false,
        channelId: pending.channel.id,
        streamUrlPresent: true,
        fullscreenActive: false,
        previewStreamUrlPresent: false,
      }));
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        event: 'fullscreen-launch-requested',
        rail: pending.rail,
        source: pending.rail === 'favorites' ? 'favorite' : 'recent',
        canonicalContentId: pending.channel.id,
        channelIdPresent: true,
        providerIdPresent: Boolean(activeProviderId),
        pendingPresent: false,
        modalOpen: false,
      }));
      setState((current) => {
        discoverLiveAudit('fullscreen-call', {
          channelIdPresent: Boolean(pending.channel.id),
          urlPresent: true,
        });
        const nextState = openResolvedLiveChannelFullscreen(
          current ?? liveStateRef.current ?? createLiveTvLandingState(pending.channel.categoryId ?? '', pending.channel.id),
          pending.channel.id,
          streamUrl,
        );
        discoverLiveAudit('fullscreen-call-returned');
        return nextState;
      });
      syncLiveTvMemory();
      novacastTrace('[NovaCast Discover Live Handoff] ' + JSON.stringify({
        phase: 'stream-bound',
        rail: pending.rail,
        canonicalContentId: pending.channel.id,
        discoverZoneOpen: false,
        channelId: pending.channel.id,
        streamUrlPresent: true,
        fullscreenActive: false,
        previewStreamUrlPresent: true,
      }));
    });
  }, [activeProviderId, discoverZoneOpen, pendingDiscoverLiveLaunch, previewStreamUrl, resolvePlaybackSource, resolvePlaybackUrl, showNotification, syncLiveTvMemory]);

  useEffect(() => {
    if (discoverLivePlaybackContextRef.current?.providerId !== activeProviderId) {
      if (discoverLivePlaybackContextRef.current) {
        discoverLiveAudit('surf-context-cleared', { reason: 'provider-change' });
      }
      discoverLivePlaybackContextRef.current = null;
      liveSearchSurfQueueRef.current = null;
    }
  }, [activeProviderId]);

  useEffect(() => {
    return () => {
      if (discoverLivePlaybackContextRef.current) {
        discoverLiveAudit('surf-context-cleared', { reason: 'screen-unmount' });
        discoverLivePlaybackContextRef.current = null;
        liveSearchSurfQueueRef.current = null;
      }
      const frame = discoverHandoffFrameRef.current;
      if (frame != null) {
        cancelAnimationFrame(frame);
        discoverHandoffFrameRef.current = null;
        discoverLiveAudit('raf-cancelled', { reason: 'screen-unmount' });
      }
    };
  }, []);

  const selectCategory = (categoryId: string) => {
    logLiveNavPerf('category-select-start', {
      categoryId,
      channelCount: channels.length,
      focusedChannelId: focusedChannelIdRef.current,
      reason: 'category-selected',
    });
    if (!liveSearchQueueActiveRef.current) {
      liveSearchSurfQueueRef.current = null;
    }
    liveRetryAttemptedRef.current = false;
    categorySelectionIsUserRef.current = true;
    logFocusAudit('category-focus-requested', {
      reason: 'category-select',
      targetType: 'category',
      targetId: categoryId,
    });
    preferredCategoryFocusId.current = categoryId;
    setCategoryFocusEpoch((value) => value + 1);
    scrollCategoryIntoView(categoryId);
    void loadCategoryChannels(categoryId).then((nextChannels) => {
      const nextChannelId = nextChannels[0]?.id ?? '';
      preferredCategoryFocusId.current = categoryId;
      setPreferredChannelFocus(nextChannelId, Boolean(nextChannelId), 'category-ok-to-channels');
      // Category OK must leave the category rail and land in the channel list.
      preferCategoryFocusRef.current = false;
      if (nextChannelId) {
        focusedChannelIdRef.current = nextChannelId;
      }
      setState((current) =>
        current ? selectLiveCategory(current, categoryId, nextChannelId) : createLiveTvLandingState(categoryId, nextChannelId),
      );
      syncLiveTvMemory();
      if (nextChannelId) {
        logFocusAudit('channel-focus-requested', {
          reason: 'category-ok-to-channels',
          targetType: 'channel',
          targetId: nextChannelId,
        });
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
      if (!firstCategoryFocusLoggedRef.current) {
        firstCategoryFocusLoggedRef.current = true;
        logLiveCategoryOrderAudit('first-category-focus-received', {
          providerId: activeProviderId,
          categoryCount: categories.length,
          selectedCategoryId: liveStateRef.current?.selectedCategoryId ?? selectedCategoryId ?? null,
          selectionSource: categorySelectionIsUserRef.current ? 'persisted-user' : 'auto-default',
          orderReady: true,
        });
      }
      if (shouldLoadCategoryOnFocusAlone()) {
        // Pass 2: category focus must not load/tune/preview.
      }
    },
    [activeProviderId, categories.length, focusCategoryRow, selectedCategoryId],
  );

  const tuneChannel = useCallback(
    (channelId: string) => {
      recordLivePerformanceEvent('tune_requested', { channelId, transactionId: liveStateRef.current?.previewRequestId ?? null });
      console.log('[NOVACAST_PLAYER_PERF]', 'tune-requested', {
        elapsedMs: 0,
        channelId,
        fullscreen: Boolean(liveStateRef.current?.fullscreenChannelId),
        reason: 'channel-ok',
      });
      liveLoadAudit('preview-or-fullscreen-start', {
        channelId,
        source: 'channel-ok',
      });
      const now = Date.now();
      if (!shouldAcceptLiveTvOkPress(channelId, lastChannelOkPressRef.current, now)) {
        return;
      }

      lastChannelOkPressRef.current = { channelId, at: now };
      const base = interactionState ?? liveState;
      const nextState = chooseLiveChannel(base ?? createLiveTvLandingState(undefined, channelId), channelId);
      const channel = channels.find((item) => item.id === channelId);
      if (isChannelPressEnteringFullscreen(base, channelId) && !directPlayRequested) {
        console.info('[NovaCast Live Browse Retention]', 'launch-channel-key', { channelId });
      }
      if (isChannelPressEnteringFullscreen(base, channelId)) {
        discoverLivePlaybackContextRef.current = null;
        fullscreenLaunchSourceRef.current = 'channel';
        const streamUrl = channel ? resolvePlaybackUrl(channel) : null;
        if (!channel || !streamUrl) {
          showNotification({
            type: 'error',
            title: 'Channel unavailable',
            message: 'This channel is no longer available.',
            duration: 6000,
            scope: 'live',
          });
          return;
        }
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
      markLiveCatalogInteraction('channel-tune');
      logFocusAudit('tune-channel', {
        reason: 'channel-ok',
        targetType: 'channel',
        targetId: channelId,
      });
      preferredChannelFocusId.current = channelId;
      logFocusAudit('preferred-channel-changed', {
        reason: 'channel-ok',
        targetType: 'channel',
        targetId: channelId,
        preferChannelFocus: preferChannelFocusRef.current,
      });
      // Channel focus clears the mount-time preference while the user moves
      // through the list. Re-arm the selected row after OK so a state update
      // cannot fall back to the category rail. Fullscreen owns focus while it
      // is opening; its close transition restores this row imperatively.
      if (!isChannelPressEnteringFullscreen(base, channelId)) {
        preferCategoryFocusRef.current = false;
        preferChannelFocusRef.current = true;
        logFocusAudit('preferred-channel-changed', {
          reason: 'channel-ok',
          targetType: 'channel',
          targetId: channelId,
          preferChannelFocus: true,
        });
      }
      enrichFocusedChannelEpg(channelId);
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
      if (isChannelPressEnteringFullscreen(base, channelId) && channel) {
        const streamUrl = resolvePlaybackUrl(channel);
        if (streamUrl) {
          console.log('[NOVACAST_PLAYER_PERF]', 'source-update-requested', {
            elapsedMs: 0,
            channelId,
            reason: 'channel-ok-fullscreen',
          });
          setPreviewStreamSource(resolvePlaybackSource(channel));
          setState((current) => openResolvedLiveChannelFullscreen(current ?? liveState ?? createLiveTvLandingState(undefined, channelId), channelId, streamUrl));
        }
      } else {
        setState((current) => chooseLiveChannel(current ?? liveState ?? createLiveTvLandingState(undefined, channelId), channelId));
      }
      syncLiveTvMemory();
    },
    [activeProviderId, channels, directPlayRequested, enrichFocusedChannelEpg, interactionState, liveLoadAudit, liveState, logFocusAudit, resolvePlaybackUrl, showNotification, syncLiveTvMemory],
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
  const surfKeyDownRef = useRef(false);
  const surfDirectionRef = useRef<1 | -1 | null>(null);
  const surfCursorIndexRef = useRef<number | null>(null);
  const surfCursorChannelIdRef = useRef<string | null>(null);
  const nativeSurfSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeSurfEventCountRef = useRef(0);
  const nativeSurfCursorMovesRef = useRef(0);
  const nativeSurfRenderStartRef = useRef<number | null>(null);
  const nativeSurfLastReleaseAtRef = useRef<number | null>(null);
  const nativeSurfLastCommitAtRef = useRef<number | null>(null);
  const nativeSurfTapBurstRef = useRef(false);
  const surfWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfTransactionRef = useRef<{
    attemptId: number;
    surfCommitId: number;
    generation: number;
    desiredChannelId: string;
    stage: string;
  } | null>(null);
  const surfCommitIdRef = useRef(0);
  const surfTokenRef = useRef(0);
  const surfRequestIdRef = useRef(0);
  const pendingSurfDeltaRef = useRef(0);
  const pendingSurfTargetIdRef = useRef<string | null>(null);
  const desiredSurfTargetIdRef = useRef<string | null>(null);
  const surfSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSurfDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const surfLiveChannel = useCallback(
    (delta: 1 | -1, targetOverride?: string, fromSettle = false, commitGeneration?: number, surfCommitId?: number): boolean => {
      if (
        !shouldHandleLiveChannelSurf({
          isLive: true,
          fullscreenActive: Boolean(liveStateRef.current?.fullscreenChannelId),
          modalOpen: isLiveSearchUiBlockingSurf(searchOverlayVisible) || guide.visible,
        })
      ) {
        return false;
      }

      const workload = getLiveTvWorkload();
      if (!workload.surfTransitionInFlight && !targetOverride && !fromSettle) {
        const currentId = liveStateRef.current?.fullscreenChannelId ?? liveStateRef.current?.previewChannelId ?? null;
        const discoverContext = liveStateRef.current?.fullscreenChannelId ? discoverLivePlaybackContextRef.current : null;
        const searchSession = liveSearchPlaybackSessionRef.current;
        const channelIds = discoverContext?.channels.map((channel) => channel.id) ?? searchSession?.resultIds ?? resolveLiveSearchSurfQueue(
          liveSearchSurfQueueRef.current,
          channels.map((channel) => channel.id),
        );
        const selectionBaseId = desiredSurfTargetIdRef.current ?? currentId;
        const adjacent = resolveLiveSurfAdjacent({ channelIds, currentId: selectionBaseId, direction: delta });
        if (adjacent.kind === 'noop') {
          return false;
        }
        desiredSurfTargetIdRef.current = adjacent.toChannelId;
        const selectedChannel = discoverContext?.channels.find((channel) => channel.id === adjacent.toChannelId) ??
          (searchSession ? searchSession.channelsById.get(adjacent.toChannelId) : null) ??
          channels.find((channel) => channel.id === adjacent.toChannelId);
        publishFullscreenSurfOverlay({
          channelId: adjacent.toChannelId,
          channelName: displayLiveChannelName(selectedChannel?.name ?? 'Channel'),
          channelNumber: selectedChannel?.number ? String(selectedChannel.number) : undefined,
        });
        focusedChannelIdRef.current = adjacent.toChannelId;
        setPreferredChannelFocus(adjacent.toChannelId, preferChannelFocusRef.current, 'fullscreen-surf-selection');
        console.info('[NovaCast Live Surf Intent]', {
          event: 'selection-updated',
          actualIndex: adjacent.fromIndex,
          desiredIndex: adjacent.toIndex,
          direction: delta,
          settleTimerArmed: true,
        });
        if (surfSettleTimerRef.current) clearTimeout(surfSettleTimerRef.current);
        surfSettleTimerRef.current = setTimeout(() => {
          surfSettleTimerRef.current = null;
          const desiredTargetId = desiredSurfTargetIdRef.current;
          desiredSurfTargetIdRef.current = null;
          if (!desiredTargetId) return;
          const ids = discoverLivePlaybackContextRef.current?.channels.map((channel) => channel.id) ??
            liveSearchPlaybackSessionRef.current?.resultIds ??
            resolveLiveSearchSurfQueue(liveSearchSurfQueueRef.current, channels.map((channel) => channel.id));
          const fromIndex = ids.indexOf(liveStateRef.current?.fullscreenChannelId ?? '');
          const toIndex = ids.indexOf(desiredTargetId);
          console.info('[NovaCast Live Surf Intent]', {
            event: 'tune-after-settle',
            fromIndex,
            toIndex,
            settleMs: 250,
          });
          surfLiveChannel(toIndex >= fromIndex ? 1 : -1, desiredTargetId, true);
        }, 250);
        return true;
      }

      if (workload.surfTransitionInFlight) {
        const currentId = liveStateRef.current?.fullscreenChannelId ?? liveStateRef.current?.previewChannelId ?? null;
        const discoverContext = liveStateRef.current?.fullscreenChannelId ? discoverLivePlaybackContextRef.current : null;
        const surfQueue = discoverContext?.channels ?? null;
        const searchSession = liveSearchPlaybackSessionRef.current;
        const channelIds = surfQueue?.map((channel) => channel.id) ?? searchSession?.resultIds ?? resolveLiveSearchSurfQueue(
          liveSearchSurfQueueRef.current,
          channels.map((channel) => channel.id),
        );
        const activeTargetId = intendedSurfChannelIdRef.current ?? currentId;
        const desiredBaseId = desiredSurfTargetIdRef.current ?? pendingSurfTargetIdRef.current ?? activeTargetId;
        const nextIntentDelta = Math.max(-5, Math.min(5, pendingSurfDeltaRef.current + delta));
        const desiredTarget = desiredBaseId
          ? resolveLiveSurfAdjacent({ channelIds, currentId: desiredBaseId, direction: delta })
          : null;
        if (nextIntentDelta !== pendingSurfDeltaRef.current && desiredTarget?.kind === 'adjacent') {
          pendingSurfDeltaRef.current = nextIntentDelta;
          pendingSurfTargetIdRef.current = desiredTarget.toChannelId;
          desiredSurfTargetIdRef.current = desiredTarget.toChannelId;
        }
        console.info('[NovaCast Live Surf Intent]', {
          event: 'selection-updated-during-tune',
          direction: delta,
          pendingDelta: pendingSurfDeltaRef.current,
          currentChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
          activeTransitionTargetId: activeTargetId,
          desiredTargetId: pendingSurfTargetIdRef.current ?? activeTargetId,
        });
        return true;
      }

      const currentId = liveStateRef.current?.fullscreenChannelId ?? liveStateRef.current?.previewChannelId ?? null;
      const discoverContext = liveStateRef.current?.fullscreenChannelId ? discoverLivePlaybackContextRef.current : null;
      const surfQueue = discoverContext?.channels ?? null;
      const searchSession = liveSearchPlaybackSessionRef.current;
      const adjacent = targetOverride
        ? resolveLiveSurfTarget({
          channelIds: surfQueue?.map((channel) => channel.id) ?? searchSession?.resultIds ?? resolveLiveSearchSurfQueue(
            liveSearchSurfQueueRef.current,
            channels.map((channel) => channel.id),
          ),
          currentId,
          targetId: targetOverride,
        })
        : resolveLiveSurfAdjacent({
          channelIds: surfQueue?.map((channel) => channel.id) ?? searchSession?.resultIds ?? resolveLiveSearchSurfQueue(
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
      const nativeCommitPrepare = fromSettle && commitGeneration !== undefined;
      if (commitGeneration !== undefined) {
        surfCommitGenerationByRequestRef.current.set(requestId, commitGeneration);
        surfCommitGenerationByChannelRef.current.set(nextId, commitGeneration);
      }
      if (surfCommitId !== undefined) {
        surfCommitIdByRequestRef.current.set(requestId, surfCommitId);
      }
      desiredSurfTargetIdRef.current = null;
      pendingSurfTargetIdRef.current = null;
      pendingSurfDeltaRef.current = 0;
      if (discoverContext) {
        discoverLiveAudit('surf-request', {
          source: discoverContext.source,
          direction: delta === 1 ? 'next' : 'previous',
          fromIndex: adjacent.fromIndex,
          toIndex: adjacent.toIndex,
          queueCount: adjacent.queueLength,
        });
      }
      intendedSurfChannelIdRef.current = nextId;
      const nextChannel = surfQueue?.find((candidate) => candidate.id === nextId) ??
        (searchSession ? searchSession.channelsById.get(nextId) ?? null :
          resolveLivePlaybackChannel(nextId, channels, liveSearchPlaybackByIdRef.current));
      if (searchSession && nextChannel) {
        liveSearchPlaybackSessionRef.current = {
          ...searchSession,
          currentIndex: adjacent.toIndex,
          selectedId: nextId,
        };
      }
      if (discoverContext && nextChannel) {
        const canonicalId = nextChannel.id.trim();
        if (canonicalId) {
          liveSearchPlaybackByIdRef.current.set(canonicalId, nextChannel);
          discoverLiveAudit('surf-destination-registered', {
            source: discoverContext.source,
            destinationIdPresent: true,
          });
        }
      }
      if (!nativeCommitPrepare) {
        publishFullscreenSurfOverlay({
          channelId: nextId,
          channelName: displayLiveChannelName(nextChannel?.name ?? 'Channel'),
          channelNumber: nextChannel?.number ? String(nextChannel.number) : undefined,
        });
      }
      console.log('[NOVACAST_PLAYER_PERF]', 'surf-key-accepted', {
        elapsedMs: 0,
        fromChannelId: adjacent.fromChannelId,
        targetChannelId: nextId,
        requestId,
        reason: 'fullscreen-surf',
      });
      if (!nativeCommitPrepare) {
        if (surfOverlayTimerRef.current) {
          clearTimeout(surfOverlayTimerRef.current);
        }
        surfOverlayTimerRef.current = setTimeout(() => clearFullscreenSurfOverlay(nextId), LIVE_SURF_OVERLAY_HIDE_MS);
        setPreferredChannelFocus(nextId, preferChannelFocusRef.current, 'fullscreen-surf');
        focusedChannelIdRef.current = nextId;
      }

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
        if (
          commitGeneration !== undefined &&
          commitGeneration !== fullscreenSurfIntentGenerationRef.current
        ) {
          console.info('[NovaCast Live Surf Playback]', {
            event: 'stale-commit-dropped',
            surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
            commitGeneration,
            currentGeneration: fullscreenSurfIntentGenerationRef.current,
            stage: 'transition-settled-source-commit',
          });
          surfCommitGenerationByRequestRef.current.delete(requestId);
          return;
        }
        const prepareStartedAt = liveLoadAuditNow();
        console.info('[NovaCast Surf Commit]', {
          surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
          generation: commitGeneration ?? null,
          stage: 'prepare-start',
          elapsedMsFromPrepareStart: 0,
        });
        let preparedSource: LivePlaybackSource | null = null;
        if (nativeCommitPrepare) {
          console.info('[NovaCast Surf Commit]', {
            surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
            generation: commitGeneration,
            stage: 'source-resolve-start',
            elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
          });
          try {
            preparedSource = nextChannel ? resolvePlaybackSource(nextChannel) : null;
          } catch {
            preparedSource = null;
          }
          if (!preparedSource) {
            console.info('[NovaCast Surf Commit]', {
              surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
              generation: commitGeneration,
              stage: 'prepare-failed',
              elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
            });
            patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-prepare-failed' });
            return;
          }
          if (commitGeneration !== fullscreenSurfIntentGenerationRef.current) {
            console.info('[NovaCast Surf Commit]', {
              surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
              generation: commitGeneration,
              stage: 'stale-dropped',
              elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
            });
            surfCommitGenerationByRequestRef.current.delete(requestId);
            surfCommitGenerationByChannelRef.current.delete(nextId);
            surfCommitIdByRequestRef.current.delete(requestId);
            return;
          }
          console.info('[NovaCast Surf Commit]', {
            surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
            generation: commitGeneration,
            stage: 'source-resolve-ready',
            elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
          });
          console.info('[NovaCast Surf Commit]', {
            surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
            generation: commitGeneration,
            stage: 'commit-start',
            elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
          });
          clearFullscreenSurfOverlay(nextId);
          setPreviewStreamSource(preparedSource);
          console.info('[NovaCast Surf Commit]', {
            surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
            generation: commitGeneration,
            stage: 'player-source-applied',
            elapsedMsFromPrepareStart: Math.round(liveLoadAuditNow() - prepareStartedAt),
          });
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
        if (discoverContext) {
          discoverContext.currentIndex = adjacent.toIndex;
          discoverContext.focusedItemId = nextId;
          discoverLiveAudit('surf-launch', {
            source: discoverContext.source,
            destinationChannelIdPresent: true,
          });
        }
        setState((current) => {
          const base = current ?? liveStateRef.current;
          if (!base) {
            return current;
          }
          if (
            commitGeneration !== undefined &&
            commitGeneration !== fullscreenSurfIntentGenerationRef.current
          ) {
            console.info('[NovaCast Live Surf Playback]', {
              event: 'stale-commit-dropped',
              surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? requestId,
              commitGeneration,
              currentGeneration: fullscreenSurfIntentGenerationRef.current,
              stage: 'state-update',
            });
            surfCommitGenerationByRequestRef.current.delete(requestId);
            surfCommitGenerationByChannelRef.current.delete(nextId);
            surfCommitIdByRequestRef.current.delete(requestId);
            return current;
          }
          if (shouldClearPreviewStreamUrl(base.previewChannelId, nextId)) {
            console.log('[NOVACAST_PLAYER_PERF]', 'source-update-requested', {
              elapsedMs: 0,
              channelId: nextId,
              requestId,
              surfCommitId: surfCommitIdByRequestRef.current.get(requestId) ?? null,
              reason: 'fullscreen-surf-preserve-current-until-next-source',
            });
          }
          return surfLiveFullscreenChannel(base, nextId);
        });
        logLiveSelection('preview-requested', {
          focusedChannelId: nextId,
          activePreviewChannelId: nextId,
          actionSource: 'live-surf',
          requestToken: (liveStateRef.current?.previewRequestId ?? 0) + 1,
        });
        markLiveCatalogInteraction('fullscreen-surf');
      }, fromSettle ? 0 : LIVE_CHANNEL_SURF_DEBOUNCE_MS);
      return true;
    },
    [channels, directPlayRequested, guide.visible, resolvePlaybackSource, searchOverlayVisible, setPreferredChannelFocus],
  );

  const handleNativeFullscreenSurfEvent = useCallback(
    (event: FullscreenSurfKeyEvent) => {
      const isDown = event.action === 0;
      const isUp = event.action === 1;
      const direction = event.keyCode === 21 ? -1 : event.keyCode === 22 ? 1 : null;
      if (!direction || (!isDown && !isUp)) {
        return;
      }

      if (isDown) {
        const now = Date.now();
        if (
          !surfKeyDownRef.current &&
          ((nativeSurfLastReleaseAtRef.current !== null && now - nativeSurfLastReleaseAtRef.current < 600) ||
            (nativeSurfLastCommitAtRef.current !== null && now - nativeSurfLastCommitAtRef.current < 600))
        ) {
          nativeSurfTapBurstRef.current = true;
        }
        if (!surfKeyDownRef.current && nativeSurfEventCountRef.current > 0) {
          console.info('[NovaCast Surf Perf Summary]', {
            event: 'session-cancelled',
            reason: 'new-input-before-settle',
            eventCount: nativeSurfEventCountRef.current,
            cursorMoves: nativeSurfCursorMovesRef.current,
            parentRenderCount: nativeSurfRenderStartRef.current === null
              ? 0
              : liveScreenRenderCountRef.current - nativeSurfRenderStartRef.current,
            overlayRenderCount: 'external-store',
          });
          nativeSurfEventCountRef.current = 0;
          nativeSurfCursorMovesRef.current = 0;
          nativeSurfRenderStartRef.current = null;
        }
        surfKeyDownRef.current = true;
        surfDirectionRef.current = direction;
        const workload = getLiveTvWorkload();
        if (workload.surfTransitionInFlight) {
          patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-new-input-breaks-stale-transaction' });
          console.info('[NovaCast Surf Tx]', {
            attemptId: surfTransactionRef.current?.attemptId ?? null,
            surfCommitId: surfTransactionRef.current?.surfCommitId ?? null,
            generation: fullscreenSurfIntentGenerationRef.current,
            desiredChannelId: surfCursorChannelIdRef.current,
            readyChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
            stage: 'cancelled',
            ageMs: null,
            activeAttemptId: surfTransactionRef.current?.attemptId ?? null,
            replaceInFlight: true,
            pendingLatestChannelId: surfCursorChannelIdRef.current,
          });
        }
        if (surfWatchdogTimerRef.current) {
          clearTimeout(surfWatchdogTimerRef.current);
          surfWatchdogTimerRef.current = null;
        }
        surfTransactionRef.current = null;
        pendingSurfTargetIdRef.current = null;
        pendingSurfDeltaRef.current = 0;
        if (nativeSurfSettleTimerRef.current) {
          clearTimeout(nativeSurfSettleTimerRef.current);
          nativeSurfSettleTimerRef.current = null;
        }

        const discoverContext = discoverLivePlaybackContextRef.current;
        const searchSession = liveSearchPlaybackSessionRef.current;
        const channelIds = discoverContext?.channels.map((channel) => channel.id) ??
          searchSession?.resultIds ??
          resolveLiveSearchSurfQueue(liveSearchSurfQueueRef.current, channels.map((channel) => channel.id));
        if (channelIds.length === 0) {
          return;
        }

        const actualId = liveStateRef.current?.fullscreenChannelId ?? null;
        const currentIndex = surfCursorIndexRef.current != null &&
          surfCursorChannelIdRef.current && channelIds[surfCursorIndexRef.current] === surfCursorChannelIdRef.current
          ? surfCursorIndexRef.current
          : Math.max(0, channelIds.indexOf(actualId ?? ''));
        const nextIndex = (currentIndex + direction + channelIds.length) % channelIds.length;
        const nextId = channelIds[nextIndex];
        if (!nextId) {
          return;
        }
        surfCursorIndexRef.current = nextIndex;
        surfCursorChannelIdRef.current = nextId;
        fullscreenSurfIntentGenerationRef.current += 1;
        if (fullscreenFrameStatus !== 'ready') {
          console.info('[NovaCast Surf Recovery]', {
            event: 'directional-input-during-player-warning',
            keyCode: event.keyCode,
            overlayType: fullscreenFrameStatus === 'error' ? 'error' : 'loading',
            oldAttemptId: liveStateRef.current?.previewRequestId ?? null,
            newGeneration: fullscreenSurfIntentGenerationRef.current,
          });
          setFullscreenFrameStatus('pending');
        }
        const nextChannel = discoverContext?.channels.find((channel) => channel.id === nextId) ??
          (searchSession ? searchSession.channelsById.get(nextId) : null) ??
          channels.find((channel) => channel.id === nextId);
        publishFullscreenSurfOverlay({
          channelId: nextId,
          channelName: displayLiveChannelName(nextChannel?.name ?? 'Channel'),
          channelNumber: nextChannel?.number ? String(nextChannel.number) : undefined,
        });
        nativeSurfCursorMovesRef.current += 1;
        nativeSurfEventCountRef.current += 1;
        const shouldSample = !event.repeatCount || event.repeatCount % 10 === 0;
        if (nativeSurfRenderStartRef.current === null) {
          nativeSurfRenderStartRef.current = liveScreenRenderCountRef.current;
        }
        if (shouldSample) {
          console.info('[NovaCast Live Surf Session]', {
            event: event.repeatCount ? 'repeat' : 'down',
            repeatCount: event.repeatCount ?? 0,
            keyHeld: true,
            cursorIndex: nextIndex,
            cursorChannelId: nextId,
            nativeEventTime: event.eventTime ?? null,
            jsReceiptTime: liveLoadAuditNow(),
            cursorCommitTime: liveLoadAuditNow(),
          });
          console.info('[NovaCast Live Surf Cursor]', {
            event: 'cursor-moved',
            fromIndex: currentIndex,
            toIndex: nextIndex,
            channelId: nextId,
            repeatCount: event.repeatCount ?? 0,
          });
        }
        if (surfOverlayTimerRef.current) {
          clearTimeout(surfOverlayTimerRef.current);
        }
        surfOverlayTimerRef.current = setTimeout(() => {
          clearFullscreenSurfOverlay(nextId);
        }, LIVE_SURF_OVERLAY_HIDE_MS);
        return;
      }

      surfKeyDownRef.current = false;
      surfDirectionRef.current = direction;
      nativeSurfLastReleaseAtRef.current = Date.now();
      const releasedGeneration = fullscreenSurfIntentGenerationRef.current;
      const releasedTargetId = surfCursorChannelIdRef.current;
      console.info('[NovaCast Live Surf Session]', {
        event: 'up',
        repeatCount: event.repeatCount ?? 0,
        keyHeld: false,
        cursorIndex: surfCursorIndexRef.current,
        cursorChannelId: releasedTargetId,
      });
      nativeSurfEventCountRef.current += 1;
      if (!releasedTargetId) {
        return;
      }
      if (nativeSurfSettleTimerRef.current) {
        clearTimeout(nativeSurfSettleTimerRef.current);
      }
      const settleDelayMs = nativeSurfTapBurstRef.current ? 480 : 200;
      nativeSurfSettleTimerRef.current = setTimeout(() => {
        nativeSurfSettleTimerRef.current = null;
        if (surfKeyDownRef.current || fullscreenSurfIntentGenerationRef.current !== releasedGeneration ||
          surfCursorChannelIdRef.current !== releasedTargetId) {
          console.info('[NovaCast Live Surf ASSERT]', 'blocked-tune-while-key-held');
          return;
        }
        const currentId = liveStateRef.current?.fullscreenChannelId ?? null;
        if (!currentId || currentId === releasedTargetId) {
          return;
        }
        const ids = discoverLivePlaybackContextRef.current?.channels.map((channel) => channel.id) ??
          liveSearchPlaybackSessionRef.current?.resultIds ??
          resolveLiveSearchSurfQueue(liveSearchSurfQueueRef.current, channels.map((channel) => channel.id));
        const fromIndex = ids.indexOf(currentId);
        const toIndex = ids.indexOf(releasedTargetId);
        if (fromIndex < 0 || toIndex < 0) {
          return;
        }
        const surfCommitId = ++surfCommitIdRef.current;
        nativeSurfLastCommitAtRef.current = Date.now();
        activeSurfCommitGenerationRef.current = releasedGeneration;
        activeSurfCommitIdRef.current = surfCommitId;
        const expectedRequestId = surfRequestIdRef.current + 1;
        surfTransactionRef.current = {
          attemptId: surfCommitId,
          surfCommitId,
          generation: releasedGeneration,
          desiredChannelId: releasedTargetId,
          stage: 'commit-requested',
        };
        console.info('[NovaCast Surf Tx]', {
          attemptId: surfCommitId,
          surfCommitId,
          generation: releasedGeneration,
          desiredChannelId: releasedTargetId,
          readyChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
          stage: 'attempt-created',
          ageMs: 0,
          activeAttemptId: surfCommitId,
          replaceInFlight: false,
          pendingLatestChannelId: null,
        });
        console.info('[NovaCast Live Surf Playback]', {
          event: 'tune-after-release',
          channelId: releasedTargetId,
          generation: releasedGeneration,
          surfCommitId,
          });
        console.info('[NovaCast Surf Perf Summary]', {
          event: 'session-complete',
          eventCount: nativeSurfEventCountRef.current,
          maxInputAgeMs: null,
          avgInputAgeMs: null,
          cursorMoves: nativeSurfCursorMovesRef.current,
          parentRenderCount: nativeSurfRenderStartRef.current === null
            ? 0
            : liveScreenRenderCountRef.current - nativeSurfRenderStartRef.current,
          overlayRenderCount: 'external-store',
        });
        nativeSurfRenderStartRef.current = null;
        nativeSurfEventCountRef.current = 0;
        nativeSurfCursorMovesRef.current = 0;
        surfLiveChannel(toIndex >= fromIndex ? 1 : -1, releasedTargetId, true, releasedGeneration, surfCommitId);
        if (surfWatchdogTimerRef.current) clearTimeout(surfWatchdogTimerRef.current);
        surfWatchdogTimerRef.current = setTimeout(() => {
          const transaction = surfTransactionRef.current;
          if (
            !transaction ||
            transaction.attemptId !== surfCommitId ||
            transaction.generation !== fullscreenSurfIntentGenerationRef.current ||
            surfRequestIdRef.current < expectedRequestId
          ) {
            surfWatchdogTimerRef.current = null;
            if (transaction?.attemptId === surfCommitId) {
              surfTransactionRef.current = null;
            }
            return;
          }
          patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-watchdog-stalled' });
          console.info('[NovaCast Surf Tx]', {
            attemptId: surfCommitId,
            surfCommitId,
            generation: releasedGeneration,
            desiredChannelId: releasedTargetId,
            readyChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
            stage: 'watchdog-stalled',
            ageMs: FULLSCREEN_FIRST_FRAME_TIMEOUT_MS + 5000,
            activeAttemptId: surfCommitId,
            replaceInFlight: true,
            pendingLatestChannelId: null,
          });
          surfTransactionRef.current = null;
          surfWatchdogTimerRef.current = null;
        }, FULLSCREEN_FIRST_FRAME_TIMEOUT_MS + 5000);
      }, settleDelayMs);
    },
    [channels, fullscreenFrameStatus, surfLiveChannel],
  );

  useEffect(() => {
    if (liveState?.fullscreenChannelId) {
      const ids = discoverLivePlaybackContextRef.current?.channels.map((channel) => channel.id) ??
        liveSearchPlaybackSessionRef.current?.resultIds ??
        resolveLiveSearchSurfQueue(liveSearchSurfQueueRef.current, channels.map((channel) => channel.id));
      const index = ids.indexOf(liveState.fullscreenChannelId);
      surfCursorIndexRef.current = index >= 0 ? index : null;
      surfCursorChannelIdRef.current = liveState.fullscreenChannelId;
    } else {
      activeSurfCommitGenerationRef.current = null;
      if (surfWatchdogTimerRef.current) {
        clearTimeout(surfWatchdogTimerRef.current);
        surfWatchdogTimerRef.current = null;
      }
      surfTransactionRef.current = null;
      surfKeyDownRef.current = false;
      surfDirectionRef.current = null;
      surfCursorIndexRef.current = null;
      surfCursorChannelIdRef.current = null;
      clearFullscreenSurfOverlay();
      if (surfOverlayTimerRef.current) {
        clearTimeout(surfOverlayTimerRef.current);
        surfOverlayTimerRef.current = null;
      }
      fullscreenSurfIntentGenerationRef.current += 1;
      if (nativeSurfSettleTimerRef.current) {
        clearTimeout(nativeSurfSettleTimerRef.current);
        nativeSurfSettleTimerRef.current = null;
      }
    }
  }, [channels, liveState?.fullscreenChannelId]);

  useEffect(() => () => {
    if (surfWatchdogTimerRef.current) {
      clearTimeout(surfWatchdogTimerRef.current);
      surfWatchdogTimerRef.current = null;
    }
    surfTransactionRef.current = null;
    fullscreenExitFocusPendingRef.current = false;
    fullscreenExitFocusPhaseRef.current = 'idle';
    fullscreenExitFocusReassertedRef.current = false;
    if (fullscreenExitFocusPendingTimerRef.current) {
      clearTimeout(fullscreenExitFocusPendingTimerRef.current);
      fullscreenExitFocusPendingTimerRef.current = null;
    }
    if (fullscreenExitFocusStabilizationTimerRef.current) {
      clearTimeout(fullscreenExitFocusStabilizationTimerRef.current);
      fullscreenExitFocusStabilizationTimerRef.current = null;
    }
    clearFullscreenSurfOverlay();
  }, []);

  useEffect(() => {
    if (
      surfRequestIdRef.current > 0 &&
      liveState?.previewStatus === 'ready' &&
      liveState.fullscreenChannelId &&
      liveState.fullscreenChannelId === intendedSurfChannelIdRef.current &&
      lastSettledSurfRequestIdRef.current !== surfRequestIdRef.current
    ) {
      lastSettledSurfRequestIdRef.current = surfRequestIdRef.current;
      if (surfWatchdogTimerRef.current) {
        clearTimeout(surfWatchdogTimerRef.current);
        surfWatchdogTimerRef.current = null;
      }
      if (surfTransactionRef.current) {
        const transaction = surfTransactionRef.current;
        transaction.stage = 'ready';
        console.info('[NovaCast Surf Tx]', {
          ...transaction,
          readyChannelId: liveState.fullscreenChannelId,
          ageMs: null,
          activeAttemptId: transaction.attemptId,
          replaceInFlight: false,
          pendingLatestChannelId: null,
        });
        console.info('[NovaCast Surf Tx]', {
          attemptId: transaction.attemptId,
          surfCommitId: transaction.surfCommitId,
          generation: transaction.generation,
          desiredChannelId: transaction.desiredChannelId,
          readyChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
          stage: 'reset-ready',
          ageMs: null,
          activeAttemptId: null,
          replaceInFlight: false,
          pendingLatestChannelId: null,
        });
        surfTransactionRef.current = null;
      }
      patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-complete' });
      const pendingTargetId = desiredSurfTargetIdRef.current ?? pendingSurfTargetIdRef.current;
      if (pendingTargetId && pendingTargetId !== liveState.fullscreenChannelId) {
        const followUpTargetId = pendingTargetId;
        const fromChannelId = liveState.fullscreenChannelId;
        pendingSurfTargetIdRef.current = null;
        pendingSurfDeltaRef.current = 0;
        console.info('[NovaCast Live Surf Intent]', {
          event: 'coalesced-follow-up',
          fromChannelId: liveState.fullscreenChannelId,
          desiredTargetId: pendingTargetId,
          currentChannelId: liveState.fullscreenChannelId,
        });
        console.info('[NovaCast Surf Tx]', {
          attemptId: null,
          surfCommitId: null,
          generation: fullscreenSurfIntentGenerationRef.current,
          desiredChannelId: followUpTargetId,
          readyChannelId: fromChannelId,
          stage: 'pending-latest-promoted',
          ageMs: null,
          activeAttemptId: null,
          replaceInFlight: false,
          pendingLatestChannelId: followUpTargetId,
        });
        if (pendingSurfDrainTimerRef.current) clearTimeout(pendingSurfDrainTimerRef.current);
        pendingSurfDrainTimerRef.current = setTimeout(() => {
          pendingSurfDrainTimerRef.current = null;
          const ids = discoverLivePlaybackContextRef.current?.channels.map((channel) => channel.id) ??
            liveSearchPlaybackSessionRef.current?.resultIds ??
            resolveLiveSearchSurfQueue(liveSearchSurfQueueRef.current, channels.map((channel) => channel.id));
          const fromIndex = ids.indexOf(fromChannelId);
          const targetIndex = ids.indexOf(followUpTargetId);
          surfLiveChannel(targetIndex >= fromIndex ? 1 : -1, followUpTargetId);
        }, 0);
      } else {
        pendingSurfTargetIdRef.current = null;
        pendingSurfDeltaRef.current = 0;
        console.info('[NovaCast Live Surf Intent]', { event: 'settled' });
      }
      logLiveSurf({
        event: 'transition-complete',
        toChannelId: liveState.fullscreenChannelId,
        surfSessionId: surfSessionIdRef.current,
        requestId: surfRequestIdRef.current,
      });
      liveSurfRouterRef.current?.notifyTransitionSettled();
    }
  }, [liveState?.fullscreenChannelId, liveState?.previewStatus, surfLiveChannel]);

  useEffect(() => {
    if (
      surfRequestIdRef.current > 0 &&
      liveState?.previewStatus === 'error' &&
      liveState.fullscreenChannelId &&
      liveState.fullscreenChannelId === intendedSurfChannelIdRef.current &&
      lastSettledSurfRequestIdRef.current !== surfRequestIdRef.current
    ) {
      lastSettledSurfRequestIdRef.current = surfRequestIdRef.current;
      if (surfWatchdogTimerRef.current) {
        clearTimeout(surfWatchdogTimerRef.current);
        surfWatchdogTimerRef.current = null;
      }
      if (surfTransactionRef.current) {
        surfTransactionRef.current.stage = 'error';
        console.info('[NovaCast Surf Tx]', {
          ...surfTransactionRef.current,
          readyChannelId: liveStateRef.current?.fullscreenChannelId ?? null,
          ageMs: null,
          activeAttemptId: surfTransactionRef.current.attemptId,
          replaceInFlight: false,
          pendingLatestChannelId: null,
        });
        surfTransactionRef.current = null;
      }
      patchLiveTvWorkload({ surfTransitionInFlight: false }, { log: true, reason: 'surf-failed' });
      pendingSurfDeltaRef.current = 0;
      pendingSurfTargetIdRef.current = null;
      console.info('[NovaCast Live Surf Intent]', { event: 'settled', reason: 'transition-failed' });
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

    discoverLivePlaybackContextRef.current = null;
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

  const favoriteChannelIds = liveFavoriteContentIds;
  const favoriteChannel = useCallback(
    (channelId: string) => {
      const channel = channels.find((item) => item.id === channelId);
      if (channel) {
        void toggleLiveFavorite(activeProviderId, channel);
      }
    },
    [activeProviderId, channels],
  );
  favoriteChannelRef.current = favoriteChannel;
  if (!favoriteHoldRef.current) {
    favoriteHoldRef.current = createFavoriteHoldDetector({
      onTriggered: (result) => {
        console.info('[NovaCast Favorite Gesture]', 'hold-triggered', {
          measuredHoldMs: Math.round(result.measuredHoldMs),
          thresholdMs: result.thresholdMs,
          focusedChannelId: focusedChannelIdRef.current,
          suppressionArmed: result.suppressionArmed,
          triggerLatencyMs: Math.round(result.triggerLatencyMs ?? 0),
        });
        const channelId = focusedChannelIdRef.current;
        if (channelId) {
          favoriteChannelRef.current(channelId);
        }
      },
      onStarted: (result) => console.info('[NovaCast Favorite Gesture]', 'down', {
        thresholdMs: result.thresholdMs,
        focusedChannelId: focusedChannelIdRef.current,
        jsReceiptAtMs: Date.now(),
      }),
      onCancelled: (result) => console.info('[NovaCast Favorite Gesture]', 'up', {
        measuredHoldMs: Math.round(result.measuredHoldMs),
        thresholdMs: result.thresholdMs,
        focusedChannelId: focusedChannelIdRef.current,
        jsReceiptAtMs: Date.now(),
        suppressionArmed: result.suppressionArmed,
      }),
    });
  }
  const handleNativeFavoriteTvKey = useCallback(
    (event: { keyCode?: number; action?: number; repeatCount?: number; eventTime?: number; downTime?: number }) => {
      if (Platform.OS !== 'android' || !Platform.isTV) {
        return;
      }
      const keyCode = event.keyCode;
      if (keyCode !== 23 && keyCode !== 66 && keyCode !== 160) {
        return;
      }
      if (!focusedChannelIdRef.current || focusedActionChannelIdRef.current) {
        return;
      }
      if (searchOverlayVisibleRef.current) {
        return;
      }
      console.info('[NovaCast Favorite Gesture]', event.action === 1 ? 'up-received' : 'down-received', {
        keyCode,
        focusedChannelId: focusedChannelIdRef.current,
        jsReceiptAtMs: Date.now(),
        nativeEventTimeMs: Number.isFinite(event.eventTime) ? event.eventTime : null,
        nativeDownTimeMs: Number.isFinite(event.downTime) ? event.downTime : null,
      });
      favoriteHoldRef.current?.handleEvent({
        keyCode,
        eventKeyAction: event.action,
        repeatCount: event.repeatCount,
        eventTime: event.eventTime,
        downTime: event.downTime,
      });
    },
    [],
  );
  useEffect(() => {
    if (Platform.OS !== 'android' || !Platform.isTV) {
      return;
    }
    const subscription = DeviceEventEmitter.addListener('onNovaCastNativeTvKey', handleNativeFavoriteTvKey);
    return () => {
      subscription.remove();
      favoriteHoldRef.current?.cancel('screen_unmount');
    };
  }, [handleNativeFavoriteTvKey]);
  const consumeFavoriteHoldSuppression = useCallback((channelId: string) => {
    if (focusedChannelIdRef.current !== channelId) {
      return false;
    }
    return favoriteHoldRef.current?.consumeSuppressedPress() ?? false;
  }, []);
  const handleActionFocusChange = useCallback((channelId: string, focused: boolean) => {
    focusedActionChannelIdRef.current = focused ? channelId : null;
    if (focused) {
      favoriteHoldRef.current?.cancel('action_focus');
    }
  }, []);
  const playChannel = useCallback(
    (channelId: string) => {
      if (liveState?.previewChannelId === channelId && liveState.previewStatus === 'ready') {
        watchFullScreen();
        return;
      }
      tuneChannel(channelId);
    },
    [liveState, tuneChannel],
  );
  const closeDiscoverZone = useCallback(() => {
    setDiscoverZoneOpen(false);
    if (!liveStateRef.current?.fullscreenChannelId && discoverLivePlaybackContextRef.current) {
      discoverLiveAudit('surf-context-cleared', { reason: 'discover-closed' });
      discoverLivePlaybackContextRef.current = null;
      liveSearchSurfQueueRef.current = null;
      setDiscoverRestoreItemId(null);
      discoverRestoreItemIdRef.current = null;
    }
  }, []);

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
                onFocus={() => {
                  console.log('[NOVACAST_PLAYER_FOCUS]', 'fullscreen-retry-focus', {
                    targetType: 'fullscreen',
                    targetId: fullscreenChannel?.id ?? null,
                  });
                  setFocusedAction('retry');
                }}
                onBlur={() => {
                  console.log('[NOVACAST_PLAYER_FOCUS]', 'fullscreen-retry-blur', {
                    targetType: 'fullscreen',
                    targetId: fullscreenChannel?.id ?? null,
                  });
                  setFocusedAction(null);
                }}
                onPress={handleReload}
                style={[styles.retryButton, novaTvFocus.base, focusedAction === 'retry' && styles.textFocusActive]}>
                <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
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
              </Pressable>
            </>
          )}
        </View>
      </NovaTvShell>
    );
  }

  if (!renderState) {
    if (directPlayRequested) {
      console.info('[NovaCast Search Direct Play]', 'browse-shell-suppressed', { reason: 'awaiting-channel-data' });
      return (
        <View style={styles.root}>
          <View style={styles.statePanel}>
            <LiveTvPlanetLoader label="Starting playback…" />
          </View>
        </View>
      );
    }
    return (
      <NovaTvShell activeId="live" title="Live TV" subtitle="Browse channels without losing the picture." preferActiveNavigationFocus={false} compactNavigationRail expirationLabel={selectedProviderExpiration}>
        <View style={styles.statePanel}>
          <LiveTvPlanetLoader label="Loading channels…" />
        </View>
      </NovaTvShell>
    );
  }

  if (!renderState.fullscreenChannelId && (directPlayRequested || !liveCategoryStartupReady)) {
    // Startup stability loader: keep the shell/navbar usable, show a centered
    // spinner, and render NO category/channel content until the final US-first
    // order + selection + focus target are ready. Prevents any raw/pre-sort or
    // "Live {id}" placeholder flash and any post-paint reorder or focus loss.
    if (directPlayRequested) {
      console.info('[NovaCast Search Direct Play]', 'browse-shell-suppressed', { reason: 'awaiting-direct-play' });
      return (
        <View style={styles.root}>
          <View style={styles.statePanel}>
            <LiveTvPlanetLoader label="Starting playback…" />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <NovaTvShell
          activeId="live"
          providerLabel={selectedProviderLabel}
          preferActiveNavigationFocus={false}
          navigationFocusable={!searchOwnsBackgroundFocus && !renderState.fullscreenChannelId}
          compactNavigationRail>
          <View style={styles.statePanel}>
            <LiveTvPlanetLoader label="Preparing live channels…" />
          </View>
        </NovaTvShell>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View
        style={styles.browseLayer}
        pointerEvents={renderState.fullscreenChannelId ? 'none' : 'auto'}
        importantForAccessibility={renderState.fullscreenChannelId ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={Boolean(renderState.fullscreenChannelId)}>
      <NovaTvShell
        activeId="live"
        providerLabel={selectedProviderLabel}
        preferActiveNavigationFocus={false}
        navigationFocusable={!searchOwnsBackgroundFocus && !renderState.fullscreenChannelId}
        compactNavigationRail
        onNavigationItemFocus={(navigationId) => {
          if (navigationId && focusOwnerRef.current === 'channels') {
            const now = Date.now();
            if (!lastShellFocusEscapeLogRef.current || now - lastShellFocusEscapeLogRef.current > 500) {
              lastShellFocusEscapeLogRef.current = now;
              recordLiveNavigationMetric('unexpected-region-transition');
              console.warn('[NOVACAST_FOCUS]', 'shell-focus-escape', {
                lastChannelId: focusedChannelIdRef.current,
                lastKeyDirection: lastDpadDirectionRef.current,
                focusedIndex: channels.findIndex((channel) => channel.id === focusedChannelIdRef.current),
                renderBand:
                  liveFocusRenderStateRef.current.bandFirst != null && liveFocusRenderStateRef.current.bandLast != null
                    ? {
                        first: liveFocusRenderStateRef.current.bandFirst,
                        last: liveFocusRenderStateRef.current.bandLast,
                      }
                    : null,
                visibleRange: liveFocusRenderStateRef.current.visibleRange,
                navigationId,
              });
            }
          }
        }}
        >
        <View
          style={styles.screen}
          pointerEvents={searchOwnsBackgroundFocus || Boolean(renderState.fullscreenChannelId) ? 'none' : 'auto'}
          importantForAccessibility={searchOwnsBackgroundFocus || renderState.fullscreenChannelId ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={searchOwnsBackgroundFocus || Boolean(renderState.fullscreenChannelId)}>
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
            <View
              style={styles.panelHeader}
              onLayout={(event) => handleLiveLayoutAudit('header-layout', event.nativeEvent.layout)}>
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
                    preferFocus={preferCategoryFocusRef.current && item.id === (preferredCategoryFocusId.current ?? renderState.selectedCategoryId ?? firstProviderCategoryId ?? null)}
                    suppressFocusVisual={fullscreenExitFocusPendingRef.current}
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
            ]}
            onLayout={(event) => handleLiveLayoutAudit('list-stage-layout', event.nativeEvent.layout)}>
            <View
              style={styles.panelHeader}
              onLayout={(event) => handleLiveLayoutAudit('header-layout', event.nativeEvent.layout)}>
              <Text style={styles.panelTitle}>Channels</Text>
              <View style={styles.channelHeaderActions}>
                <MovieToolbar
                  accessibilityLabel="Search Live TV"
                  buttonRef={searchToolbarRef}
                  searchNextFocusDown={channelNextFocusUpHandle}
                  focusable={!searchOverlayVisible && !renderState.fullscreenChannelId}
                  onSearchFocus={() => setFocusedAction('search')}
                  onSearchPress={openLiveSearch}
                  discoverZoneOpen={discoverZoneOpen}
                  onDiscoverPress={() => {
                    if (searchOpen) closeLiveSearch();
                    logLivePerformance({
                      event: 'discover-zone-open', elapsedMs: 0,
                      providerIdPresent: Boolean(activeProviderId && activeProviderId !== 'no-provider'),
                      categoryCount: categories.length, channelCount: channels.length,
                      selectedCategoryIdPresent: Boolean(selectedCategoryId), source: 'memory',
                      epgPending: false, discoverPending: true,
                    });
                    setDiscoverZoneOpen(true);
                  }}
                />
              </View>
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
                <Text style={styles.inlineStateText}>
                  {isSyntheticLiveMyChannelsCategoryId(renderState.selectedCategoryId)
                    ? 'No saved channels yet'
                    : isSyntheticLiveRecentsCategoryId(renderState.selectedCategoryId)
                      ? 'No recent channels yet'
                      : 'No channels in this category.'}
                </Text>
              </View>
            ) : (
              <LiveTvChannelListReveal revealKey={renderState.selectedCategoryId || selectedCategoryId}>
                <LiveTvChannelList
                  channels={channels}
                  epgByChannelId={epgByChannelId}
                  epgRevision={epgRevision}
                  categoryId={renderState.selectedCategoryId}
                  epgPendingChannelIds={epgPendingChannelIds}
                  selectedChannelId={renderState.selectedChannelId}
                  previewChannelId={renderState.previewChannelId}
                  preferFocusChannelId={preferChannelFocusRef.current ? (preferredChannelFocusId.current ?? channels[0]?.id ?? null) : null}
                  categoryFocusLeftHandle={categoryFocusLeftHandle}
                  channelNextFocusUpHandle={channelNextFocusUpHandle}
                  favoriteChannelIds={favoriteChannelIds}
                  onFavoriteChannel={favoriteChannel}
                  onPlayChannel={playChannel}
                  playEnabled={renderState.previewStatus === 'ready' && Boolean(renderState.previewChannelId) && !renderState.fullscreenChannelId}
                  registerFavoriteActionRef={registerFavoriteActionRef}
                  registerPlayActionRef={registerPlayActionRef}
                  consumeFavoriteHoldSuppression={consumeFavoriteHoldSuppression}
                  onActionFocusChange={handleActionFocusChange}
                  onLayout={handleLiveListLayout}
                  onFocusRenderState={updateLiveFocusRenderState}
                  getLastNavigationIntent={getLastNavigationIntent}
                  listRef={channelsRef}
                  onTuneChannel={tuneChannel}
                  onChannelFocus={focusChannelRow}
                  registerRowRef={registerChannelRowRef}
                />
              </LiveTvChannelListReveal>
            )}
          </View>

          {!directPlayRequested ? (
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
                    <Text style={styles.previewLoadingCopy}>{displayLiveChannelName(detailPanelChannel?.name, 'Unknown channel')}</Text>
                  </View>
                ) : renderState.previewStatus === 'error' ? (
                  <View style={styles.previewLoading}>
                    <MaterialCommunityIcons name="television" size={34} color={theme.colors.textMuted} />
                    <Text style={styles.previewLoadingTitle}>Preview unavailable</Text>
                    <Text style={styles.previewLoadingCopy}>
                      {displayLiveChannelName(detailPanelChannel?.name, 'Try another channel')}
                    </Text>
                    <Pressable
                      focusable
                      accessibilityRole="button"
                      accessibilityLabel="Retry preview"
                      onPress={handlePreviewRetry}
                      style={[styles.watchButton, novaTvFocus.base]}>
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
                    <Text style={styles.previewLoadingCopy}>{displayLiveChannelName(detailPanelChannel?.name, 'Unknown channel')}</Text>
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

              </View>
            </View>
          ) : null}
        </View>
        </View>
      </NovaTvShell>
      </View>

      {fullscreenChannel ? (
        <View style={[styles.fullscreenOverlay, { width, height }]}>
          <FullscreenSurfInput
            enabled={!novaViewProbeActive}
            onEvent={handleNativeFullscreenSurfEvent}
            onNativeReady={setFullscreenSurfNativeActive}
          />
          <LiveTvFocusRouter
            ref={liveSurfRouterRef}
            enabled={!novaViewProbeActive}
            directDirectionalInput={fullscreenSurfNativeActive}
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
          novaViewProbeActive && bundle && novaViewProbeChannel ? (
            <NovaViewProbe
              bundle={bundle}
              playerA={liveStreamPlayer}
              channelA={fullscreenChannel}
              channelB={novaViewProbeChannel}
              onFirstFrameRender={handleFullscreenFirstFrame}
              onPlayingChange={handleLivePlayerPlayingChange}
              onTimeUpdate={handleLivePlayerTimeUpdate}
            />
          ) : (
            <NovaStreamSurface
              player={liveStreamPlayer}
              contentFit="cover"
              style={[styles.fullscreenPlayer, fullscreenFrameStatus !== 'ready' && styles.hiddenStreamSurface]}
              onFirstFrameRender={handleFullscreenFirstFrame}
              onStatusChange={handleLivePlayerStatusChange}
              onPlayingChange={handleLivePlayerPlayingChange}
              onTimeUpdate={handleLivePlayerTimeUpdate}
            />
          )
          ) : null}
          {!novaViewProbeActive ? <FullscreenSurfOverlay /> : null}
          {shouldShowFullscreenLoadingOverlay(fullscreenFrameStatus) ? (
            <View pointerEvents="none" style={styles.fullscreenStatusOverlay}>
              <NovaSpaceLoader label="Starting playback..." />
              <Text style={styles.previewLoadingCopy}>{displayLiveChannelName(fullscreenChannel.name)}</Text>
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
                  onFocus={() => {
                    console.log('[NOVACAST_PLAYER_FOCUS]', 'fullscreen-close-focus', {
                      targetType: 'fullscreen',
                      targetId: fullscreenChannel.id,
                    });
                  }}
                  onBlur={() => {
                    console.log('[NOVACAST_PLAYER_FOCUS]', 'fullscreen-close-blur', {
                      targetType: 'fullscreen',
                      targetId: fullscreenChannel.id,
                    });
                  }}
                  onPress={() => {
                    console.info('[NovaCast Fullscreen Close Origin]', {
                      reason: 'fullscreen-close-control',
                      origin: 'LiveTvScreen.fullscreen-controls',
                      keyCode: null,
                      rawAction: null,
                      repeatCount: null,
                      fullscreenChannelId: fullscreenChannelIdRef.current,
                      nativeSurfActive: fullscreenSurfNativeActive,
                    });
                    captureFullscreenExitTarget();
                    clearFullscreenSurfOverlay();
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
                  {displayLiveChannelName(fullscreenChannel.name)} · {formatPreviewWindow(fullscreenChannel)}
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
        onClose={closeDiscoverZone}
        restoreFocusItemId={discoverRestoreItemId}
        onRestoreFocusHandled={() => {
          setDiscoverRestoreItemId(null);
          discoverRestoreItemIdRef.current = null;
        }}
        onSelectItem={(item, rail, railItems) => {
          if (item.mediaType === 'live' && (rail === 'favorites' || rail === 'recent')) {
            void playDiscoverLiveChannel(item, rail, railItems);
          }
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
        onToggleLiveFavorite={(result) => {
          void toggleLiveFavorite(activeProviderId, toLiveSearchPlaybackChannel(result));
        }}
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
  browseLayer: {
    flex: 1,
    minHeight: 0,
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
    borderRadius: NOVA_GLASS.radius.base,
    backgroundColor: 'rgba(3, 8, 20, 0.58)',
    borderWidth: 1,
    borderColor: NOVA_GLASS.subtle.borderColor,
    borderTopWidth: 1,
    borderTopColor: NOVA_GLASS.focused.topHighlight,
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
    borderRadius: NOVA_GLASS.radius.base,
    borderWidth: 1,
    borderColor: NOVA_GLASS.subtle.borderColor,
    backgroundColor: 'rgba(3, 8, 20, 0.42)',
    padding: 8,
  },
  categoriesPanelCompact: {
    flex: 22,
    minWidth: 200,
    padding: 6,
    paddingRight: 6,
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
    borderRadius: NOVA_GLASS.radius.base,
    borderWidth: 1,
    borderColor: NOVA_GLASS.subtle.borderColor,
    backgroundColor: 'rgba(3, 8, 20, 0.42)',
    padding: 8,
    paddingHorizontal: 8,
  },
  channelsPanelCompact: {
    flex: 53,
    minWidth: 260,
    padding: 6,
    paddingHorizontal: 6,
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
    gap: 8,
  },
  panelTitle: {
    flexShrink: 1,
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
  channelHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
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
    color: '#C4D0E4',
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
    borderRadius: NOVA_GLASS.radius.base,
    borderWidth: 1,
    borderColor: NOVA_GLASS.focused.borderColor,
    backgroundColor: NOVA_GLASS.focused.backgroundColor,
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
