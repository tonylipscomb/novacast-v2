import type { MediaDetail } from '@/features/media-browser/mediaTypes';
import type { MovieSummary } from '@/features/movies/movieTypes';
import { COMPLETED_PROGRESS_PERCENT, isResumeEligible } from '@/features/playback/continuity/playbackContinuity';

export type StreamQualityBadge = {
  id: string;
  label: string;
  kind: 'resolution' | 'hdr' | 'audio' | 'format';
};

export type RelatedMovieCandidate = Pick<
  MovieSummary,
  'id' | 'title' | 'posterUrl' | 'genres' | 'year' | 'rating' | 'posterStyleKey' | 'categoryId'
>;

/** Stage 4.2B compact card contracts — readable from 8–12 feet on TV. */
export const MOVIE_DETAIL_TITLE_MAX_LINES = 2;
export const MOVIE_DETAIL_SYNOPSIS_MAX_LINES = 3;
export const MOVIE_DETAIL_RELATED_LIMIT = 5;
export const MOVIE_DETAIL_CAST_LIMIT = 3;
export const MOVIE_DETAIL_GENRE_LIMIT = 3;
export const MOVIE_DETAIL_OPEN_MS = 160;
export const MOVIE_DETAIL_CLOSE_MS = 120;
export const MOVIE_DETAIL_BLUR_MS = 150;
export const MOVIE_DETAIL_FOCUS_MS = 110;
/** Hide related row below this window height to avoid vertical overflow. */
export const MOVIE_DETAIL_RELATED_MIN_HEIGHT = 700;

/**
 * Derive display badges from already-loaded detail/summary fields.
 * Never invents quality metadata that is not present in text signals.
 */
export function deriveStreamQualityBadges(input: {
  title?: string | null;
  containerExtension?: string | null;
  audio?: string | null;
  synopsis?: string | null;
}): StreamQualityBadge[] {
  const haystack = [input.title, input.containerExtension, input.audio, input.synopsis]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  const badges: StreamQualityBadge[] = [];
  const push = (badge: StreamQualityBadge) => {
    if (!badges.some((item) => item.id === badge.id)) {
      badges.push(badge);
    }
  };

  if (/\b(8K|4320P)\b/.test(haystack)) {
    push({ id: '8k', label: '8K', kind: 'resolution' });
  } else if (/\b(4K|UHD|2160P)\b/.test(haystack)) {
    push({ id: '4k', label: '4K', kind: 'resolution' });
  } else if (/\b(1080P|FHD)\b/.test(haystack)) {
    push({ id: '1080p', label: '1080p', kind: 'resolution' });
  } else if (/\b(720P|HD)\b/.test(haystack)) {
    push({ id: '720p', label: '720p', kind: 'resolution' });
  }

  if (/\bDOLBY[.\s-]?VISION\b|\bDV\b/.test(haystack)) {
    push({ id: 'dolby-vision', label: 'Dolby Vision', kind: 'hdr' });
  } else if (/\bHDR10\+?\b|\bHDR\b/.test(haystack)) {
    push({ id: 'hdr', label: 'HDR', kind: 'hdr' });
  }

  if (/\bDOLBY[.\s-]?ATMOS\b|\bATMOS\b/.test(haystack)) {
    push({ id: 'atmos', label: 'Atmos', kind: 'audio' });
  } else if (/\bDTS[.\s-]?X\b/.test(haystack)) {
    push({ id: 'dts-x', label: 'DTS:X', kind: 'audio' });
  } else if (/\bDTS[.\s-]?HD\b/.test(haystack)) {
    push({ id: 'dts-hd', label: 'DTS-HD', kind: 'audio' });
  }

  const ext = (input.containerExtension ?? '').trim().toLowerCase().replace(/^\./, '');
  if (ext && ['mkv', 'mp4', 'ts', 'm3u8', 'mov'].includes(ext)) {
    push({ id: `fmt-${ext}`, label: ext.toUpperCase(), kind: 'format' });
  }

  return badges.slice(0, 4);
}

export function formatMovieRating(value?: number | string | null): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value.toFixed(1);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed.toFixed(1);
    }
    return trimmed;
  }
  return undefined;
}

export function formatRuntimeDisplay(value?: string | number | null): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const minutes = Math.round(value);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return formatRuntimeDisplay(Number(trimmed));
  }
  return trimmed;
}

export function formatReleaseYear(value?: string | number | null): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1800) {
    return String(Math.round(value));
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? trimmed;
}

export function formatMaturityRating(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatDirectorLine(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? `Dir. ${trimmed}` : undefined;
}

export function formatAudioLine(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build truthy metadata chips only — never emits empty / null / N/A placeholders.
 */
export function buildMovieDetailMetaChips(input: {
  year?: string | number | null;
  runtime?: string | number | null;
  contentRating?: string | null;
  rating?: number | string | null;
  director?: string | null;
  audio?: string | null;
}): string[] {
  const chips = [
    formatReleaseYear(input.year),
    formatRuntimeDisplay(input.runtime),
    formatMaturityRating(input.contentRating),
    formatMovieRating(input.rating) ? `${formatMovieRating(input.rating)}★` : undefined,
    formatDirectorLine(input.director),
    formatAudioLine(input.audio),
  ].filter((chip): chip is string => Boolean(chip && chip.trim()));
  return chips;
}

export function joinMetaChips(chips: string[], separator = '  ·  '): string {
  return chips.filter((chip) => chip.trim().length > 0).join(separator);
}

export function resolveContinueWatchingLabel(
  progressPercent?: number | null,
  positionMs?: number | null,
  durationMs?: number | null,
): string {
  if (typeof positionMs === 'number' && typeof durationMs === 'number' && durationMs > 0) {
    return isResumeEligible(positionMs, durationMs) ? 'Resume' : 'Play';
  }
  if (typeof progressPercent === 'number' && progressPercent > 0 && progressPercent < COMPLETED_PROGRESS_PERCENT) {
    return 'Resume';
  }
  return 'Play';
}

export function resolveContinueWatchingProgress(progressPercent?: number | null): number | null {
  if (typeof progressPercent !== 'number' || !Number.isFinite(progressPercent)) {
    return null;
  }
  if (progressPercent <= 0 || progressPercent >= COMPLETED_PROGRESS_PERCENT) {
    return null;
  }
  return Math.max(1, Math.min(99, Math.round(progressPercent)));
}

function genreOverlapScore(left: string[] | undefined, right: string[] | undefined): number {
  if (!left?.length || !right?.length) {
    return 0;
  }
  const rightSet = new Set(right.map((genre) => genre.trim().toLowerCase()).filter(Boolean));
  let score = 0;
  for (const genre of left) {
    if (rightSet.has(genre.trim().toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

/**
 * Related titles from already-cached browse/search rows — no network.
 * Prefers shared genres, then same category, then nearby browse order.
 */
export function selectRelatedMovies(
  selected: RelatedMovieCandidate | null | undefined,
  candidates: RelatedMovieCandidate[],
  limit = MOVIE_DETAIL_RELATED_LIMIT,
): RelatedMovieCandidate[] {
  if (!selected || !candidates.length || limit <= 0) {
    return [];
  }

  const selectedIndex = candidates.findIndex((item) => item.id === selected.id);
  const scored = candidates
    .filter((item) => item.id !== selected.id)
    .map((item, index) => {
      const genreScore = genreOverlapScore(selected.genres, item.genres);
      const categoryScore = item.categoryId && item.categoryId === selected.categoryId ? 1 : 0;
      const proximity =
        selectedIndex >= 0 ? Math.max(0, 8 - Math.abs(selectedIndex - (candidates.indexOf(item) || index))) : 0;
      return {
        item,
        score: genreScore * 10 + categoryScore * 3 + proximity,
      };
    })
    .filter((entry) => entry.score > 0 || candidates.length > 1)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title));

  const unique: RelatedMovieCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of scored) {
    if (seen.has(entry.item.id)) continue;
    seen.add(entry.item.id);
    unique.push(entry.item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function heroBackdropUri(detail: Pick<MediaDetail, 'backdropUrl' | 'posterUrl'> | null | undefined) {
  return detail?.backdropUrl?.trim() || detail?.posterUrl?.trim() || null;
}

/** Concise non-focusable cast line for the compact card. */
export function formatCastLine(
  cast: Array<{ name?: string | null }> | null | undefined,
  limit = MOVIE_DETAIL_CAST_LIMIT,
): string | undefined {
  if (!cast?.length) return undefined;
  const names = cast
    .map((member) => member.name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, limit);
  if (!names.length) return undefined;
  return `Cast: ${names.join(' • ')}`;
}

export function resolveTitleFontSize(windowWidth: number): number {
  if (windowWidth >= 1800) return 36;
  if (windowWidth >= 1400) return 32;
  if (windowWidth >= 1100) return 28;
  if (windowWidth >= 900) return 26;
  return 22;
}

/** Compact card width/height within TV-safe margins. */
export function resolveCompactDetailCardSize(windowWidth: number, windowHeight: number) {
  const width = Math.min(Math.round(windowWidth * 0.78), 1480);
  const height = Math.min(Math.round(windowHeight * 0.72), Math.round(windowHeight * 0.88));
  return { width, height };
}

export function shouldShowCompactRelatedRow(windowHeight: number): boolean {
  return windowHeight >= MOVIE_DETAIL_RELATED_MIN_HEIGHT;
}
