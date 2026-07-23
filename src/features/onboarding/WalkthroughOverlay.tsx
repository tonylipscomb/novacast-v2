import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import * as ReactNative from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

export type WalkthroughStep = {
  title: string;
  body: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

type WalkthroughOverlayProps = {
  visible: boolean;
  title: string;
  steps: WalkthroughStep[];
  onDismiss: () => void;
  onSkip: () => void;
  onDontShowAgain: () => void;
  onComplete: () => void;
  initialStepIndex?: number;
};

const reactNative = ReactNative as typeof ReactNative & {
  TVFocusGuideView?: typeof RNView;
};

const FocusGuide = (reactNative.TVFocusGuideView ?? View) as ComponentType<{
  children?: ReactNode;
  style?: unknown;
  autoFocus?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
}>;

export function WalkthroughOverlay({
  visible,
  title,
  steps,
  onDismiss,
  onDontShowAgain,
  onComplete,
  initialStepIndex = 0,
}: WalkthroughOverlayProps) {
  const [stepIndex, setStepIndex] = useState(initialStepIndex);
  const [focused, setFocused] = useState<string | null>(null);

  const clampedIndex = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const currentStep = steps[clampedIndex];
  const isLastStep = clampedIndex >= steps.length - 1;

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), steps.length - 1));
    },
    [steps.length],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    setStepIndex(initialStepIndex);
    setFocused('action');
  }, [initialStepIndex, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });

    return () => subscription.remove();
  }, [onDismiss, visible]);

  const dots = useMemo(() => steps.map((_, index) => index), [steps]);

  if (!visible || !currentStep) {
    return null;
  }

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent>
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        importantForAccessibility="yes">
        <View style={styles.scrim} pointerEvents="none" />
        <FocusGuide
          style={styles.anchor}
          autoFocus
          {...(Platform.OS === 'android'
            ? {
                trapFocusLeft: true,
                trapFocusRight: true,
                trapFocusUp: true,
                trapFocusDown: true,
              }
            : {})}>
          <View style={styles.pointer} />
          <View style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.stepPill}>
                STEP {clampedIndex + 1} OF {steps.length}
              </Text>
              <Pressable
                focusable
                onFocus={() => setFocused('close')}
                onBlur={() => setFocused((current) => (current === 'close' ? null : current))}
                onPress={onDontShowAgain}
                style={[styles.closeButton, novaTvFocus.base, focused === 'close' && novaTvFocus.active]}>
                <MaterialCommunityIcons name="close" size={17} color={novaTheme.colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.headerRow}>
              <View style={styles.iconChip}>
                <MaterialCommunityIcons name={currentStep.icon} size={18} color={novaTheme.colors.accentHover} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>{title}</Text>
                <Text style={styles.stepTitle}>{currentStep.title}</Text>
              </View>
            </View>

            <Text numberOfLines={3} style={styles.body}>
              {currentStep.body}
            </Text>

            <View style={styles.footer}>
              <View style={styles.dots}>
                {dots.map((index) => {
                  const active = index === clampedIndex;
                  const dotFocused = focused === `dot-${index}`;
                  return (
                    <Pressable
                      key={index}
                      focusable
                      onFocus={() => {
                        setFocused(`dot-${index}`);
                        goTo(index);
                      }}
                      onBlur={() => setFocused((current) => (current === `dot-${index}` ? null : current))}
                      onPress={() => goTo(index)}
                      style={[styles.dotHit, novaTvFocus.base, dotFocused && novaTvFocus.active]}>
                      <View style={[styles.dot, active && styles.dotActive]} />
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                focusable
                hasTVPreferredFocus={focused === 'action' || focused === null}
                onFocus={() => setFocused('action')}
                onBlur={() => setFocused((current) => (current === 'action' ? null : current))}
                onPress={() => {
                  if (isLastStep) {
                    onComplete();
                    return;
                  }
                  goTo(clampedIndex + 1);
                }}
                style={[styles.actionButton, novaTvFocus.base, focused === 'action' && novaTvFocus.active]}>
                <Text style={styles.actionLabel}>{isLastStep ? 'Got it' : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </FocusGuide>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: '22%',
    paddingRight: 48,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2,4,8,0.55)',
  },
  anchor: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 360,
  },
  pointer: {
    width: 16,
    height: 16,
    marginRight: -8,
    borderRadius: 3,
    backgroundColor: 'rgba(16,21,32,0.98)',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(131,180,255,0.5)',
    transform: [{ rotate: '45deg' }],
  },
  card: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(131,180,255,0.5)',
    backgroundColor: 'rgba(16,21,32,0.98)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stepPill: {
    color: novaTheme.colors.accentHover,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(59,130,246,0.14)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.3)',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: novaTheme.colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  stepTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,38,54,0.9)',
  },
  body: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dotHit: {
    paddingVertical: 6,
    paddingHorizontal: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  dotActive: {
    width: 16,
    backgroundColor: novaTheme.colors.accentHover,
  },
  actionButton: {
    minWidth: 88,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.45)',
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});
