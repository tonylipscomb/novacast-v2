/**
 * Stage 4.2M — Shared Media Detail Overlay Shell.
 * Guest popup on top of Movies/Series browse. No catalog/grid ownership.
 * Safe blur: intensity-only BlurView + dark scrim. Never native blur-target refs.
 */
import type { ComponentProps, ComponentType, ElementRef, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { MediaArtworkFallback } from '@/features/media-browser/MediaArtworkFallback';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';
import {
  MEDIA_DETAIL_OVERLAY_EXIT_MS,
  buildMediaDetailMetaParts,
  logDetailOverlayEvent,
} from './mediaDetailOverlayLogic.ts';
import type { MediaDetailAction, MediaDetailOverlayModel } from './mediaDetailOverlayTypes.ts';
import { MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER } from './mediaDetailOverlayTypes.ts';

const ENTER_MS = 180;

export type MediaDetailOverlayShellProps = {
  visible: boolean;
  model: MediaDetailOverlayModel | null;
  actions: MediaDetailAction[];
  loading?: boolean;
  error?: string | null;
  onRequestClose: () => void;
  initialFocusActionId?: string;
  /** Optional series seasons/episodes (or other media-specific body). */
  children?: ReactNode;
  testID?: string;
  traceId?: string;
};

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function resolveIcon(icon: string | undefined, primary: boolean): IconName {
  if (icon && typeof icon === 'string') {
    return icon as IconName;
  }
  return primary ? 'play' : 'circle-outline';
}

function ShellAction({
  action,
  preferred,
  selected,
  buttonRef,
  onFocus,
  onBlur,
}: {
  action: MediaDetailAction;
  preferred: boolean;
  selected: boolean;
  buttonRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const focusable = !action.disabled;
  const lastActivateAtRef = useRef(0);
  const activate = () => {
    if (!focusable) {
      return;
    }
    const now = Date.now();
    if (now - lastActivateAtRef.current < 400) {
      return;
    }
    lastActivateAtRef.current = now;
    action.onPress();
  };

  return (
    <Pressable
      ref={buttonRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={preferred && focusable}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={activate}
      {...(Platform.isTV ? { onClick: activate } : {})}
      style={[
        styles.action,
        action.primary && styles.actionPrimary,
        action.disabled && styles.actionDisabled,
        novaTvFocus.base,
        selected && novaTvFocus.active,
      ]}>
      <MaterialCommunityIcons
        name={resolveIcon(action.icon, Boolean(action.primary))}
        size={20}
        color={action.primary ? '#FFFFFF' : novaTheme.colors.textPrimary}
      />
      <Text
        style={[
          styles.actionLabel,
          action.primary && styles.actionLabelPrimary,
          action.disabled && styles.actionLabelDisabled,
        ]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

export function MediaDetailOverlayShell({
  visible,
  model,
  actions,
  loading = false,
  error = null,
  onRequestClose,
  initialFocusActionId,
  children,
  testID = 'media-detail-overlay-shell',
  traceId,
}: MediaDetailOverlayShellProps) {
  const { width, height } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const wasVisibleRef = useRef(false);
  const closeGuardRef = useRef(0);
  const actionRefs = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const [focusedActionId, setFocusedActionId] = useState<string | null>(null);
  const [closeFocused, setCloseFocused] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  const cardWidth = Math.min(Math.max(width * 0.72, 640), Math.min(width * 0.78, 1100));
  const cardHeight = Math.min(Math.max(height * 0.52, 360), 560);

  const title = model ? displayStreamTitle(model.title) || model.title : '';
  const metaParts = useMemo(
    () => (model ? buildMediaDetailMetaParts(model) : []),
    [model],
  );
  const primaryActionId =
    initialFocusActionId ??
    actions.find((action) => action.primary)?.id ??
    actions[0]?.id ??
    null;

  useEffect(() => {
    if (!visible) {
      if (wasVisibleRef.current) {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: MEDIA_DETAIL_OVERLAY_EXIT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.96,
            duration: MEDIA_DETAIL_OVERLAY_EXIT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      }
      wasVisibleRef.current = false;
      return;
    }

    const opening = !wasVisibleRef.current;
    wasVisibleRef.current = true;
    setPosterFailed(false);
    logDetailOverlayEvent('media_detail_overlay_open', {
      mediaType: model?.mediaType ?? null,
      mediaId: model?.id ?? null,
      traceId: traceId ?? null,
    });

    if (Platform.isTV) {
      opacity.setValue(1);
      scale.setValue(1);
    } else if (opening) {
      opacity.setValue(0);
      scale.setValue(0.96);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: ENTER_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: ENTER_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      opacity.setValue(1);
      scale.setValue(1);
    }
  }, [model?.id, model?.mediaType, opacity, scale, traceId, visible]);

  useEffect(() => {
    if (!visible || !primaryActionId) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) {
        return;
      }
      const target = actionRefs.current.get(primaryActionId);
      try {
        target?.focus?.();
      } catch {
        // Never crash the overlay for focus.
      }
    }, Platform.isTV ? 80 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [primaryActionId, visible, model?.id]);

  const requestClose = () => {
    const now = Date.now();
    if (now - closeGuardRef.current < 350) {
      return;
    }
    closeGuardRef.current = now;
    logDetailOverlayEvent('media_detail_overlay_close_requested', {
      mediaType: model?.mediaType ?? null,
      mediaId: model?.id ?? null,
      traceId: traceId ?? null,
    });
    onRequestClose();
  };

  if (!model) {
    return null;
  }

  if (!visible) {
    return null;
  }

  const reactNative = ReactNative as typeof ReactNative & {
    TVFocusGuideView?: typeof View;
  };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }>;

  return (
    <Animated.View
      testID={testID}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      pointerEvents="auto"
      style={[styles.root, { opacity }]}
      // Stage 4.2M marker kept for source tests.
      {...{ 'data-stage4m': MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER }}>
      {/* Safe blur: intensity-only. Never bind a native blur-target ref.
          Scrim always present so blur failure cannot gray-out or remove browse. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />

      <FocusBoundaryView
        style={styles.focusBoundary}
        {...(Platform.OS === 'android'
          ? { autoFocus: true, trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true }
          : {})}
        pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            {
              width: cardWidth,
              maxWidth: cardWidth,
              height: cardHeight,
              transform: [{ scale }],
            },
          ]}>
          {model.backdropUrl ? (
            <TvRemoteImage
              uri={model.backdropUrl}
              style={styles.cardBackdrop}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.cardGradient} pointerEvents="none" />

          <Pressable
            focusable
            hasTVPreferredFocus={false}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onFocus={() => setCloseFocused(true)}
            onBlur={() => setCloseFocused(false)}
            onPress={requestClose}
            {...(Platform.isTV ? { onClick: requestClose } : {})}
            style={[styles.closeButton, closeFocused && styles.closeButtonFocused]}>
            <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
          </Pressable>

          <View style={styles.contentRow}>
            <View style={styles.posterPanel}>
              {model.posterUrl && !posterFailed ? (
                <TvRemoteImage
                  uri={model.posterUrl}
                  style={styles.posterImage}
                  resizeMode="cover"
                  onError={() => setPosterFailed(true)}
                />
              ) : (
                <View style={styles.posterImage}>
                  <MediaArtworkFallback title={title} kind={model.mediaType} />
                </View>
              )}
            </View>

            <View style={styles.copyPanel}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {metaParts.length ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {metaParts.join('  ·  ')}
                </Text>
              ) : null}
              {model.description ? (
                <Text style={styles.description} numberOfLines={4}>
                  {model.description}
                </Text>
              ) : null}
              {loading ? (
                <Text style={styles.statusLine}>Loading details…</Text>
              ) : null}
              {error ? (
                <Text style={styles.errorLine} numberOfLines={2}>
                  {error}
                </Text>
              ) : null}

              <View style={styles.actionsRow}>
                {actions.map((action) => (
                  <ShellAction
                    key={action.id}
                    action={action}
                    preferred={action.id === primaryActionId}
                    selected={focusedActionId === action.id}
                    buttonRef={(instance) => {
                      if (instance) {
                        actionRefs.current.set(action.id, instance);
                      } else {
                        actionRefs.current.delete(action.id);
                      }
                    }}
                    onFocus={() => setFocusedActionId(action.id)}
                    onBlur={() => setFocusedActionId(null)}
                  />
                ))}
              </View>

              {children ? <View style={styles.extraBody}>{children}</View> : null}
            </View>
          </View>
        </Animated.View>
      </FocusBoundaryView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: novaTheme.safeArea.left,
    paddingVertical: novaTheme.safeArea.top,
  },
  scrim: {
    backgroundColor: 'rgba(4, 8, 14, 0.62)',
  },
  focusBoundary: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(12, 16, 24, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cardBackdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.42,
  },
  cardGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 10, 16, 0.72)',
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  closeButtonFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(59, 130, 246, 0.35)',
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 28,
    paddingVertical: 28,
    gap: 22,
  },
  posterPanel: {
    width: 168,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  posterImage: {
    width: '100%',
    height: '100%',
    minHeight: 240,
  },
  copyPanel: {
    flex: 1,
    minWidth: 0,
    paddingRight: 28,
    justifyContent: 'center',
    gap: 10,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  meta: {
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
  },
  description: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 640,
  },
  statusLine: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
  },
  errorLine: {
    color: novaTheme.colors.warning,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  actionPrimary: {
    backgroundColor: novaTheme.colors.accent,
    borderColor: novaTheme.colors.accentHover,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  actionLabelPrimary: {
    color: '#FFFFFF',
  },
  actionLabelDisabled: {
    color: novaTheme.colors.textMuted,
  },
  extraBody: {
    marginTop: 8,
    maxHeight: 160,
  },
});
