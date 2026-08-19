import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { createNovaTvFocusChrome, createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import {
  discoverZoneRailTitle,
  discoverZoneRails,
  type DiscoverZoneItem,
  type DiscoverZoneScope,
} from './discoverZoneModel';
import { canOpenDiscoverZoneDetail, isSafeDiscoverZoneArtworkUrl } from './discoverZoneHydration';
import { useDiscoverZone } from './useDiscoverZone';

type DiscoverZoneOverlayProps = {
  visible: boolean;
  providerId: string;
  scope: DiscoverZoneScope;
  onClose: () => void;
  onSelectItem: (item: DiscoverZoneItem) => void;
  retainMounted?: boolean;
  restoreFocusItemId?: string | null;
  onRestoreFocusHandled?: () => void;
};

export function DiscoverZoneOverlay({
  visible,
  providerId,
  scope,
  onClose,
  onSelectItem,
  retainMounted = false,
  restoreFocusItemId = null,
  onRestoreFocusHandled,
}: DiscoverZoneOverlayProps) {
  if (!visible && !retainMounted) {
    return null;
  }

  return (
    <DiscoverZoneOverlayContent
      visible={visible}
      providerId={providerId}
      scope={scope}
      onClose={onClose}
      onSelectItem={onSelectItem}
      restoreFocusItemId={restoreFocusItemId}
      onRestoreFocusHandled={onRestoreFocusHandled}
    />
  );
}

function DiscoverZoneOverlayContent({
  visible,
  providerId,
  scope,
  onClose,
  onSelectItem,
  restoreFocusItemId,
  onRestoreFocusHandled,
}: Omit<DiscoverZoneOverlayProps, 'retainMounted'>) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const snapshot = useDiscoverZone(providerId, scope, true);
  const rails = discoverZoneRails(snapshot);
  const [closeFocused, setCloseFocused] = useState(false);
  const focusChrome = useMemo(() => createNovaTvFocusChrome(theme), [theme]);
  const posterRefs = useRef(new Map<string, View | null>());

  useEffect(() => {
    if (!visible) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, visible]);

  useEffect(() => {
    if (!visible || !restoreFocusItemId) {
      return;
    }
    const node = posterRefs.current.get(restoreFocusItemId);
    const focusable = node as { focus?: () => void } | undefined;
    focusable?.focus?.();
    onRestoreFocusHandled?.();
  }, [onRestoreFocusHandled, restoreFocusItemId, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>PERSONALIZATION</Text>
              <Text style={styles.title}>Discover Zone</Text>
            </View>
            <Pressable
              focusable
              hasTVPreferredFocus={rails.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Close Discover Zone"
              onFocus={() => setCloseFocused(true)}
              onBlur={() => setCloseFocused(false)}
              onPress={onClose}
              style={[styles.closeButton, focusChrome.base, closeFocused && focusChrome.active]}>
              <MaterialCommunityIcons name="close" size={18} color={theme.colors.textPrimary} />
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>

          {rails.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="compass-outline" size={36} color={theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyCopy}>
                {scope === 'live'
                  ? 'Favorite a channel from Live TV or the Guide, then it will appear here.'
                  : 'Favorite or add titles to your Watchlist from a title’s detail screen.'}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
              {rails.map(([rail, items]) => (
                <View key={rail} style={styles.rail}>
                  <Text style={styles.railTitle}>{discoverZoneRailTitle(scope, rail)}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
                    {items.map((item, index) => (
                      <DiscoverZonePoster
                        key={`${rail}-${item.id}`}
                        item={item}
                        preferredFocus={
                          restoreFocusItemId
                            ? restoreFocusItemId === item.id
                            : index === 0 && rail === rails[0][0]
                        }
                        onFocusableNode={(node) => {
                          if (node) {
                            posterRefs.current.set(item.id, node);
                          } else {
                            posterRefs.current.delete(item.id);
                          }
                        }}
                        onPress={() => {
                          if (!canOpenDiscoverZoneDetail(item)) {
                            return;
                          }
                          onSelectItem(item);
                        }}
                      />
                    ))}
                  </ScrollView>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function DiscoverZonePoster({
  item,
  preferredFocus,
  onFocusableNode,
  onPress,
}: {
  item: DiscoverZoneItem;
  preferredFocus?: boolean;
  onFocusableNode?: (node: View | null) => void;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const focusChrome = useMemo(() => createNovaTvFocusChrome(theme), [theme]);

  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  const showPosterArt = isSafeDiscoverZoneArtworkUrl(item.artworkUrl);

  return (
    <Pressable
      ref={(node) => onFocusableNode?.(node)}
      focusable
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.poster, focusChrome.base, focused && focusChrome.active]}>
      {showPosterArt ? (
        <TvRemoteImage uri={item.artworkUrl} style={styles.posterImage} />
      ) : (
        <View style={styles.posterFallback}>
          {initials ? (
            <Text style={styles.posterFallbackText}>{initials}</Text>
          ) : (
            <MaterialCommunityIcons name="image-off-outline" size={28} color={theme.colors.textMuted} />
          )}
        </View>
      )}
      <Text numberOfLines={2} style={[styles.posterTitle, focused && styles.posterTitleFocused]}>
        {item.title}
      </Text>
    </Pressable>
  );
}

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(4, 8, 14, 0.78)',
      justifyContent: 'center',
      padding: 28,
    },
    panel: {
      flex: 1,
      maxHeight: '92%',
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      padding: 22,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    kicker: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 28,
      fontWeight: '800',
    },
    closeButton: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
    },
    closeText: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      gap: 22,
      paddingBottom: 12,
    },
    rail: {
      gap: 10,
    },
    railTitle: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    railRow: {
      gap: 12,
      paddingVertical: 4,
    },
    poster: {
      width: 128,
      padding: 6,
    },
    posterImage: {
      width: 116,
      height: 168,
      borderRadius: 8,
      backgroundColor: theme.colors.background,
    },
    posterFallback: {
      width: 116,
      height: 168,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.background,
    },
    posterFallbackText: {
      color: theme.colors.textMuted,
      fontSize: 22,
      fontWeight: '800',
    },
    posterTitle: {
      marginTop: 8,
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    posterTitleFocused: focusText.title,
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      color: theme.colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
    emptyCopy: {
      color: theme.colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
}
