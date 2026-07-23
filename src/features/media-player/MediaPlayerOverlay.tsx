import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';

import type { NextEpisodeCandidate } from './mediaPlayerTypes';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';

type MediaPlayerOverlayProps = {
  title: string;
  subtitle?: string;
  visible: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  onClose: () => void;
  onReveal: () => void;
  nextEpisodeCountdown?: {
    visible: boolean;
    secondsLeft: number;
    episodeTitle: string;
    onPlayNow: () => void;
    onCancel: () => void;
  };
  nextEpisode?: NextEpisodeCandidate | null;
  onPlayNextEpisode?: () => void;
};

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function MediaPlayerOverlay({
  title,
  subtitle,
  visible,
  isPlaying,
  positionMs,
  durationMs,
  onTogglePlay,
  onRewind,
  onForward,
  onClose,
  onReveal,
  nextEpisodeCountdown,
  nextEpisode,
  onPlayNextEpisode,
}: MediaPlayerOverlayProps) {
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const elapsed = formatTime(positionMs);
  const remaining = formatTime(Math.max(0, durationMs - positionMs));
  const displayTitle = displayStreamTitle(title);
  const displaySubtitle = subtitle ? displayStreamTitle(subtitle) : undefined;

  if (!visible) {
    return (
      <Pressable focusable hasTVPreferredFocus onFocus={onReveal} onPress={onReveal} style={styles.interactionLayer} />
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.topBar}>
        <View style={styles.titles}>
          <Text numberOfLines={1} style={styles.title}>
            {displayTitle}
          </Text>
          {displaySubtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {displaySubtitle}
            </Text>
          ) : null}
        </View>
        <Pressable focusable onPress={onClose} style={styles.closeButton}>
          <MaterialCommunityIcons name="close" size={18} color={novaTheme.colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.seekBlock}>
        <View style={styles.seekTrack}>
          <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{elapsed}</Text>
          <Text style={styles.timeText}>-{remaining}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable focusable onPress={onRewind} style={styles.controlButton}>
          <MaterialCommunityIcons name="rewind-10" size={22} color={novaTheme.colors.textPrimary} />
        </Pressable>
        <Pressable focusable hasTVPreferredFocus onPress={onTogglePlay} style={[styles.controlButton, styles.playButton]}>
          <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={26} color="#FFFFFF" />
        </Pressable>
        <Pressable focusable onPress={onForward} style={styles.controlButton}>
          <MaterialCommunityIcons name="fast-forward-30" size={22} color={novaTheme.colors.textPrimary} />
        </Pressable>
        {nextEpisode && onPlayNextEpisode ? (
          <Pressable focusable onPress={onPlayNextEpisode} style={styles.controlButton}>
            <MaterialCommunityIcons name="skip-next" size={22} color={novaTheme.colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      {nextEpisodeCountdown?.visible ? (
        <View style={styles.countdownPanel}>
          <Text style={styles.countdownTitle}>Up Next in {nextEpisodeCountdown.secondsLeft}</Text>
          <Text numberOfLines={1} style={styles.countdownEpisode}>
            {displayStreamTitle(nextEpisodeCountdown.episodeTitle)}
          </Text>
          <View style={styles.countdownActions}>
            <Pressable focusable onPress={nextEpisodeCountdown.onPlayNow} style={styles.countdownPrimary}>
              <Text style={styles.countdownPrimaryText}>Play Now</Text>
            </Pressable>
            <Pressable focusable onPress={nextEpisodeCountdown.onCancel} style={styles.countdownSecondary}>
              <Text style={styles.countdownSecondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  interactionLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    paddingBottom: 28,
    paddingTop: 18,
    backgroundColor: 'rgba(3,7,12,0.72)',
    gap: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  seekBlock: {
    gap: 6,
  },
  seekTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  seekFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: novaTheme.colors.accent,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  playButton: {
    minWidth: 56,
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: novaTheme.colors.accent,
  },
  countdownPanel: {
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(8,12,18,0.88)',
    padding: 14,
    gap: 8,
  },
  countdownTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  countdownEpisode: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  countdownActions: {
    flexDirection: 'row',
    gap: 8,
  },
  countdownPrimary: {
    minHeight: 40,
    borderRadius: novaTheme.radius.md,
    backgroundColor: novaTheme.colors.accent,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  countdownSecondary: {
    minHeight: 40,
    borderRadius: novaTheme.radius.md,
    backgroundColor: novaTheme.colors.surface,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownSecondaryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});
