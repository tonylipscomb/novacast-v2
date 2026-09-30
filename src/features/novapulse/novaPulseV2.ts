import type { NovaPulseItem } from './novaPulseTypes';
import type { NovaPulseSource } from './novaPulseSources';
import type { NovaPulseHistoryEntry } from './novaPulseHistory.ts';
import { novaPulseHistoryPenalty } from './novaPulseHistory.ts';
import { getNovaPulseMovieFreshness } from './novaPulseLogic.ts';

export const NOVA_PULSE_V2_MIN_ITEMS = 5;
export const NOVA_PULSE_V2_MAX_ITEMS = 12;
export const NOVA_PULSE_COMPOSITION_BUCKET_MS = 6 * 60 * 60_000;
const CANDIDATE_WINDOW = 32;

export type NovaPulseV2Diagnostics = {
  movieSourceWindow: number;
  seriesSourceWindow: number;
  movieRankedCandidates: number;
  seriesRankedCandidates: number;
  candidateMovies: number;
  candidateSeries: number;
  candidateSports: number;
  candidateAnnouncements: number;
  candidateNews: number;
  candidateWeather: number;
  hasCriticalAnnouncementCandidate: boolean;
  hasNormalAnnouncementCandidate: boolean;
  candidateLive: number;
  sportsAvailable: number;
  selectedCount: number;
  selectedMovies: number;
  selectedSeries: number;
  selectedSports: number;
  selectedAnnouncements: number;
  selectedNews: number;
  selectedWeather: number;
  informationSelected: number;
  selectedLive: number;
  sportsSelected: number;
  announcementsSelected: number;
  sportsGuardApplied: boolean;
  recentItemsPenalized: number;
  signature: string;
};

export type NovaPulseV2Result = {
  items: NovaPulseItem[];
  diagnostics: NovaPulseV2Diagnostics;
};

export type NovaPulseComposeOptions = {
  seed?: string | number;
  nowMs?: number;
  recentHistory?: readonly NovaPulseHistoryEntry[];
};

export type NovaPulseCompositionSession = {
  seed: number;
  startedAt: number;
};

export function createNovaPulseCompositionSession(nowMs = Date.now()): NovaPulseCompositionSession {
  return { seed: Math.floor(nowMs / NOVA_PULSE_COMPOSITION_BUCKET_MS), startedAt: nowMs };
}

function stableKey(item: NovaPulseItem) {
  if (item.sourceItemId) return `${item.type}:${item.sourceId ?? ''}:${item.sourceItemId}`;
  return item.dedupeKey ?? `${item.type}:${item.id}`;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededTie(item: NovaPulseItem, seed: string | number) {
  return hash(`${seed}:${stableKey(item)}`);
}

function unique(items: readonly NovaPulseItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = stableKey(item);
    if (!item.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function qualityScore(item: NovaPulseItem, recentHistory: readonly NovaPulseHistoryEntry[], nowMs: number) {
  const year = Number(item.year);
  let score = 0;
  if (item.title.trim()) score += 1;
  if (item.artworkUrl?.trim() || item.artworkSource) score += 3;
  if (item.description?.trim() || item.message?.trim()) score += 2;
  if (item.rating != null) score += 1;
  if (Number.isInteger(year) && year >= 1888 && year <= new Date().getFullYear() + 2) score += 1;
  if (Number.isFinite(item.runtimeMinutes) && (item.runtimeMinutes ?? 0) > 0) score += 1;
  if (item.priority > 0) score += Math.min(3, Math.floor(item.priority / 30));
  if (item.recommendation) {
    // Behavioral candidates intentionally dominate metadata quality. Metadata
    // remains a deterministic tie-breaker for equally relevant local items.
    score = 100 + (item.recommendation.behaviorScore ?? 0) * 100 +
      (item.recommendation.affinityScore ? Math.min(20, item.recommendation.affinityScore / 20) : 0) +
      (item.recommendation.trendScore ? Math.min(10, item.recommendation.trendScore / 25) : 0) +
      Math.max(-2, Math.min(2, item.recommendation.velocity ?? 0)) + score * 0.01;
  }
  if (item.type === 'movie') {
    const freshness = getNovaPulseMovieFreshness(item.addedAt, nowMs);
    if (freshness === 'strong') score += 2;
    else if (freshness === 'moderate') score += 1;
  }
  if ((item.type === 'movie' || item.type === 'series') && item.sourceItemId) {
    const historyEntry = recentHistory.find((entry) => entry.mediaType === item.type && entry.contentId === item.sourceItemId);
    if (historyEntry && score >= 3) score += Math.max(novaPulseHistoryPenalty(historyEntry, nowMs), 2 - score);
  }
  return score;
}

function isUseful(item: NovaPulseItem, score: number) {
  if (item.type === 'sports' || item.type === 'announcement' || item.type === 'provider_alert' || item.type === 'weather' || item.type === 'news') return true;
  if (score >= 3) return true;
  return Boolean(item.sourceItemId);
}

function typeCount(items: readonly NovaPulseItem[], type: NovaPulseItem['type']) {
  return items.filter((item) => item.type === type).length;
}

function candidateSignature(items: readonly NovaPulseItem[]) {
  const aggregate = items.slice(0, CANDIDATE_WINDOW).map((item) => [
    item.type,
    item.title.trim().length,
    item.description?.trim().length ?? 0,
    item.artworkUrl ? 1 : 0,
    item.rating != null ? 1 : 0,
    item.year != null ? 1 : 0,
    item.runtimeMinutes != null ? 1 : 0,
  ].join('~')).join('|');
  return hash(aggregate).toString(16);
}

function isRecentlyAddedMovie(item: NovaPulseItem, nowMs: number) {
  return item.type === 'movie' && getNovaPulseMovieFreshness(item.addedAt, nowMs) !== null;
}

function isCriticalAnnouncement(item: NovaPulseItem) {
  return item.type === 'announcement' && item.announcementPriority === 'critical';
}

function isValidSportsItem(item: NovaPulseItem, nowMs: number) {
  if (item.type !== 'sports') return true;
  if (item.subtype === 'postponed' || item.subtype === 'cancelled') return false;
  if (item.expiresAt && Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) <= nowMs) return false;
  if ((item.subtype === 'upcoming' || item.subtype === 'starting_soon') && (!item.startsAt || !Number.isFinite(Date.parse(item.startsAt)))) return false;
  return true;
}

function selectSports(ranked: readonly NovaPulseItem[], nowMs: number) {
  const sports = ranked.filter((item) => item.type === 'sports' && isValidSportsItem(item, nowMs));
  const statusRank = (item: NovaPulseItem) => item.subtype === 'live' ? 0 : item.subtype === 'starting_soon' ? 1 : item.subtype === 'final' ? 2 : item.subtype === 'postponed' || item.subtype === 'cancelled' ? 4 : 3;
  const timestamp = (item: NovaPulseItem) => {
    if (item.subtype === 'final') {
      const completed = item.sports?.completedAt ? Date.parse(item.sports.completedAt) : Number.NaN;
      return Number.isFinite(completed) ? completed : (item.startsAt ? Date.parse(item.startsAt) : Number.NaN);
    }
    return item.startsAt ? Date.parse(item.startsAt) : Number.NaN;
  };
  const ordered = [...sports].sort((left, right) => {
    const group = statusRank(left) - statusRank(right);
    if (group) return group;
    const leftTime = timestamp(left);
    const rightTime = timestamp(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return left.subtype === 'final' ? rightTime - leftTime : leftTime - rightTime;
    }
    if (Number.isFinite(leftTime)) return -1;
    if (Number.isFinite(rightTime)) return 1;
    return right.priority - left.priority;
  });
  const primary = ordered[0];
  const leagueKey = (item: NovaPulseItem | undefined) => item?.sports?.league?.trim().toLowerCase() || null;
  const sportFamily = (item: NovaPulseItem | undefined) => {
    const leagueId = item?.sports?.leagueId?.trim();
    if (leagueId === '4391' || leagueId === '4479') return 'football';
    if (leagueId === '4387' || leagueId === '4607') return 'basketball';
    if (leagueId === '4424') return 'baseball';
    if (leagueId === '4380') return 'hockey';
    if (leagueId === '4346' || leagueId === '4328') return 'soccer';
    if (leagueId === '4445' || leagueId === '4443') return 'fighting';
    const league = item?.sports?.league?.trim().toLowerCase();
    if (league === 'nfl' || league === 'ncaa division 1 football') return 'football';
    if (league === 'nba' || league === "ncaa men's basketball") return 'basketball';
    if (league === 'mlb') return 'baseball';
    if (league === 'nhl') return 'hockey';
    if (league === 'american major league soccer' || league === 'english premier league') return 'soccer';
    if (league === 'boxing' || league === 'ufc') return 'fighting';
    return 'other';
  };
  const comparable = primary ? ordered.filter((item) =>
    item !== primary && statusRank(item) === statusRank(primary) && timestamp(item) === timestamp(primary)) : [];
  const second = comparable.find((item) => sportFamily(item) !== sportFamily(primary))
    ?? ordered.find((item) => stableKey(item) !== (primary ? stableKey(primary) : null) && leagueKey(item) !== leagueKey(primary))
    ?? ordered.find((item) => stableKey(item) !== (primary ? stableKey(primary) : null));
  return [...new Set([primary, second, ...ordered].filter((item): item is NovaPulseItem => Boolean(item)))].slice(0, 2);
}

function selectProtected(ranked: readonly NovaPulseItem[], liveCandidates: readonly NovaPulseItem[], nowMs: number) {
  const critical = ranked.find(isCriticalAnnouncement);
  const urgentProviderAlert = ranked.find((item) => item.type === 'provider_alert' && (item.providerHealthState === 'authentication_required' || item.providerHealthState === 'subscription_expired' || item.providerHealthState === 'unavailable'));
  const recoveredProviderAlert = ranked.find((item) => item.type === 'provider_alert' && ![urgentProviderAlert?.id].includes(item.id));
  const sports = selectSports(ranked, nowMs);
  const normalAnnouncement = ranked.find((item) => item.type === 'announcement' && !isCriticalAnnouncement(item));
  const weather = ranked.find((item) => item.type === 'weather');
  const news = ranked.find((item) => item.type === 'news');
  const information = [critical, normalAnnouncement, weather, news]
    .filter((item): item is NovaPulseItem => Boolean(item))
    .slice(0, 2);
  return [urgentProviderAlert, recoveredProviderAlert, ...information, ...sports, ...liveCandidates.slice(0, 2)].filter((item): item is NovaPulseItem => Boolean(item));
}

function selectDiverse(ranked: readonly NovaPulseItem[], liveCandidates: readonly NovaPulseItem[], nowMs: number) {
  const protectedItems = selectProtected(ranked, liveCandidates, nowMs);
  const selected: NovaPulseItem[] = [];
  const remaining = ranked.filter((item) => item.type !== 'sports' && item.type !== 'announcement' && item.type !== 'provider_alert' && item.type !== 'weather' && item.type !== 'news' && !protectedItems.some((protectedItem) => stableKey(protectedItem) === stableKey(item)));
  const mixedCatalog = new Set(remaining.filter((item) => item.type === 'movie' || item.type === 'series').map((item) => item.type)).size > 1;
  const reserved = new Set(protectedItems.map(stableKey));
  while ((remaining.length || protectedItems.some((item) => !selected.some((selectedItem) => stableKey(selectedItem) === stableKey(item)))) && selected.length < NOVA_PULSE_V2_MAX_ITEMS) {
    const protectedRemaining = protectedItems.filter((item) => !selected.some((selectedItem) => stableKey(selectedItem) === stableKey(item)));
    const selectedSports = selected.filter((item) => item.type === 'sports').length;
    const protectedSportsCount = protectedItems.filter((item) => item.type === 'sports').length;
    const forceSports = selectedSports < Math.min(2, protectedSportsCount) && protectedRemaining.some((item) => item.type === 'sports');
    const forceProtected = selected.length + protectedRemaining.length >= NOVA_PULSE_V2_MAX_ITEMS;
    const last = selected.at(-1)?.type;
    const previous = selected.at(-2)?.type;
    const recentReasons = selected.slice(-4).map((item) => item.recommendation?.reason).filter(Boolean);
    const recentMovieCount = selected.filter((item) => isRecentlyAddedMovie(item, nowMs)).length;
    const hasQualityNonRecentMovieAlternative = ranked.filter((item) =>
      item.type === 'movie' && !isRecentlyAddedMovie(item, nowMs) && qualityScore(item, [], nowMs) >= 3);
    const enforceRecentMovieTarget = hasQualityNonRecentMovieAlternative.length >= 2;
    const movieNeeded = ranked.some((item) => item.type === 'movie') && !selected.some((item) => item.type === 'movie');
    const seriesNeeded = ranked.some((item) => item.type === 'series') && !selected.some((item) => item.type === 'series');
    const forcedType = movieNeeded ? 'movie' : seriesNeeded ? 'series' : null;
    const pool = forceProtected || forceSports ? protectedRemaining : [...remaining, ...protectedRemaining];
    const candidateIndex = pool.findIndex((item) => {
      if (forceSports && item.type !== 'sports') return false;
      if (!forceSports && forceProtected && !reserved.has(stableKey(item))) return false;
      if (forcedType && !forceSports && !forceProtected && item.type !== forcedType) return false;
      if (item.type === 'sports' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'announcement' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'provider_alert' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'weather' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'news' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'sports' && selectedSports >= 2) return false;
      if (isRecentlyAddedMovie(item, nowMs) && recentMovieCount >= 2 && enforceRecentMovieTarget) return false;
      if (item.type === 'announcement' && !isCriticalAnnouncement(item) && selected.some((selectedItem) => selectedItem.type === 'announcement' && !isCriticalAnnouncement(selectedItem))) return false;
      if (item.type === last && item.type === previous) return false;
      const reason = item.recommendation?.reason;
      return !(reason && recentReasons.length === 4 && recentReasons.every((value) => value === reason));
    });
    const fallbackIndex = pool.findIndex((item) => {
      if (item.type === 'sports' && selectedSports >= 2) return false;
      if (item.type === 'sports' && !reserved.has(stableKey(item))) return false;
      if (isRecentlyAddedMovie(item, nowMs) && recentMovieCount >= 2 && enforceRecentMovieTarget) return false;
      if (item.type === 'announcement' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'provider_alert' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'weather' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'news' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'announcement' && !isCriticalAnnouncement(item) && selected.some((selectedItem) => selectedItem.type === 'announcement' && !isCriticalAnnouncement(selectedItem))) return false;
      return !(item.type === last && item.type === previous);
    });
    const diversityFallbackIndex = enforceRecentMovieTarget && recentMovieCount >= 2
      ? pool.findIndex((item) => !isRecentlyAddedMovie(item, nowMs) && item.type !== 'sports' && item.type !== 'announcement')
      : -1;
    const index = candidateIndex >= 0 ? candidateIndex : fallbackIndex >= 0 ? fallbackIndex : diversityFallbackIndex >= 0 ? diversityFallbackIndex : enforceRecentMovieTarget && recentMovieCount >= 2 ? -1 : mixedCatalog ? -1 : 0;
    if (index < 0) break;
    const chosen = pool[index];
    selected.push(chosen);
    const remainingIndex = remaining.findIndex((item) => stableKey(item) === stableKey(chosen));
    if (remainingIndex >= 0) remaining.splice(remainingIndex, 1);
  }
  return selected;
}

export function composeNovaPulseFeedV2(sources: readonly NovaPulseSource[], options: NovaPulseComposeOptions = {}): NovaPulseV2Result {
  const nowMs = options.nowMs ?? Date.now();
  const seed = options.seed ?? 0;
  const recentHistory = options.recentHistory ?? [];
  const all = unique(sources.flatMap((source) => {
    try {
      return source.getItems().items ?? [];
    } catch {
      return [];
    }
  })).slice(0, CANDIDATE_WINDOW * 4);
  const recentItemsPenalized = all.filter((item) => {
    if ((item.type !== 'movie' && item.type !== 'series') || !item.sourceItemId) return false;
    const entry = recentHistory.find((candidate) => candidate.mediaType === item.type && candidate.contentId === item.sourceItemId);
    return Boolean(entry && novaPulseHistoryPenalty(entry, nowMs) < 0);
  }).length;
  const ranked = all
    .map((item, index) => ({ item, score: qualityScore(item, recentHistory, nowMs), index }))
    .filter(({ item, score }) => isUseful(item, score))
    .sort((left, right) => right.score - left.score || seededTie(right.item, seed) - seededTie(left.item, seed) || left.index - right.index)
    .map(({ item }) => item);
  const liveCandidates = all
    .filter((item) => item.type === 'live_epg' && item.action?.type === 'channel')
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 2);
  const nonLiveRanked = ranked.filter((item) => item.type !== 'live_epg');
  const items = selectDiverse(nonLiveRanked, liveCandidates, nowMs);
  const diagnostics: NovaPulseV2Diagnostics = {
    movieSourceWindow: typeCount(all, 'movie'),
    seriesSourceWindow: typeCount(all, 'series'),
    movieRankedCandidates: typeCount(ranked, 'movie'),
    seriesRankedCandidates: typeCount(ranked, 'series'),
    candidateMovies: typeCount(ranked, 'movie'),
    candidateSeries: typeCount(ranked, 'series'),
    candidateSports: typeCount(ranked, 'sports'),
    candidateAnnouncements: typeCount(ranked, 'announcement'),
    candidateNews: typeCount(ranked, 'news'),
    candidateWeather: typeCount(ranked, 'weather'),
    hasCriticalAnnouncementCandidate: ranked.some(isCriticalAnnouncement),
    hasNormalAnnouncementCandidate: ranked.some((item) => item.type === 'announcement' && !isCriticalAnnouncement(item)),
    candidateLive: liveCandidates.length,
    sportsAvailable: typeCount(ranked, 'sports'),
    selectedCount: items.length,
    selectedMovies: typeCount(items, 'movie'),
    selectedSeries: typeCount(items, 'series'),
    selectedSports: typeCount(items, 'sports'),
    selectedAnnouncements: typeCount(items, 'announcement'),
    selectedNews: typeCount(items, 'news'),
    selectedWeather: typeCount(items, 'weather'),
    informationSelected: items.filter((item) => item.type === 'announcement' || item.type === 'weather' || item.type === 'news').length,
    selectedLive: typeCount(items, 'live_epg'),
    sportsSelected: typeCount(items, 'sports'),
    announcementsSelected: typeCount(items, 'announcement'),
    sportsGuardApplied: typeCount(ranked, 'sports') > 0 && typeCount(items, 'sports') > 0,
    recentItemsPenalized,
    signature: candidateSignature(items),
  };
  return { items, diagnostics };
}
