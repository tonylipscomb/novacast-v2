import {
  Component,
  type ComponentType,
  type ElementRef,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { BackHandler, findNodeHandle, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ReactNative from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import {
  buildResumeDialogNativeFocusProps,
  getResumeDialogInitialAction,
  logResumeFocus,
  type ResumeDialogAction,
} from './playbackResumeFocus.ts';
import {
  cancelPlaybackResumePrompt,
  describeResumePrompt,
  getPlaybackResumePrompt,
  resolvePlaybackResumePrompt,
  subscribePlaybackResumePrompt,
  type PlaybackResumePrompt,
} from './playbackResumeGate.ts';

type NativeFocusable = {
  focus?: () => void;
  setNativeProps?: (props: Record<string, number>) => void;
};

class ResumeDialogSafetyNet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    cancelPlaybackResumePrompt();
    console.info('[NovaCast Resume Gate]', 'dialog-unmounted', { action: 'error' });
  }

  render() {
    if (this.state.failed) {
      return null;
    }
    return this.props.children;
  }
}

function PlaybackResumeDialogView() {
  const prompt = useSyncExternalStore(subscribePlaybackResumePrompt, getPlaybackResumePrompt, getPlaybackResumePrompt);
  if (!prompt) {
    return null;
  }
  return <ResumeDialogBody key={`${prompt.mediaType}:${prompt.contentId}:${prompt.positionMs}`} prompt={prompt} />;
}

function applyResumeDialogNativeRouting(input: {
  resumeNode: NativeFocusable | null;
  restartNode: NativeFocusable | null;
  resumeHandle: number | null;
  restartHandle: number | null;
}) {
  const resumeProps = buildResumeDialogNativeFocusProps('resume', {
    resume: input.resumeHandle,
    restart: input.restartHandle,
  });
  const restartProps = buildResumeDialogNativeFocusProps('restart', {
    resume: input.resumeHandle,
    restart: input.restartHandle,
  });
  if (input.resumeHandle != null) {
    input.resumeNode?.setNativeProps?.({
      nextFocusLeft: resumeProps.nextFocusLeft ?? input.resumeHandle,
      nextFocusUp: resumeProps.nextFocusUp ?? input.resumeHandle,
      nextFocusRight: resumeProps.nextFocusRight ?? input.resumeHandle,
      nextFocusDown: resumeProps.nextFocusDown ?? input.resumeHandle,
    });
  }
  if (input.restartHandle != null) {
    input.restartNode?.setNativeProps?.({
      nextFocusLeft: restartProps.nextFocusLeft ?? input.restartHandle,
      nextFocusUp: restartProps.nextFocusUp ?? input.restartHandle,
      nextFocusRight: restartProps.nextFocusRight ?? input.restartHandle,
      nextFocusDown: restartProps.nextFocusDown ?? input.restartHandle,
    });
  }
}

function ResumeDialogBody({ prompt }: { prompt: PlaybackResumePrompt }) {
  const [focusedAction, setFocusedAction] = useState<ResumeDialogAction>(getResumeDialogInitialAction());
  const [preferResumeFocus, setPreferResumeFocus] = useState(true);
  const [guideDestinations, setGuideDestinations] = useState<object[]>([]);
  const [resumeHandle, setResumeHandle] = useState<number | null>(null);
  const [restartHandle, setRestartHandle] = useState<number | null>(null);
  const resumeRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const restartRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const resumeHandleRef = useRef<number | null>(null);
  const restartHandleRef = useRef<number | null>(null);
  const focusRequestedRef = useRef(false);
  const containedLoggedRef = useRef(false);

  const routeNativeFocus = useCallback(() => {
    applyResumeDialogNativeRouting({
      resumeNode: resumeRef.current as NativeFocusable | null,
      restartNode: restartRef.current as NativeFocusable | null,
      resumeHandle: resumeHandleRef.current,
      restartHandle: restartHandleRef.current,
    });
    if (resumeHandleRef.current != null && !containedLoggedRef.current) {
      containedLoggedRef.current = true;
      logResumeFocus('focus-contained', {
        action: 'resume',
        contentId: prompt.contentId,
        dialogOpen: true,
      });
      logResumeFocus('escape-blocked', {
        action: 'resume',
        contentId: prompt.contentId,
        dialogOpen: true,
      });
    }
  }, [prompt.contentId]);

  const bindResumeRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      resumeRef.current = instance;
      if (!instance) {
        return;
      }
      const handle = findNodeHandle(instance);
      resumeHandleRef.current = handle;
      setResumeHandle((current) => (current === handle ? current : handle));
      setGuideDestinations((current) => (current.includes(instance) ? current : [...current, instance]));
      routeNativeFocus();
    },
    [routeNativeFocus],
  );

  const bindRestartRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      restartRef.current = instance;
      if (!instance) {
        return;
      }
      const handle = findNodeHandle(instance);
      restartHandleRef.current = handle;
      setRestartHandle((current) => (current === handle ? current : handle));
      setGuideDestinations((current) => (current.includes(instance) ? current : [...current, instance]));
      routeNativeFocus();
    },
    [routeNativeFocus],
  );

  useEffect(() => {
    logResumeFocus('dialog-mounted', {
      action: getResumeDialogInitialAction(),
      contentId: prompt.contentId,
      dialogOpen: true,
    });
    if (!focusRequestedRef.current) {
      focusRequestedRef.current = true;
      logResumeFocus('initial-focus-requested', {
        action: 'resume',
        contentId: prompt.contentId,
        dialogOpen: true,
      });
      requestAnimationFrame(() => {
        try {
          (resumeRef.current as NativeFocusable | null)?.focus?.();
        } catch {
          // Native focus is best-effort; visual state is already Resume.
        }
      });
    }
    return () => {
      logResumeFocus('focus-restored', {
        contentId: prompt.contentId,
        returnTarget: 'movie-detail',
        dialogOpen: false,
      });
    };
  }, [prompt.contentId]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      logResumeFocus('back-consumed', {
        action: focusedAction,
        contentId: prompt.contentId,
        dialogOpen: true,
      });
      resolvePlaybackResumePrompt('cancel');
      return true;
    });
    return () => subscription.remove();
  }, [focusedAction, prompt.contentId]);

  const copy = describeResumePrompt(prompt);
  const reactNative = ReactNative as typeof ReactNative & { TVFocusGuideView?: typeof View };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
    autoFocus?: boolean;
    destinations?: object[];
  }>;
  const resumeFocusProps = buildResumeDialogNativeFocusProps('resume', {
    resume: resumeHandle,
    restart: restartHandle,
  });
  const restartFocusProps = buildResumeDialogNativeFocusProps('restart', {
    resume: resumeHandle,
    restart: restartHandle,
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      hardwareAccelerated
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => resolvePlaybackResumePrompt('cancel')}>
      <View
        style={styles.backdrop}
        pointerEvents="auto"
        focusable={false}
        accessibilityViewIsModal
        importantForAccessibility="yes">
        <FocusBoundaryView
          style={styles.card}
          {...(Platform.OS === 'android'
            ? {
                autoFocus: true,
                trapFocusLeft: true,
                trapFocusRight: true,
                trapFocusUp: true,
                trapFocusDown: true,
                ...(guideDestinations.length > 0 ? { destinations: guideDestinations } : {}),
              }
            : {})}>
          <Text style={styles.heading}>{copy.heading}</Text>
          <Text numberOfLines={2} style={styles.title}>
            {displayStreamTitle(prompt.title)}
          </Text>
          <Text style={styles.detail}>{copy.detail}</Text>
          <View style={styles.actions} focusable={false}>
            <Pressable
              ref={bindResumeRef}
              collapsable={false}
              focusable
              hasTVPreferredFocus={preferResumeFocus}
              accessibilityRole="button"
              accessibilityLabel={copy.resumeLabel}
              {...(Platform.OS === 'android' && resumeFocusProps.nextFocusLeft != null
                ? {
                    nextFocusLeft: resumeFocusProps.nextFocusLeft,
                    nextFocusUp: resumeFocusProps.nextFocusUp ?? resumeFocusProps.nextFocusLeft,
                    nextFocusRight: resumeFocusProps.nextFocusRight ?? resumeFocusProps.nextFocusLeft,
                    nextFocusDown: resumeFocusProps.nextFocusDown ?? resumeFocusProps.nextFocusLeft,
                  }
                : {})}
              onFocus={() => {
                setFocusedAction('resume');
                if (preferResumeFocus) {
                  setPreferResumeFocus(false);
                }
                logResumeFocus('resume-focused', { action: 'resume', contentId: prompt.contentId, dialogOpen: true });
              }}
              onBlur={() => {
                setFocusedAction((current) => (current === 'resume' ? current : current));
              }}
              onPress={() => resolvePlaybackResumePrompt('resume')}
              style={[styles.button, styles.primary, novaTvFocus.base, focusedAction === 'resume' && novaTvFocus.active]}>
              <Text style={styles.primaryText}>{copy.resumeLabel}</Text>
            </Pressable>
            <Pressable
              ref={bindRestartRef}
              collapsable={false}
              focusable
              accessibilityRole="button"
              accessibilityLabel={copy.restartLabel}
              {...(Platform.OS === 'android' && restartFocusProps.nextFocusRight != null
                ? {
                    nextFocusLeft: restartFocusProps.nextFocusLeft ?? restartFocusProps.nextFocusRight,
                    nextFocusUp: restartFocusProps.nextFocusUp ?? restartFocusProps.nextFocusRight,
                    nextFocusRight: restartFocusProps.nextFocusRight,
                    nextFocusDown: restartFocusProps.nextFocusDown ?? restartFocusProps.nextFocusRight,
                  }
                : {})}
              onFocus={() => {
                setFocusedAction('restart');
                logResumeFocus('restart-focused', { action: 'restart', contentId: prompt.contentId, dialogOpen: true });
              }}
              onBlur={() => {
                setFocusedAction((current) => (current === 'restart' ? current : current));
              }}
              onPress={() => resolvePlaybackResumePrompt('restart')}
              style={[styles.button, styles.secondary, novaTvFocus.base, focusedAction === 'restart' && novaTvFocus.active]}>
              <Text style={styles.secondaryText}>{copy.restartLabel}</Text>
            </Pressable>
          </View>
        </FocusBoundaryView>
      </View>
    </Modal>
  );
}

export function PlaybackResumeDialog() {
  return (
    <ResumeDialogSafetyNet>
      <PlaybackResumeDialogView />
    </ResumeDialogSafetyNet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3, 7, 12, 0.78)',
    padding: 36,
  },
  card: {
    width: 560,
    maxWidth: '86%',
    borderRadius: 18,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 28,
    paddingVertical: 26,
    gap: 10,
  },
  heading: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
  },
  detail: {
    color: novaTheme.colors.textSecondary,
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  button: {
    minWidth: 180,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: novaTheme.colors.accent,
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});
