import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import {
  logDiscoverZoneFocus,
  shouldShowDiscoverToolbarHighlight,
} from '@/features/personalization/discoverZoneHydration';

type MovieToolbarProps = {
  onSearchPress: () => void;
  onDiscoverPress?: () => void;
  /** Native focusable for D-pad — independent of preferred focus. */
  focusable?: boolean;
  /**
   * Stage 3D.2: Search must never auto-claim preferred focus after detail restore.
   * Keep false unless an explicit product path opts in (none today).
   */
  hasTVPreferredFocus?: boolean;
  onSearchFocus?: () => void;
  onDiscoverFocus?: () => void;
  accessibilityLabel?: string;
  discoverAccessibilityLabel?: string;
  buttonRef?: RefObject<View | null>;
  discoverButtonRef?: RefObject<View | null>;
  searchNextFocusLeft?: number;
  searchNextFocusRight?: number;
  discoverNextFocusLeft?: number;
  discoverNextFocusRight?: number;
  /** True while Discover Zone overlay owns focus. Must not reuse native-focus chrome. */
  discoverZoneOpen?: boolean;
  /** Show text beside the icons when embedded beside a sort control. */
  showLabels?: boolean;
};

export function MovieToolbar({
  onSearchPress,
  onDiscoverPress,
  focusable = true,
  hasTVPreferredFocus = false,
  onSearchFocus,
  onDiscoverFocus,
  accessibilityLabel = 'Search',
  discoverAccessibilityLabel = 'Discover Zone',
  buttonRef,
  discoverButtonRef,
  searchNextFocusLeft,
  searchNextFocusRight,
  discoverNextFocusLeft,
  discoverNextFocusRight,
  discoverZoneOpen = false,
  showLabels = false,
}: MovieToolbarProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const focusChrome = useMemo(() => createNovaTvFocusChrome(theme), [theme]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [discoverFocused, setDiscoverFocused] = useState(false);
  const overlayOpen = Boolean(discoverZoneOpen);
  const showDiscoverHighlight = shouldShowDiscoverToolbarHighlight(discoverFocused, overlayOpen);

  const searchLabel = (
    <>
      <MaterialCommunityIcons
        name="magnify"
        size={22}
        color={searchFocused ? theme.colors.focusRing : theme.colors.textPrimary}
      />
      {showLabels ? <Text style={[styles.actionText, searchFocused && styles.actionTextFocused]}>Search</Text> : null}
    </>
  );

  const discoverLabel = (
    <>
      <MaterialCommunityIcons
        name="compass-outline"
        size={22}
        color={showDiscoverHighlight ? theme.colors.focusRing : theme.colors.textPrimary}
      />
      {showLabels ? <Text style={[styles.actionText, showDiscoverHighlight && styles.actionTextFocused]}>Discover Zone</Text> : null}
    </>
  );

  return (
    <View style={styles.toolbar}>
      {focusable ? (
        <Pressable
          ref={buttonRef}
          focusable
          accessible
          hasTVPreferredFocus={hasTVPreferredFocus}
          onFocus={() => {
            setSearchFocused(true);
            setDiscoverFocused(false);
            onSearchFocus?.();
          }}
          onBlur={() => setSearchFocused(false)}
          onPress={onSearchPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          {...(searchNextFocusLeft != null ? { nextFocusLeft: searchNextFocusLeft } : null)}
          {...(searchNextFocusRight != null ? { nextFocusRight: searchNextFocusRight } : null)}
          {...(Platform.isTV ? ({ onClick: onSearchPress } as object) : null)}
          style={[styles.actionButton, showLabels && styles.actionButtonWithLabel, focusChrome.base, searchFocused && focusChrome.active, searchFocused && styles.actionButtonFocused]}>
          {searchLabel}
        </Pressable>
      ) : (
        <View focusable={false} accessible={false} pointerEvents="none" style={[styles.actionButton, showLabels && styles.actionButtonWithLabel]}>
          {searchLabel}
        </View>
      )}
      {onDiscoverPress ? (
        focusable ? (
          <Pressable
            ref={discoverButtonRef}
            focusable
            accessible
            hasTVPreferredFocus={false}
            onFocus={() => {
              setDiscoverFocused(true);
              setSearchFocused(false);
              logDiscoverZoneFocus({
                event: 'native-focus-received',
                visualFocused: shouldShowDiscoverToolbarHighlight(true, overlayOpen),
                overlayOpen,
                target: 'MovieToolbar.DiscoverZone',
              });
              onDiscoverFocus?.();
            }}
            onBlur={() => {
              setDiscoverFocused(false);
              logDiscoverZoneFocus({
                event: 'native-focus-lost',
                visualFocused: false,
                overlayOpen,
                target: 'MovieToolbar.DiscoverZone',
              });
            }}
            onPress={() => {
              setDiscoverFocused(false);
              logDiscoverZoneFocus({
                event: 'press-clear',
                visualFocused: false,
                overlayOpen: true,
                target: 'MovieToolbar.DiscoverZone',
              });
              onDiscoverPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={discoverAccessibilityLabel}
            {...(discoverNextFocusLeft != null ? { nextFocusLeft: discoverNextFocusLeft } : null)}
            {...(discoverNextFocusRight != null ? { nextFocusRight: discoverNextFocusRight } : null)}
            {...(Platform.isTV
              ? ({
                  onClick: () => {
                    setDiscoverFocused(false);
                    onDiscoverPress();
                  },
                } as object)
              : null)}
            style={[styles.actionButton, showLabels && styles.actionButtonWithLabel, focusChrome.base, showDiscoverHighlight && focusChrome.active, showDiscoverHighlight && styles.actionButtonFocused]}>
            {discoverLabel}
          </Pressable>
        ) : (
          <View focusable={false} accessible={false} pointerEvents="none" style={[styles.actionButton, showLabels && styles.actionButtonWithLabel]}>
            {discoverLabel}
          </View>
        )
      ) : null}
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    actionButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: NOVA_GLASS.radius.base,
      borderWidth: 1,
      borderColor: NOVA_GLASS.subtle.borderColor,
      backgroundColor: NOVA_GLASS.subtle.backgroundColor,
      padding: 0,
    },
    actionButtonFocused: {
      borderColor: NOVA_GLASS.activeFocused.borderColor,
      backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    },
    actionButtonWithLabel: {
      width: 'auto',
      minWidth: 88,
      height: 38,
      flexDirection: 'row',
      gap: 7,
      paddingHorizontal: 8,
    },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    actionTextFocused: {
      color: theme.colors.focusRing,
    },
  });
}
