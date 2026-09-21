import type { NovaPulseItem } from './novaPulseTypes';
import type { NovaPulseSource } from './novaPulseSources';

export const NOVA_PULSE_V2_MIN_ITEMS = 5;
export const NOVA_PULSE_V2_MAX_ITEMS = 12;
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
  candidateLive: number;
  sportsAvailable: number;
  selectedCount: number;
  selectedMovies: number;
  selectedSeries: number;
  selectedSports: number;
  selectedAnnouncements: number;
  selectedLive: number;
  sportsSelected: number;
  announcementsSelected: number;
  sportsGuardApplied: boolean;
  signature: string;
};

export type NovaPulseV2Result = {
  items: NovaPulseItem[];
  diagnostics: NovaPulseV2Diagnostics;
};

function stableKey(item: NovaPulseItem) {
  return item.dedupeKey ?? item.id;
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

function qualityScore(item: NovaPulseItem, providerOrder: number) {
  let score = 0;
  if (item.title.trim()) score += 1;
  if (item.artworkUrl?.trim() || item.artworkSource) score += 3;
  if (item.description?.trim() || item.message?.trim()) score += 2;
  if (item.rating != null) score += 1;
  if (item.year != null || item.releaseDate) score += 1;
  if (item.priority > 0) score += Math.min(3, Math.floor(item.priority / 30));
  const suppliedSortPriority = Number(item.sortPriority);
  if (Number.isFinite(suppliedSortPriority)) score += Math.max(-1, Math.min(2, suppliedSortPriority / 100));
  const suppliedTimestamp = item.updatedAt ?? item.publishedAt;
  if (Number.isFinite(suppliedTimestamp)) score += Math.max(0, Math.min(2, (Number(suppliedTimestamp) - 1_600_000_000_000) / 100_000_000_000));
  score += Math.max(0, 1 - providerOrder / 1000);
  if (item.recommendation) {
    // Behavioral candidates intentionally dominate metadata quality. Metadata
    // remains a deterministic tie-breaker for equally relevant local items.
    score = 100 + (item.recommendation.behaviorScore ?? 0) * 100 +
      (item.recommendation.affinityScore ? Math.min(20, item.recommendation.affinityScore / 20) : 0) +
      (item.recommendation.trendScore ? Math.min(10, item.recommendation.trendScore / 25) : 0) +
      Math.max(-2, Math.min(2, item.recommendation.velocity ?? 0)) + score * 0.01;
  }
  return score;
}

function isUseful(item: NovaPulseItem, score: number) {
  return item.type === 'sports' || item.type === 'announcement' || score >= 3;
}

function typeCount(items: readonly NovaPulseItem[], type: NovaPulseItem['type']) {
  return items.filter((item) => item.type === type).length;
}

function candidateSignature(items: readonly NovaPulseItem[]) {
  const hash = (value: string) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  };
  return items.slice(0, CANDIDATE_WINDOW).map((item) => [
    item.id,
    item.type,
    item.title,
    hash(item.artworkUrl ?? ''),
    item.description ?? '',
    item.rating ?? '',
    item.year ?? '',
    item.publishedAt ?? '',
    item.updatedAt ?? '',
  ].join('~')).join('|');
}

function isCriticalAnnouncement(item: NovaPulseItem) {
  return item.type === 'announcement' && item.announcementPriority === 'critical';
}

function selectSports(ranked: readonly NovaPulseItem[]) {
  const sports = ranked.filter((item) => item.type === 'sports');
  const upcoming = sports.find((item) => item.subtype === 'upcoming' || item.subtype === 'live');
  const final = sports.find((item) => item.subtype === 'final');
  return [...new Set([upcoming, final, ...sports].filter((item): item is NovaPulseItem => Boolean(item)))].slice(0, 2);
}

function selectProtected(ranked: readonly NovaPulseItem[], liveCandidates: readonly NovaPulseItem[]) {
  const critical = ranked.find(isCriticalAnnouncement);
  const sports = selectSports(ranked);
  const normalAnnouncement = ranked.find((item) => item.type === 'announcement' && !isCriticalAnnouncement(item));
  return [critical, ...sports, normalAnnouncement, ...liveCandidates.slice(0, 2)].filter((item): item is NovaPulseItem => Boolean(item));
}

function selectDiverse(ranked: readonly NovaPulseItem[], liveCandidates: readonly NovaPulseItem[]) {
  const protectedItems = selectProtected(ranked, liveCandidates);
  const selected: NovaPulseItem[] = [];
  const remaining = ranked.filter((item) => !protectedItems.some((protectedItem) => stableKey(protectedItem) === stableKey(item)));
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
      if (item.type === 'sports' && selectedSports >= 2) return false;
      if (item.type === 'announcement' && !isCriticalAnnouncement(item) && selected.some((selectedItem) => selectedItem.type === 'announcement' && !isCriticalAnnouncement(selectedItem))) return false;
      if (item.type === last && item.type === previous) return false;
      const reason = item.recommendation?.reason;
      return !(reason && recentReasons.length === 4 && recentReasons.every((value) => value === reason));
    });
    const fallbackIndex = pool.findIndex((item) => {
      if (item.type === 'sports' && selectedSports >= 2) return false;
      if (item.type === 'sports' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'announcement' && !reserved.has(stableKey(item))) return false;
      if (item.type === 'announcement' && !isCriticalAnnouncement(item) && selected.some((selectedItem) => selectedItem.type === 'announcement' && !isCriticalAnnouncement(selectedItem))) return false;
      return !(item.type === last && item.type === previous);
    });
    const index = candidateIndex >= 0 ? candidateIndex : fallbackIndex >= 0 ? fallbackIndex : 0;
    const chosen = pool[index];
    selected.push(chosen);
    const remainingIndex = remaining.findIndex((item) => stableKey(item) === stableKey(chosen));
    if (remainingIndex >= 0) remaining.splice(remainingIndex, 1);
  }
  return selected;
}

export function composeNovaPulseFeedV2(sources: readonly NovaPulseSource[]): NovaPulseV2Result {
  const all = unique(sources.flatMap((source) => {
    try {
      return source.getItems().items ?? [];
    } catch {
      return [];
    }
  }).slice(0, CANDIDATE_WINDOW * 4));
  const ranked = all
    .map((item, index) => ({ item, score: qualityScore(item, index), index }))
    .filter(({ item, score }) => isUseful(item, score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
  const liveCandidates = all
    .filter((item) => item.type === 'live_epg' && item.action?.type === 'channel')
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 2);
  const nonLiveRanked = ranked.filter((item) => item.type !== 'live_epg');
  const items = selectDiverse(nonLiveRanked, liveCandidates);
  const diagnostics: NovaPulseV2Diagnostics = {
    movieSourceWindow: typeCount(all, 'movie'),
    seriesSourceWindow: typeCount(all, 'series'),
    movieRankedCandidates: typeCount(ranked, 'movie'),
    seriesRankedCandidates: typeCount(ranked, 'series'),
    candidateMovies: typeCount(ranked, 'movie'),
    candidateSeries: typeCount(ranked, 'series'),
    candidateSports: typeCount(ranked, 'sports'),
    candidateAnnouncements: typeCount(ranked, 'announcement'),
    candidateLive: liveCandidates.length,
    sportsAvailable: typeCount(ranked, 'sports'),
    selectedCount: items.length,
    selectedMovies: typeCount(items, 'movie'),
    selectedSeries: typeCount(items, 'series'),
    selectedSports: typeCount(items, 'sports'),
    selectedAnnouncements: typeCount(items, 'announcement'),
    selectedLive: typeCount(items, 'live_epg'),
    sportsSelected: typeCount(items, 'sports'),
    announcementsSelected: typeCount(items, 'announcement'),
    sportsGuardApplied: typeCount(ranked, 'sports') > 0 && typeCount(items, 'sports') > 0,
    signature: candidateSignature(items),
  };
  return { items, diagnostics };
}
