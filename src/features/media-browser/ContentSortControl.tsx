import { MaterialCommunityIcons } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ElementRef } from 'react';
import { BackHandler, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import {
  CONTENT_SORT_OPTIONS,
  contentSortLabel,
  getVisibleSortOptions,
  type ContentSortOption,
} from './contentSorting';

export type ContentSortControlHandle = {
  focus: () => void;
  getFocusHandle: () => number | undefined;
};

type ContentSortControlProps = {
  value: ContentSortOption;
  onChange: (value: ContentSortOption) => void;
  showRating?: boolean;
  nextFocusLeft?: number;
};

export const ContentSortControl = forwardRef<ContentSortControlHandle, ContentSortControlProps>(function ContentSortControl(
  { value, onChange, showRating = true, nextFocusLeft },
  ref,
) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [focusedTarget, setFocusedTarget] = useState<'trigger' | number | null>(null);
  const openerRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const optionRefs = useRef<(ElementRef<typeof Pressable> | null)[]>([]);
  const [optionHandles, setOptionHandles] = useState<(number | null)[]>([]);

  const visibleOptions = useMemo(() => getVisibleSortOptions(showRating), [showRating]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      openerRef.current?.focus();
    },
    getFocusHandle: () => {
      const instance = openerRef.current;
      return instance ? findNodeHandle(instance) ?? undefined : undefined;
    },
  }));

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setOptionHandles(optionRefs.current.map((instance) => findNodeHandle(instance)));
    });
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => {
      cancelAnimationFrame(frame);
      subscription.remove();
    };
  }, [open, visibleOptions.length]);

  useEffect(() => {
    if (value === 'rating-desc' && !showRating) {
      onChange('newest');
    }
  }, [onChange, showRating, value]);

  return (
    <View style={styles.root}>
      <Pressable
        ref={openerRef}
        focusable
        accessibilityRole="button"
        accessibilityLabel={`Sort: ${contentSortLabel(value)}`}
        {...(nextFocusLeft ? { nextFocusLeft } : null)}
        onFocus={() => setFocusedTarget('trigger')}
        onBlur={() => setFocusedTarget(null)}
        onPress={() => setOpen((current) => !current)}
        style={[styles.trigger, novaTvFocus.base, focusedTarget === 'trigger' && styles.triggerFocused]}>
        <MaterialCommunityIcons
          name="sort-variant"
          size={18}
          color={
            focusedTarget === 'trigger'
              ? theme.scheme === 'light'
                ? theme.colors.accent
                : theme.colors.accentHover
              : theme.colors.textPrimary
          }
        />
        <Text style={[styles.triggerLabel, focusedTarget === 'trigger' && styles.triggerLabelFocused]}>
          Sort: {contentSortLabel(value)}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          {visibleOptions.map((option, index) => (
            <Pressable
              key={option.value}
              ref={(instance) => {
                optionRefs.current[index] = instance;
              }}
              focusable
              hasTVPreferredFocus={option.value === value}
              {...(optionHandles[index - 1] || (index === 0 && optionHandles[index])
                ? { nextFocusUp: optionHandles[index - 1] ?? optionHandles[index] }
                : null)}
              {...(optionHandles[index + 1] || (index === CONTENT_SORT_OPTIONS.length - 1 && optionHandles[index])
                ? { nextFocusDown: optionHandles[index + 1] ?? optionHandles[index] }
                : null)}
              {...(optionHandles[index] ? { nextFocusLeft: optionHandles[index], nextFocusRight: optionHandles[index] } : null)}
              onFocus={() => setFocusedTarget(index)}
              onBlur={() => setFocusedTarget(null)}
              onPress={() => {
                if (option.value !== value) {
                  onChange(option.value);
                }
                close();
              }}
              style={[
                styles.option,
                novaTvFocus.base,
                focusedTarget === index && styles.optionFocused,
                option.value === value && styles.optionSelected,
              ]}>
              <Text style={styles.optionText}>{option.label}</Text>
              {option.value === value ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    root: { position: 'relative', zIndex: 20 },
    trigger: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    triggerFocused:
      theme.scheme === 'light'
        ? {
            borderColor: theme.colors.focusRing,
            backgroundColor: theme.colors.surfaceFocused,
          }
        : {
            shadowColor: theme.colors.focusRing,
            shadowOpacity: theme.glow.focusShadowOpacity * 0.65,
            shadowRadius: 7,
          },
    triggerLabel: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '800' },
    triggerLabelFocused:
      theme.scheme === 'light'
        ? {
            color: theme.colors.accent,
          }
        : {
            color: theme.colors.accentHover,
            textShadowColor: theme.colors.focusRing,
            textShadowRadius: 8,
          },
    menu: {
      position: 'absolute',
      right: 0,
      top: 44,
      width: 190,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.scheme === 'light' ? theme.colors.backgroundRaised : '#111827',
      padding: 6,
      zIndex: 30,
    },
    option: {
      minHeight: 36,
      borderRadius: 0,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    optionFocused:
      theme.scheme === 'light'
        ? {
            borderColor: theme.colors.focusRing,
            backgroundColor: theme.colors.surfaceFocused,
          }
        : {
            shadowColor: theme.colors.focusRing,
            shadowOpacity: 0.65,
            shadowRadius: 7,
            backgroundColor: 'transparent',
          },
    optionSelected: {
      backgroundColor: theme.colors.surfaceMuted,
    },
    optionText: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    check: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
  });
}
