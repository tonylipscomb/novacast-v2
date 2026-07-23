import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type ExitConfirmOverlayProps = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ExitConfirmOverlay({ visible, onCancel, onConfirm }: ExitConfirmOverlayProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState<'cancel' | 'exit'>('cancel');

  useEffect(() => {
    if (!visible) {
      return;
    }

    setFocused('cancel');
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });

    return () => subscription.remove();
  }, [onCancel, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Exit NovaCast?</Text>
          <Text style={styles.copy}>Are you sure you want to close the app?</Text>
          <View style={styles.actions}>
            <Pressable
              focusable
              hasTVPreferredFocus
              accessibilityRole="button"
              accessibilityLabel="Cancel exit"
              onFocus={() => setFocused('cancel')}
              onPress={onCancel}
              style={[styles.button, novaTvFocus.base, focused === 'cancel' && styles.buttonFocused]}>
              <Text style={[styles.buttonText, focused === 'cancel' && styles.buttonTextFocused]}>Cancel</Text>
            </Pressable>
            <Pressable
              focusable
              accessibilityRole="button"
              accessibilityLabel="Exit NovaCast"
              onFocus={() => setFocused('exit')}
              onPress={onConfirm}
              style={[styles.button, novaTvFocus.base, focused === 'exit' && styles.buttonFocused]}>
              <Text style={[styles.buttonText, focused === 'exit' && styles.buttonTextFocused]}>Exit</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Show exit confirm on Android TV back; call from Home / Portal root screens. */
export function useExitConfirmOnBack(enabled = true) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (visible) {
        return true;
      }
      setVisible(true);
      return true;
    });

    return () => subscription.remove();
  }, [enabled, visible]);

  return {
    visible,
    cancel: () => setVisible(false),
    confirm: () => {
      setVisible(false);
      BackHandler.exitApp();
    },
  };
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      paddingHorizontal: 48,
    },
    card: {
      width: '100%',
      maxWidth: 520,
      gap: 10,
      paddingHorizontal: 28,
      paddingVertical: 24,
      borderTopWidth: 2,
      borderBottomWidth: 2,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.backgroundRaised,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 22,
      fontWeight: '900',
    },
    copy: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    actions: {
      flexDirection: 'row',
      gap: 20,
      marginTop: 4,
    },
    button: {
      minHeight: 40,
      paddingHorizontal: 4,
      paddingVertical: 6,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
    },
    buttonFocused: {
      borderBottomColor: theme.scheme === 'light' ? theme.colors.focusRing : theme.colors.accentHover,
    },
    buttonText: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    buttonTextFocused: {
      color: theme.scheme === 'light' ? theme.colors.accent : theme.colors.accentHover,
    },
  });
}
