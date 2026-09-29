import type { RefObject } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { createNovaCategoryChrome, createNovaTvFocusTextStyles, novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

const focusText = createNovaTvFocusTextStyles(novaTheme);
const categoryChrome = createNovaCategoryChrome();

type NovaScopeTabsProps<T extends string> = {
  options: readonly T[];
  activeOption: T;
  labelForOption: (option: T) => string;
  onSelectOption: (option: T) => void;
  onFocusOption?: (option: T) => void;
  onBlurOption?: () => void;
  emphasizedFocus?: boolean;
  focusUpHandle?: number;
  focusDownHandle?: number;
  focusLeftHandle?: number;
  firstTabRef?: RefObject<View | null>;
  style?: StyleProp<ViewStyle>;
};

export function NovaScopeTabs<T extends string>({
  options,
  activeOption,
  labelForOption,
  onSelectOption,
  onFocusOption,
  onBlurOption,
  focusUpHandle,
  focusDownHandle,
  focusLeftHandle,
  firstTabRef,
  style,
}: NovaScopeTabsProps<T>) {
  const [focusedTab, setFocusedTab] = useState<T | null>(null);

  return (
    <View style={[styles.row, style]}>
      {options.map((option) => {
        const active = activeOption === option;
        const focused = focusedTab === option;
        const label = labelForOption(option);

        return (
          <Pressable
            key={option}
            ref={option === options[0] ? firstTabRef : undefined}
            focusable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            onPress={() => onSelectOption(option)}
            onFocus={() => {
              setFocusedTab(option);
              onFocusOption?.(option);
            }}
            onBlur={() => {
              setFocusedTab((current) => (current === option ? null : current));
              onBlurOption?.();
            }}
            {...(focusUpHandle ? { nextFocusUp: focusUpHandle } : null)}
            {...(focusDownHandle ? { nextFocusDown: focusDownHandle } : null)}
            {...(option === options[0] && focusLeftHandle ? { nextFocusLeft: focusLeftHandle } : null)}
            style={[styles.tab, novaTvFocus.base, categoryChrome.default, active && categoryChrome.active, focused && (active ? categoryChrome.activeFocused : categoryChrome.focused)]}>
            <Text style={[styles.tabText, active && !focused && styles.tabTextActive, focused && styles.tabTextFocused]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingBottom: 2,
  },
  tab: {
    minHeight: novaTheme.density.scopeTabHeight,
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 8,
  },
  tabText: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: novaTheme.colors.textPrimary,
  },
  tabTextFocused: focusText.title,
});
