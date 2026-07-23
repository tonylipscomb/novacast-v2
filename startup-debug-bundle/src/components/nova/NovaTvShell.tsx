import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';

import { NovaLogo } from '@/components/nova/NovaLogo';
import { NovaScreen } from '@/components/nova/NovaScreen';
import { getTvDensity } from '@/components/nova/tvDensity';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useProviderStore } from '@/features/providers/providerStore';
import { novaTheme } from '@/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type NavigationId = 'home' | 'live' | 'movies' | 'series' | 'search' | 'guide' | 'settings';

type NavItem = {
  id: NavigationId;
  label: string;
  icon: IconName;
  route: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', route: '/main-menu' },
  { id: 'live', label: 'Live TV', icon: 'television-play', route: '/live' },
  { id: 'movies', label: 'Movies', icon: 'movie-open-outline', route: '/movies' },
  { id: 'series', label: 'Series', icon: 'play-box-multiple-outline', route: '/series' },
  { id: 'search', label: 'Search', icon: 'magnify', route: '/search' },
  { id: 'guide', label: 'Guide', icon: 'calendar-clock-outline', route: '/guide' },
  { id: 'settings', label: 'Settings', icon: 'cog-outline', route: '/settings' },
];

type NovaTvShellProps = PropsWithChildren<{
  activeId: NavigationId;
  title?: string;
  subtitle?: string;
  providerLabel?: string;
  expirationLabel?: string;
  headerSupplement?: ReactNode;
  preferActiveNavigationFocus?: boolean;
  showNavigationRail?: boolean;
  compactNavigationRail?: boolean;
}>;

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function NovaTvShell({
  activeId,
  title,
  subtitle,
  providerLabel,
  expirationLabel,
  headerSupplement,
  preferActiveNavigationFocus = true,
  showNavigationRail = true,
  compactNavigationRail = false,
  children,
}: NovaTvShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [focusedId, setFocusedId] = useState<NavigationId | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderExpiration } = useProviderStore();
  const resolvedProviderLabel = providerLabel ?? selectedProvider?.name ?? 'No provider';
  const resolvedExpirationLabel = expirationLabel ?? selectedProviderExpiration;
  const density = getTvDensity(width);
  const compactNavWidth = density === 'compact' ? 60 : 68;
  const safeHorizontal = density === 'compact' ? 28 : density === 'normal' ? 38 : 46;
  const safeVertical = density === 'compact' ? 18 : density === 'normal' ? 24 : 30;
  const shellGap = density === 'compact' ? 14 : density === 'normal' ? 20 : 24;
  const headerHeight = density === 'compact' ? 56 : density === 'normal' ? 64 : 70;

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const navWidth = useMemo(
    () =>
      compactNavigationRail
        ? compactNavWidth
        : Math.min(novaTheme.layout.navMaxWidth, Math.max(novaTheme.layout.navMinWidth, width * 0.105)),
    [compactNavWidth, compactNavigationRail, width],
  );

  return (
    <NovaScreen padded={false}>
      <View
        style={[
          styles.safeFrame,
          {
            paddingTop: safeVertical,
            paddingRight: safeHorizontal,
            paddingBottom: safeVertical,
            paddingLeft: safeHorizontal,
            gap: shellGap,
          },
        ]}>
        {showNavigationRail ? (
          <View style={[styles.navRail, compactNavigationRail && styles.navRailCompact, { width: navWidth }]}>
            <View style={[styles.logoWrap, compactNavigationRail && styles.logoWrapCompact]}>
              <NovaLogo variant="mark" size={compactNavigationRail ? 'md' : 'lg'} />
              {compactNavigationRail ? null : <Text style={styles.logoText}>NOVACAST</Text>}
            </View>

            <View style={[styles.navItems, compactNavigationRail && styles.navItemsCompact]}>
              {NAV_ITEMS.map((item) => {
                const active = item.id === activeId;
                const focused = item.id === focusedId;
                return (
                  <Pressable
                    key={item.id}
                    focusable
                    hasTVPreferredFocus={preferActiveNavigationFocus && active}
                    onFocus={() => setFocusedId(item.id)}
                    onBlur={() => setFocusedId(null)}
                    onPress={() => {
                      if (item.route === pathname) {
                        return;
                      }

                      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
                        return;
                      }
                      router.replace(item.route as Href);
                    }}
                    style={[
                      styles.navItem,
                      compactNavigationRail && styles.navItemCompact,
                      active && styles.navItemActive,
                      focused && styles.navItemFocused,
                    ]}>
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={compactNavigationRail ? 22 : 25}
                      color={focused || active ? novaTheme.colors.textPrimary : novaTheme.colors.textSecondary}
                    />
                    {compactNavigationRail ? null : (
                      <View style={styles.navLabelBlock}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.navLabel,
                            active && styles.navLabelActive,
                            focused && styles.navLabelFocused,
                          ]}>
                          {item.label}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

          </View>
        ) : null}

        <View style={styles.mainArea}>
          <View style={[styles.header, { height: headerHeight }]}>
            <View style={styles.headerCopy}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <View style={styles.headerRight}>
              <View style={styles.headerMeta}>
                <MaterialCommunityIcons name="wifi" size={19} color={novaTheme.colors.success} />
                {resolvedProviderLabel ? (
                  <Text numberOfLines={1} style={styles.provider}>
                    {resolvedProviderLabel}
                  </Text>
                ) : null}
                {resolvedExpirationLabel ? (
                  <>
                    <View style={styles.expirationBox}>
                      <Text style={styles.expirationLabel}>Expires</Text>
                      <Text style={styles.expirationValue}>{resolvedExpirationLabel}</Text>
                    </View>
                    <View style={styles.metaDivider} />
                  </>
                ) : null}
                <Text style={styles.clock}>{formatClock(clock)}</Text>
              </View>
              {headerSupplement ? <View style={styles.headerSupplement}>{headerSupplement}</View> : null}
            </View>
          </View>

          <View style={styles.content}>{children}</View>
        </View>
      </View>
    </NovaScreen>
  );
}

const styles = StyleSheet.create({
  safeFrame: {
    flex: 1,
    flexDirection: 'row',
    // Extra top inset so the header (provider + clock) clears TV overscan.
    paddingTop: novaTheme.safeArea.top + 28,
    paddingRight: novaTheme.safeArea.right,
    paddingBottom: novaTheme.safeArea.bottom,
    paddingLeft: novaTheme.safeArea.left,
    gap: novaTheme.spacing.xl,
  },
  navRail: {
    minWidth: novaTheme.layout.navMinWidth,
    maxWidth: novaTheme.layout.navMaxWidth,
    borderRightWidth: 1,
    borderRightColor: novaTheme.colors.borderSubtle,
    paddingRight: novaTheme.spacing.lg,
  },
  navRailCompact: {
    minWidth: 0,
    maxWidth: 72,
    paddingRight: novaTheme.spacing.sm,
  },
  logoWrap: {
    minHeight: 94,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: novaTheme.spacing.md,
  },
  logoWrapCompact: {
    minHeight: 72,
    marginBottom: novaTheme.spacing.sm,
  },
  navItemsCompact: {
    gap: 6,
  },
  logoText: {
    marginTop: -8,
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.1,
  },
  navItems: {
    flex: 1,
    gap: 6,
  },
  navItem: {
    minHeight: 50,
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 13,
  },
  navItemCompact: {
    minHeight: 44,
    justifyContent: 'center',
    gap: 0,
    paddingHorizontal: 0,
  },
  navItemActive: {
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
  navItemFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
  navLabel: {
    flexShrink: 1,
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.nav,
    fontWeight: '600',
  },
  navLabelBlock: {
    flex: 1,
    minWidth: 0,
  },
  navLabelActive: {
    color: novaTheme.colors.textPrimary,
  },
  navLabelFocused: {
    color: novaTheme.colors.textPrimary,
  },
  connectionCard: {
    minHeight: 58,
    borderTopWidth: 1,
    borderTopColor: novaTheme.colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 14,
  },
  connectionCardCompact: {
    minHeight: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 10,
    gap: 0,
  },
  connectionDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: novaTheme.colors.success,
  },
  connectionCopy: {
    flex: 1,
  },
  connectionTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  connectionMeta: {
    marginTop: 2,
    color: novaTheme.colors.textMuted,
    fontSize: 11,
  },
  mainArea: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    height: novaTheme.layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: novaTheme.spacing.lg,
    marginBottom: novaTheme.spacing.md,
  },
  headerCopy: {
    flex: 1,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.pageTitle,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 4,
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.pageSubtitle,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  provider: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 220,
    flexShrink: 1,
  },
  expirationBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'rgba(17,22,31,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  expirationLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  expirationValue: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  metaDivider: {
    width: 1,
    height: 22,
    backgroundColor: novaTheme.colors.borderStrong,
    marginHorizontal: 4,
  },
  clock: {
    color: novaTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSupplement: {
    alignItems: 'flex-end',
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
});
