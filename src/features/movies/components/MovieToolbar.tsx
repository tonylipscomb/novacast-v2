import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { createNovaTvFocusChrome, createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
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
  /** True while Discover Zone overlay owns focus. Must not reuse native-focus chrome. */
  discoverZoneOpen?: boolean;
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
  discoverZoneOpen = false,
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
      <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.textPrimary} />
      <Text style={[styles.actionText, searchFocused && styles.actionTextFocused]}>Search</Text>
    </>
  );

  const discoverLabel = (
    <>
      <MaterialCommunityIcons name="compass-outline" size={18} color={theme.colors.textPrimary} />
      <Text style={[styles.actionText, showDiscoverHighlight && styles.actionTextFocused]}>Discover Zone</Text>
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
          {...(Platform.isTV ? ({ onClick: onSearchPress } as object) : null)}
          style={[styles.actionButton, focusChrome.base, searchFocused && focusChrome.active]}>
          {searchLabel}
        </Pressable>
      ) : (
        <View focusable={false} accessible={false} pointerEvents="none" style={styles.actionButton}>
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
            {...(Platform.isTV
              ? ({
                  onClick: () => {
                    setDiscoverFocused(false);
                    onDiscoverPress();
                  },
                } as object)
              : null)}
            style={[styles.actionButton, focusChrome.base, showDiscoverHighlight && focusChrome.active]}>
            {discoverLabel}
          </Pressable>
        ) : (
          <View focusable={false} accessible={false} pointerEvents="none" style={styles.actionButton}>
            {discoverLabel}
          </View>
        )
      ) : null}
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  return StyleSheet.create({
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    actionButton: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    actionTextFocused: focusText.title,
  });
}
