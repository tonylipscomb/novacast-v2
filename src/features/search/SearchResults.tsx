import type { RefObject } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View, type View as ViewType } from 'react-native';

import { NovaFocusRow } from '@/components/nova/NovaFocusRow';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { searchResultKey } from './searchScopes';
import type { SearchResult } from './searchTypes';

type SearchResultsProps = {
  results: SearchResult[];
  focusedResultKey?: string | null;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  header?: React.ReactNode;
  emphasized?: boolean;
  focusUpHandle?: number;
  focusLeftHandle?: number;
  firstRowRef?: RefObject<ViewType | null>;
};

function kindLabel(type: SearchResult['type']) {
  switch (type) {
    case 'movie':
      return 'Movie';
    case 'series':
      return 'Series';
    case 'live':
      return 'Live';
    case 'guide':
      return 'Guide';
    default:
      return 'Result';
  }
}

function subtitleForResult(result: SearchResult) {
  if (result.type === 'movie') {
    return [result.year, result.rating].filter(Boolean).join(' · ') || 'Movie';
  }

  if (result.type === 'series') {
    return [result.year, result.rating].filter(Boolean).join(' · ') || 'Series';
  }

  if (result.type === 'live') {
    return result.currentProgram ?? result.subtitle ?? 'Live channel';
  }

  const timeParts: string[] = [];
  if (result.startsAt) {
    timeParts.push(new Date(result.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  }
  if (result.endsAt) {
    timeParts.push(new Date(result.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  }

  const statusLabel = result.status ? result.status.toUpperCase() : undefined;
  return [result.channelName, statusLabel, timeParts.join(' – ')].filter(Boolean).join(' · ');
}

export function SearchResults({
  results,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  header,
  emphasized = false,
  focusUpHandle,
  focusLeftHandle,
  firstRowRef,
}: SearchResultsProps) {
  return (
    <View style={styles.list}>
      {header}
      {results.map((result, index) => {
        const key = searchResultKey(result);
        return (
          <NovaFocusRow
            key={key}
            title={displayStreamTitle(result.title)}
            subtitle={subtitleForResult(result)}
            meta={kindLabel(result.type)}
            nativeRef={index === 0 ? firstRowRef : undefined}
            nextFocusUp={index === 0 ? focusUpHandle : undefined}
            nextFocusLeft={index === 0 ? focusLeftHandle : undefined}
            onFocus={() => onFocusResult?.(key)}
            onPress={() => onSelectResult(result)}
            accessibilityLabel={`Open ${kindLabel(result.type)} ${result.title}`}
            trailing={<MaterialCommunityIcons name="chevron-right" size={18} color={novaTheme.colors.textMuted} />}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: 8,
  },
});
