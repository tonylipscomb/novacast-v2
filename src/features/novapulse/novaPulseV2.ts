import type { NovaPulseItem } from './novaPulseTypes';
import type { NovaPulseSource } from './novaPulseSources';

export const NOVA_PULSE_V2_MIN_ITEMS = 5;
export const NOVA_PULSE_V2_MAX_ITEMS = 12;
const CANDIDATE_WINDOW = 32;

export type NovaPulseV2Diagnostics = {
  candidateMovies: number;
  candidateSeries: number;
  candidateSports: number;
  candidateAnnouncements: number;
  selectedCount: number;
  selectedMovies: number;
  selectedSeries: number;
  selectedSports: number;
  selectedAnnouncements: number;
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
  score += Math.max(0, 1 - providerOrder / 1000);
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

function selectDiverse(ranked: readonly NovaPulseItem[]) {
  const selected: NovaPulseItem[] = [];
  const remaining = [...ranked];
  while (remaining.length && selected.length < NOVA_PULSE_V2_MAX_ITEMS) {
    const last = selected.at(-1)?.type;
    const previous = selected.at(-2)?.type;
    const movieNeeded = ranked.some((item) => item.type === 'movie') && !selected.some((item) => item.type === 'movie');
    const seriesNeeded = ranked.some((item) => item.type === 'series') && !selected.some((item) => item.type === 'series');
    const forcedType = movieNeeded ? 'movie' : seriesNeeded ? 'series' : null;
    const candidateIndex = remaining.findIndex((item) => {
      if (forcedType && item.type !== forcedType) return false;
      return !(item.type === last && item.type === previous);
    });
    const fallbackIndex = remaining.findIndex((item) => !(item.type === last && item.type === previous));
    const index = candidateIndex >= 0 ? candidateIndex : fallbackIndex >= 0 ? fallbackIndex : 0;
    selected.push(remaining[index]);
    remaining.splice(index, 1);
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
  const items = selectDiverse(ranked);
  const diagnostics: NovaPulseV2Diagnostics = {
    candidateMovies: typeCount(ranked, 'movie'),
    candidateSeries: typeCount(ranked, 'series'),
    candidateSports: typeCount(ranked, 'sports'),
    candidateAnnouncements: typeCount(ranked, 'announcement'),
    selectedCount: items.length,
    selectedMovies: typeCount(items, 'movie'),
    selectedSeries: typeCount(items, 'series'),
    selectedSports: typeCount(items, 'sports'),
    selectedAnnouncements: typeCount(items, 'announcement'),
    signature: candidateSignature(items),
  };
  return { items, diagnostics };
}
