import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { findNodeHandle, Platform, Pressable, StyleSheet, TextInput, View, type TextInput as TextInputType } from 'react-native';

import { novaTvFocus, createNovaTvFocusTextStyles, NOVA_TV_GLASS } from '@/components/nova/novaTvFocus';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { novaTheme } from '@/theme';

import { logSearchEvent } from './searchDiagnostics';
import { shouldRefocusSearchShellOnTextInputBlur } from './searchOverlayFocusPolicy';

const focusText = createNovaTvFocusTextStyles(novaTheme);

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
  onShellBlur?: () => void;
  onKeyboardActivate?: () => void;
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
  onShellBlur,
  onKeyboardActivate,
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
    onKeyboardActivate?.();
    requestTvFocus({
      screen: 'search-overlay',
      source: 'SearchInput',
      region: 'search-ime',
      reason: 'open-native-keyboard',
      getTarget: () => resolvedInputRef.current,
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
    onShellBlur?.();
  };

  const clear = () => {
    onChangeText('');
    onClear?.();
    requestTvFocus({
      screen: 'search-overlay',
      source: 'SearchInput',
      region: 'search-shell',
      reason: 'clear-return-shell',
      getTarget: () => resolvedFocusRef.current,
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
      onFocus={() => {
        setShellFocused(true);
        onKeyboardActivate?.();
      }}
      onBlur={() => {
        setShellFocused(false);
        onShellBlur?.();
        if (shouldRefocusSearchShellOnTextInputBlur()) {
          requestTvFocus({
            screen: 'search-overlay',
            source: 'SearchInput',
            region: 'search-shell',
            reason: 'text-input-blur-return',
            getTarget: () => resolvedFocusRef.current,
          });
        }
      }}
      pointerEvents={usePressableShell ? 'none' : 'auto'}
    />
  );

  return (
    <View style={[styles.searchBox, focused && styles.searchBoxFocused]}>
      <View style={styles.searchField}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={focused ? novaTheme.colors.textPrimary : novaTheme.colors.textMuted}
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
        {...(focusUpHandle ? { nextFocusUp: focusUpHandle } : null)}
        {...(fieldHandle ? { nextFocusRight: fieldHandle } : null)}
        style={[styles.clearButton, novaTvFocus.base, clearFocused && styles.clearButtonFocused, !hasValue && styles.clearHidden]}>
        <MaterialCommunityIcons
          name="close"
          size={17}
          color={clearFocused ? novaTheme.colors.textPrimary : novaTheme.colors.textSecondary}
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
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomWidth: 2,
    borderBottomColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'transparent',
    paddingLeft: 2,
    paddingRight: 2,
    paddingVertical: 4,
  },
  searchBoxFocused: {
    borderColor: NOVA_TV_GLASS.border,
    borderBottomColor: NOVA_TV_GLASS.border,
    backgroundColor: NOVA_TV_GLASS.fill,
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
  searchIconFocused: {},
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchInputFocused: focusText.title,
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
    ...novaTvFocus.active,
  },
  clearIconFocused: {},
  clearHidden: {
    opacity: 0,
  },
});
