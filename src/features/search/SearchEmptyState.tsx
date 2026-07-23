import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NovaFocusRow } from '@/components/nova/NovaFocusRow';
import { novaTheme } from '@/theme';

import { scopedSearchEmptyHint } from './searchScopes';
import type { SearchScope } from './searchTypes';

type SearchEmptyStateProps = {
  scope: SearchScope;
  query?: string;
  mode?: 'idle' | 'empty' | 'error';
  errorMessage?: string | null;
  message?: string;
  onClear?: () => void;
  onRetry?: () => void;
  clearRowRef?: RefObject<View | null>;
  retryRowRef?: RefObject<View | null>;
  focusUpHandle?: number;
  focusLeftHandle?: number;
};

export function SearchEmptyState({
  scope,
  query,
  mode = 'idle',
  errorMessage,
  message,
  onClear,
  onRetry,
  retryRowRef,
  clearRowRef,
  focusUpHandle,
  focusLeftHandle,
}: SearchEmptyStateProps) {
  if (mode === 'error') {
    return (
      <View style={styles.compactPanel}>
        <Text style={styles.title}>Search unavailable</Text>
        <Text style={styles.copy}>{errorMessage ?? 'We could not search your provider library right now.'}</Text>
        {onRetry ? (
          <NovaFocusRow
            nativeRef={retryRowRef}
            title="Retry search"
            meta="Action"
            onPress={onRetry}
            accessibilityLabel="Retry search"
            nextFocusUp={focusUpHandle}
            nextFocusLeft={focusLeftHandle}
            trailing={<MaterialCommunityIcons name="refresh" size={16} color={novaTheme.colors.textMuted} />}
          />
        ) : null}
      </View>
    );
  }

  if (mode === 'empty') {
    return (
      <View style={styles.compactPanel}>
        <Text style={styles.title}>No matches found</Text>
        <Text style={styles.copy}>
          {message ??
            `No results for “${query?.trim()}” in ${scope === 'all' ? 'your library' : scope}. Check spelling or try another term.`}
        </Text>
        {onClear ? (
          <NovaFocusRow
            nativeRef={clearRowRef}
            title="Clear search"
            meta="Action"
            onPress={onClear}
            accessibilityLabel="Clear search"
            nextFocusUp={focusUpHandle}
            nextFocusLeft={focusLeftHandle}
            trailing={<MaterialCommunityIcons name="close" size={16} color={novaTheme.colors.textMuted} />}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.compactPanel}>
      <Text style={styles.heroTitle}>Search your library</Text>
      <Text style={styles.copy}>{scopedSearchEmptyHint(scope)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compactPanel: {
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  heroTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  copy: {
    maxWidth: 640,
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
});
