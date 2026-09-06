import { memo, useEffect, useMemo, useState } from 'react';
import { findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { novaTvFocus, createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { LiveGlassBadge } from '@/features/live/LiveGlassBadge';
import { categoryTypeAccentColor, categoryTypeLabel, type ProviderCategoryType } from '@/features/providers/categoryNormalization';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';

const HOME_PRESENTATION_AUDIT_ENABLED =
  Boolean(__DEV__) ||
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_HOME_PRESENTATION_AUDIT === '1');

type ChannelHeroCardProps = {
  title: string;
  subtitle: string;
  logoUrl?: string;
  categoryType: ProviderCategoryType;
  isLive?: boolean;
  preferredFocus?: boolean;
  onFocusHandle?: (handle: number | null) => void;
  nextFocusUp?: number;
  onPress: () => void;
  auditSectionType?: 'favorite-channels';
  auditItemIndex?: number;
  onAuditFocus?: (focused: boolean) => void;
  onAuditMounted?: (sectionType: 'favorite-channels', index: number, focusable: boolean) => void;
  getAuditState?: () => {
    rootLayoutValid: boolean;
    sectionLayoutValid: boolean;
    visuallyPresented: boolean;
  };
};

/**
 * Glanceable Live TV channel card for the Home dashboard's "Favorite
 * Channels" / "Live Now" rows: a blurred, darkened backdrop built from the
 * channel's own logo (providers don't supply separate backdrop art), a
 * category-accent strip, a large sharp foreground logo with a soft halo for
 * legibility, and a text-based fallback when no logo is available at all.
 * Pure presentational component — accepts everything it needs as props and
 * does not reach into app/global state.
 */
export const ChannelHeroCard = memo(function ChannelHeroCard({
  title,
  subtitle,
  logoUrl,
  categoryType,
  isLive = false,
  preferredFocus = false,
  onFocusHandle,
  nextFocusUp,
  onPress,
  auditSectionType,
  auditItemIndex,
  onAuditFocus,
  onAuditMounted,
  getAuditState,
}: ChannelHeroCardProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const accentColor = categoryTypeAccentColor(categoryType);
  const displayTitle = displayStreamTitle(title);

  useEffect(() => {
    if (auditSectionType && auditItemIndex === 0) {
      onAuditMounted?.(auditSectionType, auditItemIndex, true);
    }
  }, []);

  return (
    <View style={styles.wrap}>
      <Pressable
        ref={(node) => onFocusHandle?.(node ? findNodeHandle(node) : null)}
        collapsable={false}
        focusable
        hasTVPreferredFocus={preferredFocus}
        {...(nextFocusUp != null ? { nextFocusUp } : null)}
        onFocus={() => {
          if (auditSectionType && auditItemIndex === 0) {
            onAuditFocus?.(true);
            if (HOME_PRESENTATION_AUDIT_ENABLED) {
              console.info('[NovaCast Home Presentation Audit]', JSON.stringify({
                event: 'first-home-card-focus',
                sectionType: auditSectionType,
                index: auditItemIndex,
                ...getAuditState?.(),
              }));
            }
          }
          setFocused(true);
        }}
        onBlur={() => {
          if (auditSectionType && auditItemIndex === 0) {
            onAuditFocus?.(false);
            if (HOME_PRESENTATION_AUDIT_ENABLED) {
              console.info('[NovaCast Home Presentation Audit]', JSON.stringify({
                event: 'first-home-card-blur',
                sectionType: auditSectionType,
                index: auditItemIndex,
                ...getAuditState?.(),
              }));
            }
          }
          setFocused(false);
        }}
        onPress={onPress}
        style={[styles.card, novaTvFocus.base, styles.cardGlassBase, focused && styles.cardFocused]}>
          <View style={[styles.artwork, focused && styles.artworkFocused]}>
            {logoUrl ? (
              <>
                <Image source={{ uri: logoUrl }} style={styles.backdropImage} contentFit="cover" />
                <View style={styles.backdropShade} pointerEvents="none" />
                <View style={styles.vignetteTop} pointerEvents="none" />
                <View style={styles.vignetteBottom} pointerEvents="none" />
                <View style={styles.logoHaloOuter} pointerEvents="none" />
                <View style={styles.logoHaloInner} pointerEvents="none" />
                <Image
                  source={{ uri: logoUrl }}
                  style={styles.foregroundLogo}
                  contentFit="contain"
                />
              </>
            ) : (
              <View style={styles.textFallback}>
                <View style={[styles.textFallbackTint, { backgroundColor: accentColor }]} pointerEvents="none" />
                <Text numberOfLines={2} style={styles.textFallbackTitle}>{displayTitle}</Text>
                <View style={[styles.textFallbackDivider, { backgroundColor: accentColor }]} />
                <Text numberOfLines={1} style={styles.textFallbackCategory}>{categoryTypeLabel(categoryType)}</Text>
              </View>
            )}
            {isLive ? (
              <View style={styles.liveBadge} pointerEvents="none">
                <LiveGlassBadge />
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={[styles.title, focused && styles.titleFocused]}>{displayTitle}</Text>
          <Text numberOfLines={1} style={[styles.subtitle, focused && styles.subtitleFocused]}>{subtitle}</Text>
      </Pressable>
    </View>
  );
});

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
    wrap: {
      width: 215,
    },
    card: {
      width: 215,
      minHeight: 160,
      backgroundColor: 'transparent',
      padding: 0,
      ...focusChrome.base,
    },
    cardGlassBase: {
      borderWidth: 1,
      borderRadius: NOVA_GLASS.radius.base,
      borderColor: NOVA_GLASS.subtle.borderColor,
      backgroundColor: NOVA_GLASS.subtle.backgroundColor,
    },
    cardFocused: {
      borderColor: NOVA_GLASS.activeFocused.borderColor,
      backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    artwork: {
      height: 116,
      borderRadius: 11,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    artworkFocused: {},
    backdropImage: {
      ...StyleSheet.absoluteFillObject,
    },
    backdropShade: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(3,5,10,0.72)',
    },
    vignetteTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '42%',
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    vignetteBottom: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '42%',
      backgroundColor: 'rgba(0,0,0,0.34)',
    },
    logoHaloOuter: {
      position: 'absolute',
      width: '78%',
      height: '78%',
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.22)',
    },
    logoHaloInner: {
      position: 'absolute',
      width: '58%',
      height: '58%',
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    foregroundLogo: {
      width: '86%',
      height: '86%',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.55,
      shadowRadius: 8,
      elevation: 6,
    },
    liveBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
    },
    textFallback: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      backgroundColor: 'transparent',
    },
    textFallbackTint: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.16,
    },
    textFallbackTitle: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '800',
      textAlign: 'center',
    },
    textFallbackDivider: {
      marginTop: 7,
      width: 28,
      height: 2,
      borderRadius: 1,
    },
    textFallbackCategory: {
      marginTop: 7,
      color: 'rgba(255,255,255,0.82)',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    title: {
      marginTop: 7,
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    titleFocused: focusText.title,
    subtitle: {
      marginTop: 3,
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    subtitleFocused: focusText.secondary,
  });
}
