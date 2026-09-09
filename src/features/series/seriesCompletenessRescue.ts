import type { SeriesDetail } from '../media-browser/mediaTypes.ts';

export const MAX_SERIES_COMPLETENESS_CANDIDATES = 4;
export const SERIES_COMPLETENESS_PROBE_CONCURRENCY = 2;

export type SeriesCompleteness = {
  playableSeasonCount: number;
  highestSeasonNumber: number;
  totalEpisodeCount: number;
  latestEpisodeDate?: string;
};

export type SeriesCompletenessCandidate = {
  providerSeriesId: string;
  title: string;
  year?: number;
};

export type SeriesCompletenessCache = {
  generation: number;
  winnerProviderSeriesId: string;
};

export type SeriesCompletenessResult =
  | 'selected_complete'
  | 'alternate_selected'
  | 'no_alternate'
  | 'provider_missing_newer_season'
  | 'rescue_failed'
  | 'cached_winner';

export function readSeriesWinnerCache(cache: Map<string, SeriesCompletenessCache>, key: string, generation: number) {
  const entry = cache.get(key);
  return entry?.generation === generation ? entry : undefined;
}

export function writeSeriesWinnerCache(cache: Map<string, SeriesCompletenessCache>, key: string, entry: SeriesCompletenessCache) {
  cache.set(key, entry);
}

export function scoreSeriesDetail(detail: SeriesDetail): SeriesCompleteness {
  const playableSeasons = detail.seasons.filter((season) => {
    const number = Number.parseInt(season.seasonNumber, 10);
    return number > 0 && (detail.episodesBySeason[season.seasonNumber] ?? []).some((episode) => Boolean(episode.streamId?.trim()));
  });
  const episodeDates = Object.values(detail.episodesBySeason)
    .flat()
    .map((episode) => episode.airDate)
    .filter((date): date is string => Boolean(date && Number.isFinite(Date.parse(date))));

  return {
    playableSeasonCount: playableSeasons.length,
    highestSeasonNumber: playableSeasons.reduce(
      (highest, season) => Math.max(highest, Number.parseInt(season.seasonNumber, 10)),
      0,
    ),
    totalEpisodeCount: playableSeasons.reduce(
      (total, season) => total + (detail.episodesBySeason[season.seasonNumber] ?? []).filter((episode) => Boolean(episode.streamId?.trim())).length,
      0,
    ),
    latestEpisodeDate: episodeDates.sort((left, right) => Date.parse(right) - Date.parse(left))[0],
  };
}

export function compareSeriesCompleteness(
  left: SeriesCompleteness,
  right: SeriesCompleteness,
  leftIsOriginal = false,
  rightIsOriginal = false,
) {
  for (const [leftValue, rightValue] of [
    [left.playableSeasonCount, right.playableSeasonCount],
    [left.highestSeasonNumber, right.highestSeasonNumber],
    [left.totalEpisodeCount, right.totalEpisodeCount],
    [Date.parse(left.latestEpisodeDate ?? '') || 0, Date.parse(right.latestEpisodeDate ?? '') || 0],
  ]) {
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  if (leftIsOriginal !== rightIsOriginal) return leftIsOriginal ? 1 : -1;
  return 0;
}

export function selectSeriesCompletenessWinner<T extends { detail: SeriesDetail; providerSeriesId: string }>(
  records: T[],
  originalProviderSeriesId: string,
) {
  return records.reduce((winner, record) => {
    if (!winner) return record;
    return compareSeriesCompleteness(
      scoreSeriesDetail(record.detail),
      scoreSeriesDetail(winner.detail),
      record.providerSeriesId === originalProviderSeriesId,
      winner.providerSeriesId === originalProviderSeriesId,
    ) > 0 ? record : winner;
  }, null as T | null);
}

export function dedupeAndBoundSeriesCandidates(
  candidates: SeriesCompletenessCandidate[],
  selectedProviderSeriesId: string,
) {
  const seen = new Set<string>([selectedProviderSeriesId]);
  return candidates.filter((candidate) => {
    const id = candidate.providerSeriesId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, MAX_SERIES_COMPLETENESS_CANDIDATES);
}

export async function probeSeriesCandidates<T>(
  candidates: SeriesCompletenessCandidate[],
  probe: (candidate: SeriesCompletenessCandidate) => Promise<T | null>,
  concurrency = SERIES_COMPLETENESS_PROBE_CONCURRENCY,
) {
  const results: T[] = [];
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const index = next++;
      const result = await probe(candidates[index]).catch(() => null);
      if (result) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}

export function isCandidateYearCompatible(left?: number, right?: number) {
  return left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) <= 1;
}

export function classifySeriesCompleteness(
  completeness: SeriesCompleteness,
  expectedSeasonCount?: number,
  alternateSelected = false,
) : SeriesCompletenessResult {
  if (expectedSeasonCount != null && Number.isFinite(expectedSeasonCount) && expectedSeasonCount > completeness.highestSeasonNumber) {
    return 'provider_missing_newer_season';
  }
  return alternateSelected ? 'alternate_selected' : 'selected_complete';
}
