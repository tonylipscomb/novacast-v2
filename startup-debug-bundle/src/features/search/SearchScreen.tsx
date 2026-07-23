import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { NovaTvShell } from '@/components/nova';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { useProviderStore } from '@/features/providers/providerStore';
import type { ProviderSearchHit } from '@/features/providers/providerRepositories';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { openSearchHit } from './searchNavigation';
import {
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_NOTIFICATION_DURATION_MS,
  SEARCH_NOTIFICATION_ID,
  resolveSearchNotificationForStatus,
  searchHitKey,
  searchHitKindLabel,
} from './searchScreenLogic';
import { useSearchScreenModel } from './useSearchScreenModel';

export function SearchScreen() {
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const searchInputRef = useRef<TextInput>(null);
  const searchRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const [focusedResultId, setFocusedResultId] = useState<string | null>(null);
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const { query, setQuery, results, status, errorMessage, reload, hasDataSource } = useSearchScreenModel();

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace('/content-hub');
      return true;
    });

    return () => subscription.remove();
  }, [router]);

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    searchRetryAttemptedRef.current = true;
    reload();
  }, [reload]);

  useEffect(() => {
    if (status === 'ready') {
      searchRetryAttemptedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (!hasDataSource || query.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      dismissNotification(SEARCH_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSearchNotificationForStatus(status, searchRetryAttemptedRef.current, errorMessage);
    if (!spec) {
      dismissNotification(SEARCH_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: SEARCH_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleReload,
      duration: SEARCH_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'search',
    });
  }, [dismissNotification, errorMessage, handleReload, hasDataSource, query, showNotification, status]);

  useEffect(() => {
    return () => {
      clearScope('search');
    };
  }, [clearScope]);

  const handleSelectHit = useCallback(
    (hit: ProviderSearchHit) => {
      openSearchHit(router, activeProviderId, hit);
    },
    [activeProviderId, router],
  );

  if (!hasDataSource) {
    return (
      <NovaTvShell activeId="search" title="Search" subtitle="Find anything across NovaCast." preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.statePanel}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.stateTitle}>Search unavailable</Text>
          <Text style={styles.stateCopy}>Connect a provider to search your library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  const trimmedQuery = query.trim();
  const showIdleHint = trimmedQuery.length < SEARCH_MIN_QUERY_LENGTH;
  const showEmptyNotice = !showIdleHint && status !== 'loading' && status === 'empty';
  const showErrorNotice = !showIdleHint && status === 'error';

  return (
    <NovaTvShell activeId="search" title="Search" subtitle="Find anything across NovaCast." providerLabel={selectedProviderLabel}>
      <View style={styles.screen}>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={20} color={novaTheme.colors.textMuted} />
          <TextInput
            ref={searchInputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search movies, series, and channels"
            placeholderTextColor={novaTheme.colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => searchInputRef.current?.blur()}
          />
          {query.length > 0 ? (
            <Pressable
              focusable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              style={styles.clearButton}>
              <MaterialCommunityIcons name="close" size={18} color={novaTheme.colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {showIdleHint ? (
          <View style={styles.inlinePanel}>
            <View style={styles.inlineIcon}>
              <MaterialCommunityIcons name="magnify" size={40} color={novaTheme.colors.accentHover} />
            </View>
            <Text style={styles.inlineTitle}>Search your library</Text>
            <Text style={styles.inlineCopy}>
              Enter at least {SEARCH_MIN_QUERY_LENGTH} characters to search movies, series, and live channels from your provider.
            </Text>
          </View>
        ) : showErrorNotice ? (
          <View style={styles.inlinePanel}>
            <MaterialCommunityIcons name="cloud-off-outline" size={24} color={novaTheme.colors.textMuted} />
            <Text style={styles.inlineNoticeText}>No results to display right now.</Text>
          </View>
        ) : showEmptyNotice ? (
          <View style={styles.inlinePanel}>
            <MaterialCommunityIcons name="magnify-close" size={24} color={novaTheme.colors.textMuted} />
            <Text style={styles.inlineNoticeText}>No matches for “{trimmedQuery}”.</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={searchHitKey}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.resultsList}
            ListHeaderComponent={
              status === 'loading' ? (
                <View style={styles.loadingRow}>
                  <MaterialCommunityIcons name="progress-clock" size={18} color={novaTheme.colors.accentHover} />
                  <Text style={styles.loadingText}>Searching…</Text>
                </View>
              ) : (
                <Text style={styles.resultsCount}>{results.length.toLocaleString()} results</Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                focusable
                accessibilityRole="button"
                accessibilityLabel={`Open ${searchHitKindLabel(item.kind)} ${item.title}`}
                onFocus={() => setFocusedResultId(searchHitKey(item))}
                onBlur={() => setFocusedResultId((current) => (current === searchHitKey(item) ? null : current))}
                onPress={() => handleSelectHit(item)}
                style={[styles.resultRow, focusedResultId === searchHitKey(item) && styles.resultRowFocused]}>
                <View style={[styles.resultBadge, badgeStyleForKind(item.kind)]}>
                  <Text style={styles.resultBadgeText}>{searchHitKindLabel(item.kind)}</Text>
                </View>
                <View style={styles.resultCopy}>
                  <Text numberOfLines={1} style={styles.resultTitle}>
                    {displayStreamTitle(item.title)}
                  </Text>
                  <Text numberOfLines={1} style={styles.resultSubtitle}>
                    {item.kind === 'movie'
                      ? [item.year, item.rating].filter(Boolean).join(' · ') || 'Movie'
                      : item.subtitle}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={novaTheme.colors.textMuted} />
              </Pressable>
            )}
          />
        )}
      </View>
    </NovaTvShell>
  );
}

function badgeStyleForKind(kind: ProviderSearchHit['kind']) {
  if (kind === 'movie') {
    return styles.resultBadgeMovie;
  }

  if (kind === 'series') {
    return styles.resultBadgeSeries;
  }

  return styles.resultBadgeLive;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    gap: 12,
  },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    paddingVertical: 10,
  },
  clearButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  inlinePanel: {
    flex: 1,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  inlineIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  inlineCopy: {
    maxWidth: 520,
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inlineNoticeText: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  resultsList: {
    paddingBottom: 24,
    gap: 8,
  },
  resultsCount: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  loadingText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  resultRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultRowFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  resultBadge: {
    minWidth: 62,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
  },
  resultBadgeMovie: {
    backgroundColor: 'rgba(59,130,246,0.16)',
  },
  resultBadgeSeries: {
    backgroundColor: 'rgba(168,85,247,0.16)',
  },
  resultBadgeLive: {
    backgroundColor: 'rgba(16,185,129,0.16)',
  },
  resultBadgeText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  resultTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  resultSubtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  stateCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
