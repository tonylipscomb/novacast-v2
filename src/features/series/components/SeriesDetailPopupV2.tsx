/**
 * Stage 4.2N.1 — Series Detail Popup V2.
 *
 * Series adapter over the physically-accepted Movies Detail Popup V2 shell
 * (`src/features/movies/components/MovieDetailPopupV2.tsx`). The shell
 * structure/styles below are copied verbatim from that file per the
 * acceptance directive ("do not redesign the popup again"): absolute-fill
 * layer -> BlurView (intensity-only) + dark scrim -> TVFocusGuideView focus
 * trap -> centered card (no backdrop image) -> X close top-right -> content
 * row: poster left column | title/metadata/description/actions right
 * column. Series adds only: season chips, episode chips, and Play/Resume +
 * Favorite/Watchlist actions with Series' own wiring.
 *
 * Deliberately does NOT import MediaDetailOverlayShell, adaptMediaDetailToOverlayModel,
 * or any Movies module — this is a standalone guest overlay, same as Movies V2.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ComponentType, ElementRef, ReactNode } from 'react';
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { MediaArtworkFallback } from '@/features/media-browser/MediaArtworkFallback';
import type { MediaDetail, MediaDetailEpisode } from '@/features/media-browser/mediaTypes';
import { novaTheme } from '@/theme';
import {
  computeSeriesDetailPopupV2Layout,
  filterSeriesDetailPopupV2Episodes,
  isSeriesDetailPopupV2EpisodesActionEnabled,
  logSeriesDetailPopupV2Event,
  resolveSeriesDetailPopupV2InitialFocusId,
  resolveSeriesDetailPopupV2SeasonNumber,
  type SeriesDetailPopupV2Action,
} from '../seriesDetailPopupV2';

export type SeriesDetailPopupV2Series = {
  id: string;
  seriesId?: string;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
};

export type SeriesDetailPopupV2Props = {
  visible: boolean;
  series: SeriesDetailPopupV2Series | null;
  detail: MediaDetail | null;
  loading?: boolean;
  /** Local-data fetch error (`getSeriesInfo` failure) — enrichment stays silent-fallback. */
  error?: string | null;
  /** Episode playback launch failure — distinct line from `error`, never closes the popup. */
  playbackError?: string | null;
  onPlay?: () => void;
  onToggleFavorite?: () => void;
  onToggleWatchlist?: () => void;
  onClose: (source: 'back' | 'x') => void;
  originItemId?: string | null;
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  /** "Resume" vs "Play" parity with Movies' `playLabel`. */
  playLabel?: string;
  onRetry?: () => void;
  /** Selected season (1-based provider numbering), owned by SeriesScreen. */
  selectedSeasonNumber?: number | null;
  onSeasonPress?: (seasonNumber: number) => void;
  focusedEpisodeId?: string | null;
  onEpisodeFocus?: (episodeId: string) => void;
  onEpisodePress?: (episode: MediaDetailEpisode) => void;
  /**
   * True while native TV focus sits inside the season/episode chip area.
   * SeriesScreen uses this (via a ref) to decide Back order: while the
   * episode area holds focus, Back returns focus to the Episodes action
   * instead of closing the whole popup (episode view -> popup -> browse).
   */
  onEpisodesAreaFocusChange?: (focused: boolean) => void;
  /** Bumped by SeriesScreen to request focus land back on the Episodes action. */
  episodesFocusReturnToken?: number;
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
    logSeriesDetailPopupV2Event('series_detail_popup_v2_blur_fallback');
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

function SeasonChip({
  seasonNumber,
  label,
  selected,
  onPress,
  onAreaFocusChange,
  chipRef,
}: {
  seasonNumber: number;
  label: string;
  selected: boolean;
  onPress: (seasonNumber: number) => void;
  onAreaFocusChange?: (focused: boolean) => void;
  chipRef?: (instance: ElementRef<typeof Pressable> | null) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const activate = () => onPress(seasonNumber);
  return (
    <Pressable
      ref={chipRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => {
        setIsFocused(true);
        onAreaFocusChange?.(true);
      }}
      onBlur={() => {
        setIsFocused(false);
        onAreaFocusChange?.(false);
      }}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[styles.seasonChip, selected && styles.seasonChipSelected, isFocused && styles.seasonChipFocused]}>
      <Text style={[styles.seasonChipText, selected && styles.seasonChipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function EpisodeChip({
  episode,
  focusedEpisodeId,
  onFocusEpisode,
  onPressEpisode,
  onAreaFocusChange,
  chipRef,
}: {
  episode: MediaDetailEpisode;
  focusedEpisodeId: string | null;
  onFocusEpisode?: (episodeId: string) => void;
  onPressEpisode?: (episode: MediaDetailEpisode) => void;
  onAreaFocusChange?: (focused: boolean) => void;
  chipRef?: (instance: ElementRef<typeof Pressable> | null) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const highlighted = isFocused || focusedEpisodeId === episode.id;
  const activate = () => onPressEpisode?.(episode);
  return (
    <Pressable
      ref={chipRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Episode ${episode.episodeNumber}: ${episode.title}`}
      onFocus={() => {
        setIsFocused(true);
        onFocusEpisode?.(episode.id);
        onAreaFocusChange?.(true);
      }}
      onBlur={() => {
        setIsFocused(false);
        onAreaFocusChange?.(false);
      }}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[styles.episodeChip, highlighted && styles.episodeChipFocused]}>
      <Text style={styles.episodeChipText} numberOfLines={1}>
        E{episode.episodeNumber} · {episode.title}
      </Text>
    </Pressable>
  );
}

export function SeriesDetailPopupV2({
  visible,
  series,
  detail,
  loading = false,
  error = null,
  playbackError = null,
  onPlay,
  onToggleFavorite,
  onToggleWatchlist,
  onClose,
  isFavorite = false,
  isWatchlisted = false,
  playLabel,
  onRetry,
  selectedSeasonNumber = null,
  onSeasonPress,
  focusedEpisodeId = null,
  onEpisodeFocus,
  onEpisodePress,
  onEpisodesAreaFocusChange,
  episodesFocusReturnToken,
}: SeriesDetailPopupV2Props) {
  const { width, height } = useWindowDimensions();
  const layout = useMemo(
    () => computeSeriesDetailPopupV2Layout({ screenWidth: width, screenHeight: height }),
    [width, height],
  );

  const actionRefs = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const episodeChipRefs = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const seasonChipRefs = useRef(new Map<number, ElementRef<typeof Pressable>>());
  const [focusedActionId, setFocusedActionId] = useState<string | null>(null);
  const [closeFocused, setCloseFocused] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const closeGuardRef = useRef(0);
  const wasVisibleRef = useRef(false);
  const episodesReturnTokenRef = useRef(episodesFocusReturnToken);

  const title = series?.title ?? detail?.title ?? '';
  const posterUrl = detail?.posterUrl ?? series?.posterUrl;
  const metaLine = buildMetaLine(detail);
  const description = detail?.synopsis ?? '';

  const seasons = detail?.seasons ?? [];
  const episodes = detail?.episodes ?? [];
  const activeSeasonNumber = useMemo(
    () => resolveSeriesDetailPopupV2SeasonNumber(seasons, selectedSeasonNumber),
    [seasons, selectedSeasonNumber],
  );
  const seasonEpisodes = useMemo(
    () => filterSeriesDetailPopupV2Episodes(episodes, activeSeasonNumber).slice(0, 24),
    [episodes, activeSeasonNumber],
  );

  const episodesActionEnabled = isSeriesDetailPopupV2EpisodesActionEnabled(seasons.length);

  const focusEpisodesArea = () => {
    const target =
      seasonEpisodes.length > 0
        ? episodeChipRefs.current.get(seasonEpisodes[0].id)
        : activeSeasonNumber != null
          ? seasonChipRefs.current.get(activeSeasonNumber)
          : undefined;
    try {
      target?.focus?.();
    } catch {
      // Never crash the popup for focus.
    }
  };

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
    next.push({
      id: 'episodes',
      label: 'Episodes',
      icon: 'playlist-play',
      disabled: !episodesActionEnabled,
      onPress: focusEpisodesArea,
    });
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
    if (error && onRetry) {
      next.push({
        id: 'retry',
        label: 'Retry',
        icon: 'refresh',
        onPress: onRetry,
      });
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    episodesActionEnabled,
    error,
    isFavorite,
    isWatchlisted,
    onPlay,
    onRetry,
    onToggleFavorite,
    onToggleWatchlist,
    playLabel,
    seasonEpisodes,
    activeSeasonNumber,
  ]);

  const initialFocusActionId = useMemo(
    () =>
      resolveSeriesDetailPopupV2InitialFocusId(
        actions.map<SeriesDetailPopupV2Action>((action) => ({ id: action.id, disabled: action.disabled })),
      ),
    [actions],
  );

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;
    setPosterFailed(false);
    if (opening) {
      // Reset stale focus-ring state from a prior open/close cycle — same
      // fix as Movies V2 (Android doesn't reliably fire onBlur on the close
      // button when its host view unmounts mid-focus).
      setCloseFocused(false);
      setFocusedActionId(null);
      logSeriesDetailPopupV2Event('series_detail_popup_v2_active', {
        seriesId: series?.id ?? null,
      });
    }
  }, [series?.id, visible]);

  // Initial focus: Play/Resume preferred, else the first enabled action.
  useEffect(() => {
    if (!visible || !initialFocusActionId) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (cancelled) return;
        const target = actionRefs.current.get(initialFocusActionId);
        try {
          target?.focus?.();
        } catch {
          // Never crash the popup for focus.
        }
      },
      Platform.isTV ? 90 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialFocusActionId, series?.id, visible]);

  // Back-order support: when SeriesScreen decides a Back press should just
  // collapse episode-area focus (not close the whole popup), it bumps
  // `episodesFocusReturnToken`. Landing focus back on the Episodes action
  // keeps the D-pad experience predictable (episode area -> Episodes -> popup).
  useEffect(() => {
    if (
      episodesFocusReturnToken == null ||
      episodesFocusReturnToken === episodesReturnTokenRef.current
    ) {
      return;
    }
    episodesReturnTokenRef.current = episodesFocusReturnToken;
    const target = actionRefs.current.get('episodes');
    try {
      target?.focus?.();
    } catch {
      // Never crash the popup for focus.
    }
  }, [episodesFocusReturnToken]);

  const requestClose = (source: 'back' | 'x') => {
    const now = Date.now();
    if (now - closeGuardRef.current < 300) {
      return;
    }
    closeGuardRef.current = now;
    onClose(source);
  };

  if (!visible || !series) {
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
  }>;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="auto"
      testID="series-detail-popup-v2"
      accessibilityViewIsModal
      importantForAccessibility="yes">
      {/* Background layer: Series browse stays visible underneath, dimmed/blurred. */}
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
          ? { autoFocus: true, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
          : {})}>
        <View style={[styles.shadowWrap, { width: layout.popupWidth, height: layout.popupHeight }]}>
          {/* No backdrop image — same Android layout-stability reasoning as Movies V2. */}
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
                    <MediaArtworkFallback title={title} kind="series" />
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
                  <Text style={styles.description} numberOfLines={3}>
                    {description}
                  </Text>
                ) : null}
                {loading && !error ? <Text style={styles.statusLine}>Loading details…</Text> : null}
                {error ? (
                  <Text style={styles.errorLine} numberOfLines={2}>
                    {error}
                  </Text>
                ) : null}
                {playbackError ? (
                  <Text style={styles.errorLine} numberOfLines={2}>
                    {playbackError}
                  </Text>
                ) : null}

                <View style={styles.actionsRow}>
                  {actions.map((action) => (
                    <ActionButton
                      key={action.id}
                      action={action}
                      preferred={action.id === initialFocusActionId}
                      focused={focusedActionId === action.id}
                      buttonRef={(instance) => {
                        if (instance) {
                          actionRefs.current.set(action.id, instance);
                        } else {
                          actionRefs.current.delete(action.id);
                        }
                      }}
                      onFocus={() => setFocusedActionId(action.id)}
                      onBlur={() => setFocusedActionId(null)}
                    />
                  ))}
                </View>

                {seasons.length > 0 ? (
                  <View style={styles.seasonsBlock}>
                    <ScrollView
                      horizontal
                      focusable={false}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.seasonRow}>
                      {seasons.map((season) => (
                        <SeasonChip
                          key={`season-${season.seasonNumber}`}
                          seasonNumber={season.seasonNumber}
                          label={season.name ?? `Season ${season.seasonNumber}`}
                          selected={season.seasonNumber === activeSeasonNumber}
                          onPress={(seasonNumber) => onSeasonPress?.(seasonNumber)}
                          onAreaFocusChange={onEpisodesAreaFocusChange}
                          chipRef={(instance) => {
                            if (instance) {
                              seasonChipRefs.current.set(season.seasonNumber, instance);
                            } else {
                              seasonChipRefs.current.delete(season.seasonNumber);
                            }
                          }}
                        />
                      ))}
                    </ScrollView>
                    <ScrollView
                      horizontal
                      focusable={false}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.episodeRow}>
                      {seasonEpisodes.map((episode) => (
                        <EpisodeChip
                          key={episode.id}
                          episode={episode}
                          focusedEpisodeId={focusedEpisodeId}
                          onFocusEpisode={onEpisodeFocus}
                          onPressEpisode={onEpisodePress}
                          onAreaFocusChange={onEpisodesAreaFocusChange}
                          chipRef={(instance) => {
                            if (instance) {
                              episodeChipRefs.current.set(episode.id, instance);
                            } else {
                              episodeChipRefs.current.delete(episode.id);
                            }
                          }}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </FocusBoundaryView>
    </View>
  );
}

export default SeriesDetailPopupV2;

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
  // No overflow:'hidden' here — same reasoning as Movies V2's `card` style.
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
    paddingVertical: 26,
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
    minHeight: 0,
    paddingRight: 24,
    justifyContent: 'center',
    gap: 10,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  meta: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  description: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 14,
    lineHeight: 20,
  },
  statusLine: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
  },
  errorLine: {
    color: novaTheme.colors.warning,
    fontSize: 14,
  },
  seasonsBlock: {
    gap: 8,
    marginTop: 2,
    flexShrink: 1,
    minHeight: 0,
  },
  seasonRow: {
    gap: 8,
    paddingVertical: 2,
  },
  seasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  seasonChipSelected: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(59, 130, 246, 0.28)',
  },
  seasonChipFocused: {
    borderColor: novaTheme.colors.focusRing,
    transform: [{ scale: 1.05 }],
  },
  seasonChipText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  seasonChipTextSelected: {
    color: novaTheme.colors.textPrimary,
  },
  episodeRow: {
    gap: 8,
    paddingVertical: 2,
  },
  episodeChip: {
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  episodeChipFocused: {
    borderColor: novaTheme.colors.focusRing,
  },
  episodeChipText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
    flexShrink: 0,
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
