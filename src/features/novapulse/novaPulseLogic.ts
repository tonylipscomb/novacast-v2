import type { NovaPulseAction, NovaPulseItem, NovaPulseSportsData } from './novaPulseTypes';
import { extractYearFromTitle, normalizeProviderTitle, parseProviderTitlePrefix, stripProviderStreamTitlePrefix } from '../series/metadata/titleNormalization.ts';

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
const NOVA_PULSE_STRUCTURED_PROVIDER_PREFIX = /^(?:AR(?:-SUBS)?|A\+)(?:\s*[-|:\u2022]\s*|\s+)/i;
const NOVA_PULSE_COUNTRY_CODES = new Set(['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'FR', 'DE', 'ES', 'IT', 'PT', 'BR', 'MX', 'IN', 'JP', 'KR', 'CN', 'PL']);

export function getNovaPulseDisplayCountry(title?: string) {
  const match = title?.trim().match(/\s+\(([^()]{2})\)\s*$/);
  const code = match?.[1]?.toUpperCase();
  return code && NOVA_PULSE_COUNTRY_CODES.has(code) ? code : undefined;
}

export function hasNovaPulseDisplayPrefix(title?: string) {
  const value = title?.trim() ?? '';
  return Boolean(value) && (NOVA_PULSE_PROVIDER_PREFIX.test(value) || NOVA_PULSE_STRUCTURED_PROVIDER_PREFIX.test(value) || NOVA_PULSE_TOP_PREFIX.test(value));
}

export function sanitizeNovaPulseDisplayTitle(title?: string) {
  const original = title?.trim() ?? '';
  if (!original) return '';
  const withoutCountryYear = original.replace(/\s*\((?:19|20)\d{2}\)\s+\((?:US|GB|CA|AU|NZ|IE|FR|DE|ES|IT|PT|BR|MX|IN|JP|KR|CN|PL)\)\s*$/i, '').trim();
  const withoutYear = withoutCountryYear.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
  const withoutQualityPrefix = withoutYear.replace(NOVA_PULSE_PROVIDER_PREFIX, '').trim();
  let withoutStructuredPrefix = withoutQualityPrefix;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = withoutStructuredPrefix.replace(NOVA_PULSE_STRUCTURED_PROVIDER_PREFIX, '').trim();
    if (next === withoutStructuredPrefix) break;
    withoutStructuredPrefix = next;
  }
  return withoutStructuredPrefix.replace(NOVA_PULSE_TOP_PREFIX, '').trim() || withoutStructuredPrefix || withoutYear;
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

export type NovaPulseLanguageEvidence = 'us-english' | 'neutral' | 'foreign';

const NOVA_PULSE_FOREIGN_LANGUAGE_PREFIXES = new Set(['AR', 'AR-SUBS', 'ES', 'FR', 'DE', 'IT', 'PT', 'RU', 'HI', 'JP', 'KO', 'ZH']);
const NOVA_PULSE_ENGLISH_PREFIXES = new Set(['EN', 'ENG']);
const NOVA_PULSE_ENGLISH_REGION_CODES = new Set(['US', 'GB', 'CA', 'AU', 'NZ']);
const NON_LATIN_SCRIPT_RANGES = [
  /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/g,
  /[\u0400-\u052f\u2de0-\u2dff\uA640-\uA69F]/g,
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
  /[\uac00-\ud7af]/g,
  /[\u0590-\u05ff\u0900-\u097f\u0e00-\u0e7f]/g,
];

function prefixTokens(rawTitle: string) {
  const tokens = rawTitle.toUpperCase().match(/^(?:\[?([A-Z][A-Z+]*(?:-[A-Z]+)?)\]?)(?:\s*[-|:\u2022]\s*|\s+)/);
  return tokens?.[1] ? [tokens[1], tokens[1].replace(/-SUBS$/, '')] : [];
}

/** Conservative NovaPulse-only language/region evidence; raw provider values remain unchanged. */
export function getNovaPulseLanguageEvidence(rawTitle?: string, countryCode?: string): NovaPulseLanguageEvidence {
  const parsed = parseProviderTitlePrefix(rawTitle ?? '');
  const normalizedCountry = countryCode?.trim().toUpperCase() || parsed.countryCode;
  if (normalizedCountry === 'US') return 'us-english';
  if (normalizedCountry && NOVA_PULSE_ENGLISH_REGION_CODES.has(normalizedCountry)) return 'neutral';
  const tokens = prefixTokens(rawTitle ?? '');
  if (tokens.some((token) => NOVA_PULSE_ENGLISH_PREFIXES.has(token))) return 'us-english';
  if (tokens.some((token) => NOVA_PULSE_FOREIGN_LANGUAGE_PREFIXES.has(token))) return 'foreign';
  return 'neutral';
}

/** Reject only descriptions dominated by clearly non-Latin scripts. Accented Latin remains valid. */
export function isNovaPulseEnglishDescription(value?: string) {
  const text = value?.trim() ?? '';
  if (!text) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character)).length;
  if (!letters) return true;
  const nonLatin = NON_LATIN_SCRIPT_RANGES.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
  return !(nonLatin >= 2 && (nonLatin / letters >= 0.25 || nonLatin >= 8));
}

export function buildNovaPulseVariantKey(input: { type: 'movie' | 'series'; title: string; rawTitle?: string; year?: number | string }) {
  const sourceTitle = normalizeProviderTitle(sanitizeNovaPulseDisplayTitle(stripProviderStreamTitlePrefix(input.rawTitle || input.title)))
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLocaleLowerCase();
  const parsedYear = typeof input.year === 'number' ? input.year : Number.parseInt(String(input.year ?? ''), 10) || extractYearFromTitle(input.rawTitle || input.title);
  return `${input.type}|${sourceTitle}|${Number.isInteger(parsedYear) ? parsedYear : ''}`;
}

export type NovaPulseVariantDiagnostics = {
  foreignVariantsRejected: number;
  englishVariantsPreferred: number;
  duplicateVariantsCollapsed: number;
};

export function preferNovaPulseEnglishVariants<T extends { id: string; title: string; rawTitle?: string; countryCode?: string; year?: number | string; description?: string; rating?: string | number; posterUrl?: string; backdropUrl?: string }>(
  items: readonly T[],
  type: 'movie' | 'series',
): { items: T[]; diagnostics: NovaPulseVariantDiagnostics } {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(buildNovaPulseVariantKey({ type, title: item.title, rawTitle: item.rawTitle, year: item.year })) ?? [];
    group.push(item);
    groups.set(buildNovaPulseVariantKey({ type, title: item.title, rawTitle: item.rawTitle, year: item.year }), group);
  }
  const diagnostics: NovaPulseVariantDiagnostics = { foreignVariantsRejected: 0, englishVariantsPreferred: 0, duplicateVariantsCollapsed: 0 };
  const selected: T[] = [];
  for (const variants of groups.values()) {
    const ranked = variants.map((item, index) => {
      const evidence = getNovaPulseLanguageEvidence(item.rawTitle, item.countryCode);
      const descriptionScore = isNovaPulseEnglishDescription(item.description) ? 1 : 0;
      const richness = Number(Boolean(item.backdropUrl)) * 3 + Number(Boolean(item.posterUrl)) * 2 + Number(Boolean(item.description)) + Number(item.rating != null);
      return { item, index, evidence, score: (evidence === 'us-english' ? 30 : evidence === 'neutral' ? 20 : 0) + descriptionScore + richness };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    const winner = ranked[0];
    if (!winner) continue;
    selected.push(winner.item);
    if (variants.length > 1) {
      diagnostics.duplicateVariantsCollapsed += variants.length - 1;
      if (winner.evidence !== 'foreign' && ranked.some((entry) => entry.evidence === 'foreign')) {
        diagnostics.englishVariantsPreferred += 1;
        diagnostics.foreignVariantsRejected += ranked.filter((entry) => entry.evidence === 'foreign').length;
      }
    }
  }
  return { items: selected, diagnostics };
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
  return name?.trim() || 'Competitor';
}

/** Display-only runtime guard; tiny provider placeholders are not useful metadata. */
export function getNovaPulseDisplayRuntimeMinutes(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  return value >= 5 && value <= 600 ? value : undefined;
}

export const NOVA_PULSE_RECENTLY_ADDED_FLOOR_MS = Date.UTC(2000, 0, 1);
export const NOVA_PULSE_RECENTLY_ADDED_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const NOVA_PULSE_RECENTLY_ADDED_FUTURE_TOLERANCE_MS = 24 * 60 * 60_000;
export const NOVA_PULSE_RECENTLY_ADDED_STRONG_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type NovaPulseMovieFreshness = 'strong' | 'moderate' | null;

/** Validates only the provider `added` lineage against the mounted session clock. */
export function getNovaPulseMovieFreshness(addedAt: number | undefined, sessionNowMs: number): NovaPulseMovieFreshness {
  if (!Number.isFinite(addedAt) || !Number.isFinite(sessionNowMs) || (addedAt ?? 0) < NOVA_PULSE_RECENTLY_ADDED_FLOOR_MS) return null;
  const age = sessionNowMs - (addedAt ?? 0);
  if (age < -NOVA_PULSE_RECENTLY_ADDED_FUTURE_TOLERANCE_MS || age > NOVA_PULSE_RECENTLY_ADDED_WINDOW_MS) return null;
  return age <= NOVA_PULSE_RECENTLY_ADDED_STRONG_WINDOW_MS ? 'strong' : 'moderate';
}

export function formatNovaPulseCatalogMeta(item: NovaPulseItem) {
  const genres = normalizeNovaPulseGenres(item.genres);
  const validYear = getNovaPulseDisplayYear(item.year);
  const countryCandidate = item.countryCode?.trim().toUpperCase();
  const country = countryCandidate && NOVA_PULSE_COUNTRY_CODES.has(countryCandidate) ? countryCandidate : undefined;
  const parts = [validYear ? String(validYear) : null, country || null, ...genres];
  const runtimeMinutes = getNovaPulseDisplayRuntimeMinutes(item.runtimeMinutes);
  if (runtimeMinutes) {
    parts.push(`${Math.floor(runtimeMinutes / 60)}h ${runtimeMinutes % 60}m`);
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
    if (!winner) return sports.resultMethod ?? sports.decisionType ?? sports.statusText ?? 'Result unavailable';
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
