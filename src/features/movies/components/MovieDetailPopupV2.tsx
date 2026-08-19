/**
 * Stage 4.2N — Movies Detail Popup V2.
 *
 * A brand-new, from-scratch centered popup. It is a guest overlay: it does
 * not own the Movies grid/category rail, does not construct playback URLs,
 * and never runs a multi-phase close transaction. Back and X share exactly
 * one close call, made by the caller (MoviesScreen), via `onClose`.
 *
 * Deliberately does NOT import: moviesDetailCloseInstant, moviesDetailFocusLifecycle,
 * moviesDetailCloseTransaction, moviesDetailSimpleBack, any visual-isolation or
 * hold-cover helper, or the old MovieDetailOverlay / MediaDetailOverlayShell layout.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ComponentType, ElementRef, ReactNode } from 'react';
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import { findNodeHandle, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { MediaArtworkFallback } from '@/features/media-browser/MediaArtworkFallback';
import type { MediaDetail } from '@/features/media-browser/mediaTypes';
import { isValidTvFocusableTarget, requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { novaTheme } from '@/theme';
import {
  computeMovieDetailPopupV2Layout,
  logMovieDetailPopupV2Event,
  logMovieDetailRenderLoopAudit,
  logMoviesDetailV2FocusOwnership,
  resolveMovieDetailPopupV2InitialFocusId,
  shouldConfirmMovieDetailInitialFocus,
  shouldPublishMovieDetailDestinations,
  shouldReArmMovieDetailPreferredFocus,
  shouldRequestMovieDetailPopupV2InitialFocus,
  shouldUpdateMovieDetailFocusedActionId,
  type MovieDetailPopupV2Action,
} from '../moviesDetailPopupV2';

type TvFocusablePressable = ElementRef<typeof Pressable> & {
  setNativeProps?: (props: Record<string, number>) => void;
};

const NOOP_ACTION_BUTTON_REF = (_instance: TvFocusablePressable | null) => undefined;

function pinDetailCtaLeftEdge(instance: TvFocusablePressable | null) {
  if (!instance) {
    return;
  }
  const handle = findNodeHandle(instance);
  if (handle == null) {
    return;
  }
  try {
    instance.setNativeProps?.({ nextFocusLeft: handle });
  } catch {
    // Directional pinning must never crash Detail.
  }
}

export type MovieDetailPopupV2Movie = {
  id: string;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
};

export type MovieDetailPopupV2Props = {
  visible: boolean;
  movie: MovieDetailPopupV2Movie | null;
  detail: MediaDetail | null;
  loading?: boolean;
  error?: string | null;
  onPlay?: () => void;
  onToggleFavorite?: () => void;
  onToggleWatchlist?: () => void;
  onClose: (source: 'back' | 'x') => void;
  originItemId?: string | null;
  /** Optional — favorite/watchlist visual state and Resume/Trailer parity. */
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  playLabel?: string;
  onTrailerPress?: () => void;
  onRetry?: () => void;
};

type ActionSpec = {
  id: string;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** If BlurView cannot render safely, the dark scrim underneath is the fallback. */
class BlurSafetyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    logMovieDetailPopupV2Event('movie_detail_popup_v2_blur_fallback');
  }

  render() {
    if (this.state.failed) {
      return null;
    }
    return this.props.children;
  }
}

function formatYear(detail: MediaDetail | null): string | null {
  if (!detail) return null;
  if (detail.year) return String(detail.year);
  if (detail.releaseDate) {
    const match = /^\d{4}/.exec(detail.releaseDate);
    if (match) return match[0];
  }
  return null;
}

function formatRating(detail: MediaDetail | null): string | null {
  if (!detail?.rating) return null;
  const value = typeof detail.rating === 'number' ? detail.rating : Number(detail.rating);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `★ ${value.toFixed(1)}`;
}

function buildMetaLine(detail: MediaDetail | null): string {
  if (!detail) return '';
  const parts: string[] = [];
  const year = formatYear(detail);
  if (year) parts.push(year);
  if (detail.contentRating) parts.push(detail.contentRating);
  const rating = formatRating(detail);
  if (rating) parts.push(rating);
  if (detail.runtime) parts.push(detail.runtime);
  const genres = (detail.genres ?? []).filter(Boolean).slice(0, 3);
  if (genres.length) parts.push(genres.join(', '));
  return parts.join('  •  ');
}

function ActionButton({
  action,
  preferred,
  focused,
  buttonRef,
  onFocus,
  onBlur,
}: {
  action: ActionSpec;
  preferred: boolean;
  focused: boolean;
  buttonRef: (instance: ElementRef<typeof Pressable> | null) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const focusable = !action.disabled;
  const lastPressAtRef = useRef(0);
  const activate = () => {
    if (!focusable) return;
    const now = Date.now();
    if (now - lastPressAtRef.current < 350) return;
    lastPressAtRef.current = now;
    action.onPress();
  };

  return (
    <Pressable
      ref={buttonRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={preferred && focusable}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[
        styles.action,
        action.primary && styles.actionPrimary,
        action.disabled && styles.actionDisabled,
        focused && styles.actionFocused,
        focused && action.primary && styles.actionPrimaryFocused,
      ]}>
      <MaterialCommunityIcons
        name={action.icon}
        size={20}
        color={action.disabled ? novaTheme.colors.textMuted : '#FFFFFF'}
      />
      <Text
        style={[
          styles.actionLabel,
          action.disabled && styles.actionLabelDisabled,
          focused && styles.actionLabelFocused,
        ]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

export function MovieDetailPopupV2({
  visible,
  movie,
  detail,
  loading = false,
  error = null,
  onPlay,
  onToggleFavorite,
  onToggleWatchlist,
  onClose,
  isFavorite = false,
  isWatchlisted = false,
  playLabel,
  onTrailerPress,
  onRetry,
}: MovieDetailPopupV2Props) {
  const { width, height } = useWindowDimensions();
  const layout = useMemo(
    () => computeMovieDetailPopupV2Layout({ screenWidth: width, screenHeight: height }),
    [width, height],
  );

  const actionRefs = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const [focusedActionId, setFocusedActionId] = useState<string | null>(null);
  const [closeFocused, setCloseFocused] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [guideDestinations, setGuideDestinations] = useState<TvFocusablePressable[]>([]);
  const closeGuardRef = useRef(0);
  const wasVisibleRef = useRef(false);
  const visibleRef = useRef(visible);
  const movieIdRef = useRef(movie?.id ?? null);
  const initialFocusActionIdRef = useRef<string | null>(null);
  const initialFocusIssuedForMovieRef = useRef<string | null>(null);
  const initialFocusConfirmedRef = useRef(false);
  const cancelInitialFocusRef = useRef<(() => void) | null>(null);
  const destinationsPublishedRef = useRef(false);
  const renderCountRef = useRef(0);
  const openSession = visible && movie?.id ? movie.id : null;
  const [ctaFocusSession, setCtaFocusSession] = useState<string | null>(null);
  const [ctaFocusConsumed, setCtaFocusConsumed] = useState(false);
  if (shouldReArmMovieDetailPreferredFocus({ openSession, previousSession: ctaFocusSession })) {
    setCtaFocusSession(openSession);
    setCtaFocusConsumed(false);
    setPosterFailed(false);
    setCloseFocused(false);
    setFocusedActionId(null);
    setGuideDestinations((current) => (current.length === 0 ? current : []));
  } else if (openSession == null && ctaFocusSession != null) {
    setCtaFocusSession(null);
    setGuideDestinations((current) => (current.length === 0 ? current : []));
  }
  const preferInitialCta = Boolean(openSession) && !ctaFocusConsumed;

  const title = movie?.title ?? detail?.title ?? '';
  const posterUrl = detail?.posterUrl ?? movie?.posterUrl;
  const metaLine = buildMetaLine(detail);
  const description = detail?.synopsis ?? '';

  const actions = useMemo<ActionSpec[]>(() => {
    const next: ActionSpec[] = [];
    if (onPlay) {
      next.push({
        id: 'play',
        label: playLabel ?? 'Play',
        icon: 'play',
        primary: true,
        onPress: onPlay,
      });
    }
    if (onToggleFavorite) {
      next.push({
        id: 'favorite',
        label: isFavorite ? 'Favorited' : 'Favorite',
        icon: isFavorite ? 'heart' : 'heart-outline',
        onPress: onToggleFavorite,
      });
    }
    if (onToggleWatchlist) {
      next.push({
        id: 'watchlist',
        label: isWatchlisted ? 'In Watchlist' : 'Watchlist',
        icon: isWatchlisted ? 'bookmark' : 'bookmark-outline',
        onPress: onToggleWatchlist,
      });
    }
    if (detail?.trailerUrl && onTrailerPress) {
      next.push({
        id: 'trailer',
        label: 'Trailer',
        icon: 'movie-open-outline',
        onPress: onTrailerPress,
      });
    }
    if (error && onRetry) {
      next.push({
        id: 'retry',
        label: 'Retry',
        icon: 'refresh',
        onPress: onRetry,
      });
    }
    return next;
  }, [
    detail?.trailerUrl,
    error,
    isFavorite,
    isWatchlisted,
    onPlay,
    onRetry,
    onToggleFavorite,
    onToggleWatchlist,
    onTrailerPress,
    playLabel,
  ]);

  const initialFocusActionId = useMemo(
    () =>
      resolveMovieDetailPopupV2InitialFocusId(
        actions.map<MovieDetailPopupV2Action>((action) => ({ id: action.id, disabled: action.disabled })),
      ),
    [actions],
  );

  const claimInitialCtaFocus = useCallback((
    actionId: string,
    instance: TvFocusablePressable | null,
    movieId: string | null,
    isVisible: boolean,
    focusActionId: string | null,
  ) => {
    visibleRef.current = isVisible;
    movieIdRef.current = movieId;
    initialFocusActionIdRef.current = focusActionId;
    if (!isVisible || !movieId || !instance) {
      return;
    }
    if (actionId !== focusActionId) {
      return;
    }
    if (initialFocusIssuedForMovieRef.current === movieId) {
      return;
    }
    if (!isValidTvFocusableTarget(instance)) {
      return;
    }
    if (
      !shouldRequestMovieDetailPopupV2InitialFocus({
        detailOpen: true,
        hasPrimaryAction: true,
        alreadyIssued: false,
      })
    ) {
      return;
    }

    logMoviesDetailV2FocusOwnership({
      phase: 'cta-ref-ready',
      movieId,
      detailOpen: true,
      focusIssued: false,
      detailCtaHandlePresent: true,
      focusedRegion: 'detail-cta',
      categoryHostFocusable: false,
      posterHostFocusable: false,
    });

    initialFocusIssuedForMovieRef.current = movieId;
    logMovieDetailRenderLoopAudit({
      event: 'initial-request',
      movieId,
      actionId,
      nativeHandlePresent: true,
      sameHandle: false,
      preferredFocus: true,
      initialRequestLatched: true,
    });
    logMoviesDetailV2FocusOwnership({
      phase: 'initial-focus-requested',
      movieId,
      detailOpen: true,
      focusIssued: true,
      detailCtaHandlePresent: true,
      focusedRegion: 'detail-cta',
      categoryHostFocusable: false,
      posterHostFocusable: false,
    });

    cancelInitialFocusRef.current?.();
    cancelInitialFocusRef.current = requestTvFocus({
      screen: 'movies',
      source: 'MovieDetailPopupV2',
      region: 'detail-cta',
      itemId: movieId,
      reason: 'detail-v2-initial-cta',
      maxFrames: 3,
      isActive: () => visibleRef.current && movieIdRef.current === movieId,
      getTarget: () => {
        const current = actionRefs.current.get(actionId);
        return isValidTvFocusableTarget(current) ? current : null;
      },
    });
  }, []);

  const registerActionNode = useCallback((
    actionId: string,
    instance: TvFocusablePressable | null,
    context?: { movieId: string | null; visible: boolean; initialFocusActionId: string | null },
  ) => {
    if (context) {
      if (movieIdRef.current !== context.movieId) {
        destinationsPublishedRef.current = false;
        initialFocusConfirmedRef.current = false;
      }
      visibleRef.current = context.visible;
      movieIdRef.current = context.movieId;
      initialFocusActionIdRef.current = context.initialFocusActionId;
    }
    const previous = (actionRefs.current.get(actionId) as TvFocusablePressable | undefined) ?? null;
    const sameHandle = previous === instance;
    logMovieDetailRenderLoopAudit({
      event: instance ? 'ref-attach' : 'ref-detach',
      movieId: movieIdRef.current,
      actionId,
      nativeHandlePresent: Boolean(instance),
      sameHandle,
      initialRequestLatched: initialFocusIssuedForMovieRef.current === movieIdRef.current,
    });
    if (sameHandle) {
      return;
    }
    if (instance) {
      actionRefs.current.set(actionId, instance);
    } else {
      actionRefs.current.delete(actionId);
      return;
    }

    const focusActionId = initialFocusActionIdRef.current;
    if (actionId === focusActionId) {
      pinDetailCtaLeftEdge(instance);
    }
    claimInitialCtaFocus(
      actionId,
      instance,
      movieIdRef.current,
      visibleRef.current,
      focusActionId,
    );

    if (
      shouldPublishMovieDetailDestinations({
        alreadyPublished: destinationsPublishedRef.current,
        actionId,
        initialFocusActionId: focusActionId,
        instancePresent: true,
        sameHandle: false,
      })
    ) {
      destinationsPublishedRef.current = true;
      const next = Array.from(actionRefs.current.values()) as TvFocusablePressable[];
      setGuideDestinations(next);
      logMovieDetailRenderLoopAudit({
        event: 'destinations-change',
        movieId: movieIdRef.current,
        actionId,
        nativeHandlePresent: true,
        sameHandle: false,
      });
    }
  }, [claimInitialCtaFocus]);

  const actionIdsKey = actions.map((action) => action.id).join('|');
  // Stable per-action ref callbacks. The nested functions only run after commit.
  // eslint-disable-next-line react-hooks/refs -- registerActionNode is a ref callback, not render
  const actionButtonRefs = useMemo(() => {
    const next = new Map<string, (instance: TvFocusablePressable | null) => void>();
    const movieId = movie?.id ?? null;
    for (const actionId of actionIdsKey.length > 0 ? actionIdsKey.split('|') : []) {
      next.set(actionId, (instance) => {
        registerActionNode(actionId, instance, {
          movieId,
          visible: true,
          initialFocusActionId,
        });
      });
    }
    return next;
  }, [actionIdsKey, initialFocusActionId, movie?.id, registerActionNode]);

  const getActionButtonRef = (actionId: string) =>
    actionButtonRefs.get(actionId) ?? NOOP_ACTION_BUTTON_REF;

  useEffect(() => {
    renderCountRef.current += 1;
    if (renderCountRef.current <= 4) {
      logMovieDetailRenderLoopAudit({
        event: 'render',
        movieId: movie?.id ?? null,
        renderCount: renderCountRef.current,
        focusedActionId,
        preferredFocus: preferInitialCta,
        initialRequestLatched: initialFocusIssuedForMovieRef.current === movie?.id,
      });
    }
  });

  useEffect(() => {
    visibleRef.current = visible;
    movieIdRef.current = movie?.id ?? null;
    initialFocusActionIdRef.current = initialFocusActionId;
    if (!visible) {
      wasVisibleRef.current = false;
      initialFocusIssuedForMovieRef.current = null;
      initialFocusConfirmedRef.current = false;
      destinationsPublishedRef.current = false;
      cancelInitialFocusRef.current?.();
      cancelInitialFocusRef.current = null;
      return;
    }
    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;
    if (opening) {
      destinationsPublishedRef.current = false;
      logMovieDetailPopupV2Event('movie_detail_popup_v2_active', {
        movieId: movie?.id ?? null,
      });
      logMoviesDetailV2FocusOwnership({
        phase: 'detail-open',
        movieId: movie?.id ?? null,
        detailOpen: true,
        focusIssued: false,
        detailCtaHandlePresent: Boolean(
          initialFocusActionId && actionRefs.current.get(initialFocusActionId),
        ),
        focusedRegion: 'detail',
        categoryHostFocusable: false,
        posterHostFocusable: false,
      });
    }
  }, [initialFocusActionId, movie?.id, visible]);

  useEffect(() => {
    if (!visible || !initialFocusActionId) {
      return;
    }
    const target = actionRefs.current.get(initialFocusActionId) as TvFocusablePressable | undefined;
    if (!target) {
      return;
    }
    pinDetailCtaLeftEdge(target);
    claimInitialCtaFocus(initialFocusActionId, target, movie?.id ?? null, visible, initialFocusActionId);
  }, [claimInitialCtaFocus, initialFocusActionId, movie?.id, visible]);

  const requestClose = (source: 'back' | 'x') => {
    const now = Date.now();
    if (now - closeGuardRef.current < 300) {
      return;
    }
    closeGuardRef.current = now;
    onClose(source);
  };

  if (!visible || !movie) {
    return null;
  }

  const reactNative = ReactNative as typeof ReactNative & { TVFocusGuideView?: typeof View };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
    destinations?: unknown[];
  }>;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="auto"
      testID="movie-detail-popup-v2"
      accessibilityViewIsModal
      importantForAccessibility="yes">
      {/* Background layer: Movies browse stays visible underneath, dimmed/blurred. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BlurSafetyBoundary>
          <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
        </BlurSafetyBoundary>
      </View>
      <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />

      <FocusBoundaryView
        style={styles.centerWrap}
        pointerEvents="box-none"
        {...(Platform.OS === 'android'
          ? {
              autoFocus: true,
              trapFocusLeft: true,
              trapFocusRight: true,
              trapFocusUp: true,
              trapFocusDown: true,
              destinations: guideDestinations,
            }
          : {})}>
        <View style={[styles.shadowWrap, { width: layout.popupWidth, height: layout.popupHeight }]}>
          {/*
           * No backdrop image in this popup. Two rebuild attempts proved that
           * mounting ANY async <Image> anywhere in `card`'s subtree — even as
           * an always-mounted, position:'absolute', non-overflow:'hidden'
           * sibling — corrupts Android's layout/stacking on this build the
           * instant the image arrives: first observed as contentRow's flex
           * box collapsing to a sliver at the bottom of the card, then (after
           * moving the image out of `card` into a `shadowWrap`-level sibling)
           * as the entire popup card rendering *behind* the Movies browse
           * screen. The backdrop was always optional per spec ("may appear as
           * a faint decoration") — the poster (available from the very first
           * render, not async-appearing later) plus title/metadata/
           * description is the actual requirement, and it renders correctly
           * and stably without a backdrop in the mix.
           */}
          <View style={styles.card}>
            <Pressable
              focusable
              hasTVPreferredFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onFocus={() => setCloseFocused(true)}
              onBlur={() => setCloseFocused(false)}
              onPress={() => requestClose('x')}
              {...(Platform.isTV ? { onClick: () => requestClose('x') } : {})}
              style={[styles.closeButton, closeFocused && styles.closeButtonFocused]}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>

            <View style={styles.contentRow}>
              <View style={[styles.posterPanel, { width: layout.posterWidth }]}>
                {posterUrl && !posterFailed ? (
                  <TvRemoteImage
                    uri={posterUrl}
                    style={styles.posterImage}
                    resizeMode="cover"
                    onError={() => setPosterFailed(true)}
                  />
                ) : (
                  <View style={styles.posterImage}>
                    <MediaArtworkFallback title={title} kind="movie" />
                  </View>
                )}
              </View>

              <View style={styles.copyPanel}>
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
                {metaLine ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {metaLine}
                  </Text>
                ) : null}
                {description ? (
                  <Text style={styles.description} numberOfLines={5}>
                    {description}
                  </Text>
                ) : null}
                {loading && !error ? <Text style={styles.statusLine}>Loading details…</Text> : null}
                {error ? (
                  <Text style={styles.errorLine} numberOfLines={2}>
                    {error}
                  </Text>
                ) : null}

                <View style={styles.actionsRow}>
                  {actions.map((action) => (
                    <ActionButton
                      key={action.id}
                      action={action}
                      preferred={preferInitialCta && action.id === initialFocusActionId}
                      focused={focusedActionId === action.id}
                      buttonRef={getActionButtonRef(action.id)}
                      onFocus={() => {
                        logMovieDetailRenderLoopAudit({
                          event: 'focus',
                          movieId: movieIdRef.current,
                          actionId: action.id,
                          focusedActionId: action.id,
                          preferredFocus: preferInitialCta,
                          initialRequestLatched:
                            initialFocusIssuedForMovieRef.current === movieIdRef.current,
                        });
                        setFocusedActionId((current) =>
                          shouldUpdateMovieDetailFocusedActionId(current, action.id)
                            ? action.id
                            : current,
                        );
                        if (
                          shouldConfirmMovieDetailInitialFocus({
                            actionId: action.id,
                            initialFocusActionId: initialFocusActionIdRef.current,
                            alreadyConfirmed: initialFocusConfirmedRef.current,
                            visible: visibleRef.current,
                          })
                        ) {
                          initialFocusConfirmedRef.current = true;
                          setCtaFocusConsumed(true);
                          logMovieDetailRenderLoopAudit({
                            event: 'preferred-focus-change',
                            movieId: movieIdRef.current,
                            actionId: action.id,
                            preferredFocus: false,
                            initialRequestLatched: true,
                          });
                          logMoviesDetailV2FocusOwnership({
                            phase: 'initial-focus-confirmed',
                            movieId: movieIdRef.current,
                            detailOpen: true,
                            focusIssued: true,
                            detailCtaHandlePresent: true,
                            focusedRegion: 'detail-cta',
                            categoryHostFocusable: false,
                            posterHostFocusable: false,
                          });
                        }
                      }}
                      onBlur={() => {
                        setFocusedActionId((current) =>
                          shouldUpdateMovieDetailFocusedActionId(current, null) &&
                          current === action.id
                            ? null
                            : current,
                        );
                      }}
                    />
                  ))}
                </View>
              </View>
            </View>
          </View>
        </View>
      </FocusBoundaryView>
    </View>
  );
}

export default MovieDetailPopupV2;

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shadowWrap: {
    borderRadius: 20,
    backgroundColor: 'transparent',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  // No overflow:'hidden' anywhere in this file (see below). `card`'s
  // rounded look comes from borderRadius alone — RN/Android clips the
  // background+border fill to the rounded rect without needing
  // overflow:'hidden', and nothing inside `card` (poster, text, buttons)
  // extends past its padded bounds, so there is nothing that needs clipping.
  card: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: 'rgba(14, 18, 26, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 3,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  closeButtonFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(59, 130, 246, 0.4)',
    transform: [{ scale: 1.08 }],
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 30,
    paddingVertical: 30,
    gap: 26,
    zIndex: 2,
  },
  posterPanel: {
    aspectRatio: 2 / 3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'flex-start',
    flexShrink: 0,
    flexGrow: 0,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  copyPanel: {
    flex: 1,
    minWidth: 0,
    paddingRight: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  meta: {
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  description: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 15,
    lineHeight: 22,
  },
  statusLine: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
  },
  errorLine: {
    color: novaTheme.colors.warning,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  actionPrimary: {
    backgroundColor: novaTheme.colors.accent,
    borderColor: novaTheme.colors.accentHover,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(131, 180, 255, 0.28)',
    transform: [{ scale: 1.06 }],
    shadowColor: novaTheme.colors.focusRing,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 10,
  },
  actionPrimaryFocused: {
    backgroundColor: novaTheme.colors.accentHover,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  actionLabelFocused: {
    color: '#FFFFFF',
  },
});
