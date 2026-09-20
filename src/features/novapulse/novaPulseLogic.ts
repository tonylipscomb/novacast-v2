import type { NovaPulseAction, NovaPulseItem, NovaPulseSportsData } from './novaPulseTypes';

export function nextNovaPulseIndex(length: number, currentIndex: number, direction: -1 | 1) {
  if (length <= 1) return 0;
  return (currentIndex + direction + length) % length;
}

export function canNovaPulseAutoRotate(length: number, focused: boolean) {
  return length > 1 && !focused;
}

export function resolveNovaPulseAction(item: NovaPulseItem): NovaPulseAction | null {
  const action = item.action;
  if (!action || action.type === 'none' || !action.target?.trim()) return null;
  return action;
}

export function formatNovaPulseStart(startsAt?: string, now = Date.now()) {
  if (!startsAt) return null;
  const difference = Date.parse(startsAt) - now;
  if (!Number.isFinite(difference) || difference <= 0) return 'Starting soon';
  const minutes = Math.max(1, Math.round(difference / 60_000));
  if (minutes < 60) return `Starts in ${minutes}m`;
  return `Starts in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatNovaPulseUpcomingStatus(startsAt?: string, now = Date.now()) {
  if (!startsAt) return 'UPCOMING';
  const start = new Date(startsAt);
  const current = new Date(now);
  if (!Number.isFinite(start.getTime())) return 'UPCOMING';
  if (start.getFullYear() === current.getFullYear() && start.getMonth() === current.getMonth() && start.getDate() === current.getDate()) return 'TONIGHT';
  const tomorrow = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  if (start.getFullYear() === tomorrow.getFullYear() && start.getMonth() === tomorrow.getMonth() && start.getDate() === tomorrow.getDate()) return 'TOMORROW';
  return 'UPCOMING';
}

export function formatNovaPulseEventTime(startsAt?: string) {
  if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return null;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(startsAt)).toUpperCase();
}

export function formatNovaPulseCountdown(startsAt?: string, now = Date.now()) {
  return formatNovaPulseStart(startsAt, now) ?? 'Starts soon';
}

export function formatNovaPulseStage(stage?: string) {
  const value = stage?.trim();
  if (!value || /^\d+(?:\.\d+)?$/.test(value)) return null;
  const normalized = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getNovaPulseTeamInitials(name?: string) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return '—';
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

const NOVA_PULSE_PROVIDER_PREFIX = /^(?:(?:4K|UHD|FHD|HD|SD|AMZ|NF|DSNP|HMAX|ATVP|HULU|WEB-DL|WEBRIP)(?:\s*[-|:•]\s*|\s+))+/i;
const NOVA_PULSE_TOP_PREFIX = /^TOP\s*[-|:•]\s*/;

/** Presentation-only cleanup; provider/catalog values remain unchanged. */
export function sanitizeNovaPulseDisplayTitle(title?: string) {
  const original = title?.trim() ?? '';
  if (!original) return '';
  const withoutYear = original.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
  const withoutQualityPrefix = withoutYear.replace(NOVA_PULSE_PROVIDER_PREFIX, '').trim();
  return withoutQualityPrefix.replace(NOVA_PULSE_TOP_PREFIX, '').trim() || withoutQualityPrefix || withoutYear;
}

export function getNovaPulseDisplayYear(value?: number, now = new Date()) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  const year: number = value;
  const currentYear = now.getFullYear();
  return year >= 1888 && year <= currentYear + 2 ? year : undefined;
}

export function normalizeNovaPulseGenres(genres?: readonly string[]) {
  const generic = new Set(['movies', 'movie', 'series', 'tv shows', 'tv', 'vod']);
  const normalized: string[] = [];
  for (const value of genres ?? []) {
    const parts = value.split(/[,/•]+/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const key = part.toLocaleLowerCase();
      if (!generic.has(key) && !normalized.some((entry) => entry.toLocaleLowerCase() === key)) {
        normalized.push(part);
      }
      if (normalized.length === 2) return normalized;
    }
  }
  return normalized;
}

export function resolveNovaPulseDescription(input: {
  overview?: string;
  plot?: string;
  description?: string;
  cachedDescription?: string;
}, fallback = '') {
  return [input.overview, input.plot, input.description, input.cachedDescription]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value)) ?? fallback;
}

export function buildNovaPulseCandidateSignature(items: readonly {
  id: string;
  title?: string;
  description?: string;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: string | number;
  year?: string | number;
}[]) {
  return items.map((item) => [
    item.id,
    item.title ?? '',
    item.description ?? '',
    item.posterUrl ?? '',
    item.backdropUrl ?? '',
    item.rating ?? '',
    item.year ?? '',
  ].join('~')).join('|');
}

export function describeNovaPulseArtwork(value?: string) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { present: false, scheme: 'unknown' as const, hostPresent: false };
  }
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      return { present: true, scheme, hostPresent: Boolean(new URL(trimmed).hostname) };
    } catch {
      return { present: true, scheme, hostPresent: false };
    }
  }
  if (trimmed.startsWith('//')) {
    try {
      return { present: true, scheme: 'protocol-relative' as const, hostPresent: Boolean(new URL(`https:${trimmed}`).hostname) };
    } catch {
      return { present: true, scheme: 'protocol-relative' as const, hostPresent: false };
    }
  }
  if (trimmed.startsWith('/')) {
    return { present: true, scheme: 'relative' as const, hostPresent: false };
  }
  return { present: true, scheme: 'unknown' as const, hostPresent: false };
}

/** Compact team label for the constrained matchup columns. */
export function formatNovaPulseTeamLabel(name?: string) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length <= 1) return words[0] ?? 'Competitor';
  return words.length >= 3 ? words.slice(-2).join(' ') : words[words.length - 1];
}

export function formatNovaPulseCatalogMeta(item: NovaPulseItem) {
  const genres = normalizeNovaPulseGenres(item.genres);
  const validYear = getNovaPulseDisplayYear(item.year);
  const parts = [validYear ? String(validYear) : null, ...genres];
  if (item.runtimeMinutes && item.runtimeMinutes > 0) {
    parts.push(`${Math.floor(item.runtimeMinutes / 60)}h ${item.runtimeMinutes % 60}m`);
  }
  if (item.contentRating) parts.unshift(item.contentRating);
  return parts.filter(Boolean).join(' • ');
}

export function formatNovaPulseEpisodeMeta(item: NovaPulseItem) {
  if (item.seasonNumber == null && item.episodeNumber == null && !item.episodeTitle) return null;
  const position = item.seasonNumber != null && item.episodeNumber != null ? `Season ${item.seasonNumber} • Episode ${item.episodeNumber}` : null;
  return [position, item.episodeTitle ? `"${item.episodeTitle}"` : null].filter(Boolean).join(' • ');
}

export function formatNovaPulseRating(item: NovaPulseItem) {
  if (item.rating == null || !Number.isFinite(item.rating)) return null;
  return `${item.ratingSource ?? 'Rating'} ${item.rating.toFixed(1)}`;
}

export function getNovaPulseCatalogBadge(item: NovaPulseItem) {
  return item.catalogStatus ?? item.badge ?? (item.type === 'series' ? 'SERIES' : 'MOVIE');
}

const ANNOUNCEMENT_BADGES = {
  feature: 'NEW FEATURE', update: 'UPDATE', beta: 'BETA', maintenance: 'MAINTENANCE', service_alert: 'SERVICE ALERT', notice: 'NOTICE', promotion: 'PROMOTION', general: 'ANNOUNCEMENT',
} as const;

export function getNovaPulseAnnouncementBadge(item: NovaPulseItem) {
  return item.badgeOverride ?? item.badge ?? ANNOUNCEMENT_BADGES[item.announcementType ?? 'general'];
}

export function formatNovaPulseAnnouncementTiming(effectiveAt?: string, expiresAt?: string, now = Date.now()) {
  const effective = effectiveAt ? Date.parse(effectiveAt) : NaN;
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(effective) && effective > now) return `Available ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(effective))}`;
  if (Number.isFinite(expires) && expires > now) return `Ends ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(expires))}`;
  if (Number.isFinite(effective)) return 'Available now';
  return null;
}

export function getNovaPulseWinner(sports?: NovaPulseSportsData) {
  if (!sports || sports.isDraw || sports.isNoContest || sports.resultStatus === 'DRAW' || sports.resultStatus === 'NO_CONTEST') return null;
  if (sports.winnerName) return sports.winnerName;
  const scoreA = Number(sports.finalScoreA ?? sports.awayScore);
  const scoreB = Number(sports.finalScoreB ?? sports.homeScore);
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA === scoreB) return null;
  return scoreA > scoreB ? sports.awayName : sports.homeName;
}

export function formatNovaPulseResultSummary(sports?: NovaPulseSportsData) {
  if (!sports) return 'Final result unavailable';
  if (sports.isNoContest || sports.resultStatus === 'NO_CONTEST') return 'No contest';
  if (sports.isDraw || sports.resultStatus === 'DRAW') return sports.format === 'fight' ? 'Fight ends in a draw' : 'Draw';
  const winner = getNovaPulseWinner(sports);
  if (sports.format === 'fight') {
    if (!winner) return 'Result unavailable';
    const method = sports.resultMethod ?? sports.decisionType;
    const round = sports.resultRound != null ? ` in Round ${sports.resultRound}` : '';
    const time = sports.resultTime ? ` at ${sports.resultTime}` : '';
    return `${winner} wins${method ? ` by ${method}` : ''}${round}${time}`;
  }
  const scoreA = sports.finalScoreA ?? sports.awayScore;
  const scoreB = sports.finalScoreB ?? sports.homeScore;
  if (scoreA != null && scoreB != null && Number(scoreA) === Number(scoreB)) return 'Draw';
  return winner ? `${winner} wins${scoreA != null && scoreB != null ? ` ${scoreA}–${scoreB}` : ''}` : 'Final result unavailable';
}
