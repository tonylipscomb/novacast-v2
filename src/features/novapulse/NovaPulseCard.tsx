import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { NOVA_FOCUS, NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { TvRemoteImage, normalizeTvRemoteImageUri } from '@/components/media/TvRemoteImage';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaPulseItem } from './novaPulseTypes';
import { NovaPulseSportsCard } from './NovaPulseSportsCard';
import { formatNovaPulseAnnouncementTiming, formatNovaPulseCatalogMeta, formatNovaPulseEpisodeMeta, formatNovaPulseRating, formatNovaPulseUpcomingStatus, getNovaPulseAnnouncementBadge, getNovaPulseCatalogBadge, resolveNovaPulseAction } from './novaPulseLogic';

const NOVACAST_FALLBACK_CARD = require('../../../assets/images/novacastnewcard.png') as number;
const NOVA_PULSE_ARTWORK_TIMEOUT_MS = 15_000;

export type NovaPulseArtworkStatus = 'idle' | 'loading' | 'loaded' | 'displayed' | 'error' | 'timeout';
export type NovaPulseArtworkDiagnostics = {
  mediaMountCount: number;
  mediaUnmountCount: number;
  mediaKeyChangeCount: number;
  viewWidth?: number;
  viewHeight?: number;
  layoutNonZero?: boolean;
  cardWidth?: number;
  rowWidth?: number;
  leftWidth?: number;
  mediaWidth?: number;
  artworkWidth?: number;
  height?: number;
};

type NovaPulseCardProps = {
  item: NovaPulseItem;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
  onFocusHandle?: (handle: number | null) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onArtworkStatus?: (status: NovaPulseArtworkStatus, diagnostics?: NovaPulseArtworkDiagnostics) => void;
};

export function NovaPulseCard({ item, onFocus, onBlur, onPress, onFocusHandle, nextFocusUp, nextFocusDown, onArtworkStatus }: NovaPulseCardProps) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);
  const sports = item.type === 'sports';
  const announcement = item.type === 'announcement';
  const [focused, setFocused] = useState(false);
  const badge = announcement ? getNovaPulseAnnouncementBadge(item) : sports ? item.sports?.eventStatus ?? (item.subtype === 'final' ? 'FINAL' : formatNovaPulseUpcomingStatus(item.startsAt)) : getNovaPulseCatalogBadge(item);
  const catalogMeta = !sports ? formatNovaPulseCatalogMeta(item) : null;
  const episodeMeta = item.type === 'series' ? formatNovaPulseEpisodeMeta(item) : null;
  const rating = !sports ? formatNovaPulseRating(item) : null;
  const announcementSecondary = item.secondaryText ?? (item.version ? `Version ${item.version}` : null);
  const announcementTiming = announcement ? formatNovaPulseAnnouncementTiming(item.effectiveAt, item.expiresAt) : null;
  const action = resolveNovaPulseAction(item);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [artworkLoaded, setArtworkLoaded] = useState(false);
  const [artworkTimedOut, setArtworkTimedOut] = useState(false);
  const artworkStateRef = useRef<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const artworkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaMountCountRef = useRef(0);
  const mediaUnmountCountRef = useRef(0);
  const mediaKeyChangeCountRef = useRef(0);
  const previousMediaKeyRef = useRef<string | null>(null);
  const layoutRef = useRef<{ cardWidth?: number; rowWidth?: number; leftWidth?: number; mediaWidth?: number; artworkWidth?: number; height?: number }>({});
  const onArtworkStatusRef = useRef(onArtworkStatus);
  onArtworkStatusRef.current = onArtworkStatus;
  const remoteArtworkUrl = normalizeTvRemoteImageUri(item.artworkUrl);
  const cachedArtworkRef = item.artworkRef;
  const hasRemoteArtwork = Boolean(remoteArtworkUrl || cachedArtworkRef);
  const mediaKey = `${item.id}|${remoteArtworkUrl ?? ''}`;
  const artworkDiagnostics = () => ({
    mediaMountCount: mediaMountCountRef.current,
    mediaUnmountCount: mediaUnmountCountRef.current,
    mediaKeyChangeCount: mediaKeyChangeCountRef.current,
  });
  const reportLayout = (next: Partial<NonNullable<typeof layoutRef.current>>) => {
    layoutRef.current = { ...layoutRef.current, ...next };
    return { ...artworkDiagnostics(), ...layoutRef.current };
  };
  useEffect(() => {
    mediaMountCountRef.current += 1;
    if (previousMediaKeyRef.current !== null && previousMediaKeyRef.current !== mediaKey) {
      mediaKeyChangeCountRef.current += 1;
    }
    previousMediaKeyRef.current = mediaKey;
    return () => {
      mediaUnmountCountRef.current += 1;
    };
  }, [mediaKey]);
  useEffect(() => {
    setArtworkFailed(false);
    setArtworkLoaded(Boolean(item.artworkSource) && !hasRemoteArtwork);
    setArtworkTimedOut(false);
    if (artworkTimeoutRef.current) {
      clearTimeout(artworkTimeoutRef.current);
      artworkTimeoutRef.current = null;
    }
    const initialStatus = hasRemoteArtwork ? 'loading' : 'idle';
    artworkStateRef.current = initialStatus;
    onArtworkStatusRef.current?.(initialStatus, artworkDiagnostics());
    if (!hasRemoteArtwork) {
      return;
    }
    artworkTimeoutRef.current = setTimeout(() => {
      artworkTimeoutRef.current = null;
      if (artworkStateRef.current !== 'loading') {
        return;
      }
      artworkStateRef.current = 'error';
      setArtworkLoaded(false);
      setArtworkFailed(true);
      setArtworkTimedOut(true);
      onArtworkStatusRef.current?.('timeout', artworkDiagnostics());
    }, NOVA_PULSE_ARTWORK_TIMEOUT_MS);
    return () => {
      if (artworkTimeoutRef.current) {
        clearTimeout(artworkTimeoutRef.current);
        artworkTimeoutRef.current = null;
      }
    };
  }, [hasRemoteArtwork, mediaKey]);
  const artworkFit = item.artworkFit ?? 'cover';
  const fallbackArtwork = item.type === 'movie' || item.type === 'series' ? NOVACAST_FALLBACK_CARD : null;
  const fallbackIcon = item.type === 'announcement' ? 'bullhorn-outline' : item.type === 'series' ? 'television-classic' : item.type === 'movie' ? 'movie-open-outline' : 'trophy-outline';
  return (
    <Pressable
      ref={(node) => onFocusHandle?.(node ? findNodeHandle(node) : null)}
      focusable
      collapsable={false}
      hasTVPreferredFocus={false}
      {...(nextFocusUp != null ? { nextFocusUp } : null)}
      {...(nextFocusDown != null ? { nextFocusDown } : null)}
      onFocus={() => { setFocused(true); onFocus(); }}
      onBlur={() => { setFocused(false); onBlur(); }}
      onPress={onPress}
      onLayout={(event) => { const { width, height } = event.nativeEvent.layout; onArtworkStatusRef.current?.('loading', reportLayout({ cardWidth: width, height })); }}
      style={[styles.card, item.announcementPriority === 'high' ? styles.announcementHigh : null, item.announcementPriority === 'critical' ? styles.announcementCritical : null, novaTvFocus.base, focused ? styles.cardFocused : null, item.type === 'sports' ? styles.sportsCard : null]}>
      <View style={styles.contentRow} onLayout={(event) => { const { width, height } = event.nativeEvent.layout; onArtworkStatusRef.current?.('loading', reportLayout({ rowWidth: width, height })); }}>
      <View style={[styles.copy, sports ? styles.sportsCopy : null]} onLayout={(event) => { const { width } = event.nativeEvent.layout; onArtworkStatusRef.current?.('loading', reportLayout({ leftWidth: width })); }}>
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
        <Text numberOfLines={2} style={[styles.title, sports ? styles.sportsTitle : null]}>{item.title}</Text>
        {announcement ? <Text numberOfLines={3} style={styles.announcementMessage}>{item.message ?? item.description ?? item.subtitle}</Text> : catalogMeta ? <Text numberOfLines={1} style={styles.catalogMeta}>{catalogMeta}</Text> : item.subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{item.subtitle}</Text> : null}
        {episodeMeta ? <Text numberOfLines={1} style={styles.episodeMeta}>{episodeMeta}</Text> : null}
        {!announcement && item.description ? <Text numberOfLines={2} style={styles.description}>{item.description}</Text> : null}
        {rating ? <Text numberOfLines={1} style={styles.rating}>{rating}</Text> : null}
        {announcement ? <>{announcementSecondary || announcementTiming ? <View style={styles.announcementMeta}>{announcementSecondary ? <Text numberOfLines={1} style={styles.announcementSecondary}>{announcementSecondary}</Text> : null}{announcementTiming ? <Text numberOfLines={1} style={styles.announcementTiming}>{announcementTiming}</Text> : null}</View> : null}{item.ctaLabel ? <Text numberOfLines={1} style={styles.announcementCta}>{item.ctaLabel}</Text> : null}</> : sports ? <NovaPulseSportsCard item={item} /> : action ? <View style={styles.actionHint}><MaterialCommunityIcons name="play-circle-outline" size={17} color={theme.colors.accent} /><Text style={styles.actionText}>Press OK</Text></View> : null}
      </View>
      <View style={styles.media} onLayout={(event) => { const { width, height } = event.nativeEvent.layout; onArtworkStatusRef.current?.('loading', reportLayout({ mediaWidth: width, height })); }}>
        {(!remoteArtworkUrl && !item.artworkSource || artworkFailed || artworkTimedOut || (!remoteArtworkUrl && !artworkLoaded)) ? <View style={styles.backdropFallback}>{fallbackArtwork ? <><Image source={fallbackArtwork} style={styles.fallbackArtwork} contentFit="cover" /><View pointerEvents="none" style={styles.fallbackGlow} /><MaterialCommunityIcons name={fallbackIcon} size={30} color="rgba(211, 205, 255, 0.78)" style={styles.fallbackIcon} /></> : <MaterialCommunityIcons name={fallbackIcon} size={46} color="rgba(154, 139, 255, 0.62)" style={styles.fallbackIcon} />}</View> : null}
        {hasRemoteArtwork && !artworkFailed ? <View key={mediaKey} onLayout={(event) => { const { width, height } = event.nativeEvent.layout; onArtworkStatusRef.current?.('loading', { ...reportLayout({ artworkWidth: width, height }), viewWidth: width, viewHeight: height, layoutNonZero: width > 0 && height > 0 }); }} style={[styles.artworkFrame, artworkFit === 'contain' ? styles.artworkFrameContained : null]}><TvRemoteImage uri={remoteArtworkUrl ?? undefined} imageRef={cachedArtworkRef} style={styles.backdrop} resizeMode={artworkFit === 'contain' ? 'contain' : 'cover'} onLoad={() => { if (artworkTimeoutRef.current) { clearTimeout(artworkTimeoutRef.current); artworkTimeoutRef.current = null; } artworkStateRef.current = 'loaded'; setArtworkTimedOut(false); setArtworkLoaded(true); onArtworkStatusRef.current?.('loaded', artworkDiagnostics()); }} onDisplay={() => { onArtworkStatusRef.current?.('displayed', artworkDiagnostics()); }} onError={() => { if (artworkTimeoutRef.current) { clearTimeout(artworkTimeoutRef.current); artworkTimeoutRef.current = null; } artworkStateRef.current = 'error'; setArtworkLoaded(false); setArtworkFailed(true); onArtworkStatusRef.current?.('error', artworkDiagnostics()); }} /></View> : item.artworkSource && !hasRemoteArtwork ? <View key={mediaKey} style={[styles.artworkFrame, artworkFit === 'contain' ? styles.artworkFrameContained : null]}><Image source={item.artworkSource} style={styles.backdrop} contentFit={artworkFit} onLoad={() => { setArtworkLoaded(true); }} onError={() => { setArtworkLoaded(false); setArtworkFailed(true); }} /></View> : null}
        <View pointerEvents="none" style={styles.mediaBlendOne} />
        <View pointerEvents="none" style={styles.mediaBlendTwo} />
        <View pointerEvents="none" style={styles.mediaBlendThree} />
        <View pointerEvents="none" style={styles.mediaScrim} />
      </View>
      </View>
      <View style={styles.scrim} />
      <View pointerEvents="none" style={styles.topHighlight} />
      <View pointerEvents="none" style={[styles.innerBorder, focused ? styles.innerBorderFocused : null]} />
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    card: { width: '100%', height: 272, overflow: 'hidden', borderRadius: NOVA_GLASS.radius.base, borderWidth: 1, borderColor: NOVA_GLASS.subtle.borderColor, backgroundColor: 'rgba(8, 13, 42, 0.84)', position: 'relative', shadowColor: '#291b72', shadowOpacity: 0.42, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
    cardFocused: { borderColor: NOVA_FOCUS.poster.borderColor, backgroundColor: 'rgba(22, 17, 62, 0.88)', shadowColor: '#875dff', shadowOpacity: 0.58, shadowRadius: 15, elevation: 7 },
    announcementHigh: { borderColor: 'rgba(145, 119, 255, 0.34)' },
    announcementCritical: { borderColor: 'rgba(255, 184, 112, 0.48)', backgroundColor: 'rgba(45, 24, 52, 0.88)' },
    sportsCard: {},
    contentRow: { width: '100%', height: '100%', minWidth: 0, flexDirection: 'row' },
    media: { position: 'relative', width: '45%', height: '100%', minWidth: 0, overflow: 'hidden', borderTopRightRadius: NOVA_GLASS.radius.base - 1, borderBottomRightRadius: NOVA_GLASS.radius.base - 1, alignItems: 'center', justifyContent: 'center' },
    artworkFrame: { width: '100%', height: '100%', overflow: 'hidden' },
    artworkFrameContained: { marginVertical: 10, marginHorizontal: 8, borderRadius: 10 },
    backdrop: { width: '100%', height: '100%' },
    backdropFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11163f' },
    fallbackArtwork: { ...StyleSheet.absoluteFillObject, opacity: 0.92 },
    fallbackGlow: { position: 'absolute', right: 18, bottom: 18, width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(92, 80, 255, 0.24)', shadowColor: '#8d7dff', shadowOpacity: 0.7, shadowRadius: 18, elevation: 4 },
    fallbackIcon: {},
    mediaBlendOne: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '18%', backgroundColor: 'rgba(3, 6, 23, 0.40)' },
    mediaBlendTwo: { position: 'absolute', top: 0, bottom: 0, left: '10%', width: '20%', backgroundColor: 'rgba(3, 6, 23, 0.24)' },
    mediaBlendThree: { position: 'absolute', top: 0, bottom: 0, left: '22%', width: '18%', backgroundColor: 'rgba(3, 6, 23, 0.10)' },
    mediaScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3, 6, 23, 0.22)' },
    scrim: { ...StyleSheet.absoluteFillObject, width: '64%', backgroundColor: 'rgba(3, 6, 23, 0.78)' },
    topHighlight: { position: 'absolute', top: 1, left: 1, right: 1, height: 1, backgroundColor: NOVA_GLASS.active.topHighlight },
    innerBorder: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: 'rgba(170, 190, 255, 0.10)', borderRadius: NOVA_GLASS.radius.base - 1 },
    innerBorderFocused: { borderColor: NOVA_FOCUS.poster.innerHighlight },
    copy: { width: '55%', height: '100%', minWidth: 0, justifyContent: 'center', padding: 22 },
    sportsCopy: { width: '55%', padding: 22 },
    sportsTitle: { maxWidth: '100%', fontSize: 26, lineHeight: 30 },
    badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: 'rgba(97, 65, 220, 0.86)', marginBottom: 8 },
    badgeText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    title: { color: theme.colors.textPrimary, fontSize: 30, lineHeight: 35, fontWeight: '900' },
    subtitle: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 18, lineHeight: 22, fontWeight: '700' },
    catalogMeta: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 16, lineHeight: 20, fontWeight: '700' },
    episodeMeta: { marginTop: 3, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 18, fontWeight: '700' },
    description: { marginTop: 7, color: theme.colors.textMuted, fontSize: 16, lineHeight: 20, maxWidth: 560 },
    rating: { marginTop: 5, color: theme.colors.accent, fontSize: 13, lineHeight: 17, fontWeight: '800' },
    announcementMessage: { marginTop: 1, color: theme.colors.textSecondary, fontSize: 16, lineHeight: 20, fontWeight: '600' },
    announcementMeta: { marginTop: 7, gap: 3 },
    announcementSecondary: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 17, fontWeight: '700' },
    announcementTiming: { color: theme.colors.accent, fontSize: 12, lineHeight: 16, fontWeight: '800' },
    announcementCta: { marginTop: 6, color: theme.colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '800' },
    actionHint: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  });
}
