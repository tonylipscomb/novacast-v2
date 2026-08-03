import type { MediaDetail } from '@/features/media-browser/mediaTypes';
import type { MovieSummary } from '@/features/movies/movieTypes';

export type StreamQualityBadge = {
  id: string;
  label: string;
  kind: 'resolution' | 'hdr' | 'audio' | 'format';
};

export type RelatedMovieCandidate = Pick<
  MovieSummary,
  'id' | 'title' | 'posterUrl' | 'genres' | 'year' | 'rating' | 'posterStyleKey' | 'categoryId'
>;

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

export function resolveContinueWatchingLabel(progressPercent?: number | null): string {
  if (typeof progressPercent === 'number' && progressPercent > 0 && progressPercent < 90) {
    return 'Resume';
  }
  return 'Play';
}

export function resolveContinueWatchingProgress(progressPercent?: number | null): number | null {
  if (typeof progressPercent !== 'number' || !Number.isFinite(progressPercent)) {
    return null;
  }
  if (progressPercent <= 0 || progressPercent >= 90) {
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
  limit = 12,
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
