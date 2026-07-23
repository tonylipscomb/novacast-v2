import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';

type SidebarItem = {
  id: string;
  label: string;
};

type NovaSidebarProps = {
  items: SidebarItem[];
  activeId: string;
  onSelect?: (id: string) => void;
};

export function NovaSidebar({ items, activeId, onSelect }: NovaSidebarProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  return (
    <View style={styles.sidebar}>
      {items.map((item) => {
        const highlighted = focusedId === item.id || activeId === item.id;
        return (
          <Pressable
            key={item.id}
            focusable
            onFocus={() => setFocusedId(item.id)}
            onBlur={() => setFocusedId(null)}
            onPress={() => onSelect?.(item.id)}
            style={[styles.item, highlighted && styles.itemFocused]}>
            <Text style={[styles.itemLabel, highlighted && styles.itemLabelFocused]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    backgroundColor: novaTheme.colors.surface,
    borderRadius: novaTheme.radius.md,
    paddingVertical: novaTheme.spacing.sm,
    paddingHorizontal: novaTheme.spacing.xs,
    gap: 6,
  },
  item: {
    minHeight: 56,
    borderRadius: novaTheme.radius.sm,
    borderWidth: novaTheme.glow.borderWidth,
    borderColor: 'transparent',
    justifyContent: 'center',
    paddingHorizontal: novaTheme.spacing.md,
  },
  itemFocused: {
    borderColor: novaTheme.colors.accent,
    backgroundColor: novaTheme.colors.surfaceMuted,
  },
  itemLabel: {
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.cardBody,
    fontWeight: '500',
  },
  itemLabelFocused: {
    color: novaTheme.colors.textPrimary,
  },
});
