// TODO(stage-live): migrate preview/fullscreen playback to useUnifiedPlayer via UnifiedPlayerHost.
/* eslint-disable react-hooks/refs -- Android TV focus restoration, list handles, and Animated values are intentionally imperative. */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
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

import { getTvDensity, NovaTvShell } from '@/components/nova';
import { usePlaybackActivity } from '@/features/playback/usePlaybackActivity';
import { NovaStreamSurface, useNovaStreamPlayer } from '@/features/playback/NovaStreamPlayer';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { novaTheme } from '@/theme';

import {
  chooseLiveChannel,
  clearPreviewConfirmationOnFocus,
  closeLiveFullscreen,
  createInitialLiveTvState,
  createLiveTvShellState,
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
  shouldFocusPreviewActionAfterChannelOk,
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
  PREVIEW_OVERLAY_AUTO_HIDE_MS,
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
  shouldClearPreviewStreamUrl,
} from './liveTvPreviewScheduling';
import { getLiveTvRowVisualFlags } from './liveTvUiPerfMode';
import { useLiveTvScreenModel } from './useLiveTvScreenModel';
import { displayLiveProgramText, isRawLiveStreamValue } from './liveTvProgramText';

/** Bounded retry count for focusing a just-mounted/just-laid-out native view. */
const FOCUS_RESTORE_MAX_ATTEMPTS = 3;

/**
 * Calls `.focus()` on the target once it (and its native layout) is ready,
 * retrying across a few animation frames instead of a blind timeout. Bounded
 * to `FOCUS_RESTORE_MAX_ATTEMPTS` frames (~50ms) so it can never hang.
 */
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

const FULLSCREEN_CHROME_INSETS = {
  topRow: {
    top: novaTheme.safeArea.top,
    left: novaTheme.safeArea.left,
    right: novaTheme.safeArea.right,
  },
  metaPanel: {
    left: novaTheme.safeArea.left,
    right: novaTheme.safeArea.right,
    bottom: novaTheme.safeArea.bottom + 8,
  },
};

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

function ChannelLogoBadge({ channel }: { channel: ProviderLiveChannel | null | undefined }) {
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
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ categoryId?: string | string[]; channelId?: string | string[]; returnRoute?: string | string[] }>();
  const { width, height } = useWindowDimensions();
  const tvDensity = getTvDensity(width);
  const navigationGateRef = useRef(createTvNavigationGate());
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
  const {
    bundle,
    status: loadStatus,
    errorMessage: loadErrorMessage,
    categories,
    categoryTotalCount,
    channels,
    selectedCategoryId,
    selectCategory: loadCategoryChannels,
    enrichFocusedChannelEpg,
    resolvePlaybackUrl,
    reload,
    initialChannel,
  } = useLiveTvScreenModel(routeCategoryId ?? liveMemory.selectedCategoryId, routeChannelId ?? liveMemory.selectedChannelId);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const liveRetryAttemptedRef = useRef(false);
  const livePreviewRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const liveStateRef = useRef<LiveTvState | null>(null);
  const [interactionState, setState] = useState<LiveTvState | null>(null);
  const [previewStreamUrl, setPreviewStreamUrl] = useState<string | null>(null);
  const [fullscreenFrameStatus, setFullscreenFrameStatus] = useState<FullscreenFrameStatus>('pending');
  const [fullscreenChromeVisible, setFullscreenChromeVisible] = useState(true);
  const [previewOverlayVisible, setPreviewOverlayVisible] = useState(true);
  const [focusedAction, setFocusedAction] = useState<'favorite' | 'fullscreen' | 'retry' | null>(null);
  const [fullscreenRetryNodeTag, setFullscreenRetryNodeTag] = useState<number | null>(null);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapState = useMemo(() => {
    if (!channels.length) {
      return null;
    }

    const categoryId = selectedCategoryId || channels[0]?.categoryId || '';
    const channelId = initialChannel?.id ?? channels[0]?.id ?? '';
    return createInitialLiveTvState(categoryId, channelId);
  }, [channels, initialChannel, selectedCategoryId]);
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
    () => channels.find((channel) => channel.id === liveState?.selectedChannelId) ?? channels[0] ?? null,
    [channels, liveState?.selectedChannelId],
  );
  const previewChannel = useMemo(
    () => channels.find((channel) => channel.id === liveState?.previewChannelId) ?? selectedChannel,
    [channels, selectedChannel, liveState?.previewChannelId],
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
    ? frozenPreviewChannelRef.current ?? selectedChannel
    : previewChannel;
  const detailChannelIsFavorite = personalizationState.liveFavorites.map((item) => item.contentId).includes(detailPanelChannel?.id ?? '');
  const fullscreenChannel = useMemo(
    () => channels.find((channel) => channel.id === liveState?.fullscreenChannelId) ?? null,
    [channels, liveState?.fullscreenChannelId],
  );
  const categoriesRef = useRef<FlatList<ProviderLiveCategory>>(null);
  const channelsRef = useRef<FlatList<LiveTvChannelRowShellData>>(null);
  // Native refs for imperative focus restoration when fullscreen closes.
  // hasTVPreferredFocus only applies at mount time and cannot re-target an
  // already-mounted row/button, so restoring real Android TV focus after an
  // overlay unmounts requires calling .focus() directly on these refs.
  const channelRowRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const watchButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenCloseButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenLaunchSourceRef = useRef<FullscreenLaunchSource>(null);
  const previousFullscreenChannelIdRef = useRef<string | null>(null);
  const isRestoringFullscreenFocusRef = useRef(false);
  const fullscreenRetryButtonRef = useRef<ElementRef<typeof View>>(null);
  const fullscreenRetryFocusKeyRef = useRef<string | null>(null);
  const fullscreenInteractionRef = useRef<ElementRef<typeof View>>(null);
  const lastChannelOkPressRef = useRef<LiveTvOkPressRecord | null>(null);
  const pendingPreviewActionFocusRef = useRef<string | null>(null);
  const preferredCategoryFocusId = useRef(liveMemory.focusedCategoryId ?? categories[0]?.id ?? null);
  const preferredChannelFocusId = useRef(liveMemory.focusedChannelId ?? channels[0]?.id ?? null);
  const preferCategoryFocusRef = useRef(true);
  const preferChannelFocusRef = useRef(true);

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

  const registerChannelRowRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    if (instance) {
      channelRowRefs.current.set(channelId, instance);
    } else {
      channelRowRefs.current.delete(channelId);
    }
  }, []);

  useEffect(() => {
    if (!liveState || liveState.previewStatus !== 'loading' || !liveState.previewChannelId) {
      return;
    }

    const channelId = liveState.previewChannelId;
    const requestId = liveState.previewRequestId;
    const channel = channels.find((item) => item.id === channelId) ?? null;
    const timer = setTimeout(() => {
      const playbackUrl = resolvePlaybackUrl(channel);
      if (!playbackUrl) {
        setPreviewStreamUrl(null);
        setState((current) =>
          resolveLivePreview(current ?? liveState, requestId, channelId, 'error', 'This channel is unavailable right now.'),
        );
        return;
      }

      setPreviewStreamUrl(playbackUrl);
      setState((current) => resolveLivePreview(current ?? liveState, requestId, channelId, 'ready'));
    }, 240);

    return () => clearTimeout(timer);
  // The request id and preview channel fields are the intentional debounce
  // boundary; the full state object would restart the timer on every update.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keep preview debounce scoped to its request fields.
  }, [channels, resolvePlaybackUrl, liveState?.previewChannelId, liveState?.previewRequestId, liveState?.previewStatus]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) {
        return true;
      }

      const action = decideLiveTvBackAction(
        fullscreenChannelIdRef.current,
        isRestoringFullscreenFocusRef.current,
      );

      if (action === 'close-fullscreen') {
        setState((current) => closeLiveFullscreen(current ?? liveState ?? bootstrapState ?? createInitialLiveTvState('', '')));
        return true;
      }

      if (action === 'swallow') {
        // Native focus is still being restored onto the control that launched
        // fullscreen (bounded to a few animation frames, see
        // focusNativeViewWhenReady). fullscreenChannelId is already cleared at
        // this instant, so without this guard a stray/rapid second Back during
        // that brief window would open the Content Hub instead of leaving
        // focus to settle on this screen.
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace(returnRoute);
      return true;
    });

    return () => subscription.remove();
  }, [bootstrapState, guide.visible, liveState, returnRoute, router]);

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

    const source = fullscreenLaunchSourceRef.current;
    const targetChannelId = liveState?.selectedChannelId ?? null;
    isRestoringFullscreenFocusRef.current = true;

    const cancel = focusNativeViewWhenReady(
      () => {
        if (opening) {
          return fullscreenCloseButtonRef.current;
        }
        return source === 'button' ? watchButtonRef.current : targetChannelId ? channelRowRefs.current.get(targetChannelId) : null;
      },
      () => {
        isRestoringFullscreenFocusRef.current = false;
        if (closing) {
          fullscreenLaunchSourceRef.current = null;
        }
      },
    );

    return cancel;
  }, [liveState?.fullscreenChannelId, liveState?.selectedChannelId]);

  useEffect(() => {
    const requestedChannelId = pendingPreviewActionFocusRef.current;
    if (
      !requestedChannelId ||
      requestedChannelId !== liveState?.selectedChannelId ||
      requestedChannelId !== liveState?.previewChannelId ||
      liveState.fullscreenChannelId
    ) {
      return;
    }

    pendingPreviewActionFocusRef.current = null;
    return focusNativeViewWhenReady(() => watchButtonRef.current, () => {});
  }, [
    liveState?.fullscreenChannelId,
    liveState?.previewChannelId,
    liveState?.previewRequestId,
    liveState?.previewStatus,
    liveState?.selectedChannelId,
  ]);

  useEffect(() => {
    if (!liveState?.fullscreenChannelId || fullscreenFrameStatus !== 'pending') {
      return;
    }

    const timer = setTimeout(() => {
      setFullscreenFrameStatus((current) => (current === 'ready' ? current : 'timeout'));
    }, FULLSCREEN_FIRST_FRAME_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [liveState?.fullscreenChannelId, fullscreenFrameStatus]);

  const handleFullscreenFirstFrame = () => setFullscreenFrameStatus('ready');
  const retryFullscreenPlayback = () => {
    setFullscreenFrameStatus('pending');
    setFullscreenChromeVisible(true);
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
      return;
    }

    setFullscreenChromeVisible(true);
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

  const previewOverlayOpacity = useRef(new Animated.Value(1)).current;

  const clearPreviewOverlayTimer = useCallback(() => {
    if (previewOverlayTimerRef.current) {
      clearTimeout(previewOverlayTimerRef.current);
      previewOverlayTimerRef.current = null;
    }
  }, []);

  const fadeOutPreviewOverlay = useCallback(() => {
    Animated.timing(previewOverlayOpacity, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPreviewOverlayVisible(false);
      }
    });
  }, [previewOverlayOpacity]);

  const resetPreviewOverlay = useCallback(() => {
    clearPreviewOverlayTimer();
    setPreviewOverlayVisible(true);
    previewOverlayOpacity.setValue(1);
  }, [clearPreviewOverlayTimer, previewOverlayOpacity]);

  const schedulePreviewOverlayHide = useCallback(() => {
    clearPreviewOverlayTimer();
    previewOverlayTimerRef.current = setTimeout(() => {
      fadeOutPreviewOverlay();
    }, PREVIEW_OVERLAY_AUTO_HIDE_MS);
  }, [clearPreviewOverlayTimer, fadeOutPreviewOverlay]);

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
    return focusNativeViewWhenReady(() => fullscreenRetryButtonRef.current, () => {});
  }, [fullscreenFallbackVisible, fullscreenFrameStatus, liveState?.fullscreenChannelId]);

  useEffect(() => {
    const previewReady =
      liveState?.previewStatus === 'ready' && !streamSurfaceInFullscreen && hasLiveStream;

    if (!previewReady) {
      // The preview overlay is an imperative playback-layer reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the overlay when the preview source becomes unavailable.
      resetPreviewOverlay();
      return;
    }

    resetPreviewOverlay();
    schedulePreviewOverlayHide();
    return clearPreviewOverlayTimer;
  }, [
    clearPreviewOverlayTimer,
    hasLiveStream,
    liveState?.previewChannelId,
    liveState?.previewStatus,
    resetPreviewOverlay,
    schedulePreviewOverlayHide,
    streamSurfaceInFullscreen,
  ]);

  useEffect(() => {
    if (showFullscreenChrome || !liveState?.fullscreenChannelId || fullscreenFrameStatus !== 'ready') {
      return;
    }

    return focusNativeViewWhenReady(() => fullscreenInteractionRef.current, () => {});
  }, [showFullscreenChrome, fullscreenFrameStatus, liveState?.fullscreenChannelId]);

  useEffect(() => {
    syncLiveTvMemory();
  }, [syncLiveTvMemory]);

  const focusCategoryRow = (categoryId: string) => {
    preferredCategoryFocusId.current = categoryId;
    preferCategoryFocusRef.current = false;
  };

  const focusChannelRow = useCallback(
    (channelId: string) => {
      preferredChannelFocusId.current = channelId;
      preferChannelFocusRef.current = false;
      enrichFocusedChannelEpg(channelId);
      setState((current) => {
        const base = current ?? liveState;
        if (!base) {
          return current;
        }

        return clearPreviewConfirmationOnFocus(base, channelId);
      });
    },
    [enrichFocusedChannelEpg, liveState],
  );

  const selectCategory = (categoryId: string) => {
    liveRetryAttemptedRef.current = false;
    void loadCategoryChannels(categoryId).then((nextChannels) => {
      const nextChannelId = nextChannels[0]?.id ?? '';
      preferredCategoryFocusId.current = categoryId;
      preferredChannelFocusId.current = nextChannelId;
      preferCategoryFocusRef.current = true;
      preferChannelFocusRef.current = true;
      setPreviewStreamUrl(null);
      setState((current) =>
        current ? selectLiveCategory(current, categoryId, nextChannelId) : createInitialLiveTvState(categoryId, nextChannelId),
      );
      syncLiveTvMemory();
    });
  };

  const tuneChannel = useCallback(
    (channelId: string) => {
      const now = Date.now();
      if (!shouldAcceptLiveTvOkPress(channelId, lastChannelOkPressRef.current, now)) {
        return;
      }

      lastChannelOkPressRef.current = { channelId, at: now };
      const base = interactionState ?? liveState;
      const nextState = chooseLiveChannel(base ?? createInitialLiveTvState(undefined, channelId), channelId);
      if (isChannelPressEnteringFullscreen(base, channelId)) {
        fullscreenLaunchSourceRef.current = 'channel';
      } else if (shouldFocusPreviewActionAfterChannelOk(base, nextState, channelId)) {
        pendingPreviewActionFocusRef.current = channelId;
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
      setState((current) => chooseLiveChannel(current ?? liveState ?? createInitialLiveTvState(undefined, channelId), channelId));
      syncLiveTvMemory();
    },
    [activeProviderId, channels, enrichFocusedChannelEpg, interactionState, liveState, syncLiveTvMemory],
  );

  const watchFullScreen = () => {
    if (!liveState?.previewChannelId || liveState.previewStatus !== 'ready') {
      return;
    }

    fullscreenLaunchSourceRef.current = 'button';
    setState((current) => {
      const base = current ?? liveState;
      return {
        ...base,
        fullscreenChannelId: base.previewChannelId,
      };
    });
  };

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
      actionLabel: 'Retry',
      onAction: handleReload,
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
      actionLabel: 'Retry',
      onAction: handlePreviewRetry,
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

  const showFatalPanel = !bundle || (categories.length === 0 && loadStatus !== 'loading');

  if (loadStatus === 'loading' && categories.length === 0) {
    return (
      <NovaTvShell activeId="live" title="Live TV" subtitle="Browse channels without losing the picture." preferActiveNavigationFocus={false} compactNavigationRail expirationLabel={selectedProviderExpiration}>
        <View style={styles.statePanel}>
          <MaterialCommunityIcons name="progress-clock" size={34} color={novaTheme.colors.accentHover} />
          <Text style={styles.stateTitle}>Loading Live TV</Text>
          <Text style={styles.stateCopy}>Fetching channels from your provider.</Text>
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
              <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
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
                style={[styles.retryButton, focusedAction === 'retry' && styles.actionFocused]}>
                <MaterialCommunityIcons name="refresh" size={18} color={novaTheme.colors.textPrimary} />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="television-off" size={34} color={novaTheme.colors.textMuted} />
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
                style={[styles.retryButton, focusedAction === 'retry' && styles.actionFocused]}>
                <MaterialCommunityIcons name="refresh" size={18} color={novaTheme.colors.textPrimary} />
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
          <MaterialCommunityIcons name="progress-clock" size={34} color={novaTheme.colors.accentHover} />
          <Text style={styles.stateTitle}>Loading Live TV</Text>
          <Text style={styles.stateCopy}>Preparing channel list.</Text>
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
        compactNavigationRail>
        <View style={styles.screen}>
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
                  onFocus={() => focusCategoryRow(item.id)}
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
              <View style={styles.panelHeaderActions}>
                <Text style={styles.panelCount}>
                  {loadStatus === 'loading' ? '...' : channels.length.toLocaleString()}
                </Text>
                <MaterialCommunityIcons name="tune-variant" size={20} color={novaTheme.colors.textMuted} />
              </View>
            </View>
            {channels.length === 0 && loadStatus === 'error' ? (
              <View style={styles.inlineStateNotice}>
                <MaterialCommunityIcons name="cloud-off-outline" size={22} color={novaTheme.colors.textMuted} />
                <Text style={styles.inlineStateText}>No channels to display right now.</Text>
              </View>
            ) : channels.length === 0 && loadStatus === 'empty' ? (
              <View style={styles.inlineStateNotice}>
                <MaterialCommunityIcons name="television-off" size={22} color={novaTheme.colors.textMuted} />
                <Text style={styles.inlineStateText}>No channels in this category.</Text>
              </View>
            ) : (
              <LiveTvChannelList
                channels={channels}
                selectedChannelId={renderState.selectedChannelId}
                previewChannelId={renderState.previewChannelId}
                preferFocusChannelId={preferChannelFocusRef.current ? preferredChannelFocusId.current : null}
                listRef={channelsRef}
                onTuneChannel={tuneChannel}
                onChannelFocus={focusChannelRow}
                registerRowRef={registerChannelRowRef}
              />
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
                    <MaterialCommunityIcons name="progress-clock" size={34} color={novaTheme.colors.accentHover} />
                    <Text style={styles.previewLoadingTitle}>Loading preview</Text>
                    <Text style={styles.previewLoadingCopy}>{detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Unknown channel'}</Text>
                  </View>
                ) : renderState.previewStatus === 'error' ? (
                  <View style={styles.previewLoading}>
                    <MaterialCommunityIcons name="television" size={34} color={novaTheme.colors.textMuted} />
                    <Text style={styles.previewLoadingTitle}>Preview unavailable</Text>
                    <Text style={styles.previewLoadingCopy}>
                      {detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Try another channel'}
                    </Text>
                  </View>
                ) : streamSurfaceInFullscreen || !hasLiveStream ? (
                  <View style={styles.previewLoading}>
                    <MaterialCommunityIcons name="television" size={34} color={novaTheme.colors.accentHover} />
                    <Text style={styles.previewLoadingTitle}>
                      {streamSurfaceInFullscreen ? 'Playing full screen' : 'Preparing stream'}
                    </Text>
                    <Text style={styles.previewLoadingCopy}>{detailPanelChannel?.name ? displayStreamTitle(detailPanelChannel.name) : 'Unknown channel'}</Text>
                  </View>
                ) : (
                  <>
                    <NovaStreamSurface player={liveStreamPlayer} style={styles.previewPlayer} />
                    {previewOverlayVisible ? (
                      <Animated.View style={[styles.previewOverlay, { opacity: previewOverlayOpacity }]}>
                        <View style={styles.previewBrandRow}>
                          <ChannelLogoBadge channel={detailPanelChannel} />
                          <Text style={styles.previewLive}>LIVE</Text>
                        </View>
                        <View style={styles.previewArtCopy}>
                          <Text style={styles.previewArtEyebrow}>NOW PLAYING</Text>
                          <Text numberOfLines={2} style={styles.previewArtTitle}>
                            {displayLiveProgramText(detailPanelChannel?.current, 'No program information available.')}
                          </Text>
                        </View>
                      </Animated.View>
                    ) : null}
                  </>
                )}
              </View>

              <View style={styles.previewDetails}>
                <LiveTvProgramDetailPanel
                  channel={detailPanelChannel}
                  previewWindow={formatPreviewWindow(detailPanelChannel)}
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
                      style={[styles.favoriteButton, focusedAction === 'favorite' && styles.actionFocused]}>
                      <MaterialCommunityIcons
                        name={detailChannelIsFavorite ? 'star' : 'star-outline'}
                        size={18}
                        color={novaTheme.colors.accentHover}
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
                      style={[styles.watchButton, renderState.previewStatus !== 'ready' && styles.watchButtonDisabled, focusedAction === 'fullscreen' && styles.actionFocused]}>
                      <MaterialCommunityIcons name="play" size={20} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.miniGuide}>
          <View style={styles.guideItem}>
            <Text style={styles.guideLabel}>Now</Text>
            <Text numberOfLines={1} style={styles.guideValue}>
              {displayLiveProgramText(selectedChannel?.current, 'No program information available.')}
            </Text>
          </View>
          <View style={styles.guideDivider} />
          <View style={styles.guideItem}>
            <Text style={styles.guideLabel}>Next</Text>
            <Text numberOfLines={1} style={styles.guideValue}>
              {displayLiveProgramText(selectedChannel?.next, 'No program information available.')}
            </Text>
          </View>
          <View style={styles.guideDivider} />
          <View style={styles.guideItem}>
            <Text style={styles.guideLabel}>Following</Text>
            <Text numberOfLines={1} style={styles.guideValue}>
              {displayLiveProgramText(selectedChannel?.following, 'No program information available.')}
            </Text>
          </View>
          <View style={styles.guideAction}>
            <MaterialCommunityIcons name="calendar-clock-outline" size={20} color={novaTheme.colors.accentHover} />
            <Text style={styles.guideActionText}>
              {selectedChannel ? `${selectedChannel.currentStart} - ${selectedChannel.currentEnd}` : 'Open Guide'}
            </Text>
          </View>
        </View>
        </View>
      </NovaTvShell>
      ) : null}

      {fullscreenChannel && hasLiveStream ? (
        <View style={[styles.fullscreenOverlay, { width, height }]}>
          <NovaStreamSurface
            player={liveStreamPlayer}
            contentFit="cover"
            style={[styles.fullscreenPlayer, fullscreenFrameStatus !== 'ready' && styles.hiddenStreamSurface]}
            onFirstFrameRender={handleFullscreenFirstFrame}
          />
          {shouldShowFullscreenLoadingOverlay(fullscreenFrameStatus) ? (
            <View style={styles.fullscreenStatusOverlay}>
              <MaterialCommunityIcons name="progress-clock" size={34} color={novaTheme.colors.accentHover} />
              <Text style={styles.previewLoadingTitle}>Starting playback</Text>
              <Text style={styles.previewLoadingCopy}>{displayStreamTitle(fullscreenChannel.name)}</Text>
            </View>
          ) : null}
          {fullscreenFallbackVisible ? (
            <View pointerEvents="auto" style={[styles.fullscreenStatusOverlay, styles.fullscreenFallbackOverlay]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
              <Text style={styles.previewErrorTitle}>
                {fullscreenFrameStatus === 'error' ? 'Playback error' : 'This channel is taking too long to start'}
              </Text>
              <Text style={styles.previewErrorCopy}>Try again, or go back to the preview.</Text>
              <Pressable
                ref={registerFullscreenRetryButtonRef}
                focusable
                hasTVPreferredFocus={fullscreenRetryFocusKeyRef.current === null}
                accessibilityRole="button"
                accessibilityLabel="Retry"
                {...(fullscreenRetryNodeTag
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
                style={[styles.watchButton, focusedAction === 'retry' && styles.actionFocused]}>
                <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.watchButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {showFullscreenChrome && !fullscreenFallbackVisible ? (
            <>
              <View style={[styles.fullscreenBadgeRow, FULLSCREEN_CHROME_INSETS.topRow]}>
                <View style={styles.fullscreenBadgeLeading}>
                  <ChannelLogoBadge channel={fullscreenChannel} />
                </View>
                <Pressable
                  ref={fullscreenCloseButtonRef}
                  focusable
                  hasTVPreferredFocus
                  onPress={() => {
                    setState((current) => closeLiveFullscreen(current ?? renderState));
                  }}
                  style={styles.closeButton}>
                  <MaterialCommunityIcons name="close" size={18} color={novaTheme.colors.textPrimary} />
                  <Text style={styles.closeButtonText}>Back to Live TV</Text>
                </Pressable>
              </View>
              <View style={[styles.fullscreenMetaPanel, FULLSCREEN_CHROME_INSETS.metaPanel]}>
                <Text style={styles.fullscreenEyebrow}>WATCHING LIVE</Text>
                <Text numberOfLines={2} style={styles.fullscreenTitle}>
                  {displayLiveProgramText(fullscreenChannel.current, 'No program information available.')}
                </Text>
                <Text numberOfLines={2} style={styles.fullscreenMeta}>
                  {displayStreamTitle(fullscreenChannel.name)} · {formatPreviewWindow(fullscreenChannel)}
                </Text>
              </View>
            </>
          ) : null}
          {!showFullscreenChrome && !fullscreenFallbackVisible ? (
            <Pressable
              ref={fullscreenInteractionRef}
              focusable
              hasTVPreferredFocus={false}
              onPress={revealFullscreenChrome}
              style={styles.fullscreenInteractionLayer}
            />
          ) : null}
        </View>
      ) : null}

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: novaTheme.colors.background,
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
  inlineStateNotice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  inlineStateText: {
    color: novaTheme.colors.textMuted,
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
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 16,
  },
  retryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  previewPlayer: {
    flex: 1,
    minHeight: 0,
  },
  previewOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.18)',
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
    paddingTop: 12,
    paddingHorizontal: 2,
  },
  mainGrid: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 12,
  },
  mainGridCompact: {
    gap: 10,
  },
  mainGridNormal: {
    gap: 14,
  },
  mainGridComfortable: {
    gap: 16,
  },
  categoriesPanel: {
    flex: 22,
    minWidth: 220,
    minHeight: 0,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    padding: 14,
  },
  categoriesPanelCompact: {
    flex: 22,
    minWidth: 180,
    padding: 12,
  },
  categoriesPanelNormal: {
    flex: 22,
    minWidth: 220,
  },
  categoriesPanelComfortable: {
    flex: 22,
    minWidth: 260,
  },
  channelsPanel: {
    flex: 53,
    minWidth: 300,
    minHeight: 0,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    padding: 14,
  },
  channelsPanelCompact: {
    flex: 53,
    minWidth: 260,
    padding: 12,
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
  },
  panelTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  panelCount: {
    minWidth: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: novaTheme.colors.surfaceMuted,
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 5,
  },
  panelHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryList: {
    gap: 3,
    paddingTop: 2,
    paddingBottom: 8,
  },
  categoryRow: {
    minHeight: 60,
    borderRadius: novaTheme.radius.md,
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
    borderRadius: novaTheme.radius.sm,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  categoryName: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  categoryCount: {
    marginTop: 2,
    color: novaTheme.colors.textMuted,
    fontSize: 11,
  },
  selectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: novaTheme.colors.accentHover,
  },
  channelList: {
    gap: 3,
    paddingTop: 2,
    paddingBottom: 8,
  },
  channelRow: {
    minHeight: 66,
    borderRadius: novaTheme.radius.md,
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
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  channelLogo: {
    width: 42,
    height: 42,
    borderRadius: novaTheme.radius.sm,
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
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  resolution: {
    color: novaTheme.colors.accentHover,
    fontSize: 9,
    fontWeight: '900',
  },
  nowPlaying: {
    marginTop: 2,
    color: novaTheme.colors.textSecondary,
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
    backgroundColor: novaTheme.colors.accent,
  },
  selectedRow: {
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
  focusedRow: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
  previewPanel: {
    flex: 25,
    minWidth: 0,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    minHeight: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    padding: 14,
    gap: 12,
  },
  previewPanelCompact: {
    flex: 25,
    minWidth: 260,
    padding: 12,
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
    borderRadius: novaTheme.radius.lg,
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
    borderRadius: novaTheme.radius.lg,
    backgroundColor: novaTheme.colors.surface,
  },
  previewLoadingTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  previewLoadingCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
  },
  previewError: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: novaTheme.radius.lg,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 18,
  },
  previewErrorTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  previewErrorCopy: {
    color: novaTheme.colors.textSecondary,
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
  previewBrandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewLogoBadge: {
    width: 52,
    height: 52,
    borderRadius: novaTheme.radius.md,
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
    borderRadius: novaTheme.radius.sm,
  },
  previewLive: {
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: novaTheme.colors.danger,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewArtCopy: {
    maxWidth: '72%',
  },
  previewArtEyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  previewArtTitle: {
    marginTop: 6,
    color: '#FFFFFF',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -0.6,
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
    color: novaTheme.colors.textPrimary,
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
    color: novaTheme.colors.accentHover,
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
    backgroundColor: novaTheme.colors.surfaceMuted,
    color: '#CCD8EB',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  description: {
    color: novaTheme.colors.textSecondary,
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
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  watchButton: {
    width: 44,
    height: 40,
    minHeight: 40,
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchButtonDisabled: {
    opacity: 0.56,
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
    borderRadius: novaTheme.radius.md,
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
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    ...androidTextFit,
  },
  fullscreenEyebrow: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    ...androidTextFit,
  },
  fullscreenTitle: {
    marginTop: 6,
    color: novaTheme.colors.textPrimary,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.5,
    ...androidTextFit,
  },
  fullscreenMeta: {
    marginTop: 8,
    color: '#D9E2F0',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    ...androidTextFit,
  },
  fullscreenDescription: {
    marginTop: 10,
    maxWidth: '68%',
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  fullscreenHint: {
    marginTop: 12,
    color: novaTheme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  miniGuide: {
    minHeight: 58,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
  },
  guideItem: {
    flex: 1,
    minWidth: 0,
  },
  guideLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  guideValue: {
    marginTop: 3,
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  guideDivider: {
    width: 1,
    height: 28,
    backgroundColor: novaTheme.colors.borderSubtle,
  },
  guideAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
  },
  guideActionText: {
    color: novaTheme.colors.accentHover,
    fontSize: 13,
    fontWeight: '700',
  },
});
