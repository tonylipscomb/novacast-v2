import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findNodeHandle, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';

import {
  GlassNavDivider,
  GlassNavItem,
  GlassNavbarFocusGuide,
  GlassNavbarFrame,
  GlassNavbarLogo,
} from '@/components/nova/NovaGlassNavbar';
import { NovaGlassStatusFooter } from '@/components/nova/NovaGlassStatusFooter';
import { NovaScreen } from '@/components/nova/NovaScreen';
import { getTvDensity } from '@/components/nova/tvDensity';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { noteFocusLifecycleEvent, recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { shouldArmNavbarPreferredFocus } from '@/features/navigation/navbarInitialFocus';
import { markCatalogAuditFocus, markCatalogAuditRender } from '@/features/diagnostics/novaCastCatalogAudit';
import { noteFocusLatencyFocus } from '@/features/diagnostics/focusLatencyAudit';
import { useStartupVisualInteractive } from '@/features/startup/startupVisualGate';
import { setCatalogUiSurface } from '@/features/catalog/catalogForegroundPriority.ts';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type NavigationId = 'home' | 'live' | 'movies' | 'series' | 'search' | 'guide' | 'settings';

let nextShellInstanceId = 1;

export type NovaNavigationId = NavigationId;
export type NovaNavigationFocusHandles = Partial<Record<NavigationId, number>>;

type NavItem = {
  id: NavigationId;
  label: string;
  icon: IconName;
  route: string;
  iconOnly?: boolean;
  group: 'primary' | 'utility';
};

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', route: '/main-menu', group: 'primary' },
  { id: 'movies', label: 'Movies', icon: 'movie-open-outline', route: '/movies', group: 'primary' },
  { id: 'series', label: 'Series', icon: 'play-box-multiple-outline', route: '/series', group: 'primary' },
  { id: 'live', label: 'Live TV', icon: 'television-play', route: '/live', group: 'primary' },
  { id: 'search', label: 'Search', icon: 'magnify', route: '/search', group: 'primary' },
  { id: 'guide', label: 'Guide', icon: 'view-grid-outline', route: '/guide', group: 'primary' },
  { id: 'settings', label: 'Settings', icon: 'cog-outline', route: '/settings', group: 'utility', iconOnly: true },
];

const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group === 'primary');
const UTILITY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group === 'utility');
const NAVBAR_CONTENT_GAP = 16;
const NAVBAR_ITEM_WIDTHS: Record<NavigationId, number> = {
  home: 92,
  movies: 102,
  series: 96,
  live: 104,
  search: 98,
  guide: 94,
  settings: 52,
};
const NAVBAR_PRIMARY_GAP = 5;

// TEMPORARY: release-candidate focus-paint audit is disabled. Set true only
// for an explicit developer/device diagnostic build.
const FOCUS_VISUAL_AUDIT_ENABLED = false;

function logFocusVisualAudit({
  event,
  activeId,
  focusedId,
  itemId,
  ...details
}: {
  event: string;
  activeId: NavigationId;
  focusedId?: NavigationId | null;
  itemId?: NavigationId;
  [key: string]: unknown;
}) {
  if (!FOCUS_VISUAL_AUDIT_ENABLED) {
    return;
  }
  console.info('[NovaCast Focus Visual Audit]', {
    event,
    timestamp: Date.now(),
    activeId,
    ...(focusedId !== undefined ? { focusedId } : null),
    ...(itemId !== undefined ? { itemId } : null),
    ...details,
  });
}

type NovaTvShellProps = PropsWithChildren<{
  activeId: NavigationId;
  title?: string;
  subtitle?: string;
  providerLabel?: string;
  expirationLabel?: string;
  headerSupplement?: ReactNode;
  preferActiveNavigationFocus?: boolean;
  /** Narrow guard for native preferred focus; does not affect focusability or navigation. */
  suppressNavbarPreferredFocus?: boolean;
  /** When false, the top navigation bar cannot receive D-pad focus. */
  navigationFocusable?: boolean;
  /** Native focus handles for navigation items (focusable mode only). */
  onNavigationFocusHandles?: (handles: NovaNavigationFocusHandles) => void;
  /** Fires when a navbar item gains or loses TV focus. */
  onNavigationItemFocus?: (id: NavigationId | null) => void;
  /**
   * When set, Down from the matching nav item jumps to this native handle.
   * Prop name is historical from the left-rail layout; it now maps to nextFocusDown.
   */
  navigationNextFocusRight?: Partial<Record<NavigationId, number>>;
  /** When set, Down from every nav item jumps to this native handle. */
  navigationContentFocusHandle?: number;
  showNavigationRail?: boolean;
  compactNavigationRail?: boolean;
}>;

export function NovaTvShell({
  activeId,
  title,
  subtitle,
  providerLabel,
  expirationLabel,
  headerSupplement,
  preferActiveNavigationFocus = true,
  suppressNavbarPreferredFocus = false,
  navigationFocusable: navigationFocusableProp = true,
  onNavigationFocusHandles,
  onNavigationItemFocus,
  navigationNextFocusRight,
  navigationContentFocusHandle,
  showNavigationRail = true,
  compactNavigationRail = false,
  children,
}: NovaTvShellProps) {
  markCatalogAuditRender('NovaTvShell');
  const startupInteractive = useStartupVisualInteractive();
  const navigationFocusable = navigationFocusableProp && startupInteractive;
  const { theme } = useAppTheme();
  const styles = useMemo(() => createShellStyles(theme), [theme]);
  const router = useRouter();
  const pathname = usePathname();
  const shellInstanceIdRef = useRef<number | null>(null);
  if (shellInstanceIdRef.current == null) {
    shellInstanceIdRef.current = nextShellInstanceId++;
  }
  const shellInstanceId = shellInstanceIdRef.current;
  const shellRenderCountRef = useRef(0);
  shellRenderCountRef.current += 1;
  if (__DEV__ && shellRenderCountRef.current > 1) {
    console.info('[NovaCast Shell Lifecycle]', {
      event: 'rerender',
      shellInstanceId,
      renderCount: shellRenderCountRef.current,
      timestamp: Date.now(),
    });
  }
  const { width } = useWindowDimensions();
  // Native TV focus still owns the real focus lifecycle. This initial value only
  // makes the preferred active item render its glass state on the first frame,
  // before Android TV delivers the native onFocus callback.
  const [focusedId, setFocusedId] = useState<NavigationId | null>(() =>
    preferActiveNavigationFocus && !suppressNavbarPreferredFocus ? activeId : null,
  );
  const navigationGateRef = useRef(createTvNavigationGate());
  const navbarLayoutLoggedRef = useRef(false);
  const navbarMountedAtRef = useRef(Date.now());
  const firstNavbarFocusLoggedRef = useRef(false);
  const focusVisualStateRequestedAtRef = useRef<number | null>(null);
  const navItemRefs = useRef<Partial<Record<NavigationId, View | null>>>({});
  const [navbarHandles, setNavbarHandles] = useState<NovaNavigationFocusHandles>({});
  const lastNavHandlesJson = useRef('');
  const lastNavbarFocusGraphJson = useRef('');
  const preferredFocusConsumedRef = useRef(false);
  const navbarPreferredFocus = navigationFocusable && preferActiveNavigationFocus && !suppressNavbarPreferredFocus;
  useEffect(() => {
    const committedAt = Date.now();
    const requestedAt = focusVisualStateRequestedAtRef.current;
    logFocusVisualAudit({
      event: 'navbar-commit',
      activeId,
      focusedId,
      stateUpdateToCommitMs: requestedAt == null ? null : committedAt - requestedAt,
    });
  }, [activeId, focusedId]);
  useLayoutEffect(() => {
    if (__DEV__) {
      console.info('[NovaCast Shell Lifecycle]', {
        event: 'mount',
        shellInstanceId,
        timestamp: Date.now(),
      });
    }
    noteFocusLifecycleEvent('shell-mount', { activeId, shellInstanceId });
    logFocusVisualAudit({ event: 'shell-mount', activeId, focusedId, shellInstanceId });
    if (showNavigationRail) {
      noteFocusLifecycleEvent('navbar-mount', { activeId, shellInstanceId });
    }
    return () => {
      if (__DEV__) {
        console.info('[NovaCast Shell Lifecycle]', {
          event: 'unmount',
          shellInstanceId,
          timestamp: Date.now(),
          lifetimeMs: Date.now() - navbarMountedAtRef.current,
        });
      }
    };
  }, []);
  useEffect(() => {
    if (navbarPreferredFocus && !preferredFocusConsumedRef.current) {
      recordFocusAudit({
        component: 'NovaTvShell.navbar',
        action: 'hasTVPreferredFocus',
        itemId: activeId,
      });
      noteFocusLifecycleEvent('hasTVPreferredFocus', { activeId });
      logFocusVisualAudit({ event: 'preferred-focus-armed', activeId, focusedId, itemId: activeId });
      if (__DEV__ && activeId === 'home') {
        console.info('[NovaCast Navbar Focus]', {
          event: 'preferred-owner',
          owner: navbarPreferredFocus ? 'home-nav' : 'hero',
        });
      }
    }
  }, [activeId, navbarPreferredFocus]);
  useEffect(() => {
    const surface = activeId === 'live' || activeId === 'movies' || activeId === 'series' ? activeId : 'other';
    setCatalogUiSurface(surface);
    return () => {
      setCatalogUiSurface('other');
    };
  }, [activeId]);
  const density = getTvDensity(width);
  const safeHorizontal = density === 'compact' ? 44 : density === 'normal' ? 48 : 52;
  const safeVertical = density === 'compact' ? 18 : density === 'normal' ? 20 : 22;
  const navIconSize = density === 'compact' ? 23 : density === 'normal' ? 25 : 27;
  const navbarOverlayHeight = density === 'compact' ? 66 : 68;
  const navbarReserve = showNavigationRail
    ? safeVertical + navbarOverlayHeight + (compactNavigationRail ? 4 : NAVBAR_CONTENT_GAP)
    : safeVertical;
  const bleedContentUnderNavbar = false;
  const showPageHeader = Boolean(title || subtitle || headerSupplement);
  void compactNavigationRail;

  useEffect(() => {
    if (!__DEV__ || navbarLayoutLoggedRef.current || !showNavigationRail) {
      return;
    }
    navbarLayoutLoggedRef.current = true;
    const navGroupWidth = PRIMARY_NAV_ITEMS.reduce((sum, item) => sum + NAVBAR_ITEM_WIDTHS[item.id], 0)
      + NAVBAR_PRIMARY_GAP * Math.max(0, PRIMARY_NAV_ITEMS.length - 1);
    const totalNavbarWidth = Math.min(1820, Math.max(0, width - safeHorizontal * 2));
    const logoWidth = density === 'compact' ? 150 : density === 'normal' ? 166 : 178;
    const settingsWidth = NAVBAR_ITEM_WIDTHS.settings;
    const settingsSlotWidth = 1 + 12 + settingsWidth;
    const availableGap = totalNavbarWidth - 36 - logoWidth - navGroupWidth - settingsSlotWidth;
    if (availableGap < 0) {
      console.warn('[NovaCast Navbar Layout] fixed slots exceed available width', {
        totalNavbarWidth,
        availableGap,
      });
    }
    console.info('[NovaCast Navbar Layout]', {
      screenWidth: width,
      totalNavbarWidth,
      navbarHeight: navbarOverlayHeight,
      logoWidth,
      centerGroupWidth: navGroupWidth,
      settingsWidth,
      availableGap: Math.max(0, availableGap),
      overlaps: availableGap < 0,
    });
  }, [density, navbarOverlayHeight, safeHorizontal, showNavigationRail, width]);

  const setNavItemRef = useCallback((itemId: NavigationId, node: View | null) => {
    navItemRefs.current[itemId] = node;
    // Keep the last known native handle. Clearing it during a ref callback would
    // briefly remove native LEFT/RIGHT destinations during ordinary rerenders.
    if (node == null) {
      return;
    }
    const handle = findNodeHandle(node);
    if (handle == null) {
      return;
    }
    setNavbarHandles((previous) => (
      previous[itemId] === handle ? previous : { ...previous, [itemId]: handle }
    ));
  }, []);

  useLayoutEffect(() => {
    if (!navigationFocusable || !onNavigationFocusHandles) {
      return;
    }

    const serialized = JSON.stringify(navbarHandles);
    if (serialized !== lastNavHandlesJson.current) {
      lastNavHandlesJson.current = serialized;
      onNavigationFocusHandles(navbarHandles);
    }
  }, [navigationFocusable, navbarHandles, onNavigationFocusHandles]);

  useEffect(() => {
    if (!__DEV__ || !navigationFocusable) {
      return;
    }
    const graphReady = NAV_ITEMS.every((item) => navbarHandles[item.id] != null);
    if (!graphReady) {
      return;
    }
    const graph = NAV_ITEMS.map((item, index) => {
      const previous = NAV_ITEMS[Math.max(0, index - 1)];
      const next = NAV_ITEMS[Math.min(NAV_ITEMS.length - 1, index + 1)];
      return {
        itemId: item.id,
        leftTargetId: previous.id,
        rightTargetId: next.id,
        leftHandlePresent: navbarHandles[previous.id] != null,
        rightHandlePresent: navbarHandles[next.id] != null,
      };
    });
    const serialized = JSON.stringify(graph);
    if (serialized === lastNavbarFocusGraphJson.current) {
      return;
    }
    lastNavbarFocusGraphJson.current = serialized;
    for (const entry of graph) {
      console.info('[NovaCast Navbar Focus Graph]', entry);
    }
  }, [navbarHandles, navigationFocusable]);

  const horizontalFocusTarget = (itemIndex: number, direction: 'left' | 'right') => {
    const item = NAV_ITEMS[itemIndex];
    const neighborIndex = direction === 'left'
      ? Math.max(0, itemIndex - 1)
      : Math.min(NAV_ITEMS.length - 1, itemIndex + 1);
    // A missing neighbor must never fall through to page content. Self is also
    // the intentional edge target for the first/last navbar item.
    return navbarHandles[NAV_ITEMS[neighborIndex].id] ?? navbarHandles[item.id];
  };

  const contentDownHandle = (itemId: NavigationId) => {
    if (itemId !== activeId) {
      return undefined;
    }
    return navigationNextFocusRight?.[itemId] ?? navigationContentFocusHandle;
  };

  const renderNavItem = (item: NavItem) => {
    const itemIndex = NAV_ITEMS.findIndex((candidate) => candidate.id === item.id);
    const active = item.id === activeId;
    const focused = navigationFocusable && item.id === focusedId;
    const downHandle = contentDownHandle(item.id);
    return (
      <GlassNavItem
        key={item.id}
        label={item.label}
        icon={item.icon}
        iconOnly={item.iconOnly}
        active={active}
        focused={focused}
        focusable={navigationFocusable}
        hasTVPreferredFocus={shouldArmNavbarPreferredFocus({
          preferActiveNavigationFocus,
          suppressNavbarPreferredFocus,
          navigationFocusable,
          isActiveItem: active,
          preferredFocusConsumed: preferredFocusConsumedRef.current,
        })}
        iconSize={item.iconOnly ? navIconSize + 2 : navIconSize}
        slotWidth={NAVBAR_ITEM_WIDTHS[item.id]}
        nativeRef={(node) => {
          setNavItemRef(item.id, node);
        }}
        nextFocusLeft={horizontalFocusTarget(itemIndex, 'left')}
        nextFocusRight={horizontalFocusTarget(itemIndex, 'right')}
        nextFocusUp={navbarHandles[item.id]}
        nextFocusDown={downHandle}
        onFocus={() => {
          const focusReceivedAt = Date.now();
          focusVisualStateRequestedAtRef.current = focusReceivedAt;
          logFocusVisualAudit({
            event: 'focus-state-requested',
            activeId,
            focusedId: item.id,
            itemId: item.id,
            focusReceivedAt,
          });
          preferredFocusConsumedRef.current = true;
          if (__DEV__ && !firstNavbarFocusLoggedRef.current) {
            firstNavbarFocusLoggedRef.current = true;
            console.info('[NovaCast Navbar Focus]', {
              event: 'first-focus',
              control: `nav:${item.id}`,
              elapsedMs: Date.now() - navbarMountedAtRef.current,
            });
            console.info('[NovaCast Fresh Focus]', {
              event: 'first-native-focus',
              control: activeId === 'home' && item.id === 'home' ? 'home-nav' : `nav:${item.id}`,
              elapsedFromShellMountMs: Date.now() - navbarMountedAtRef.current,
            });
          }
          noteFocusLifecycleEvent('native-focus', { source: `nav:${item.id}`, activeId });
          logFocusVisualAudit({ event: 'native-focus', activeId, focusedId: item.id, itemId: item.id });
          recordFocusAudit({ component: 'NovaTvShell.navbar', action: 'focus-received', itemId: item.id });
          markCatalogAuditFocus(`nav:${item.id}`);
          noteFocusLatencyFocus(`nav:${item.id}`);
          setFocusedId(item.id);
          onNavigationItemFocus?.(item.id);
        }}
        onBlur={() => {
          setFocusedId(null);
          onNavigationItemFocus?.(null);
        }}
        onPress={() => {
          if (item.route === pathname) {
            return;
          }

          if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
            return;
          }
          router.replace(item.route as Href);
        }}
      />
    );
  };

  return (
    <NovaScreen padded={false}>
      <View
        style={[
          styles.safeFrame,
          {
            paddingRight: safeHorizontal,
            paddingBottom: safeVertical,
            paddingLeft: safeHorizontal,
          },
        ]}>
        <View
          style={[
            styles.mainArea,
            bleedContentUnderNavbar ? null : { paddingTop: navbarReserve },
          ]}>
          {bleedContentUnderNavbar ? (
            <View pointerEvents="box-none" style={styles.backdropBleed}>
              {children}
            </View>
          ) : null}

          {showPageHeader ? (
            <View style={[styles.header, bleedContentUnderNavbar ? { marginTop: navbarReserve } : null]}>
              <View style={styles.headerCopy}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              {headerSupplement ? <View style={styles.headerSupplement}>{headerSupplement}</View> : null}
            </View>
          ) : null}

          {bleedContentUnderNavbar ? null : <View style={styles.content}>{children}</View>}
        </View>

        {showNavigationRail ? (
          <NovaGlassStatusFooter
            density={density}
            providerLabel={providerLabel}
            expirationLabel={expirationLabel}
          />
        ) : null}

        {showNavigationRail ? (
          <View
            pointerEvents={navigationFocusable ? 'box-none' : 'none'}
            style={[
              styles.navbarOverlay,
              {
                top: safeVertical,
                right: safeHorizontal,
                left: safeHorizontal,
              },
            ]}
            {...(!navigationFocusable ? { importantForAccessibility: 'no-hide-descendants' as const } : null)}>
            <GlassNavbarFrame density={density}>
              <GlassNavbarLogo density={density} />
              <GlassNavbarFocusGuide trapFocusUp>
                <View style={styles.primaryCluster}>{PRIMARY_NAV_ITEMS.map(renderNavItem)}</View>
                <View style={styles.settingsSlot}>
                  <GlassNavDivider />
                  <View style={styles.utilityCluster}>{UTILITY_NAV_ITEMS.map(renderNavItem)}</View>
                </View>
              </GlassNavbarFocusGuide>
            </GlassNavbarFrame>
          </View>
        ) : null}
      </View>
    </NovaScreen>
  );
}

function createShellStyles(theme: NovaTheme) {
  return StyleSheet.create({
    safeFrame: {
      flex: 1,
      position: 'relative',
      paddingTop: 0,
      paddingRight: theme.safeArea.right,
      paddingBottom: theme.safeArea.bottom,
      paddingLeft: theme.safeArea.left,
    },
    navbarOverlay: {
      position: 'absolute',
      maxWidth: 1820,
      alignSelf: 'center',
      zIndex: 8,
    },
    primaryCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      gap: 5,
    },
    settingsSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      marginLeft: 'auto',
    },
    utilityCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    },
    mainArea: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
    },
    backdropBleed: {
      ...StyleSheet.absoluteFillObject,
    },
    header: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.lg,
      marginBottom: 6,
      backgroundColor: 'transparent',
    },
    headerCopy: {
      flex: 1,
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
    headerSupplement: {
      alignItems: 'flex-end',
    },
    content: {
      flex: 1,
      minHeight: 0,
    },
  });
}
