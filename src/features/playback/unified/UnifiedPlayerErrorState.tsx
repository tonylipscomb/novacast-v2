import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  setUnifiedRemoteFocusedControl,
} from './unifiedRemoteDebug.ts';

type UnifiedPlayerErrorStateProps = {
  message: string;
  onRetry: () => void;
  onBack: () => void;
};

export function UnifiedPlayerErrorState({ message, onRetry, onBack }: UnifiedPlayerErrorStateProps) {
  const [focusedControl, setFocusedControl] = useState<'retry' | 'back' | null>('retry');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Playback issue</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <Pressable
          focusable
          hasTVPreferredFocus
          onFocus={() => {
            setFocusedControl('retry');
            setUnifiedRemoteFocusedControl('error-retry');
          }}
          onBlur={() => setFocusedControl((current) => (current === 'retry' ? null : current))}
          onPress={() => {
            if (isUnifiedRemoteDebugEnabled()) {
              logUnifiedRemoteEvent({
                source: 'error-state-onPress',
                eventType: 'press',
                disposition: 'accepted',
                actionTaken: 'retry-playback',
                controlId: 'error-retry',
              });
            }
            onRetry();
          }}
          style={[styles.primaryButton, novaTvFocus.base, focusedControl === 'retry' && novaTvFocus.active]}>
          <Text style={styles.primaryText}>Retry</Text>
        </Pressable>
        <Pressable
          focusable
          onFocus={() => {
            setFocusedControl('back');
            setUnifiedRemoteFocusedControl('error-back');
          }}
          onBlur={() => setFocusedControl((current) => (current === 'back' ? null : current))}
          onPress={() => {
            if (isUnifiedRemoteDebugEnabled()) {
              logUnifiedRemoteEvent({
                source: 'error-state-onPress',
                eventType: 'press',
                disposition: 'accepted',
                actionTaken: 'close-playback',
                controlId: 'error-back',
              });
            }
            onBack();
          }}
          style={[styles.secondaryButton, novaTvFocus.base, focusedControl === 'back' && novaTvFocus.active]}>
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  message: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 0,
    backgroundColor: novaTheme.colors.accent,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 0,
    backgroundColor: 'rgba(18,24,34,0.88)',
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
});
