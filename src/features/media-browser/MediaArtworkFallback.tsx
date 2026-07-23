import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';

type MediaArtworkFallbackProps = {
  title: string;
  kind?: 'movie' | 'series' | 'episode';
  subtitle?: string;
  compact?: boolean;
};

const KIND_LABELS = {
  movie: 'Movie',
  series: 'Series',
  episode: 'Episode',
} as const;

export function MediaArtworkFallback({ title, kind = 'movie', subtitle, compact = false }: MediaArtworkFallbackProps) {
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={[styles.canvas, compact && styles.canvasCompact]}>
      <View style={styles.frame}>
        <MaterialCommunityIcons
          name={kind === 'series' ? 'television-classic' : kind === 'episode' ? 'play-box-outline' : 'movie-open-outline'}
          size={compact ? 18 : 24}
          color={novaTheme.colors.textMuted}
        />
        <Text style={[styles.label, compact && styles.labelCompact]}>Artwork Unavailable</Text>
        {initials ? <Text style={[styles.initials, compact && styles.initialsCompact]}>{initials}</Text> : null}
        <Text numberOfLines={compact ? 1 : 2} style={[styles.title, compact && styles.titleCompact]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, compact && styles.subtitleCompact]}>
            {subtitle}
          </Text>
        ) : (
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{KIND_LABELS[kind]}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: '#0D1118',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  canvasCompact: {
    padding: 8,
  },
  frame: {
    width: '100%',
    flex: 1,
    borderRadius: novaTheme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  label: {
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  labelCompact: {
    fontSize: 8,
  },
  initials: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  initialsCompact: {
    fontSize: 20,
  },
  title: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 9,
  },
  subtitle: {
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitleCompact: {
    fontSize: 8,
  },
});
