import type { ComponentProps, ComponentType, ElementRef, ReactNode, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { createNovaTvFocusTextStyles, novaTvFocus } from '@/components/nova/novaTvFocus';
import { MediaArtworkFallback } from '@/features/media-browser/MediaArtworkFallback';
import type { MediaDetail } from '@/features/media-browser/mediaTypes';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import {
  isOnnMoviesTraceEnabled,
  noteOnnMoviesMount,
  noteOnnMoviesRender,
  noteOnnMoviesUnmount,
  traceOnnMoviesEvent,
} from '@/features/diagnostics/onnMoviesTrace';
import {
  buildMovieDetailMetaChips,
  deriveStreamQualityBadges,
  formatCastLine,
  formatMovieRating,
  joinMetaChips,
  MOVIE_DETAIL_BLUR_MS,
  MOVIE_DETAIL_CAST_LIMIT,
  MOVIE_DETAIL_CLOSE_MS,
  MOVIE_DETAIL_FOCUS_MS,
  MOVIE_DETAIL_GENRE_LIMIT,
  MOVIE_DETAIL_OPEN_MS,
  MOVIE_DETAIL_RELATED_LIMIT,
  MOVIE_DETAIL_SYNOPSIS_MAX_LINES,
  MOVIE_DETAIL_TITLE_MAX_LINES,
  resolveCompactDetailCardSize,
  resolveContinueWatchingLabel,
  resolveContinueWatchingProgress,
  resolveTitleFontSize,
  shouldShowCompactRelatedRow,
  type RelatedMovieCandidate,
  type StreamQualityBadge,
} from '../movieDetailOverlayModel';

const focusText = createNovaTvFocusTextStyles(novaTheme);
const OPEN_EASING = Easing.out(Easing.cubic);

type ActionId = 'play' | 'watchlist' | 'trailer' | 'favorite' | 'retry';

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
};

export type MovieDetailOverlayProps = {
  visible: boolean;
  keepFocusTrap?: boolean;
  focusHandoffActive?: boolean;
  /** Stage 4.2G: keep card + blur fully opaque until focus/offset confirm. */
  visualHoldActive?: boolean;
  /**
   * Stage 4.2K: non-focusable cover until focus + final offset confirm.
   * Hides browse highlights/jumps without replacing the overlay shell.
   */
  visualIsolationActive?: boolean;
  /** Stage 4.2K: stable shell identity for mount diagnostics. */
  overlayInstanceId?: string;
  /**
   * Stage 4.2H/J: Detail focus owner stays native-focusable during handoff
   * (Close on X; Play/Watchlist/Favorite/etc. on Back) — no hidden sentinel.
   */
  preserveCloseButtonFocus?: boolean;
  /** Stage 4.2H: duplicate X activation lock (onPress + onClick). */
  closeActivationLocked?: boolean;
  closeTargetRef?: RefObject<ElementRef<typeof Pressable> | null>;
  blurTarget?: RefObject<View | null>;
  detail: MediaDetail | null;
  detailLoading?: boolean;
  detailError?: string | null;
  continueWatchingLabel?: string;
  continueWatchingProgress?: number | null;
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  relatedMovies?: RelatedMovieCandidate[];
  onClose: () => void;
  onRetry?: () => void;
  onPlay?: () => void;
  onTrailerPress?: () => void;
  onFavoritePress?: () => void;
  onWatchlistPress?: () => void;
  onSelectRelated?: (movie: RelatedMovieCandidate) => void;
};

function noopUseTVEventHandler(_handler: (event: TvEventPayload) => void) {}

function handleFor(ref: { current: ElementRef<typeof Pressable> | null } | undefined) {
  return ref?.current ? findNodeHandle(ref.current) ?? undefined : undefined;
}

function QualityBadge({ badge }: { badge: StreamQualityBadge }) {
  return (
    <View style={[styles.qualityBadge, badge.kind === 'hdr' && styles.qualityBadgeHdr]}>
      <Text style={styles.qualityBadgeText}>{badge.label}</Text>
    </View>
  );
}

function OverlayAction({
  id,
  label,
  icon,
  onPress,
  primary = false,
  compact = false,
  selected = false,
  focused = false,
  disabled = false,
  preferred = false,
  forceFocusable = false,
  buttonRef,
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
  onFocus,
  onBlur,
}: {
  id: ActionId;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress?: () => void;
  primary?: boolean;
  compact?: boolean;
  selected?: boolean;
  focused?: boolean;
  disabled?: boolean;
  preferred?: boolean;
  /** Stage 4.2J: remain native-focusable during handoff without activating. */
  forceFocusable?: boolean;
  buttonRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocus: (id: ActionId) => void;
  onBlur: () => void;
}) {
  const focusable = (Boolean(onPress) || Boolean(forceFocusable)) && !disabled;
  const lastActivateAtRef = useRef(0);

  const activate = () => {
    if (!onPress || disabled) return;
    const now = Date.now();
    if (now - lastActivateAtRef.current < 400) return;
    lastActivateAtRef.current = now;
    onPress();
  };

  return (
    <Pressable
      ref={buttonRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={preferred && focusable}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(nextFocusLeft ? { nextFocusLeft } : {})}
      {...(nextFocusRight ? { nextFocusRight } : {})}
      {...(nextFocusUp ? { nextFocusUp } : {})}
      {...(nextFocusDown ? { nextFocusDown } : {})}
      onFocus={() => onFocus(id)}
      onBlur={onBlur}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[
        styles.action,
        styles.actionFocusTransition,
        primary ? styles.actionPrimary : compact ? styles.actionCompact : styles.actionSecondary,
        disabled && styles.actionDisabled,
        selected && !primary && styles.actionSelected,
        selected && primary && styles.actionPrimarySelected,
        novaTvFocus.base,
        focused && novaTvFocus.active,
      ]}>
      <MaterialCommunityIcons
        name={icon}
        size={primary ? 22 : 20}
        color={primary ? '#FFFFFF' : novaTheme.colors.textPrimary}
      />
      {primary || !compact ? (
        <Text
          style={[
            styles.actionLabel,
            primary && styles.actionLabelPrimary,
            disabled && styles.actionLabelDisabled,
          ]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function RelatedCompactRow({
  movies,
  focusedId,
  onFocus,
  onSelect,
  firstRef,
  cardWidth,
  nextFocusUp,
}: {
  movies: RelatedMovieCandidate[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onSelect?: (movie: RelatedMovieCandidate) => void;
  firstRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  cardWidth: number;
  /** Keep related Up on the action row — never jump to Close. */
  nextFocusUp?: number;
}) {
  const limited = movies.slice(0, MOVIE_DETAIL_RELATED_LIMIT);
  if (!limited.length) return null;

  const posterWidth = Math.min(88, Math.max(64, Math.round((cardWidth - 48) / 6.2)));

  return (
    <View style={styles.relatedSection} focusable={false}>
      <Text style={styles.sectionLabel}>More Like This</Text>
      <View style={styles.relatedRow} focusable={false}>
        {limited.map((movie, index) => {
          const focused = focusedId === `related:${movie.id}`;
          return (
            <Pressable
              key={movie.id}
              ref={index === 0 ? firstRef : undefined}
              focusable={Boolean(onSelect)}
              accessibilityLabel={movie.title}
              {...(nextFocusUp ? { nextFocusUp } : {})}
              onFocus={() => onFocus(`related:${movie.id}`)}
              onPress={() => onSelect?.(movie)}
              style={[
                styles.relatedCard,
                { width: posterWidth },
                novaTvFocus.base,
                focused && styles.relatedCardFocused,
                focused && novaTvFocus.active,
              ]}>
              <View style={styles.relatedPoster}>
                {movie.posterUrl ? (
                  <TvRemoteImage uri={movie.posterUrl} style={styles.relatedPosterImage} resizeMode="cover" />
                ) : (
                  <MediaArtworkFallback
                    title={movie.title}
                    kind="movie"
                    subtitle={movie.year ? String(movie.year) : undefined}
                  />
                )}
              </View>
              <Text numberOfLines={1} style={[styles.relatedTitle, focused && focusText.title]}>
                {displayStreamTitle(movie.title) || movie.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MovieDetailOverlayComponent({
  visible,
  keepFocusTrap = false,
  focusHandoffActive = false,
  visualHoldActive = false,
  visualIsolationActive = false,
  overlayInstanceId,
  preserveCloseButtonFocus = false,
  closeActivationLocked = false,
  closeTargetRef,
  blurTarget,
  detail,
  detailLoading = false,
  detailError,
  continueWatchingLabel,
  continueWatchingProgress,
  isFavorite = false,
  isWatchlisted = false,
  relatedMovies = [],
  onClose,
  onRetry,
  onPlay,
  onTrailerPress,
  onFavoritePress,
  onWatchlistPress,
  onSelectRelated,
}: MovieDetailOverlayProps) {
  const { width, height } = useWindowDimensions();
  const [focusedTarget, setFocusedTarget] = useState<string | null>(null);
  const [failedPosterKey, setFailedPosterKey] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const posterKey = detail ? `${detail.id}:${detail.posterUrl ?? ''}` : null;
  const posterFailed = Boolean(posterKey) && failedPosterKey === posterKey;

  const progress = useSharedValue(0);
  const actionRefs = useRef(new Map<ActionId, ElementRef<typeof Pressable>>());
  const playRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const retryRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const closeButtonRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const relatedFirstRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const [actionHandles, setActionHandles] = useState<Record<string, number>>({});
  const [closeHandle, setCloseHandle] = useState<number | undefined>(undefined);
  const [relatedHandle, setRelatedHandle] = useState<number | undefined>(undefined);
  const focusRetryCancelRef = useRef<(() => void) | null>(null);
  const wasVisibleRef = useRef(false);
  const lastPlayInvokeAtRef = useRef(0);
  const lastCloseInvokeAtRef = useRef(0);
  const blurMountedRef = useRef(false);
  const lastRootPointerRef = useRef<string | null>(null);
  const lastBrowsePointerRef = useRef<string | null>(null);

  if (isOnnMoviesTraceEnabled()) {
    noteOnnMoviesRender('MovieDetailOverlay');
  }

  // Stage 4.2K: mount diagnostics once per overlay shell — not per movie/visibility.
  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    noteOnnMoviesMount('MovieDetailOverlay', {
      overlayInstanceId: overlayInstanceId ?? null,
      movieId: detail?.id ?? null,
      visible,
    });
    return () => {
      noteOnnMoviesUnmount('MovieDetailOverlay', {
        overlayInstanceId: overlayInstanceId ?? null,
        movieId: detail?.id ?? null,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable shell identity
  }, [overlayInstanceId]);

  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    if (visible && !blurMountedRef.current) {
      blurMountedRef.current = true;
      traceOnnMoviesEvent('Overlay', 'blur_view_mount', {
        movieId: detail?.id ?? null,
        hasBlurTarget: Boolean(blurTarget),
      });
      traceOnnMoviesEvent('Overlay', 'blur_view_fade_start', {
        movieId: detail?.id ?? null,
        durationMs: MOVIE_DETAIL_BLUR_MS,
        direction: 'in',
      });
      traceOnnMoviesEvent('Overlay', 'detail_card_mount', {
        movieId: detail?.id ?? null,
      });
    }
    if (!visible && blurMountedRef.current) {
      blurMountedRef.current = false;
      traceOnnMoviesEvent('Overlay', 'blur_view_fade_start', {
        movieId: detail?.id ?? null,
        durationMs: MOVIE_DETAIL_CLOSE_MS,
        direction: 'out',
      });
      traceOnnMoviesEvent('Overlay', 'blur_view_unmount', {
        movieId: detail?.id ?? null,
      });
      traceOnnMoviesEvent('Overlay', 'detail_card_unmount', {
        movieId: detail?.id ?? null,
      });
    }
  }, [blurTarget, detail?.id, visible]);

  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    const rootPointer = focusHandoffActive ? 'box-none' : visible ? 'auto' : 'none';
    if (lastRootPointerRef.current !== rootPointer) {
      lastRootPointerRef.current = rootPointer;
      traceOnnMoviesEvent('Overlay', 'overlay_pointer_events_changed', {
        target: 'detail-root',
        pointerEvents: rootPointer,
        focusHandoffActive,
        visible,
        movieId: detail?.id ?? null,
      });
    }
    const blurPointer = visible && !focusHandoffActive ? 'auto' : 'none';
    if (lastBrowsePointerRef.current !== blurPointer) {
      lastBrowsePointerRef.current = blurPointer;
      traceOnnMoviesEvent('Overlay', 'blur_view_pointer_events_changed', {
        pointerEvents: blurPointer,
        focusHandoffActive,
        visible,
        movieId: detail?.id ?? null,
      });
      traceOnnMoviesEvent('Overlay', 'browse_layer_pointer_events_changed', {
        // Browse layer is dimmed/blocked by overlay pointer ownership; log companion value.
        pointerEvents: focusHandoffActive ? 'auto' : visible ? 'none' : 'auto',
        focusHandoffActive,
        visible,
        movieId: detail?.id ?? null,
      });
    }
  }, [detail?.id, focusHandoffActive, visible]);

  const cardSize = resolveCompactDetailCardSize(width, height);
  const posterWidth = Math.round(cardSize.width * 0.27);
  const titleFontSize = resolveTitleFontSize(width);
  const showRelated = shouldShowCompactRelatedRow(height) && relatedMovies.length > 0;

  const showRetry = Boolean(detailError && onRetry);

  const invokePlay = useCallback(() => {
    if (!onPlay) return;
    const now = Date.now();
    if (now - lastPlayInvokeAtRef.current < 400) return;
    lastPlayInvokeAtRef.current = now;
    onPlay();
  }, [onPlay]);

  const invokeClose = useCallback(() => {
    // Stage 4.2H: lock duplicate X activation without making Close non-focusable.
    if (!visible || closeActivationLocked || focusHandoffActive) return;
    const now = Date.now();
    if (now - lastCloseInvokeAtRef.current < 400) return;
    lastCloseInvokeAtRef.current = now;
    recordFocusAudit({
      component: 'MovieDetailOverlay',
      action: 'close_activate',
      itemId: detail?.id ?? null,
      reason: 'close-button',
    });
    onClose();
  }, [closeActivationLocked, detail?.id, focusHandoffActive, onClose, visible]);

  const reactNativeTv = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
  };
  const useTVEventHandler = reactNativeTv.useTVEventHandler ?? noopUseTVEventHandler;

  useTVEventHandler((event: TvEventPayload) => {
    if (!visible || focusHandoffActive || !onPlay) return;
    if (event.eventType !== 'select' && event.eventType !== 'playPause') return;
    if (focusedTarget !== null && focusedTarget !== 'play') return;
    invokePlay();
  });

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const firstAction: ActionId | null = onPlay
    ? 'play'
    : showRetry
      ? 'retry'
      : onWatchlistPress
        ? 'watchlist'
        : onTrailerPress
          ? 'trailer'
          : onFavoritePress
            ? 'favorite'
            : null;

  const actionIds = [
    onPlay ? 'play' : null,
    onWatchlistPress ? 'watchlist' : null,
    onTrailerPress ? 'trailer' : null,
    onFavoritePress ? 'favorite' : null,
    showRetry ? 'retry' : null,
  ].filter((item): item is ActionId => Boolean(item));
  const actionGraphKey = actionIds.join('|');

  useEffect(() => {
    // Stage 4.2G: visual hold keeps opacity fully on — never fade during handoff.
    if (visualHoldActive) {
      wasVisibleRef.current = true;
      progress.value = 1;
      return;
    }

    if (!visible) {
      wasVisibleRef.current = false;
      progress.value = 0;
      return;
    }

    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;

    if (opening) {
      progress.value = 0;
      if (reducedMotion) {
        progress.value = 1;
      } else {
        progress.value = withTiming(1, { duration: MOVIE_DETAIL_OPEN_MS, easing: OPEN_EASING });
      }
    } else {
      progress.value = 1;
    }

    if (focusHandoffActive || !firstAction) return;

    const detailId = detail?.id ?? null;
    let cancelled = false;
    let frame: number | null = null;
    let attempt = 0;
    const maxAttempts = Platform.isTV ? 2 : 4;
    const stopFocusRetry = () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (focusRetryCancelRef.current === stopFocusRetry) {
        focusRetryCancelRef.current = null;
      }
    };
    const requestActionFocus = () => {
      if (cancelled) return;
      attempt += 1;
      const target = playRef.current ?? actionRefs.current.get(firstAction);
      recordFocusAudit({
        component: 'MovieDetailOverlay',
        action: 'requestFocus',
        itemId: detailId,
        reason: 'detail-open-action',
        detail: { attempt },
      });
      target?.focus();
      if (attempt >= maxAttempts) {
        stopFocusRetry();
        return;
      }
      frame = requestAnimationFrame(requestActionFocus);
    };

    focusRetryCancelRef.current?.();
    focusRetryCancelRef.current = stopFocusRetry;
    const focusTimer = setTimeout(() => {
      frame = requestAnimationFrame(requestActionFocus);
    }, Platform.isTV ? 100 : 0);

    return () => {
      clearTimeout(focusTimer);
      stopFocusRetry();
    };
  }, [
    actionGraphKey,
    detail?.id,
    firstAction,
    focusHandoffActive,
    progress,
    reducedMotion,
    visible,
    visualHoldActive,
  ]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const nextHandles: Record<string, number> = {};
      const graphIds = actionGraphKey ? (actionGraphKey.split('|') as ActionId[]) : [];
      graphIds.forEach((id) => {
        const handle = handleFor({ current: actionRefs.current.get(id) ?? null });
        if (handle) nextHandles[id] = handle;
      });
      setActionHandles(nextHandles);
      setCloseHandle(handleFor(closeButtonRef) ?? undefined);
      setRelatedHandle(showRelated ? handleFor(relatedFirstRef) ?? undefined : undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [actionGraphKey, detail?.id, relatedMovies.length, showRelated, showRetry, visible]);

  const blurStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const shellStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [16, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.97, 1]) },
    ],
  }));

  const qualityBadges = useMemo(
    () =>
      detail
        ? deriveStreamQualityBadges({
            title: detail.title,
            containerExtension: detail.containerExtension,
            audio: detail.audio,
            synopsis: detail.synopsis,
          })
        : [],
    [detail],
  );

  const metaChips = useMemo(
    () =>
      detail
        ? buildMovieDetailMetaChips({
            year: detail.year,
            runtime: detail.runtime,
            contentRating: detail.contentRating,
            rating: detail.rating,
            director: detail.director,
            audio: detail.audio,
          })
        : [],
    [detail],
  );

  const resumeProgress = resolveContinueWatchingProgress(continueWatchingProgress);
  const rating = formatMovieRating(detail?.rating);
  const title = detail ? displayStreamTitle(detail.title) || detail.title : '';
  const genres = detail?.genres.filter(Boolean).slice(0, MOVIE_DETAIL_GENRE_LIMIT) ?? [];
  const castLine = formatCastLine(detail?.cast, MOVIE_DETAIL_CAST_LIMIT);
  const playLabel = continueWatchingLabel ?? resolveContinueWatchingLabel(continueWatchingProgress);
  const metaLine = joinMetaChips(metaChips);

  const reactNative = ReactNative as typeof ReactNative & {
    TVFocusGuideView?: typeof View;
  };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }>;

  // Stage 4.2K: stable shell — stay mounted for MoviesScreen lifetime via keepFocusTrap.
  // Content may be null while suppressed/closed; do not remount the shell.
  if (!detail && !keepFocusTrap && !visualHoldActive) return null;
  if (!visible && !keepFocusTrap && !visualHoldActive) return null;

  if (!detail) {
    return (
      <View
        style={[styles.root, styles.rootHidden]}
        pointerEvents="none"
        focusable={false}
        importantForAccessibility="no-hide-descendants">
        {visualIsolationActive ? (
          <View
            style={[StyleSheet.absoluteFill, styles.visualIsolationCover]}
            pointerEvents="none"
            focusable={false}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </View>
    );
  }

  // Stage 4.2K: keepFocusTrap keeps the shell mounted; panelVisible controls paint.
  const panelVisible = visible || visualHoldActive;
  const holdCoverActive = focusHandoffActive || visualHoldActive;
  // Stage 4.2H/J: preserved Detail focus owner stays native-focusable; no hidden sentinel.
  const ownerPreservedHandoff = preserveCloseButtonFocus && holdCoverActive;
  const mountHiddenHandoffTarget = holdCoverActive && !preserveCloseButtonFocus;

  const renderAction = (id: ActionId) => {
    const index = actionIds.indexOf(id);
    const left = actionIds[index - 1];
    const right = actionIds[index + 1];
    const onPress =
      id === 'play'
        ? invokePlay
        : id === 'watchlist'
          ? onWatchlistPress
          : id === 'trailer'
            ? onTrailerPress
            : id === 'favorite'
              ? onFavoritePress
              : onRetry;
    const label =
      id === 'play'
        ? playLabel
        : id === 'watchlist'
          ? isWatchlisted
            ? 'In Watchlist'
            : 'Watchlist'
          : id === 'trailer'
            ? 'Trailer'
            : id === 'favorite'
              ? isFavorite
                ? 'Favorited'
                : 'Favorite'
              : 'Retry';
    const icon = (
      id === 'play'
        ? 'play'
        : id === 'watchlist'
          ? isWatchlisted
            ? 'bookmark'
            : 'bookmark-outline'
          : id === 'trailer'
            ? 'movie-open-outline'
            : id === 'favorite'
              ? isFavorite
                ? 'heart'
                : 'heart-outline'
              : 'refresh'
    ) as ComponentProps<typeof MaterialCommunityIcons>['name'];
    const isSelected =
      (id === 'favorite' && isFavorite) || (id === 'watchlist' && isWatchlisted);
    const isFocused = focusedTarget === id;
    // Stage 4.2J: keep the currently focused action native-focusable during handoff.
    const preserveThisAction =
      ownerPreservedHandoff && (focusedTarget === id || (focusedTarget == null && id === firstAction));

    return (
      <OverlayAction
        key={id}
        id={id}
        label={label}
        icon={icon}
        onPress={holdCoverActive ? undefined : onPress}
        forceFocusable={preserveThisAction}
        primary={id === 'play'}
        compact={id !== 'play'}
        preferred={!holdCoverActive && id === firstAction}
        selected={isSelected}
        focused={isFocused}
        disabled={
          (holdCoverActive && !preserveThisAction) || (id === 'trailer' && !onTrailerPress && !preserveThisAction)
        }
        buttonRef={(instance) => {
          if (instance) {
            actionRefs.current.set(id, instance);
            if (id === 'play') playRef.current = instance;
            if (id === 'retry') retryRef.current = instance;
          } else {
            actionRefs.current.delete(id);
            if (id === 'retry') retryRef.current = null;
          }
        }}
        nextFocusLeft={actionHandles[left ?? id]}
        nextFocusRight={right ? actionHandles[right] : actionHandles[id]}
        // Up from the action row reaches Close; Close is never preferred focus.
        nextFocusUp={closeHandle ?? actionHandles[id]}
        nextFocusDown={showRelated ? relatedHandle ?? actionHandles[id] : actionHandles[id]}
        onFocus={(actionId) => {
          focusRetryCancelRef.current?.();
          focusRetryCancelRef.current = null;
          setFocusedTarget(actionId);
        }}
        onBlur={() => setFocusedTarget(null)}
      />
    );
  };

  const playFocusHandle =
    (firstAction ? actionHandles[firstAction] : undefined) ?? actionHandles.play ?? closeHandle;
  // Stage 4.2H/J: never strip Close focusability while the Detail owner is preserved.
  // Duplicate activation is locked via closeActivationLocked / invokeClose — not via focusable=false.
  const closeFocusable =
    panelVisible &&
    (!holdCoverActive ||
      preserveCloseButtonFocus ||
      (ownerPreservedHandoff && (focusedTarget === 'close' || focusedTarget == null)));
  const focusBoundaryPointerEvents = ownerPreservedHandoff
    ? 'box-none'
    : holdCoverActive
      ? 'none'
      : 'auto';

  return (
    <View
      style={[styles.root, !panelVisible && styles.rootHidden]}
      pointerEvents={holdCoverActive ? 'box-none' : panelVisible ? 'auto' : 'none'}
      accessibilityViewIsModal={panelVisible && !holdCoverActive}
      importantForAccessibility={panelVisible && !holdCoverActive ? 'yes' : 'no-hide-descendants'}
      // Stable shell identity — never key by movie/visibility/token.
      collapsable={false}>

      {mountHiddenHandoffTarget ? (
        <Pressable
          ref={closeTargetRef}
          focusable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => undefined}
          style={styles.closeFocusTarget}
        />
      ) : null}

      {/* Stage 4.2K: non-focusable cover — hides browse jumps until offset confirms. */}
      {visualIsolationActive ? (
        <View
          style={[StyleSheet.absoluteFill, styles.visualIsolationCover]}
          pointerEvents="none"
          focusable={false}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      {/* Full-screen blur of the mounted Movies grid — never focusable. */}
      <Animated.View
        entering={visualHoldActive ? undefined : FadeIn.duration(MOVIE_DETAIL_BLUR_MS)}
        exiting={visualHoldActive ? undefined : FadeOut.duration(MOVIE_DETAIL_CLOSE_MS)}
        style={[
          StyleSheet.absoluteFill,
          styles.detailBackdropLayer,
          visualHoldActive ? undefined : blurStyle,
          visualHoldActive && styles.visualHoldOpaque,
        ]}
        pointerEvents={panelVisible && !holdCoverActive ? 'auto' : 'none'}
        focusable={false}
        accessible={false}
        importantForAccessibility="no-hide-descendants">
        {blurTarget ? (
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={28}
            tint="dark"
            style={styles.backgroundBlur}
            pointerEvents="none"
          />
        ) : (
          <BlurView
            intensity={28}
            tint="dark"
            style={styles.backgroundBlur}
            pointerEvents="none"
          />
        )}
        <View
          style={[
            styles.backgroundScrim,
            holdCoverActive && styles.backgroundScrimHandoff,
            visualHoldActive && styles.backgroundScrimVisualHold,
          ]}
          pointerEvents="none"
          focusable={false}
        />
      </Animated.View>

      <FocusBoundaryView
        style={styles.focusBoundary}
        {...(Platform.OS === 'android' && !holdCoverActive
          ? { autoFocus: true, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
          : {})}
        pointerEvents={focusBoundaryPointerEvents}>
        <Animated.View
          style={[
            styles.compactCard,
            {
              width: cardSize.width,
              maxWidth: cardSize.width,
              height: cardSize.height,
              maxHeight: cardSize.height,
            },
            visualHoldActive ? styles.visualHoldOpaque : shellStyle,
          ]}>
          <View style={styles.cardGlassFill} pointerEvents="none" />

          <Pressable
            ref={closeButtonRef}
            focusable={closeFocusable}
            disabled={!closeFocusable}
            hasTVPreferredFocus={false}
            accessibilityRole="button"
            accessibilityLabel="Close movie details"
            {...(closeHandle
              ? {
                  nextFocusLeft: closeHandle,
                  nextFocusRight: closeHandle,
                  nextFocusUp: closeHandle,
                }
              : {})}
            {...(playFocusHandle ? { nextFocusDown: playFocusHandle } : {})}
            onFocus={() => {
              focusRetryCancelRef.current?.();
              focusRetryCancelRef.current = null;
              setFocusedTarget('close');
              recordFocusAudit({
                component: 'MovieDetailOverlay',
                action: 'close_focus',
                itemId: detail.id,
                reason: 'close-button',
              });
            }}
            onBlur={() =>
              setFocusedTarget((current) => (current === 'close' ? null : current))
            }
            onPress={invokeClose}
            {...(Platform.isTV ? { onClick: invokeClose } : {})}
            style={[
              styles.closeHint,
              styles.closeHintFocusTransition,
              novaTvFocus.base,
              focusedTarget === 'close' && styles.closeHintFocused,
              focusedTarget === 'close' && novaTvFocus.active,
            ]}>
            <MaterialCommunityIcons
              name="close"
              size={20}
              color={focusedTarget === 'close' ? '#FFFFFF' : 'rgba(255,255,255,0.72)'}
            />
          </Pressable>

          <View style={styles.cardBody}>
            <View style={[styles.posterColumn, { width: posterWidth }]}>
              <View style={styles.posterFrame}>
                {detail.posterUrl && !posterFailed ? (
                  <TvRemoteImage
                    uri={detail.posterUrl}
                    style={styles.posterImage}
                    resizeMode="cover"
                    onError={() => {
                      if (posterKey) setFailedPosterKey(posterKey);
                    }}
                  />
                ) : (
                  <MediaArtworkFallback title={title} kind="movie" subtitle={detail.year} />
                )}
                {rating ? (
                  <View style={styles.posterRating} pointerEvents="none">
                    <MaterialCommunityIcons name="star" size={13} color="#F6C85F" />
                    <Text style={styles.posterRatingText}>{rating}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.infoColumn}>
              <Text style={styles.eyebrow}>MOVIE</Text>

              <Text
                numberOfLines={MOVIE_DETAIL_TITLE_MAX_LINES}
                style={[styles.title, { fontSize: titleFontSize, lineHeight: titleFontSize + 4 }]}>
                {title}
              </Text>

              {metaLine ? (
                <Text numberOfLines={1} style={styles.metaLine} accessibilityLabel={metaLine}>
                  {metaLine}
                </Text>
              ) : null}

              {(qualityBadges.length > 0 || genres.length > 0) ? (
                <View style={styles.badgeGenreRow} focusable={false}>
                  {qualityBadges.map((badge) => (
                    <QualityBadge key={badge.id} badge={badge} />
                  ))}
                  {genres.map((genre) => (
                    <View key={genre} style={styles.genreChip}>
                      <Text style={styles.genreChipText}>{genre}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {resumeProgress != null ? (
                <View style={styles.progressBlock} focusable={false}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${resumeProgress}%` }]} />
                  </View>
                  <Text style={styles.progressLabel}>{resumeProgress}% watched</Text>
                </View>
              ) : null}

              {detailLoading ? (
                <View
                  pointerEvents="none"
                  focusable={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants">
                  <Text style={styles.loadingText}>Updating details…</Text>
                </View>
              ) : null}

              {detailError ? (
                <View style={styles.inlineError} focusable={false}>
                  <Text style={styles.inlineErrorText}>{detailError}</Text>
                </View>
              ) : null}

              {detail.synopsis?.trim() ? (
                <Text numberOfLines={MOVIE_DETAIL_SYNOPSIS_MAX_LINES} style={styles.synopsis}>
                  {detail.synopsis.trim()}
                </Text>
              ) : !detailLoading ? (
                <Text style={styles.synopsisMuted}>No synopsis available.</Text>
              ) : null}

              {castLine ? (
                <Text numberOfLines={1} style={styles.castLine} importantForAccessibility="yes">
                  {castLine}
                </Text>
              ) : null}

              <View style={styles.actionRow}>{actionIds.map((id) => renderAction(id))}</View>

              {showRelated ? (
                <RelatedCompactRow
                  movies={relatedMovies}
                  focusedId={focusedTarget}
                  onFocus={setFocusedTarget}
                  onSelect={focusHandoffActive ? undefined : onSelectRelated}
                  cardWidth={cardSize.width}
                  nextFocusUp={playFocusHandle}
                  firstRef={(instance) => {
                    relatedFirstRef.current = instance;
                  }}
                />
              ) : null}
            </View>
          </View>
        </Animated.View>
      </FocusBoundaryView>
    </View>
  );
}

export const MovieDetailOverlay = memo(MovieDetailOverlayComponent);

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rootHidden: {
    opacity: 0,
  },
  closeFocusTarget: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: 0,
    top: 0,
  },
  backgroundBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  backgroundScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 7, 12, 0.62)',
  },
  /** Stage 4.2F/G: hide native focus drift / corrective scroll under cover. */
  backgroundScrimHandoff: {
    backgroundColor: 'rgba(4, 7, 12, 0.94)',
  },
  /** Stage 4.2G: fully opaque handoff scrim (no black flash — matches detail card tone). */
  backgroundScrimVisualHold: {
    backgroundColor: 'rgba(8, 12, 20, 0.98)',
  },
  visualHoldOpaque: {
    opacity: 1,
  },
  /** Stage 4.2K: non-focusable cover — never receives focus; blocks browse visibility. */
  visualIsolationCover: {
    backgroundColor: '#05070D',
    zIndex: 1,
  },
  detailBackdropLayer: {
    zIndex: 2,
  },
  focusBoundary: {
    zIndex: 3,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCard: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(10, 14, 22, 0.88)',
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },
  cardGlassFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  closeHint: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 12, 20, 0.62)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  closeHintFocusTransition: Platform.select({
    web: {
      transitionProperty: 'border-color, background-color, transform',
      transitionDuration: `${MOVIE_DETAIL_FOCUS_MS}ms`,
    },
    default: {},
  }),
  closeHintFocused: {
    backgroundColor: 'rgba(20, 32, 52, 0.95)',
    borderColor: 'rgba(191, 219, 254, 0.95)',
    transform: [{ scale: 1.08 }],
  },
  cardBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 22,
    paddingVertical: 20,
    alignItems: 'stretch',
  },
  posterColumn: {
    justifyContent: 'center',
  },
  posterFrame: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterRating: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 12, 22, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(246, 200, 95, 0.35)',
  },
  posterRatingText: {
    color: '#F6C85F',
    fontSize: 12,
    fontWeight: '700',
  },
  infoColumn: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    justifyContent: 'flex-start',
  },
  eyebrow: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  metaLine: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  badgeGenreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  qualityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  qualityBadgeHdr: {
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderColor: 'rgba(167, 139, 250, 0.35)',
  },
  qualityBadgeText: {
    color: '#E8EDF5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  genreChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  genreChipText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  progressBlock: {
    gap: 4,
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: novaTheme.colors.accent,
  },
  progressLabel: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  loadingText: {
    color: novaTheme.colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  inlineError: {
    gap: 4,
  },
  inlineErrorText: {
    color: novaTheme.colors.danger,
    fontSize: 13,
  },
  synopsis: {
    color: 'rgba(236, 242, 255, 0.88)',
    fontSize: 14,
    lineHeight: 20,
  },
  synopsisMuted: {
    color: novaTheme.colors.textMuted,
    fontSize: 13,
  },
  castLine: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
    alignItems: 'center',
  },
  action: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionFocusTransition: Platform.select({
    web: {
      transitionProperty: 'border-color, background-color',
      transitionDuration: `${MOVIE_DETAIL_FOCUS_MS}ms`,
    },
    default: {},
  }),
  actionPrimary: {
    backgroundColor: 'rgba(59, 130, 246, 0.95)',
    borderWidth: 2,
    borderColor: 'rgba(191, 219, 254, 0.75)',
    minWidth: 140,
    paddingHorizontal: 18,
  },
  actionPrimarySelected: {
    backgroundColor: 'rgba(37, 99, 235, 0.98)',
  },
  actionSecondary: {
    backgroundColor: 'rgba(12, 20, 36, 0.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  actionCompact: {
    width: 44,
    minWidth: 44,
    paddingHorizontal: 0,
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 20, 36, 0.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  actionSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.28)',
    borderColor: 'rgba(147, 197, 253, 0.55)',
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  actionLabelPrimary: {
    color: '#FFFFFF',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  sectionLabel: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  relatedSection: {
    marginTop: 'auto',
    paddingTop: 4,
  },
  relatedRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  relatedCard: {
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  relatedCardFocused: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  relatedPoster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  relatedPosterImage: {
    width: '100%',
    height: '100%',
  },
  relatedTitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
});
