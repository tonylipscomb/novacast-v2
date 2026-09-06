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
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Platform,
  BackHandler,
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
import { NOVA_FOCUS, NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { isValidTvFocusableTarget, requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { novacastTrace } from '@/features/diagnostics/novacastLogPolicy';
import {
  computeSeriesDetailPopupV2Layout,
  filterSeriesDetailPopupV2Episodes,
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
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
  onFocus,
  onBlur,
}: {
  action: ActionSpec;
  preferred: boolean;
  focused: boolean;
  buttonRef: (instance: ElementRef<typeof Pressable> | null) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const focusable = !action.disabled;
  const visibleLabel = action.id === 'play' && action.label.toLowerCase().startsWith('continue')
    ? 'Continue'
    : action.label;
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
      {...(nextFocusLeft != null ? { nextFocusLeft } : {})}
      {...(nextFocusRight != null ? { nextFocusRight } : {})}
      {...(nextFocusUp != null ? { nextFocusUp } : {})}
      {...(nextFocusDown != null ? { nextFocusDown } : {})}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[
        styles.action,
        action.primary && styles.actionPrimarySize,
        action.primary && styles.actionPrimary,
        action.disabled && styles.actionDisabled,
        focused && styles.actionFocused,
        focused && action.primary && styles.actionPrimaryFocused,
      ]}>
      <MaterialCommunityIcons
        name={action.icon}
        size={focused ? 27 : 22}
        color={
          action.disabled
            ? novaTheme.colors.textMuted
            : focused
              ? '#FFFFFF'
              : '#FFFFFF'
        }
        />
      {focused ? (
        <Text
          style={[
            styles.actionLabel,
            action.disabled && styles.actionLabelDisabled,
            styles.actionLabelFocused,
          ]}
          numberOfLines={1}>
          {visibleLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

function CollectionSelector({
  seasons,
  selectedSeasonNumber,
  open,
  onToggle,
  onSelect,
  onAreaFocusChange,
  controlRef,
  focusProps,
}: {
  seasons: Array<{ seasonNumber: number; name?: string | null }>;
  selectedSeasonNumber: number | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (seasonNumber: number) => void;
  onAreaFocusChange?: (focused: boolean) => void;
  controlRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  focusProps?: {
    nextFocusLeft?: number;
    nextFocusRight?: number;
    nextFocusUp?: number;
    nextFocusDown?: number;
  };
}) {
  const [focused, setFocused] = useState(false);
  const controlTargetRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const optionRefs = useRef(new Map<number, ElementRef<typeof Pressable>>());
  const optionRefCallbacks = useRef(new Map<number, (instance: ElementRef<typeof Pressable> | null) => void>());
  const optionHandlesRef = useRef(new Map<number, number>());
  const seasonScrollRef = useRef<ScrollView | null>(null);
  const seasonScrollOffsetRef = useRef(0);
  const seasonMenuHeightRef = useRef(0);
  const cancelOptionFocusRef = useRef<(() => void) | null>(null);
  const menuOpenSessionRef = useRef(0);
  const menuOpenRef = useRef(open);
  const [collectionMenuFocusOwned, setCollectionMenuFocusOwned] = useState(false);
  const [focusedSeasonOption, setFocusedSeasonOption] = useState<number | null>(null);
  const registerControlRef = useCallback((instance: ElementRef<typeof Pressable> | null) => {
    controlTargetRef.current = instance;
    controlRef?.(instance);
  }, [controlRef]);
  menuOpenRef.current = open;
  const selected = seasons.find((season) => season.seasonNumber === selectedSeasonNumber);
  const label = selected
    ? selected.seasonNumber === 0 ? 'Specials' : selected.name ?? `Season ${selected.seasonNumber}`
    : 'Select collection';

  const registerSeasonOption = useCallback((seasonNumber: number, instance: ElementRef<typeof Pressable> | null) => {
    if (instance == null) {
      optionRefs.current.delete(seasonNumber);
      optionHandlesRef.current.delete(seasonNumber);
      return;
    }

    optionRefs.current.set(seasonNumber, instance);
    const handle = ReactNative.findNodeHandle(instance);
    if (handle == null || optionHandlesRef.current.get(seasonNumber) === handle) {
      return;
    }
    optionHandlesRef.current.set(seasonNumber, handle);
  }, []);

  const getSeasonOptionRef = useCallback((seasonNumber: number) => {
    const existing = optionRefCallbacks.current.get(seasonNumber);
    if (existing) {
      return existing;
    }
    const callback = (instance: ElementRef<typeof Pressable> | null) => {
      registerSeasonOption(seasonNumber, instance);
    };
    optionRefCallbacks.current.set(seasonNumber, callback);
    return callback;
  }, [registerSeasonOption]);

  const restoreControlFocus = () => {
    menuOpenRef.current = false;
    setCollectionMenuFocusOwned(false);
    setFocusedSeasonOption(null);
    novacastTrace('[NovaCast Season Dropdown Focus]', {
      event: 'close', selectedSeason: selectedSeasonNumber,
      focusedSeason: focusedSeasonOption, targetSeason: selectedSeasonNumber,
    });
    cancelOptionFocusRef.current?.();
    cancelOptionFocusRef.current = requestTvFocus({
      screen: 'series',
      source: 'SeriesDetailPopupV2',
      region: 'collection-control',
      reason: 'collection-menu-close',
      getTarget: () =>
        isValidTvFocusableTarget(controlTargetRef.current) ? controlTargetRef.current : null,
    });
  };

  useEffect(() => () => cancelOptionFocusRef.current?.(), []);

  useEffect(() => {
    menuOpenRef.current = open;
    if (!open) {
      setCollectionMenuFocusOwned(false);
      setFocusedSeasonOption(null);
      return;
    }

    const session = menuOpenSessionRef.current + 1;
    menuOpenSessionRef.current = session;
    const preferredSeason = seasons.some((season) => season.seasonNumber === selectedSeasonNumber)
      ? selectedSeasonNumber
      : seasons[0].seasonNumber;
    setFocusedSeasonOption(null);
    novacastTrace('[NovaCast Season Dropdown Focus]', {
      event: 'open', selectedSeason: selectedSeasonNumber,
      focusedSeason: null, targetSeason: preferredSeason,
    });
    cancelOptionFocusRef.current?.();
    cancelOptionFocusRef.current = requestTvFocus({
      screen: 'series',
      source: 'SeriesDetailPopupV2',
      region: 'collection-menu',
      itemId: preferredSeason == null ? null : String(preferredSeason),
      reason: 'season-dropdown-open',
      maxFrames: 6,
      isActive: () => menuOpenRef.current && menuOpenSessionRef.current === session,
      getTarget: () => {
        const target = preferredSeason == null ? null : optionRefs.current.get(preferredSeason);
        return isValidTvFocusableTarget(target) ? target : null;
      },
    });
    novacastTrace('[NovaCast Season Dropdown Focus]', {
      event: 'focus-requested', selectedSeason: selectedSeasonNumber,
      focusedSeason: null, targetSeason: preferredSeason,
    });

    return () => cancelOptionFocusRef.current?.();
  // The request is intentionally keyed only to menu open. D-pad movement or
  // parent detail updates must not start another opening handoff.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reactNative = ReactNative as typeof ReactNative & { TVFocusGuideView?: typeof View };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    focusable?: boolean;
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }>;

  return (
    <View style={styles.collectionBlock}>
      <Text style={styles.sectionLabel}>Collection</Text>
      <Pressable
        ref={registerControlRef}
        focusable
        accessibilityRole="button"
        accessibilityLabel={`Collection: ${label}`}
        onFocus={() => { setFocused(true); onAreaFocusChange?.(true); }}
        onBlur={() => {
          if (!open || collectionMenuFocusOwned) {
            setFocused(false);
          }
          onAreaFocusChange?.(open && !collectionMenuFocusOwned);
        }}
        onPress={onToggle}
        {...(Platform.isTV ? { onClick: onToggle } : {})}
        {...focusProps}
        style={[styles.collectionControl, (focused || (open && !collectionMenuFocusOwned)) && styles.collectionControlFocused]}>
        <Text style={styles.collectionValue} numberOfLines={1}>{label}</Text>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={21} color="#DCEBFF" />
      </Pressable>
      {open ? (
        <FocusBoundaryView
          style={styles.collectionMenu}
          focusable={false}
          {...(Platform.OS === 'android'
            ? { autoFocus: false, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
            : {})}>
          <ScrollView
            ref={seasonScrollRef}
            focusable={false}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            scrollEventThrottle={16}
            onScroll={(event) => {
              seasonScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            onLayout={(event) => {
              seasonMenuHeightRef.current = event.nativeEvent.layout.height;
            }}>
            {seasons.map((season, seasonIndex) => {
              const seasonLabel = season.seasonNumber === 0
                ? 'Specials' : season.name ?? `Season ${season.seasonNumber}`;
              const selectedRow = season.seasonNumber === selectedSeasonNumber;
              return (
                <Pressable
                  ref={getSeasonOptionRef(season.seasonNumber)}
                  key={`collection-option-${season.seasonNumber}`}
                  focusable
                  accessibilityRole="button"
                  accessibilityLabel={seasonLabel}
                  onFocus={() => {
                    setFocusedSeasonOption(season.seasonNumber);
                    setCollectionMenuFocusOwned(true);
                    onAreaFocusChange?.(true);
                    const rowHeight = 36;
                    const rowTop = seasonIndex * rowHeight;
                    const rowBottom = rowTop + rowHeight;
                    const viewportBottom = seasonScrollOffsetRef.current + seasonMenuHeightRef.current;
                    if (seasonMenuHeightRef.current > 0 && rowTop < seasonScrollOffsetRef.current) {
                      seasonScrollRef.current?.scrollTo({ y: rowTop, animated: true });
                    } else if (seasonMenuHeightRef.current > 0 && rowBottom > viewportBottom) {
                      seasonScrollRef.current?.scrollTo({
                        y: Math.max(0, rowBottom - seasonMenuHeightRef.current),
                        animated: true,
                      });
                    }
                    novacastTrace('[NovaCast Season Dropdown Focus]', {
                      event: 'option-focus', selectedSeason: selectedSeasonNumber,
                      focusedSeason: season.seasonNumber, targetSeason: season.seasonNumber,
                    });
                  }}
                  onBlur={() => {
                    setFocusedSeasonOption((current) => current === season.seasonNumber ? null : current);
                    onAreaFocusChange?.(false);
                    novacastTrace('[NovaCast Season Dropdown Focus]', {
                      event: 'option-blur', selectedSeason: selectedSeasonNumber,
                      focusedSeason: null, targetSeason: season.seasonNumber,
                    });
                  }}
                  onPress={() => {
                    novacastTrace('[NovaCast Season Dropdown Focus]', {
                      event: 'select', selectedSeason: season.seasonNumber,
                      focusedSeason: focusedSeasonOption, targetSeason: season.seasonNumber,
                    });
                    onSelect(season.seasonNumber);
                    restoreControlFocus();
                  }}
                  {...(Platform.isTV ? { onClick: () => { onSelect(season.seasonNumber); restoreControlFocus(); } } : {})}
                  style={[
                    styles.collectionOption,
                    selectedRow && styles.collectionOptionSelected,
                    focusedSeasonOption === season.seasonNumber && styles.collectionOptionFocused,
                  ]}>
                  <Text
                    style={[
                      styles.collectionOptionText,
                      focusedSeasonOption === season.seasonNumber && styles.collectionOptionTextFocused,
                    ]}
                    numberOfLines={1}>
                    {seasonLabel}
                  </Text>
                  {selectedRow ? <MaterialCommunityIcons name="check" size={18} color="#8FD7FF" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </FocusBoundaryView>
      ) : null}
    </View>
  );
}

function EpisodeChip({
  episode,
  focusedEpisodeId,
  onFocusEpisode,
  onPressEpisode,
  onAreaFocusChange,
  chipRef,
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
}: {
  episode: MediaDetailEpisode;
  focusedEpisodeId: string | null;
  onFocusEpisode?: (episodeId: string) => void;
  onPressEpisode?: (episode: MediaDetailEpisode) => void;
  onAreaFocusChange?: (focused: boolean) => void;
  chipRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const highlighted = isFocused || focusedEpisodeId === episode.id;
  const activate = () => onPressEpisode?.(episode);
  return (
    <Pressable
      ref={chipRef}
      focusable
      {...(nextFocusLeft != null ? { nextFocusLeft } : {})}
      {...(nextFocusRight != null ? { nextFocusRight } : {})}
      {...(nextFocusUp != null ? { nextFocusUp } : {})}
      {...(nextFocusDown != null ? { nextFocusDown } : {})}
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
      <View style={styles.episodeTextWrap}>
        <Text style={styles.episodeChipText} numberOfLines={1}>
          E{episode.episodeNumber} · {episode.title}
        </Text>
        {episode.runtime ? <Text style={styles.episodeRuntime} numberOfLines={1}>{episode.runtime}</Text> : null}
      </View>
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
}: SeriesDetailPopupV2Props) {
  const { width, height } = useWindowDimensions();
  const layout = useMemo(
    () => computeSeriesDetailPopupV2Layout({ screenWidth: width, screenHeight: height }),
    [width, height],
  );

  const actionRefs = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const collectionRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const detailRefCallbacks = useRef(new Map<string, (instance: ElementRef<typeof Pressable> | null) => void>());
  const detailHandlesRef = useRef(new Map<string, number>());
  const [detailHandles, setDetailHandles] = useState<Record<string, number>>({});
  const [focusedActionId, setFocusedActionId] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [closeFocused, setCloseFocused] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const closeGuardRef = useRef(0);
  const wasVisibleRef = useRef(false);

  const registerDetailHandle = useCallback((id: string, instance: ElementRef<typeof Pressable> | null) => {
    if (instance == null) {
      detailHandlesRef.current.delete(id);
      setDetailHandles((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (id === 'collection') collectionRef.current = null;
      if (id === 'close') return;
      if (id.startsWith('action:')) actionRefs.current.delete(id.slice('action:'.length));
      return;
    }

    if (id.startsWith('action:')) actionRefs.current.set(id.slice('action:'.length), instance);
    if (id === 'collection') collectionRef.current = instance;
    const handle = ReactNative.findNodeHandle(instance);
    if (handle == null || detailHandlesRef.current.get(id) === handle) return;
    detailHandlesRef.current.set(id, handle);
    setDetailHandles((current) => current[id] === handle ? current : { ...current, [id]: handle });
  }, []);

  const getDetailRef = useCallback((id: string) => {
    const existing = detailRefCallbacks.current.get(id);
    if (existing) return existing;
    const callback = (instance: ElementRef<typeof Pressable> | null) => registerDetailHandle(id, instance);
    detailRefCallbacks.current.set(id, callback);
    return callback;
  }, [registerDetailHandle]);

  const title = series?.title ?? detail?.title ?? '';
  const posterUrl = detail?.posterUrl ?? series?.posterUrl;
  const metaLine = buildMetaLine(detail);
  const description = detail?.synopsis ?? '';

  const seasons = detail?.seasons ?? [];
  const episodes = detail?.episodes ?? [];
  // Keep the selector stable while details are loading, but do not expose
  // provider seasons that explicitly contain no episodes once loaded.
  const selectableSeasons = useMemo(
    () => loading ? seasons : seasons.filter((season) => season.episodeCount > 0),
    [loading, seasons],
  );
  const [openSeasonOptions, setOpenSeasonOptions] = useState<typeof selectableSeasons | null>(null);
  useEffect(() => {
    // Capture once per open session. Hydration may update selectableSeasons,
    // but native focus must not lose the option view it currently owns.
    setOpenSeasonOptions(collectionOpen ? selectableSeasons : null);
    // Deliberately depend only on the open/close boundary; do not refresh the
    // snapshot when episode hydration changes the canonical season list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionOpen]);
  const renderedSeasonOptions = collectionOpen && openSeasonOptions
    ? openSeasonOptions
    : selectableSeasons;
  const activeSeasonNumber = useMemo(
    () => resolveSeriesDetailPopupV2SeasonNumber(renderedSeasonOptions, selectedSeasonNumber),
    [renderedSeasonOptions, selectedSeasonNumber],
  );
  const seasonEpisodes = useMemo(
    () => filterSeriesDetailPopupV2Episodes(episodes, activeSeasonNumber).slice(0, 24),
    [episodes, activeSeasonNumber],
  );

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
        label: isFavorite ? 'In My List' : 'My List',
        icon: isFavorite ? 'heart' : 'heart-outline',
        onPress: onToggleFavorite,
      });
    }
    if (onToggleWatchlist) {
      next.push({
        id: 'watchlist',
        label: isWatchlisted ? 'Bookmarked' : 'Bookmark',
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
    error,
    isFavorite,
    isWatchlisted,
    onPlay,
    onRetry,
    onToggleFavorite,
    onToggleWatchlist,
    playLabel,
  ]);

  const initialFocusActionId = useMemo(
    () =>
      resolveSeriesDetailPopupV2InitialFocusId(
        actions.map<SeriesDetailPopupV2Action>((action) => ({ id: action.id, disabled: action.disabled })),
      ),
    [actions],
  );

  // Native focus must remain inside the modal even during the short period in
  // which Android has attached some refs but not their neighbors. A missing
  // neighbor therefore resolves to the current control's own handle. Handles
  // are registered through stable callbacks; this state is only a render
  // notification and never changes from inside render.
  const detailFocusProps = useCallback((id: string, targets: {
    left: string;
    right: string;
    up: string;
    down: string;
  }) => {
    const ownHandle = detailHandles[id];
    const resolve = (targetId: string) => detailHandles[targetId] ?? ownHandle;
    return {
      ...(resolve(targets.left) != null ? { nextFocusLeft: resolve(targets.left) } : {}),
      ...(resolve(targets.right) != null ? { nextFocusRight: resolve(targets.right) } : {}),
      ...(resolve(targets.up) != null ? { nextFocusUp: resolve(targets.up) } : {}),
      ...(resolve(targets.down) != null ? { nextFocusDown: resolve(targets.down) } : {}),
    };
  }, [detailHandles]);

  const actionIds = actions.map((action) => `action:${action.id}`);
  const episodeIds = seasonEpisodes.map((episode) => `episode:${episode.id}`);
  const firstActionId = actionIds[0] ?? 'close';
  const lastActionId = actionIds[actionIds.length - 1] ?? 'close';
  const firstContentId = firstActionId !== 'close' ? firstActionId : ('collection' in detailHandles ? 'collection' : (episodeIds[0] ?? 'close'));
  const lastContentId = episodeIds[episodeIds.length - 1] ?? ('collection' in detailHandles ? 'collection' : lastActionId);
  const focusPropsById = new Map<string, ReturnType<typeof detailFocusProps>>();
  focusPropsById.set('close', detailFocusProps('close', {
    left: 'close', right: firstActionId, up: 'close', down: firstContentId,
  }));
  actionIds.forEach((id, index) => {
    const previous = actionIds[index - 1] ?? id;
    const next = actionIds[index + 1] ?? id;
    focusPropsById.set(id, detailFocusProps(id, {
      left: previous,
      right: next,
      up: 'close',
      down: renderedSeasonOptions.length > 0 ? 'collection' : (episodeIds[0] ?? id),
    }));
  });
  if ('collection' in detailHandles || renderedSeasonOptions.length > 0) {
    focusPropsById.set('collection', detailFocusProps('collection', {
      left: 'collection', right: 'collection', up: lastActionId, down: episodeIds[0] ?? 'collection',
    }));
  }
  episodeIds.forEach((id, index) => {
    focusPropsById.set(id, detailFocusProps(id, {
      left: id, right: id, up: episodeIds[index - 1] ?? ('collection' in detailHandles ? 'collection' : lastActionId), down: episodeIds[index + 1] ?? id,
    }));
  });

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
        setCollectionOpen(false);
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

  useEffect(() => {
    if (!collectionOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setCollectionOpen(false);
      novacastTrace('[NovaCast Season Dropdown Focus]', {
        event: 'close', selectedSeason: activeSeasonNumber,
        focusedSeason: null, targetSeason: activeSeasonNumber,
      });
      requestTvFocus({
        screen: 'series',
        source: 'SeriesDetailPopupV2',
        region: 'collection-control',
        reason: 'collection-menu-back',
        getTarget: () =>
          isValidTvFocusableTarget(collectionRef.current) ? collectionRef.current : null,
      });
      novacastTrace('[NovaCast Season Dropdown Focus]', {
        event: 'selector-restored', selectedSeason: activeSeasonNumber,
        focusedSeason: null, targetSeason: activeSeasonNumber,
      });
      return true;
    });
    return () => subscription.remove();
  }, [collectionOpen]);

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
            <View pointerEvents="none" style={styles.cardTopHighlight} />
            <Pressable
              ref={getDetailRef('close')}
              focusable
              hasTVPreferredFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onFocus={() => setCloseFocused(true)}
              onBlur={() => setCloseFocused(false)}
              onPress={() => requestClose('x')}
              {...(Platform.isTV ? { onClick: () => requestClose('x') } : {})}
              {...focusPropsById.get('close')}
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
                <Text style={styles.title} numberOfLines={3}>
                  {title}
                </Text>
                {metaLine ? (
                  <Text style={styles.meta} numberOfLines={2}>
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
                      buttonRef={getDetailRef(`action:${action.id}`)}
                      {...focusPropsById.get(`action:${action.id}`)}
                      onFocus={() => setFocusedActionId(action.id)}
                      onBlur={() => setFocusedActionId(null)}
                    />
                  ))}
                </View>

                {renderedSeasonOptions.length > 0 ? (
                  <View style={styles.episodesSection}>
                    <CollectionSelector
                      seasons={renderedSeasonOptions}
                      selectedSeasonNumber={activeSeasonNumber}
                      open={collectionOpen}
                      onToggle={() => setCollectionOpen((open) => !open)}
                      focusProps={focusPropsById.get('collection')}
                      onSelect={(seasonNumber) => {
                        onSeasonPress?.(seasonNumber);
                        setCollectionOpen(false);
                      }}
                      onAreaFocusChange={onEpisodesAreaFocusChange}
                      controlRef={getDetailRef('collection')}
                    />
                    <Text style={styles.sectionLabel}>Episodes</Text>
                    <View style={styles.episodeBox}>
                      {seasonEpisodes.length > 0 ? (
                        <ScrollView
                          showsVerticalScrollIndicator
                          nestedScrollEnabled
                          contentContainerStyle={styles.episodeList}>
                          {seasonEpisodes.map((episode) => (
                            <EpisodeChip
                              key={episode.id}
                              episode={episode}
                              focusedEpisodeId={focusedEpisodeId}
                              onFocusEpisode={onEpisodeFocus}
                              onPressEpisode={onEpisodePress}
                              onAreaFocusChange={onEpisodesAreaFocusChange}
                              chipRef={getDetailRef(`episode:${episode.id}`)}
                              {...focusPropsById.get(`episode:${episode.id}`)}
                            />
                          ))}
                        </ScrollView>
                      ) : (
                        <Text style={styles.emptyEpisodes}>No episodes available for this collection.</Text>
                      )}
                    </View>
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
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(8, 13, 25, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(205,190,255,0.28)',
  },
  cardTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 28,
    right: 28,
    height: 2,
    backgroundColor: NOVA_FOCUS.poster.innerHighlight,
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
    borderColor: NOVA_GLASS.activeFocused.borderColor,
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 28,
    paddingVertical: 24,
    gap: 24,
    zIndex: 2,
    overflow: 'hidden',
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
    paddingRight: 36,
    justifyContent: 'flex-start',
    gap: 8,
    overflow: 'hidden',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  meta: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  description: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    lineHeight: 19,
  },
  statusLine: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
  },
  errorLine: {
    color: novaTheme.colors.warning,
    fontSize: 14,
  },
  episodesSection: {
    flex: 1,
    minHeight: 0,
    gap: 6,
    marginTop: 2,
  },
  sectionLabel: {
    color: '#B8D7FF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  collectionBlock: {
    gap: 5,
    zIndex: 3,
  },
  collectionControl: {
    minHeight: 42,
    width: '100%',
    paddingHorizontal: 13,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(21,35,61,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(104,157,224,0.38)',
  },
  collectionControlFocused: {
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
  },
  collectionValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  collectionMenu: {
    height: 116,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(7,15,29,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(104,157,224,0.55)',
  },
  collectionOption: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(135,175,220,0.12)',
  },
  collectionOptionSelected: {
    backgroundColor: NOVA_GLASS.active.backgroundColor,
    borderColor: NOVA_GLASS.active.borderColor,
  },
  collectionOptionFocused: {
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderWidth: 2,
    borderColor: NOVA_GLASS.focused.borderColor,
  },
  collectionOptionText: {
    color: '#E8F2FF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  collectionOptionTextFocused: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  episodeList: {
    padding: 7,
    gap: 4,
  },
  episodeBox: {
    width: '100%',
    maxWidth: '100%',
    flex: 1,
    minHeight: 84,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: 'rgba(10,20,38,0.56)',
    borderWidth: 1,
    borderColor: 'rgba(104,157,224,0.28)',
  },
  episodeChip: {
    width: '100%',
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  episodeChipFocused: {
    borderColor: NOVA_GLASS.focused.borderColor,
    backgroundColor: NOVA_GLASS.focused.backgroundColor,
  },
  episodeChipText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  episodeTextWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  episodeRuntime: {
    color: '#AFC8E8',
    fontSize: 12,
    marginLeft: 'auto',
  },
  emptyEpisodes: {
    color: novaTheme.colors.textMuted,
    fontSize: 13,
    padding: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 8,
    maxWidth: '100%',
    flexShrink: 0,
    alignItems: 'flex-start',
    paddingRight: 8,
  },
  action: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 50,
    height: 44,
    minWidth: 50,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  actionPrimarySize: {
    width: 56,
    minWidth: 56,
  },
  actionPrimary: {
    backgroundColor: 'transparent',
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionFocused: {
    flexDirection: 'row',
    gap: 7,
    width: 96,
    minWidth: 96,
    paddingHorizontal: 10,
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderWidth: 1,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
    borderRadius: NOVA_GLASS.radius.base,
  },
  actionPrimaryFocused: {
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
    width: 104,
    minWidth: 104,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  actionLabelFocused: {
    color: '#FFFFFF',
  },
});
