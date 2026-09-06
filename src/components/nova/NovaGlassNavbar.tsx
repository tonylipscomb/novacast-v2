import { memo, type ComponentProps, type ComponentType, type ReactNode, type Ref } from 'react';
import * as ReactNative from 'react-native';
import { Pressable, StyleSheet, Text, View, type View as ViewType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { NovaSymbol } from '@/components/nova/NovaSymbol';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { useAppTheme } from '@/theme/AppThemeProvider';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type GlassNavDensity = 'compact' | 'normal' | 'comfortable';

type NavbarFocusGuideProps = {
  children: ReactNode;
  style?: object;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
};

const reactNative = ReactNative as typeof ReactNative & {
  TVFocusGuideView?: ComponentType<NavbarFocusGuideProps & {
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
  }>;
};
const NativeNavbarFocusGuide = reactNative.TVFocusGuideView;

/** Stable boundary for the navbar only; it never rebuilds destinations or requests focus. */
export function GlassNavbarFocusGuide({
  children,
  style,
  trapFocusUp = true,
  trapFocusDown = false,
}: NavbarFocusGuideProps) {
  const FocusGuide = NativeNavbarFocusGuide ?? View;
  return (
    <FocusGuide
      style={[styles.navigationGuide, style]}
      {...(NativeNavbarFocusGuide
        ? { trapFocusLeft: true, trapFocusRight: true, trapFocusUp, trapFocusDown }
        : null)}>
      {children}
    </FocusGuide>
  );
}

type GlassNavItemProps = {
  label: string;
  icon: IconName;
  iconOnly?: boolean;
  active: boolean;
  focused: boolean;
  focusable: boolean;
  hasTVPreferredFocus?: boolean;
  iconSize: number;
  slotWidth?: number;
  nativeRef?: Ref<ViewType>;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusDown?: number;
  nextFocusUp?: number;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
};

const LOGO_WIDTH: Record<GlassNavDensity, number> = {
  compact: 34,
  normal: 38,
  comfortable: 42,
};

export function GlassNavbarLogo({ density }: { density: GlassNavDensity }) {
  const { theme } = useAppTheme();
  const ice = theme.scheme === 'light';
  const width = LOGO_WIDTH[density];
  return (
    <View
      style={[
        styles.logoLockup,
        density === 'compact' && styles.logoLockupCompact,
        density === 'comfortable' && styles.logoLockupComfortable,
      ]}
      accessibilityRole="image"
      accessibilityLabel="NovaCast">
      {/* nav-mark.png is square; use a square box so its transparent artwork is not vertically compressed. */}
      <NovaSymbol width={width} height={width} />
      <Text
        style={[
          styles.wordmark,
          ice && styles.wordmarkIce,
          density === 'compact' && styles.wordmarkCompact,
          density === 'comfortable' && styles.wordmarkComfortable,
        ]}
        numberOfLines={1}>
        NOVACAST
      </Text>
    </View>
  );
}

export function GlassNavDivider() {
  return <View style={styles.divider} pointerEvents="none" />;
}

export function GlassNavbarFrame({
  density,
  children,
}: {
  density: GlassNavDensity;
  children: ReactNode;
}) {
  return (
    <View
      collapsable={false}
      pointerEvents="box-none"
      style={[
        styles.frame,
        density === 'compact' && styles.frameCompact,
        density === 'comfortable' && styles.frameComfortable,
      ]}>
      <View
        style={[
          styles.contentRow,
          density === 'compact' && styles.contentRowCompact,
          density === 'comfortable' && styles.contentRowComfortable,
        ]}>
        {children}
      </View>
    </View>
  );
}

export const GlassNavItem = memo(function GlassNavItem({
  label,
  icon,
  iconOnly = false,
  active,
  focused,
  focusable,
  hasTVPreferredFocus = false,
  iconSize,
  slotWidth,
  nativeRef,
  nextFocusLeft,
  nextFocusRight,
  nextFocusDown,
  nextFocusUp,
  onFocus,
  onBlur,
  onPress,
}: GlassNavItemProps) {
  const { theme } = useAppTheme();
  const ice = theme.scheme === 'light';
  const showPill = active || focused;
  const itemStyle = [
    styles.item,
    slotWidth != null && { width: slotWidth },
    iconOnly && styles.itemIconOnly,
    active && styles.itemActive,
    focused && !active && (ice ? styles.itemFocusedIce : styles.itemFocused),
    active && focused && (ice ? styles.itemActiveFocusedIce : styles.itemActiveFocused),
  ];
  const iconColor = active || focused
    ? 'rgba(255,255,255,1)'
    : ice ? 'rgba(26,21,16,0.82)' : 'rgba(255,255,255,0.78)';
  const labelStyle = [ice ? styles.labelIce : styles.label, (active || focused) && (ice ? styles.labelLitIce : styles.labelLit)];

  const content = (
    <>
      {active ? <View pointerEvents="none" style={styles.pillSecondaryTint} /> : null}
      {showPill ? (
        <View
          pointerEvents="none"
          style={focused && !active ? (ice ? styles.focusHighlightIce : styles.focusHighlight) : styles.pillHighlight}
        />
      ) : null}
      {showPill ? (
        <View
          pointerEvents="none"
          style={focused && !active ? (ice ? styles.focusLowerEdgeIce : styles.focusLowerEdge) : styles.pillLowerEdge}
        />
      ) : null}
      <MaterialCommunityIcons name={icon} size={iconSize} color={iconColor} />
      {iconOnly ? null : (
        <Text numberOfLines={1} style={labelStyle}>
          {label}
        </Text>
      )}
    </>
  );

  const focusNavProps = {
    ...(nextFocusLeft != null ? { nextFocusLeft } : null),
    ...(nextFocusRight != null ? { nextFocusRight } : null),
    ...(nextFocusDown != null ? { nextFocusDown } : null),
    ...(nextFocusUp != null ? { nextFocusUp } : null),
  };

  if (!focusable) {
    return (
      <View
        focusable={false}
        accessible={false}
        importantForAccessibility="no"
        style={itemStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      ref={nativeRef}
      collapsable={false}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      style={itemStyle}
      {...focusNavProps}>
      {content}
    </Pressable>
  );
});
const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    minHeight: 68,
    backgroundColor: 'transparent',
  },
  frameCompact: {
    minHeight: 66,
  },
  frameComfortable: {
    minHeight: 68,
  },
  contentRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 6,
  },
  contentRowCompact: {
    minHeight: 66,
    paddingHorizontal: 14,
    gap: 5,
  },
  contentRowComfortable: {
    minHeight: 68,
    paddingHorizontal: 22,
    gap: 7,
  },
  navigationGuide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    width: 174,
    gap: 8,
    paddingRight: 10,
  },
  logoLockupCompact: {
    width: 158,
    gap: 7,
    paddingRight: 8,
  },
  logoLockupComfortable: {
    width: 186,
    gap: 10,
    paddingRight: 12,
  },
  wordmark: {
    color: 'rgba(255,255,255,0.96)',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  wordmarkCompact: {
    fontSize: 15,
    letterSpacing: 1.1,
  },
  wordmarkComfortable: {
    fontSize: 18,
    letterSpacing: 1.6,
  },
  divider: {
    width: 1,
    height: 38,
    marginHorizontal: 6,
    backgroundColor: 'rgba(180,195,255,0.12)',
    alignSelf: 'center',
  },
  item: {
    position: 'relative',
    flexShrink: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  itemIconOnly: {
    minWidth: 52,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  itemActive: {
    minHeight: 48,
    borderRadius: NOVA_GLASS.radius.pill,
    backgroundColor: NOVA_GLASS.active.backgroundColor,
    borderColor: NOVA_GLASS.active.borderColor,
  },
  itemFocused: {
    backgroundColor: NOVA_GLASS.focused.backgroundColor,
    borderColor: NOVA_GLASS.focused.borderColor,
  },
  itemFocusedIce: {
    backgroundColor: 'rgba(95,70,220,0.30)',
    borderColor: 'rgba(210,195,255,0.78)',
    shadowColor: '#7356E8',
    shadowOpacity: 0.56,
    shadowRadius: 12,
    elevation: 5,
  },
  itemActiveFocused: {
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
  },
  itemActiveFocusedIce: {
    backgroundColor: 'rgba(83,58,190,0.40)',
    borderColor: 'rgba(224,214,255,0.88)',
    shadowColor: '#7356E8',
    shadowOpacity: 0.64,
    shadowRadius: 13,
    elevation: 5,
  },
  pillSecondaryTint: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderRadius: NOVA_GLASS.radius.base,
    backgroundColor: NOVA_GLASS.active.secondaryTint,
  },
  pillHighlight: {
    position: 'absolute',
    top: 0,
    right: 8,
    left: 8,
    height: 1,
    backgroundColor: NOVA_GLASS.active.topHighlight,
  },
  pillLowerEdge: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    left: 8,
    height: 1,
    backgroundColor: NOVA_GLASS.active.lowerEdge,
  },
  focusHighlight: {
    position: 'absolute',
    top: 0,
    right: 8,
    left: 8,
    height: 1,
    backgroundColor: NOVA_GLASS.focused.topHighlight,
  },
  focusLowerEdge: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    left: 8,
    height: 1,
    backgroundColor: NOVA_GLASS.focused.lowerEdge,
  },
  focusHighlightIce: {
    position: 'absolute',
    top: 0,
    right: 8,
    left: 8,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  focusLowerEdgeIce: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    left: 8,
    height: 1,
    backgroundColor: 'rgba(85,210,255,0.72)',
  },
  label: {
    color: NOVA_GLASS.text.secondary,
    fontSize: 17,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  labelIce: {
    color: 'rgba(26,21,16,0.88)',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  labelLit: {
    color: 'rgba(255,255,255,1)',
    fontWeight: '600',
  },
  labelLitIce: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  wordmarkIce: {
    color: 'rgba(26,21,16,0.92)',
  },
});
