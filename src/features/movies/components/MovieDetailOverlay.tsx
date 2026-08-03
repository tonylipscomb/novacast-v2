import type { ComponentProps, ComponentType, ElementRef, ReactNode, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
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
import type { MediaCastMember, MediaDetail } from '@/features/media-browser/mediaTypes';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import {
  deriveStreamQualityBadges,
  formatMovieRating,
  heroBackdropUri,
  resolveContinueWatchingProgress,
  type RelatedMovieCandidate,
  type StreamQualityBadge,
} from '../movieDetailOverlayModel';

const focusText = createNovaTvFocusTextStyles(novaTheme);

const OPEN_MS = 180;
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

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

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
  selected = false,
  disabled = false,
  preferred = false,
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
  selected?: boolean;
  disabled?: boolean;
  preferred?: boolean;
  buttonRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocus: (id: ActionId) => void;
  onBlur: () => void;
}) {
  const focusable = Boolean(onPress) && !disabled;
  const lastActivateAtRef = useRef(0);

  const activate = () => {
    if (!focusable || !onPress) return;
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
        primary ? styles.actionPrimary : styles.actionSecondary,
        disabled && styles.actionDisabled,
        novaTvFocus.base,
        selected && styles.actionFocused,
        selected && novaTvFocus.active,
      ]}>
      <MaterialCommunityIcons
        name={icon}
        size={primary ? 22 : 18}
        color={primary ? '#FFFFFF' : novaTheme.colors.textPrimary}
      />
      <Text style={[styles.actionLabel, primary && styles.actionLabelPrimary, disabled && styles.actionLabelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

function RelatedCarousel({
  movies,
  focusedId,
  onFocus,
  onSelect,
  firstRef,
}: {
  movies: RelatedMovieCandidate[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onSelect?: (movie: RelatedMovieCandidate) => void;
  firstRef?: (instance: ElementRef<typeof Pressable> | null) => void;
}) {
  if (!movies.length) return null;

  return (
    <View style={styles.relatedSection}>
      <Text style={styles.sectionLabel}>Related Titles</Text>
      <ScrollView
        focusable={false}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.relatedRow}>
        {movies.map((movie, index) => {
          const focused = focusedId === `related:${movie.id}`;
          return (
            <Pressable
              key={movie.id}
              ref={index === 0 ? firstRef : undefined}
              focusable={Boolean(onSelect)}
              accessibilityLabel={movie.title}
              onFocus={() => onFocus(`related:${movie.id}`)}
              onPress={() => onSelect?.(movie)}
              style={[styles.relatedCard, novaTvFocus.base, focused && styles.relatedCardFocused, focused && novaTvFocus.active]}>
              <View style={styles.relatedPoster}>
                {movie.posterUrl ? (
                  <TvRemoteImage uri={movie.posterUrl} style={styles.relatedPosterImage} />
                ) : (
                  <MediaArtworkFallback title={movie.title} kind="movie" subtitle={movie.year ? String(movie.year) : undefined} />
                )}
              </View>
              <Text numberOfLines={2} style={[styles.relatedTitle, focused && focusText.title]}>
                {displayStreamTitle(movie.title) || movie.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CastCarousel({
  cast,
  focusedId,
  onFocus,
}: {
  cast: MediaCastMember[];
  focusedId: string | null;
  onFocus: (id: string) => void;
}) {
  if (!cast.length) return null;

  return (
    <View style={styles.castSection}>
      <Text style={styles.sectionLabel}>Cast</Text>
      <ScrollView focusable={false} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
        {cast.slice(0, 10).map((member) => {
          const focused = focusedId === `cast:${member.name}`;
          return (
            <Pressable
              key={`${member.name}-${member.character ?? ''}`}
              focusable
              accessibilityLabel={member.name}
              onFocus={() => onFocus(`cast:${member.name}`)}
              style={[styles.castCard, novaTvFocus.base, focused && novaTvFocus.active]}>
              <View style={styles.castAvatar}>
                {member.imageUrl ? (
                  <TvRemoteImage uri={member.imageUrl} style={styles.castImage} />
                ) : (
                  <Text style={styles.castInitials}>{initials(member.name)}</Text>
                )}
              </View>
              <Text numberOfLines={1} style={[styles.castName, focused && focusText.title]}>
                {member.name}
              </Text>
              {member.character ? (
                <Text numberOfLines={1} style={styles.castCharacter}>
                  {member.character}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MovieDetailOverlayComponent({
  visible,
  keepFocusTrap = false,
  focusHandoffActive = false,
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
  const [failedBackdropKey, setFailedBackdropKey] = useState<string | null>(null);
  const posterKey = detail ? `${detail.id}:${detail.posterUrl ?? ''}` : null;
  const backdropKey = detail ? `${detail.id}:${detail.backdropUrl ?? detail.posterUrl ?? ''}` : null;
  const posterFailed = Boolean(posterKey) && failedPosterKey === posterKey;
  const backdropFailed = Boolean(backdropKey) && failedBackdropKey === backdropKey;

  const progress = useSharedValue(0);
  const actionRefs = useRef(new Map<ActionId, ElementRef<typeof Pressable>>());
  const playRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const relatedFirstRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const [actionHandles, setActionHandles] = useState<Record<string, number>>({});
  const [relatedHandle, setRelatedHandle] = useState<number | undefined>(undefined);
  const focusRetryCancelRef = useRef<(() => void) | null>(null);
  const wasVisibleRef = useRef(false);
  const lastPlayInvokeAtRef = useRef(0);

  const invokePlay = useCallback(() => {
    if (!onPlay) return;
    const now = Date.now();
    if (now - lastPlayInvokeAtRef.current < 400) return;
    lastPlayInvokeAtRef.current = now;
    onPlay();
  }, [onPlay]);

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

  const firstAction: ActionId | null = onPlay
    ? 'play'
    : onWatchlistPress
      ? 'watchlist'
      : onTrailerPress
        ? 'trailer'
        : onFavoritePress
          ? 'favorite'
          : onRetry
            ? 'retry'
            : null;

  const actionIds = [
    onPlay ? 'play' : null,
    onWatchlistPress ? 'watchlist' : null,
    onTrailerPress ? 'trailer' : null,
    onFavoritePress ? 'favorite' : null,
  ].filter((item): item is ActionId => Boolean(item));
  const actionGraphKey = actionIds.join('|');

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      progress.value = 0;
      return;
    }

    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;

    if (opening) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING });
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
  }, [actionGraphKey, detail?.id, firstAction, focusHandoffActive, progress, visible]);

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
      setRelatedHandle(handleFor(relatedFirstRef) ?? undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [actionGraphKey, detail?.id, relatedMovies.length, visible]);

  const shellStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [28, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.965, 1]) },
    ],
  }));

  const posterStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [36, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
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

  const resumeProgress = resolveContinueWatchingProgress(continueWatchingProgress);
  const rating = formatMovieRating(detail?.rating);
  const backdropUri = heroBackdropUri(detail);
  const title = detail ? displayStreamTitle(detail.title) || detail.title : '';
  const genres = detail?.genres.filter(Boolean).slice(0, 5) ?? [];

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

  if (!detail) return null;
  if (!visible && !keepFocusTrap) return null;

  const panelVisible = visible;
  const contentMaxWidth = Math.min(width - 64, 1280);

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
        ? continueWatchingLabel ?? 'Play'
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

    return (
      <OverlayAction
        key={id}
        id={id}
        label={label}
        icon={icon}
        onPress={focusHandoffActive ? undefined : onPress}
        primary={id === 'play'}
        preferred={!focusHandoffActive && id === firstAction}
        selected={!focusHandoffActive && focusedTarget === id}
        disabled={focusHandoffActive || (id === 'trailer' && !onTrailerPress)}
        buttonRef={(instance) => {
          if (instance) {
            actionRefs.current.set(id, instance);
            if (id === 'play') playRef.current = instance;
          } else {
            actionRefs.current.delete(id);
          }
        }}
        nextFocusLeft={actionHandles[left ?? id]}
        nextFocusRight={right ? actionHandles[right] : actionHandles[id]}
        nextFocusUp={actionHandles[id]}
        nextFocusDown={relatedHandle ?? actionHandles[id]}
        onFocus={(actionId) => {
          focusRetryCancelRef.current?.();
          focusRetryCancelRef.current = null;
          setFocusedTarget(actionId);
        }}
        onBlur={() => setFocusedTarget(null)}
      />
    );
  };

  return (
    <View
      style={[styles.root, !panelVisible && styles.rootHidden]}
      pointerEvents={focusHandoffActive ? 'box-none' : panelVisible ? 'auto' : 'none'}
      accessibilityViewIsModal={panelVisible && !focusHandoffActive}
      importantForAccessibility={panelVisible && !focusHandoffActive ? 'yes' : 'no-hide-descendants'}>
      {focusHandoffActive ? (
        <Pressable
          ref={closeTargetRef}
          focusable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => undefined}
          style={styles.closeFocusTarget}
        />
      ) : null}

      <Animated.View
        entering={FadeIn.duration(OPEN_MS)}
        exiting={FadeOut.duration(120)}
        style={StyleSheet.absoluteFill}
        pointerEvents="none">
        {backdropUri && !backdropFailed ? (
          <TvRemoteImage
            uri={backdropUri}
            style={styles.heroImage}
            onError={() => {
              if (backdropKey) setFailedBackdropKey(backdropKey);
            }}
          />
        ) : (
          <View style={styles.heroFallback} />
        )}
        {blurTarget ? (
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={64}
            tint="dark"
            style={styles.heroBlur}
          />
        ) : (
          <BlurView intensity={70} tint="dark" style={styles.heroBlur} />
        )}
        <View style={styles.heroScrim} />
        <View style={styles.heroAccentGlow} />
      </Animated.View>

      <FocusBoundaryView
        style={styles.focusBoundary}
        {...(Platform.OS === 'android' && !focusHandoffActive
          ? { autoFocus: true, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
          : {})}
        pointerEvents={focusHandoffActive ? 'none' : 'auto'}>
        <Animated.View style={[styles.shell, { maxWidth: contentMaxWidth, minHeight: Math.min(height * 0.78, 720) }, shellStyle]}>
          <Pressable
            focusable={false}
            onPress={onClose}
            style={styles.closeHint}
            accessibilityLabel="Close details">
            <MaterialCommunityIcons name="close" size={22} color="rgba(255,255,255,0.72)" />
          </Pressable>

          <View style={styles.heroRow}>
            <Animated.View style={[styles.posterFrame, posterStyle]}>
              {detail.posterUrl && !posterFailed ? (
                <TvRemoteImage
                  uri={detail.posterUrl}
                  style={styles.posterImage}
                  onError={() => {
                    if (posterKey) setFailedPosterKey(posterKey);
                  }}
                />
              ) : (
                <MediaArtworkFallback title={title} kind="movie" subtitle={detail.year} />
              )}
              {rating ? (
                <View style={styles.posterRating}>
                  <MaterialCommunityIcons name="star" size={14} color="#F6C85F" />
                  <Text style={styles.posterRatingText}>{rating}</Text>
                </View>
              ) : null}
            </Animated.View>

            <View style={styles.glassCard}>
              <View style={styles.glassFill} />
              <ScrollView
                focusable={false}
                style={styles.infoScroll}
                contentContainerStyle={styles.infoContent}
                showsVerticalScrollIndicator={false}>
                <Text numberOfLines={2} style={styles.title}>
                  {title}
                </Text>

                <View style={styles.metaRow}>
                  {rating ? (
                    <View style={styles.ratingChip}>
                      <MaterialCommunityIcons name="star" size={14} color="#F6C85F" />
                      <Text style={styles.ratingChipText}>{rating}</Text>
                    </View>
                  ) : null}
                  {detail.year ? <Text style={styles.metaChip}>{detail.year}</Text> : null}
                  {detail.runtime ? <Text style={styles.metaChip}>{detail.runtime}</Text> : null}
                  {detail.contentRating ? <Text style={styles.metaChip}>{detail.contentRating}</Text> : null}
                  {qualityBadges.map((badge) => (
                    <QualityBadge key={badge.id} badge={badge} />
                  ))}
                </View>

                {genres.length ? (
                  <View style={styles.genreRow}>
                    {genres.map((genre) => (
                      <View key={genre} style={styles.genreChip}>
                        <Text style={styles.genreChipText}>{genre}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {resumeProgress != null ? (
                  <View style={styles.progressBlock}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${resumeProgress}%` }]} />
                    </View>
                    <Text style={styles.progressLabel}>{resumeProgress}% watched</Text>
                  </View>
                ) : null}

                {detailLoading ? <Text style={styles.loadingText}>Updating details…</Text> : null}
                {detailError ? (
                  <View style={styles.inlineError}>
                    <Text style={styles.inlineErrorText}>{detailError}</Text>
                    {onRetry ? (
                      <OverlayAction
                        id="retry"
                        label="Retry"
                        icon="refresh"
                        onPress={onRetry}
                        selected={focusedTarget === 'retry'}
                        onFocus={setFocusedTarget}
                        onBlur={() => setFocusedTarget(null)}
                      />
                    ) : null}
                  </View>
                ) : null}

                {detail.synopsis?.trim() ? (
                  <Text numberOfLines={5} style={styles.synopsis}>
                    {detail.synopsis.trim()}
                  </Text>
                ) : !detailLoading ? (
                  <Text style={styles.synopsisMuted}>No synopsis available.</Text>
                ) : null}

                <View style={styles.actionRow}>{actionIds.map((id) => renderAction(id))}</View>

                {!onTrailerPress ? (
                  <View style={styles.trailerPlaceholder}>
                    <MaterialCommunityIcons name="movie-open-outline" size={16} color={novaTheme.colors.textMuted} />
                    <Text style={styles.trailerPlaceholderText}>Trailer coming soon</Text>
                  </View>
                ) : null}

                <CastCarousel cast={detail.cast} focusedId={focusedTarget} onFocus={setFocusedTarget} />

                <RelatedCarousel
                  movies={relatedMovies}
                  focusedId={focusedTarget}
                  onFocus={setFocusedTarget}
                  onSelect={focusHandoffActive ? undefined : onSelectRelated}
                  firstRef={(instance) => {
                    relatedFirstRef.current = instance;
                  }}
                />
              </ScrollView>
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
    paddingHorizontal: 28,
    paddingVertical: 20,
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
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A1020',
  },
  heroBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 8, 18, 0.72)',
  },
  heroAccentGlow: {
    position: 'absolute',
    left: '-10%',
    right: '-10%',
    bottom: '-20%',
    height: '55%',
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    opacity: 0.9,
  },
  focusBoundary: {
    width: '100%',
    maxWidth: 1280,
    alignItems: 'center',
  },
  shell: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
  },
  closeHint: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 14, 28, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  heroRow: {
    flexDirection: 'row',
    gap: 28,
    paddingHorizontal: 28,
    paddingVertical: 28,
    alignItems: 'stretch',
  },
  posterFrame: {
    width: 248,
    aspectRatio: 2 / 3,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(131, 180, 255, 0.28)',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterRating: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 12, 22, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(246, 200, 95, 0.35)',
  },
  posterRatingText: {
    color: '#F6C85F',
    fontSize: 13,
    fontWeight: '700',
  },
  glassCard: {
    flex: 1,
    minHeight: 360,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(131, 180, 255, 0.28)',
    backgroundColor: 'rgba(12, 18, 32, 0.55)',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
  },
  glassFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 36, 72, 0.42)',
  },
  infoScroll: {
    flex: 1,
  },
  infoContent: {
    paddingHorizontal: 26,
    paddingVertical: 24,
    gap: 14,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(59, 130, 246, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  metaChip: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(246, 200, 95, 0.28)',
  },
  ratingChipText: {
    color: '#F6C85F',
    fontSize: 14,
    fontWeight: '700',
  },
  qualityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(131, 180, 255, 0.35)',
  },
  qualityBadgeHdr: {
    backgroundColor: 'rgba(124, 58, 237, 0.22)',
    borderColor: 'rgba(167, 139, 250, 0.45)',
  },
  qualityBadgeText: {
    color: '#E0EAFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(165, 180, 252, 0.28)',
  },
  genreChipText: {
    color: '#C7D2FE',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBlock: {
    gap: 6,
  },
  progressTrack: {
    height: 6,
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
    fontSize: 12,
    fontWeight: '600',
  },
  loadingText: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
  },
  inlineError: {
    gap: 10,
  },
  inlineErrorText: {
    color: novaTheme.colors.danger,
    fontSize: 14,
  },
  synopsis: {
    color: 'rgba(236, 242, 255, 0.88)',
    fontSize: 16,
    lineHeight: 24,
  },
  synopsisMuted: {
    color: novaTheme.colors.textMuted,
    fontSize: 15,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  action: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionPrimary: {
    backgroundColor: 'rgba(59, 130, 246, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.55)',
    minWidth: 148,
  },
  actionSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  actionFocused: {
    shadowColor: '#83B4FF',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  actionLabelPrimary: {
    color: '#FFFFFF',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  trailerPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    opacity: 0.7,
  },
  trailerPlaceholderText: {
    color: novaTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionLabel: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  castSection: {
    marginTop: 8,
  },
  castRow: {
    gap: 12,
    paddingRight: 8,
  },
  castCard: {
    width: 92,
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 14,
  },
  castAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(131, 180, 255, 0.28)',
  },
  castImage: {
    width: '100%',
    height: '100%',
  },
  castInitials: {
    color: '#DBEAFE',
    fontSize: 18,
    fontWeight: '700',
  },
  castName: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  castCharacter: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    width: '100%',
  },
  relatedSection: {
    marginTop: 10,
    marginBottom: 8,
  },
  relatedRow: {
    gap: 14,
    paddingRight: 8,
  },
  relatedCard: {
    width: 112,
    borderRadius: 14,
    padding: 6,
    gap: 8,
  },
  relatedCardFocused: {
    backgroundColor: 'rgba(18, 36, 72, 0.55)',
  },
  relatedPoster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  relatedPosterImage: {
    width: '100%',
    height: '100%',
  },
  relatedTitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    minHeight: 32,
  },
});
