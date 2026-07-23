import type { ComponentProps, ComponentType, ElementRef, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Animated,
  Easing,
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

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { MediaArtworkFallback } from '@/features/media-browser/MediaArtworkFallback';
import type { MediaCastMember, MediaDetail, MediaDetailEpisode } from '@/features/media-browser/mediaTypes';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

type MediaDetailOverlayProps = {
  visible: boolean;
  /** Keep the modal mounted invisibly so TV focus cannot fall through to the browse grid during playback launch. */
  keepFocusTrap?: boolean;
  blurTarget?: RefObject<View | null>;
  detail: MediaDetail | null;
  detailLoading?: boolean;
  detailError?: string | null;
  continueWatchingLabel?: string;
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  selectedSeasonNumber?: number;
  focusedEpisodeId?: string | null;
  onClose: () => void;
  onRetry?: () => void;
  onPlay?: () => void;
  onPlayFromBeginning?: () => void;
  onTrailerPress?: () => void;
  onFavoritePress?: () => void;
  onWatchlistPress?: () => void;
  onSeasonPress?: (seasonNumber: number) => void;
  onEpisodePress?: (episode: MediaDetailEpisode) => void;
  onEpisodeFocus?: (episodeId: string) => void;
};

type ActionId = 'play' | 'restart' | 'trailer' | 'favorite' | 'watchlist' | 'retry';

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
};

function noopUseTVEventHandler(_handler: (event: TvEventPayload) => void) {
  // RN 0.86 Android builds may not ship TV event hooks.
}

function formatDate(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : value;
}

function formatRating(value?: number) {
  return value && value > 0 ? value.toFixed(1) : undefined;
}

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

function OverlayAction({
  id,
  label,
  icon,
  onPress,
  primary = false,
  selected = false,
  disabled = false,
  preferred = false,
  compact = false,
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
  compact?: boolean;
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
    if (!focusable || !onPress) {
      return;
    }

    const now = Date.now();
    if (now - lastActivateAtRef.current < 400) {
      return;
    }

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
        primary && styles.actionPrimary,
        compact && styles.actionCompact,
        compact && !primary && styles.actionGhost,
        disabled && styles.actionDisabled,
        novaTvFocus.base,
        selected && !compact && novaTvFocus.active,
        selected && compact && !primary && styles.actionGhostFocused,
        selected && compact && primary && styles.actionPrimaryFocused,
        selected && !compact && styles.actionFocused,
      ]}>
      {!compact ? (
        <MaterialCommunityIcons name={icon} size={20} color={primary ? '#FFFFFF' : novaTheme.colors.textPrimary} />
      ) : (
        <MaterialCommunityIcons name={icon} size={16} color={primary ? '#FFFFFF' : novaTheme.colors.textPrimary} />
      )}
      <Text style={[styles.actionLabel, primary && styles.actionLabelPrimary, compact && styles.actionLabelMovie, disabled && styles.actionLabelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CastRow({
  cast,
  focusedId,
  onFocus,
  compact = false,
}: {
  cast: MediaCastMember[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  compact?: boolean;
}) {
  if (!cast.length) {
    return null;
  }

  return (
    <View style={[styles.sectionBlock, compact && styles.sectionBlockCompact]}>
      <Text style={styles.sectionLabel}>Cast</Text>
        <ScrollView focusable={false} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
        {cast.slice(0, 8).map((member) => {
          const focused = focusedId === member.name;
          return (
            <Pressable
              key={`${member.name}-${member.character ?? ''}`}
              focusable
              accessibilityLabel={member.name}
              onFocus={() => onFocus(member.name)}
              style={[styles.castMember, compact && styles.castMemberCompact, focused && styles.castMemberFocused]}>
              <View style={[styles.castAvatar, compact && styles.castAvatarCompact]}>
                {member.imageUrl ? (
                  <TvRemoteImage uri={member.imageUrl} resizeMode="cover" style={styles.castImage} />
                ) : (
                  <Text style={styles.castInitials}>{initials(member.name)}</Text>
                )}
              </View>
              <Text numberOfLines={1} style={styles.castName}>{member.name}</Text>
              {member.character ? <Text numberOfLines={1} style={styles.castCharacter}>{member.character}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SeriesEpisodePanel({
  detail,
  selectedSeasonNumber,
  focusedEpisodeId,
  onSeasonPress,
  onEpisodePress,
  onEpisodeFocus,
}: {
  detail: MediaDetail;
  selectedSeasonNumber?: number;
  focusedEpisodeId?: string | null;
  onSeasonPress?: (seasonNumber: number) => void;
  onEpisodePress?: (episode: MediaDetailEpisode) => void;
  onEpisodeFocus?: (episodeId: string) => void;
}) {
  const selected = selectedSeasonNumber ?? detail.seasons[0]?.seasonNumber;
  const episodes = detail.episodes.filter((episode) => episode.seasonNumber === selected);

  return (
    <View style={styles.sidePanelContent}>
      <Text style={styles.sideTitle}>Seasons &amp; Episodes</Text>
      <ScrollView focusable={false} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonRow}>
        {detail.seasons.map((season) => {
          const seasonFocused = focusedEpisodeId === `season-${season.seasonNumber}`;
          return (
            <Pressable
              key={season.seasonNumber}
              focusable
              accessibilityLabel={season.name ?? `Season ${season.seasonNumber}`}
              onFocus={() => onEpisodeFocus?.(`season-${season.seasonNumber}`)}
              onPress={() => onSeasonPress?.(season.seasonNumber)}
              style={[styles.seasonChip, season.seasonNumber === selected && styles.seasonChipSelected, seasonFocused && styles.seasonChipFocused]}>
              <Text style={[styles.seasonText, season.seasonNumber === selected && styles.seasonTextSelected]}>
                {season.name ?? `Season ${season.seasonNumber}`}
              </Text>
              <Text style={styles.seasonCount}>{season.episodeCount}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView focusable={false} style={styles.episodeScroll} contentContainerStyle={styles.episodeList} showsVerticalScrollIndicator={false}>
        {episodes.length ? episodes.map((episode, index) => {
          const focused = focusedEpisodeId === episode.id;
          return (
            <Pressable
              key={episode.id}
              focusable
              accessibilityLabel={`Episode ${episode.episodeNumber}, ${episode.title}`}
              onFocus={() => onEpisodeFocus?.(episode.id)}
              onPress={() => onEpisodePress?.(episode)}
              style={[styles.episodeRow, focused && styles.episodeRowFocused]}>
              <View style={styles.episodeNumberBox}>
                <Text style={[styles.episodeNumber, focused && styles.episodeNumberFocused]}>{episode.episodeNumber}</Text>
              </View>
              <View style={styles.episodeCopy}>
                <Text numberOfLines={1} style={[styles.episodeTitle, focused && styles.episodeTitleFocused]}>{displayStreamTitle(episode.title)}</Text>
                <Text style={styles.episodeMeta}>{[episode.runtime, episode.airDate].filter(Boolean).join('  /  ') || 'Runtime unavailable'}</Text>
              </View>
              <MaterialCommunityIcons name="play-circle-outline" size={18} color={focused ? novaTheme.colors.accentHover : novaTheme.colors.textMuted} />
            </Pressable>
          );
        }) : (
          <Text style={styles.mutedCopy}>Episodes are not available for this season.</Text>
        )}
      </ScrollView>
    </View>
  );
}

export function MediaDetailOverlay({
  visible,
  keepFocusTrap = false,
  blurTarget,
  detail,
  detailLoading = false,
  detailError,
  continueWatchingLabel,
  isFavorite = false,
  isWatchlisted = false,
  selectedSeasonNumber,
  focusedEpisodeId,
  onClose,
  onRetry,
  onPlay,
  onPlayFromBeginning,
  onTrailerPress,
  onFavoritePress,
  onWatchlistPress,
  onSeasonPress,
  onEpisodePress,
  onEpisodeFocus,
}: MediaDetailOverlayProps) {
  const { width, height } = useWindowDimensions();
  const [focusedTarget, setFocusedTarget] = useState<ActionId | string | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const actionRefs = useRef(new Map<ActionId, ElementRef<typeof Pressable>>());
  const playRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const [actionHandles, setActionHandles] = useState<Record<string, number>>({});
  const focusRetryCancelRef = useRef<(() => void) | null>(null);
  const wasVisibleRef = useRef(false);
  const lastPlayInvokeAtRef = useRef(0);

  const invokePlay = useCallback(() => {
    if (!onPlay) {
      return;
    }

    const now = Date.now();
    if (now - lastPlayInvokeAtRef.current < 400) {
      return;
    }

    lastPlayInvokeAtRef.current = now;
    onPlay();
  }, [onPlay]);

  const reactNativeTv = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
  };
  const useTVEventHandler = reactNativeTv.useTVEventHandler ?? noopUseTVEventHandler;

  useTVEventHandler((event: TvEventPayload) => {
    if (!visible || !onPlay) {
      return;
    }

    if (event.eventType !== 'select' && event.eventType !== 'playPause') {
      return;
    }

    if (focusedTarget !== null && focusedTarget !== 'play') {
      return;
    }

    invokePlay();
  });

  const firstAction: ActionId | null = onPlay
    ? 'play'
    : onPlayFromBeginning
      ? 'restart'
      : onTrailerPress
        ? 'trailer'
        : onFavoritePress
          ? 'favorite'
          : onWatchlistPress
            ? 'watchlist'
            : onRetry
              ? 'retry'
              : null;
  const actionIds = [
    onPlay ? 'play' : null,
    onPlayFromBeginning ? 'restart' : null,
    onTrailerPress ? 'trailer' : null,
    onFavoritePress ? 'favorite' : null,
    onWatchlistPress ? 'watchlist' : null,
  ].filter((item): item is ActionId => Boolean(item));
  const actionGraphKey = actionIds.join('|');

  const handleActionFocus = (id: ActionId) => {
    focusRetryCancelRef.current?.();
    focusRetryCancelRef.current = null;
    setFocusedTarget(id);
  };

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }

    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;

    if (!opening) {
      opacity.setValue(1);
      return;
    }

    if (Platform.isTV) {
      opacity.setValue(1);
    } else {
      opacity.setValue(0);
      const animation = Animated.timing(opacity, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
    }

    if (!firstAction) {
      return;
    }

    let cancelled = false;
    let frame: number | null = null;
    let attempt = 0;
    const maxAttempts = Platform.isTV ? 2 : 4;
    const stopFocusRetry = () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (focusRetryCancelRef.current === stopFocusRetry) {
        focusRetryCancelRef.current = null;
      }
    };
    const requestActionFocus = () => {
      if (cancelled) {
        return;
      }

      attempt += 1;
      const target = playRef.current ?? actionRefs.current.get(firstAction);
      target?.focus();

      if (attempt >= maxAttempts) {
        stopFocusRetry();
        return;
      }

      frame = requestAnimationFrame(requestActionFocus);
    };

    focusRetryCancelRef.current?.();
    focusRetryCancelRef.current = stopFocusRetry;
    const focusDelayMs = Platform.isTV ? 120 : 0;
    const focusTimer = setTimeout(() => {
      frame = requestAnimationFrame(requestActionFocus);
    }, focusDelayMs);

    return () => {
      clearTimeout(focusTimer);
      stopFocusRetry();
    };
  }, [actionGraphKey, firstAction, opacity, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const nextHandles: Record<string, number> = {};
      const graphIds = actionGraphKey ? actionGraphKey.split('|') as ActionId[] : [];
      graphIds.forEach((id) => {
        const handle = handleFor({ current: actionRefs.current.get(id) ?? null });
        if (handle) {
          nextHandles[id] = handle;
        }
      });
      setActionHandles(nextHandles);
    });

    return () => cancelAnimationFrame(frame);
  }, [actionGraphKey, visible]);

  if (!detail) {
    return null;
  }

  if (!visible && !keepFocusTrap) {
    return null;
  }

  const panelVisible = visible;
  const title = displayStreamTitle(detail.title) || detail.title;
  const isMovie = detail.mediaType === 'movie';
  const rating = formatRating(detail.rating);
  const displayGenres = detail.genres.filter(Boolean).slice(0, 4);
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
  const modalWidth = isMovie
    ? Math.min(Math.max(width * 0.56, 620), 920)
    : Math.min(Math.max(width * 0.72, 780), 1180);
  const modalHeight = isMovie
    ? Math.min(Math.max(height * 0.46, 320), 460)
    : Math.min(Math.max(height * 0.58, 380), 560);
  const renderAction = (id: ActionId) => {
    const index = actionIds.indexOf(id);
    const left = actionIds[index - 1];
    const right = actionIds[index + 1];
    const onPress = id === 'play'
      ? invokePlay
      : id === 'restart'
        ? onPlayFromBeginning
        : id === 'trailer'
          ? onTrailerPress
          : id === 'favorite'
            ? onFavoritePress
            : onWatchlistPress;
    const label = id === 'play'
      ? continueWatchingLabel ?? 'Play'
      : id === 'restart'
        ? 'Restart'
        : id === 'trailer'
          ? 'Trailer'
          : id === 'favorite'
            ? isFavorite ? 'Favorited' : 'Favorite'
            : isWatchlisted ? 'In Watchlist' : 'Watchlist';
    const icon = id === 'play'
      ? 'play'
      : id === 'restart'
        ? 'restart'
        : id === 'trailer'
          ? 'movie-outline'
          : id === 'favorite'
            ? isFavorite ? 'heart' : 'heart-outline'
            : isWatchlisted ? 'bookmark' : 'bookmark-outline';

    return (
      <OverlayAction
        key={id}
        id={id}
        label={label}
        icon={icon as ComponentProps<typeof MaterialCommunityIcons>['name']}
        onPress={onPress}
        primary={id === 'play'}
        compact
        preferred={id === firstAction}
        selected={focusedTarget === id}
        buttonRef={(instance) => {
          if (instance) {
            actionRefs.current.set(id, instance);
            if (id === 'play') {
              playRef.current = instance;
            }
          } else {
            actionRefs.current.delete(id);
          }
        }}
        nextFocusLeft={actionHandles[left ?? id]}
        nextFocusRight={actionHandles[right ?? id]}
        nextFocusUp={actionHandles[id]}
        nextFocusDown={actionHandles[id]}
        onFocus={handleActionFocus}
        onBlur={() => setFocusedTarget(null)}
      />
    );
  };

  return (
    <Animated.View
      style={[
        styles.backdrop,
        !panelVisible && styles.backdropHidden,
        { opacity: panelVisible ? opacity : 0 },
      ]}
      pointerEvents={panelVisible ? 'auto' : 'none'}
      accessibilityViewIsModal={panelVisible}
      importantForAccessibility={panelVisible ? 'yes' : 'no-hide-descendants'}>
      {blurTarget && panelVisible ? (
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={52}
          tint="dark"
          style={styles.backdropBlur}
        />
      ) : null}
      <View style={styles.backdropDim} />
      <FocusBoundaryView
        style={styles.focusBoundary}
        {...(Platform.OS === 'android'
          ? { autoFocus: true, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
          : {})}>
        <View
          style={[
            styles.modal,
            styles.modalCompact,
            isMovie && styles.modalMovie,
            {
              width: modalWidth,
              height: modalHeight,
            },
          ]}>
        <View style={[styles.modalBody, styles.modalBodyCompact]}>
          <View style={[styles.posterColumn, styles.posterColumnCompact]}>
            <View style={[styles.posterFrame, styles.posterFrameCompact]}>
              {detail.posterUrl && !posterFailed ? (
                <TvRemoteImage uri={detail.posterUrl} style={styles.posterImage} onError={() => setPosterFailed(true)} />
              ) : (
                <MediaArtworkFallback title={title} kind={detail.mediaType} subtitle={detail.year} />
              )}
              {rating ? (
                <View style={styles.posterRating}>
                  <MaterialCommunityIcons name="star" size={14} color="#F6C85F" />
                  <Text style={styles.posterRatingText}>{rating}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[styles.infoColumn, styles.infoColumnCompact]}>
            <ScrollView focusable={false} style={styles.infoScroll} contentContainerStyle={[styles.infoContent, styles.infoContentCompact]} showsVerticalScrollIndicator={false}>
            <Text numberOfLines={2} style={[styles.title, styles.titleCompact]}>{title}</Text>
            <View style={[styles.metaRow, styles.metaRowCompact]}>
              {detail.year ? <Text style={styles.metaChip}>{detail.year}</Text> : null}
              {detail.runtime ? <Text style={styles.metaChip}>{detail.runtime}</Text> : null}
              {detail.releaseDate ? <Text style={styles.metaChip}>Release {formatDate(detail.releaseDate)}</Text> : null}
              {detail.creator ? <Text style={styles.metaChip}>{detail.creator}</Text> : null}
              {detail.network ? <Text style={styles.metaChip}>{detail.network}</Text> : null}
              {detail.contentRating ? <Text style={styles.metaChip}>{detail.contentRating}</Text> : null}
              {displayGenres.map((genre) => <Text key={genre} style={styles.metaChip}>{genre}</Text>)}
              {rating ? (
                <View style={styles.ratingChip}>
                  <MaterialCommunityIcons name="star" size={13} color="#F6C85F" />
                  <Text style={styles.ratingChipText}>{rating}/10</Text>
                </View>
              ) : null}
            </View>

            {detailLoading ? <Text style={styles.loadingText}>Updating details...</Text> : null}
            {detailError ? (
              <View style={styles.inlineError}>
                <Text style={styles.inlineErrorText}>{detailError}</Text>
                {onRetry ? (
                  <OverlayAction
                    id="retry"
                    label="Retry"
                    icon="refresh"
                    onPress={onRetry}
                    compact
                    selected={focusedTarget === 'retry'}
                    onFocus={setFocusedTarget}
                    onBlur={() => setFocusedTarget(null)}
                  />
                ) : null}
              </View>
            ) : null}

            {detail.synopsis?.trim() || !isMovie ? (
              <View style={[styles.sectionBlock, styles.sectionBlockCompact]}>
                <Text style={styles.sectionLabel}>Synopsis</Text>
                <Text numberOfLines={isMovie ? 2 : 4} style={[styles.description, styles.descriptionCompact]}>
                  {detail.synopsis || 'No synopsis available.'}
                </Text>
              </View>
            ) : null}

            <CastRow
              cast={detail.cast}
              compact
              focusedId={typeof focusedTarget === 'string' && focusedTarget.startsWith('cast:') ? focusedTarget.slice(5) : null}
              onFocus={(id) => setFocusedTarget(`cast:${id}`)}
            />
          </ScrollView>

            <View style={styles.movieActionRow}>{actionIds.map(renderAction)}</View>
          </View>

          {!isMovie ? (
            <View style={styles.sideColumn}>
              <SeriesEpisodePanel
                detail={detail}
                selectedSeasonNumber={selectedSeasonNumber}
                focusedEpisodeId={focusedEpisodeId}
                onSeasonPress={onSeasonPress}
                onEpisodePress={onEpisodePress}
                onEpisodeFocus={onEpisodeFocus}
              />
            </View>
          ) : null}
        </View>
        </View>
      </FocusBoundaryView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdropHidden: {
    backgroundColor: 'transparent',
  },
  focusBoundary: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 56,
  },
  backdropBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 9, 13, 0.32)',
  },
  backdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 4, 8, 0.48)',
  },
  modal: {
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  modalCompact: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  modalMovie: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  modalBody: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 14,
  },
  modalBodyCompact: {
    gap: 14,
  },
  posterColumn: {
    width: 132,
    minWidth: 124,
    maxWidth: 148,
    gap: 0,
  },
  posterColumnCompact: {
    width: 132,
    minWidth: 124,
    maxWidth: 148,
  },
  posterFrame: {
    width: '100%',
    aspectRatio: 2 / 3,
    maxHeight: 198,
    overflow: 'hidden',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
  },
  posterFrameCompact: {
    maxHeight: 198,
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
  },
  posterRating: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  posterRatingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  movieActionRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 8,
  },
  actionCompact: {
    width: 'auto',
    flex: 1,
    minHeight: 34,
    paddingHorizontal: 8,
    gap: 2,
  },
  actionGhost: {
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  actionGhostFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity * 0.65,
    shadowRadius: 7,
  },
  actionPrimaryFocused: {
    borderColor: novaTheme.colors.focusRing,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  action: {
    minHeight: 34,
    borderRadius: 0,
    borderWidth: novaTheme.glow.borderWidth,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 8,
  },
  actionPrimary: {
    borderColor: novaTheme.colors.accent,
    backgroundColor: novaTheme.colors.accent,
  },
  actionFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  actionDisabled: {
    opacity: 0.42,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  actionLabelMovie: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
  actionLabelPrimary: {
    color: '#FFFFFF',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  infoColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  infoColumnCompact: {
    flex: 1,
    minHeight: 0,
  },
  infoScroll: {
    flex: 1,
    minHeight: 0,
  },
  infoContent: {
    paddingBottom: 4,
  },
  infoContentCompact: {
    paddingBottom: 4,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  titleCompact: {
    fontSize: 20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  metaRowCompact: {
    marginTop: 8,
    gap: 5,
  },
  metaChip: {
    color: novaTheme.colors.textPrimary,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  ratingChipText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  loadingText: {
    marginTop: 12,
    color: novaTheme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  inlineError: {
    marginTop: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(127,29,29,0.18)',
    padding: 10,
    gap: 8,
  },
  inlineErrorText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionBlock: {
    marginTop: 12,
  },
  sectionBlockCompact: {
    marginTop: 10,
  },
  sectionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
  },
  description: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  descriptionCompact: {
    fontSize: 12,
    lineHeight: 18,
  },
  castRow: {
    gap: 10,
    paddingRight: 12,
  },
  castMember: {
    width: 68,
    minHeight: 92,
    alignItems: 'center',
    borderRadius: 0,
    borderWidth: 0,
    paddingVertical: 4,
  },
  castMemberCompact: {
    width: 62,
    minHeight: 84,
  },
  castMemberFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 6,
  },
  castAvatar: {
    width: 48,
    height: 48,
    overflow: 'hidden',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castAvatarCompact: {
    width: 44,
    height: 44,
  },
  castImage: {
    width: '100%',
    height: '100%',
  },
  castInitials: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  castName: {
    marginTop: 6,
    color: novaTheme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  castCharacter: {
    marginTop: 2,
    color: novaTheme.colors.textMuted,
    fontSize: 9,
    textAlign: 'center',
  },
  sideColumn: {
    width: 240,
    minWidth: 220,
    maxWidth: 280,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: novaTheme.colors.borderSubtle,
    paddingLeft: 12,
  },
  sidePanelContent: {
    flex: 1,
    minHeight: 0,
  },
  sideTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  seasonRow: {
    gap: 6,
    paddingBottom: 6,
  },
  seasonChip: {
    minHeight: 30,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  seasonChipSelected: {
    backgroundColor: 'transparent',
  },
  seasonChipFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 6,
  },
  seasonText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  seasonTextSelected: {
    color: novaTheme.colors.accentHover,
  },
  seasonCount: {
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  episodeScroll: {
    flex: 1,
    minHeight: 0,
  },
  episodeList: {
    gap: 2,
    paddingVertical: 2,
  },
  episodeRow: {
    minHeight: 40,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  episodeRowFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 6,
  },
  episodeNumberBox: {
    width: 20,
    alignItems: 'center',
  },
  episodeNumber: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  episodeCopy: {
    flex: 1,
    minWidth: 0,
  },
  episodeTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  episodeTitleFocused: {
    color: novaTheme.colors.accentHover,
  },
  episodeNumberFocused: {
    color: novaTheme.colors.accentHover,
  },
  episodeMeta: {
    marginTop: 2,
    color: novaTheme.colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  mutedCopy: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
});
