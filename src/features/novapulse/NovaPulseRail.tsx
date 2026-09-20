import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ReactNative from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useRef, useState } from 'react';

import { useAppTheme } from '@/theme/AppThemeProvider';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { recordNovaPulseEvent } from './novaPulseAnalytics';
import { NovaPulseCard, type NovaPulseArtworkDiagnostics, type NovaPulseArtworkStatus } from './NovaPulseCard';
import { useNovaPulse } from './useNovaPulse';
import type { NovaPulseItem } from './novaPulseTypes';

type NovaPulseRailProps = {
  items: readonly NovaPulseItem[];
  onAction?: (item: NovaPulseItem) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocusHandle?: (handle: number | null) => void;
  onArtworkStatus?: (item: NovaPulseItem, status: NovaPulseArtworkStatus, diagnostics?: NovaPulseArtworkDiagnostics) => void;
};

export function NovaPulseRail({ items, onAction, nextFocusUp, nextFocusDown, onFocusHandle, onArtworkStatus }: NovaPulseRailProps) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);
  const pulse = useNovaPulse({ items, onAction, onEvent: recordNovaPulseEvent });
  const [cardHandle, setCardHandle] = useState<number | null>(null);
  const lastDirectionalInputRef = useRef<{ direction: 'left' | 'right'; at: number } | null>(null);
  const moveDirectional = (direction: 'left' | 'right') => {
    const now = Date.now();
    const previous = lastDirectionalInputRef.current;
    if (previous && previous.direction === direction && now - previous.at < 80) return;
    lastDirectionalInputRef.current = { direction, at: now };
    if (direction === 'left') pulse.previous();
    else pulse.next();
  };
  const reactNativeTv = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: { eventType?: string }) => void) => void;
  };
  const useTVEventHandler = reactNativeTv.useTVEventHandler ?? ((_handler: (event: { eventType?: string }) => void) => {});
  useTVEventHandler((event: { eventType?: string }) => {
    if (!pulse.focused || items.length <= 1) return;
    if (event.eventType === 'left' || event.eventType === 'arrowleft' || event.eventType === 'swipeLeft') moveDirectional('left');
    if (event.eventType === 'right' || event.eventType === 'arrowright' || event.eventType === 'swipeRight') moveDirectional('right');
  });
  if (!pulse.item) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}><View><Text style={styles.kicker}>NOVAPULSE</Text><Text style={styles.heading}>Featured for you</Text></View><Text style={styles.counter}>{pulse.index + 1} / {items.length}</Text></View>
      <NovaPulseCard
        item={pulse.item}
        onFocus={() => pulse.setFocus(true)}
        onBlur={() => pulse.setFocus(false)}
        onPress={pulse.activate}
        onFocusHandle={(handle) => { setCardHandle(handle); onFocusHandle?.(handle); }}
        nextFocusUp={nextFocusUp}
        nextFocusDown={nextFocusDown}
        nextFocusLeft={cardHandle ?? undefined}
        nextFocusRight={cardHandle ?? undefined}
        onDirectionalInput={moveDirectional}
        onArtworkStatus={(status, diagnostics) => onArtworkStatus?.(pulse.item!, status, diagnostics)}
      />
      {pulse.canRotate ? <View style={styles.footer}><View style={styles.dots}>{items.map((item, index) => <View key={item.id} style={[styles.dot, index === pulse.index && styles.dotActive]} />)}</View><Text style={styles.hint}><MaterialCommunityIcons name="arrow-left-right" size={15} color={theme.colors.textMuted} /> LEFT / RIGHT to browse</Text></View> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    section: { width: '100%', paddingHorizontal: 18, paddingTop: 4, paddingBottom: 5 },
    header: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kicker: { color: theme.colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
    heading: { color: theme.colors.textPrimary, fontSize: 21, fontWeight: '900', marginTop: 1 },
    counter: { alignSelf: 'flex-start', marginTop: 2, color: theme.colors.textMuted, fontSize: 13, fontWeight: '800' },
    footer: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dots: { flexDirection: 'row', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: NOVA_GLASS.subtle.borderColor },
    dotActive: { width: 22, backgroundColor: theme.colors.accent, shadowColor: theme.colors.accent, shadowOpacity: 0.65, shadowRadius: 5, elevation: 3 },
    hint: { color: 'rgba(225, 228, 255, 0.58)', fontSize: 12, fontWeight: '700' },
  });
}
