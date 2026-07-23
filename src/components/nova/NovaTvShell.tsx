import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findNodeHandle, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';

import { NovaLogo } from '@/components/nova/NovaLogo';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { NovaScreen } from '@/components/nova/NovaScreen';
import { getTvDensity } from '@/components/nova/tvDensity';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { themeLogoIncludesWordmark } from '@/theme/brandingAssets';
import type { NovaTheme } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type NavigationId = 'home' | 'live' | 'movies' | 'series' | 'search' | 'guide' | 'settings';

export type NovaNavigationId = NavigationId;
export type NovaNavigationFocusHandles = Partial<Record<NavigationId, number>>;

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
  /** When false, the left navigation rail cannot receive D-pad focus. */
  navigationFocusable?: boolean;
  /** Native focus handles for navigation items (focusable mode only). */
  onNavigationFocusHandles?: (handles: NovaNavigationFocusHandles) => void;
  /** When set, Right from the matching nav item jumps to this native handle. */
  navigationNextFocusRight?: Partial<Record<NavigationId, number>>;
  /** When set, Right from every nav item jumps to this native handle. */
  navigationContentFocusHandle?: number;
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
  navigationFocusable = true,
  onNavigationFocusHandles,
  navigationNextFocusRight,
  navigationContentFocusHandle,
  showNavigationRail = true,
  compactNavigationRail = false,
  children,
}: NovaTvShellProps) {
  const { theme, themeId } = useAppTheme();
  const styles = useMemo(() => createShellStyles(theme), [theme]);
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [focusedId, setFocusedId] = useState<NavigationId | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const navigationGateRef = useRef(createTvNavigationGate());
  const navItemRefs = useRef<Partial<Record<NavigationId, View | null>>>({});
  const lastNavHandlesJson = useRef('');
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

  useLayoutEffect(() => {
    if (!navigationFocusable || !onNavigationFocusHandles) {
      return;
    }

    const handles: NovaNavigationFocusHandles = {};
    for (const item of NAV_ITEMS) {
      const node = navItemRefs.current[item.id];
      if (node) {
        const handle = findNodeHandle(node) ?? undefined;
        if (handle) {
          handles[item.id] = handle;
        }
      }
    }

    const serialized = JSON.stringify(handles);
    if (serialized !== lastNavHandlesJson.current) {
      lastNavHandlesJson.current = serialized;
      onNavigationFocusHandles(handles);
    }
  }, [navigationFocusable, onNavigationFocusHandles, activeId, pathname, focusedId]);

  const navWidth = useMemo(
    () =>
      compactNavigationRail
        ? compactNavWidth
        : Math.min(theme.layout.navMaxWidth, Math.max(theme.layout.navMinWidth, width * 0.105)),
    [compactNavWidth, compactNavigationRail, theme.layout.navMaxWidth, theme.layout.navMinWidth, width],
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
          <View
            pointerEvents={navigationFocusable ? 'auto' : 'none'}
            style={[styles.navRail, compactNavigationRail && styles.navRailCompact, { width: navWidth }]}>
            <View style={[styles.logoWrap, compactNavigationRail && styles.logoWrapCompact]}>
              <NovaLogo variant="mark" size={compactNavigationRail ? 'md' : 'lg'} />
              {compactNavigationRail || themeLogoIncludesWordmark(themeId) ? null : (
                <Text style={styles.logoText}>NOVACAST</Text>
              )}
            </View>

            <View
              style={[styles.navItems, compactNavigationRail && styles.navItemsCompact]}
              {...(!navigationFocusable ? { importantForAccessibility: 'no-hide-descendants' as const } : null)}>
              {NAV_ITEMS.map((item) => {
                const active = item.id === activeId;
                const focused = navigationFocusable && item.id === focusedId;
                const itemStyle = [
                  styles.navItem,
                  compactNavigationRail && styles.navItemCompact,
                  novaTvFocus.base,
                  active && !focused && styles.navItemActive,
                  focused && styles.navItemFocused,
                ];
                const iconColor = active || focused ? theme.colors.textPrimary : theme.colors.textSecondary;

                const itemContent = (
                  <>
                    {focused ? <View style={styles.navFocusIndicator} pointerEvents="none" /> : active ? <View style={styles.navActiveIndicator} pointerEvents="none" /> : null}
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={compactNavigationRail ? 22 : 25}
                      color={iconColor}
                      style={focused ? styles.navIconFocused : undefined}
                    />
                    {compactNavigationRail ? null : (
                      <View style={styles.navLabelBlock}>
                        <Text numberOfLines={1} style={[styles.navLabel, (active || focused) && styles.navLabelActive, focused && styles.navLabelFocused]}>
                          {item.label}
                        </Text>
                      </View>
                    )}
                  </>
                );

                if (!navigationFocusable) {
                  return (
                    <View
                      key={item.id}
                      focusable={false}
                      accessible={false}
                      importantForAccessibility="no"
                      style={[itemStyle, active && styles.navItemActive]}>
                      {active ? <View style={styles.navActiveIndicator} pointerEvents="none" /> : null}
                      <MaterialCommunityIcons
                        name={item.icon}
                        size={compactNavigationRail ? 22 : 25}
                        color={active ? theme.colors.textPrimary : theme.colors.textSecondary}
                      />
                      {compactNavigationRail ? null : (
                        <View style={styles.navLabelBlock}>
                          <Text numberOfLines={1} style={[styles.navLabel, active && styles.navLabelActive]}>
                            {item.label}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                }

                return (
                  <Pressable
                    key={item.id}
                    ref={(node) => {
                      navItemRefs.current[item.id] = node;
                    }}
                    focusable
                    hasTVPreferredFocus={preferActiveNavigationFocus && active}
                    onFocus={() => setFocusedId(item.id)}
                    onBlur={() => setFocusedId(null)}
                    {...(navigationNextFocusRight?.[item.id]
                      ? { nextFocusRight: navigationNextFocusRight[item.id] }
                      : navigationContentFocusHandle
                        ? { nextFocusRight: navigationContentFocusHandle }
                        : null)}
                    onPress={() => {
                      if (item.route === pathname) {
                        return;
                      }

                      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
                        return;
                      }
                      router.replace(item.route as Href);
                    }}
                    style={itemStyle}>
                    {itemContent}
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
                <MaterialCommunityIcons name="wifi" size={19} color={theme.colors.success} />
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

function createShellStyles(theme: NovaTheme) {
  return StyleSheet.create({
    safeFrame: {
      flex: 1,
      flexDirection: 'row',
      // Extra top inset so the header (provider + clock) clears TV overscan.
      paddingTop: theme.safeArea.top + 28,
      paddingRight: theme.safeArea.right,
      paddingBottom: theme.safeArea.bottom,
      paddingLeft: theme.safeArea.left,
      gap: theme.spacing.xl,
    },
    navRail: {
      minWidth: theme.layout.navMinWidth,
      maxWidth: theme.layout.navMaxWidth,
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      paddingRight: theme.spacing.lg,
    },
    navRailCompact: {
      minWidth: 0,
      maxWidth: 72,
      paddingRight: theme.spacing.sm,
    },
    logoWrap: {
      minHeight: 94,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.md,
    },
    logoWrapCompact: {
      minHeight: 72,
      marginBottom: theme.spacing.sm,
    },
    navItemsCompact: {
      gap: 6,
    },
    logoText: {
      marginTop: -8,
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 2.1,
    },
    navItems: {
      flex: 1,
      gap: 6,
    },
    navItem: {
      position: 'relative',
      minHeight: 46,
      borderRadius: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    navItemCompact: {
      minHeight: 40,
      justifyContent: 'center',
      gap: 0,
      paddingHorizontal: 4,
    },
    navItemActive: {
      backgroundColor: 'transparent',
    },
    navItemFocused:
      theme.scheme === 'light'
        ? {
            backgroundColor: theme.colors.surfaceFocused,
          }
        : {
            backgroundColor: 'transparent',
            shadowColor: theme.colors.focusRing,
            shadowOpacity: 0.65,
            shadowRadius: 7,
          },
    navActiveIndicator: {
      position: 'absolute',
      left: 0,
      top: 6,
      bottom: 6,
      width: 3,
      backgroundColor: theme.colors.success,
    },
    navFocusIndicator:
      theme.scheme === 'light'
        ? {
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            backgroundColor: theme.colors.focusRing,
          }
        : {
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            backgroundColor: theme.colors.focusRing,
            shadowColor: theme.colors.focusRing,
            shadowOpacity: 0.85,
            shadowRadius: 6,
          },
    navLabel: {
      flexShrink: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.nav,
      fontWeight: '600',
    },
    navLabelBlock: {
      flex: 1,
      minWidth: 0,
    },
    navLabelActive: {
      color: theme.colors.textPrimary,
      fontWeight: '700',
    },
    navLabelFocused:
      theme.scheme === 'light'
        ? {
            color: theme.colors.accent,
          }
        : {
            color: theme.colors.accentHover,
            textShadowColor: theme.colors.focusRing,
            textShadowRadius: 8,
          },
    navIconFocused:
      theme.scheme === 'light'
        ? {
            transform: [{ scale: 1.08 }],
          }
        : {
            transform: [{ scale: 1.16 }],
            shadowColor: theme.colors.focusRing,
            shadowOpacity: 0.9,
            shadowRadius: 7,
          },
    connectionCard: {
      minHeight: 58,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
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
      backgroundColor: theme.colors.success,
    },
    connectionCopy: {
      flex: 1,
    },
    connectionTitle: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    connectionMeta: {
      marginTop: 2,
      color: theme.colors.textMuted,
      fontSize: 11,
    },
    mainArea: {
      flex: 1,
      minWidth: 0,
    },
    header: {
      height: theme.layout.headerHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    headerCopy: {
      flex: 1,
    },
    headerRight: {
      alignItems: 'flex-end',
      gap: 8,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: theme.typography.pageTitle,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    subtitle: {
      marginTop: 4,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.pageSubtitle,
    },
    headerMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    provider: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      maxWidth: 220,
      flexShrink: 1,
    },
    expirationBox: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.success,
      paddingHorizontal: 2,
      paddingBottom: 4,
    },
    expirationLabel: {
      color: theme.colors.success,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    expirationValue: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    metaDivider: {
      width: 1,
      height: 22,
      backgroundColor: theme.colors.borderStrong,
      marginHorizontal: 4,
    },
    clock: {
      color: theme.colors.textPrimary,
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
}
