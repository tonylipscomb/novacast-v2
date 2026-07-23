import { useMemo, useRef, useState, type ElementRef } from 'react';
import { findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

export type SettingsSectionId =
  | 'account'
  | 'playback'
  | 'appearance'
  | 'parental'
  | 'smart-categories'
  | 'about';

type SettingsRailItem = {
  id: SettingsSectionId;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
};

type SettingsRailProps = {
  items: SettingsRailItem[];
  selectedId: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
  nextFocusRightHandle?: number;
  onSelectedFocusHandleReady?: (handle: number | undefined) => void;
};

export function SettingsRail({
  items,
  selectedId,
  onSelect,
  nextFocusRightHandle,
  onSelectedFocusHandleReady,
}: SettingsRailProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createRailStyles(theme), [theme]);
  const [focusedId, setFocusedId] = useState<SettingsSectionId | null>(null);
  const preferredFocusConsumedRef = useRef(false);
  const itemRefs = useRef<Map<SettingsSectionId, ElementRef<typeof Pressable>>>(new Map());

  const reportSelectedHandle = (id: SettingsSectionId) => {
    const instance = itemRefs.current.get(id);
    const handle = instance ? findNodeHandle(instance) ?? undefined : undefined;
    onSelectedFocusHandleReady?.(handle);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sections</Text>
      </View>
      <View style={styles.list}>
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          const focused = focusedId === item.id;
          const selfHandle = (() => {
            const instance = itemRefs.current.get(item.id);
            return instance ? findNodeHandle(instance) ?? undefined : undefined;
          })();
          // Prefer detail pane when available; otherwise loop Right back onto this row
          // so read-only sections (Account) keep focus on the rail.
          const rightHandle = selected ? (nextFocusRightHandle ?? selfHandle) : undefined;

          return (
            <Pressable
              key={item.id}
              ref={(instance) => {
                if (instance) {
                  itemRefs.current.set(item.id, instance);
                } else {
                  itemRefs.current.delete(item.id);
                }
                if (item.id === selectedId) {
                  requestAnimationFrame(() => reportSelectedHandle(item.id));
                }
              }}
              focusable
              hasTVPreferredFocus={!preferredFocusConsumedRef.current && index === 0}
              {...(rightHandle != null ? { nextFocusRight: rightHandle } : null)}
              onFocus={() => {
                preferredFocusConsumedRef.current = true;
                setFocusedId(item.id);
                onSelect(item.id);
                reportSelectedHandle(item.id);
              }}
              onBlur={() => setFocusedId((current) => (current === item.id ? null : current))}
              onPress={() => onSelect(item.id)}
              style={[
                styles.row,
                selected && styles.rowSelected,
                focused && styles.rowFocused,
                novaTvFocus.base,
              ]}>
              <MaterialCommunityIcons
                name={item.icon}
                size={16}
                color={focused || selected ? theme.colors.accentHover : theme.colors.textMuted}
              />
              <Text style={[styles.title, (focused || selected) && styles.titleActive]} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function createRailStyles(theme: NovaTheme) {
  return StyleSheet.create({
    panel: {
      width: 240,
      minWidth: 220,
      maxWidth: 260,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
      paddingTop: 10,
    },
    header: {
      minHeight: 28,
      paddingHorizontal: 4,
      marginBottom: 6,
    },
    headerTitle: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    list: {
      gap: 2,
    },
    row: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
    },
    rowSelected: {
      borderBottomColor: theme.colors.success,
      backgroundColor: 'transparent',
    },
    rowFocused: {
      borderBottomColor: theme.scheme === 'light' ? theme.colors.focusRing : theme.colors.accentHover,
      backgroundColor: 'transparent',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    titleActive: {
      color: theme.scheme === 'light' ? theme.colors.accent : theme.colors.accentHover,
      ...(theme.scheme === 'light'
        ? {}
        : {
            textShadowColor: theme.colors.accentHover,
            textShadowRadius: 10,
            textShadowOffset: { width: 0, height: 0 },
          }),
    },
  });
}
