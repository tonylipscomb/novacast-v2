import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { findNodeHandle, Platform, Pressable, StyleSheet, TextInput, View, type TextInput as TextInputType } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

import { logSearchEvent } from './searchDiagnostics';

type SearchInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  focusRef?: RefObject<View | null>;
  inputRef?: RefObject<TextInputType | null>;
  focusLeftHandle?: number;
  focusUpHandle?: number;
  focusDownHandle?: number;
  autoFocus?: boolean;
  preferredFocus?: boolean;
  /** When false, soft keyboard stays closed (TV on-screen keyboard mode). */
  showSoftKeyboard?: boolean;
  onSubmit?: () => void;
  onClear?: () => void;
  onShellFocus?: () => void;
  /** Opens the platform IME when the TV shell receives focus. */
  openKeyboardOnFocus?: boolean;
};

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  focusRef,
  inputRef,
  focusLeftHandle,
  focusUpHandle,
  focusDownHandle,
  autoFocus = false,
  preferredFocus = false,
  showSoftKeyboard = true,
  onSubmit,
  onClear,
  onShellFocus,
  openKeyboardOnFocus = false,
}: SearchInputProps) {
  const usePressableShell = Platform.isTV;
  const [shellFocused, setShellFocused] = useState(false);
  const [clearFocused, setClearFocused] = useState(false);
  const shellRef = useRef<View>(null);
  const internalInputRef = useRef<TextInputType>(null);
  const clearRef = useRef<View>(null);
  const resolvedFocusRef = focusRef ?? shellRef;
  const resolvedInputRef = inputRef ?? internalInputRef;
  const [fieldHandle, setFieldHandle] = useState<number | undefined>(undefined);
  const [clearHandle, setClearHandle] = useState<number | undefined>(undefined);
  const hasValue = value.length > 0;
  const focused = shellFocused;

  useLayoutEffect(() => {
    const handle = resolvedFocusRef.current ? findNodeHandle(resolvedFocusRef.current) ?? undefined : undefined;
    setFieldHandle((prev) => (prev === handle ? prev : handle));
  }, [resolvedFocusRef, hasValue, preferredFocus]);

  useLayoutEffect(() => {
    if (!hasValue) {
      setClearHandle(undefined);
      return;
    }

    const handle = clearRef.current ? findNodeHandle(clearRef.current) ?? undefined : undefined;
    setClearHandle((prev) => (prev === handle ? prev : handle));
  }, [hasValue]);

  const openKeyboard = () => {
    if (!showSoftKeyboard) {
      logSearchEvent('search_input_activate_skipped', { reason: 'soft-keyboard-disabled' });
      return;
    }
    logSearchEvent('search_input_activate', { platform: Platform.OS });
    requestAnimationFrame(() => {
      resolvedInputRef.current?.focus();
    });
  };

  const handleShellFocus = () => {
    setShellFocused(true);
    logSearchEvent('search_input_shell_focus', {});
    onShellFocus?.();
    if (!usePressableShell && openKeyboardOnFocus) {
      openKeyboard();
    }
  };

  const handleShellBlur = () => {
    setShellFocused(false);
  };

  const clear = () => {
    onChangeText('');
    onClear?.();
    requestAnimationFrame(() => {
      resolvedFocusRef.current?.focus();
    });
  };

  const fieldFocusProps = {
    ...(focusLeftHandle ? { nextFocusLeft: focusLeftHandle } : null),
    ...(focusUpHandle ? { nextFocusUp: focusUpHandle } : null),
    ...(focusDownHandle ? { nextFocusDown: focusDownHandle } : null),
    ...(clearHandle ? { nextFocusRight: clearHandle } : null),
  };

  const textInput = (
    <TextInput
      ref={resolvedInputRef}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={novaTheme.colors.textMuted}
      style={[styles.searchInput, focused && styles.searchInputFocused]}
      returnKeyType="search"
      autoFocus={autoFocus && !usePressableShell && showSoftKeyboard}
      focusable={!usePressableShell}
      editable={showSoftKeyboard}
      showSoftInputOnFocus={showSoftKeyboard}
      onSubmitEditing={onSubmit}
      onFocus={() => setShellFocused(true)}
      onBlur={() => setShellFocused(false)}
      pointerEvents={usePressableShell ? 'none' : 'auto'}
    />
  );

  return (
    <View style={[styles.searchBox, novaTvFocus.base, focused && styles.searchBoxFocused]}>
      <View style={styles.searchField}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={focused ? novaTheme.colors.accentHover : novaTheme.colors.textMuted}
          style={focused ? styles.searchIconFocused : undefined}
        />
        {usePressableShell ? (
          <Pressable
            ref={resolvedFocusRef}
            focusable
            hasTVPreferredFocus={preferredFocus}
            accessibilityRole="search"
            accessibilityLabel={placeholder}
            onFocus={handleShellFocus}
            onBlur={handleShellBlur}
            onPress={openKeyboard}
            {...(Platform.isTV ? ({ onClick: openKeyboard } as object) : null)}
            {...fieldFocusProps}
            style={styles.searchFieldHit}>
            {textInput}
          </Pressable>
        ) : (
          <Pressable
            ref={resolvedFocusRef}
            focusable
            accessibilityRole="search"
            accessibilityLabel={placeholder}
            onFocus={handleShellFocus}
            onBlur={handleShellBlur}
            onPress={openKeyboard}
            {...(Platform.isTV ? ({ onClick: openKeyboard } as object) : null)}
            {...fieldFocusProps}
            style={styles.searchFieldHit}>
            {textInput}
          </Pressable>
        )}
      </View>
      <Pressable
        ref={clearRef}
        focusable={hasValue}
        disabled={!hasValue}
        accessibilityRole="button"
        accessibilityLabel="Clear search"
        onPress={clear}
        {...(Platform.isTV ? ({ onClick: clear } as object) : null)}
        onFocus={() => setClearFocused(true)}
        onBlur={() => setClearFocused(false)}
        {...(fieldHandle ? { nextFocusLeft: fieldHandle } : null)}
        {...(focusDownHandle ? { nextFocusDown: focusDownHandle } : null)}
        style={[styles.clearButton, novaTvFocus.base, clearFocused && styles.clearButtonFocused, !hasValue && styles.clearHidden]}>
        <MaterialCommunityIcons
          name="close"
          size={17}
          color={clearFocused ? novaTheme.colors.accentHover : novaTheme.colors.textSecondary}
          style={clearFocused ? styles.clearIconFocused : undefined}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: novaTheme.density.compactControlHeight + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'transparent',
    paddingLeft: 2,
    paddingRight: 2,
    paddingVertical: 4,
  },
  searchBoxFocused: {
    borderBottomColor: novaTheme.colors.focusRing,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity * 0.65,
    shadowRadius: 7,
  },
  searchField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: novaTheme.density.compactControlHeight,
  },
  searchFieldHit: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIconFocused: {
    transform: [{ scale: 1.12 }],
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.9,
    shadowRadius: 7,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchInputFocused: {
    color: novaTheme.colors.accentHover,
    textShadowColor: novaTheme.colors.focusRing,
    textShadowRadius: 8,
  },
  clearButton: {
    width: 34,
    height: 34,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  clearButtonFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  clearIconFocused: {
    transform: [{ scale: 1.16 }],
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.9,
    shadowRadius: 7,
  },
  clearHidden: {
    opacity: 0,
  },
});
