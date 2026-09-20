import { createRecommendationFingerprint } from './recommendationContract.ts';
import type { RecommendationCandidate, RecommendationCatalogFingerprint, RecommendationSeed } from './recommendationCandidateClient.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import type { RecentItemRecord } from '../personalization/personalizationModel.ts';
import type { NovaPulseRecommendationSignals } from './novaPulseTypes.ts';

const MAX_SEEDS = 12;
const MAX_CATALOG = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NovaPulseLocalRecommendationContext = {
  recentlyWatched: readonly RecentItemRecord[];
  favoriteMovies: readonly MovieSummary[];
  watchlistMovies: readonly MovieSummary[];
  favoriteSeries: readonly SeriesSummary[];
  watchlistSeries: readonly SeriesSummary[];
};

export type NovaPulseSeedBuildResult = {
  seeds: RecommendationSeed[];
  signature: string;
  confidence: 'cold' | 'light' | 'rich';
};

export type NovaPulseCatalogBridgeEntry = RecommendationCatalogFingerprint & {
  itemKey: string;
};

export type NovaPulseCatalogBridge = {
  entries: NovaPulseCatalogBridgeEntry[];
  signature: string;
};

const strengthPriority: Record<RecommendationSeed['strength'], number> = {
  repeat: 5,
  complete: 4,
  meaningful: 3,
  favorite: 2,
  watchlist: 2,
};

function ageFactor(timestamp: number, now: number) {
  return Math.max(0.5, 1 - Math.max(0, now - timestamp) / (90 * DAY_MS));
}

function contentFingerprint(item: { title: string; year?: number | string }, contentType: 'movie' | 'series') {
  return createRecommendationFingerprint({
    contentType,
    title: item.title,
    year: item.year,
  });
}

function addSeed(
  map: Map<string, RecommendationSeed & { priority: number; occurredMs: number }>,
  input: { fingerprint: string; contentType: 'movie' | 'series'; strength: RecommendationSeed['strength']; occurredMs: number },
  now: number,
) {
  const priority = strengthPriority[input.strength] * 10 + ageFactor(input.occurredMs, now) * 2;
  const existing = map.get(input.fingerprint);
  if (!existing || priority > existing.priority || (priority === existing.priority && input.occurredMs > existing.occurredMs)) {
    map.set(input.fingerprint, {
      fingerprint: input.fingerprint,
      contentType: input.contentType,
      strength: input.strength,
      occurredAt: new Date(input.occurredMs).toISOString(),
      priority,
      occurredMs: input.occurredMs,
    });
  }
}

export function buildNovaPulsePersonalSeeds(
  context: NovaPulseLocalRecommendationContext,
  now = Date.now(),
): NovaPulseSeedBuildResult {
  const movieById = new Map(context.favoriteMovies.concat(context.watchlistMovies).map((item) => [String(item.id), item]));
  const seriesById = new Map(context.favoriteSeries.concat(context.watchlistSeries).map((item) => [String(item.id || item.seriesId), item]));
  const seedMap = new Map<string, RecommendationSeed & { priority: number; occurredMs: number }>();
  const recentFingerprints = new Set<string>();

  for (const recent of context.recentlyWatched) {
    if (recent.mediaType !== 'movie' && recent.mediaType !== 'series' && recent.mediaType !== 'episode') continue;
    const isEpisode = recent.mediaType === 'episode';
    const contentType: 'movie' | 'series' = isEpisode ? 'series' : recent.mediaType === 'movie' ? 'movie' : 'series';
    const item = contentType === 'movie'
      ? movieById.get(String(recent.contentId))
      : seriesById.get(String(recent.parentSeriesId ?? recent.contentId));
    const fingerprint = contentFingerprint(item ?? { title: isEpisode && recent.title.includes(':') ? recent.title.split(':')[0] : recent.title }, contentType);
    if (!fingerprint) continue;
    const meaningful = recent.completed === true || (recent.progressPercent != null && recent.progressPercent >= 10);
    if (!meaningful) continue;
    const strength = recentFingerprints.has(fingerprint)
      ? 'repeat'
      : recent.completed === true || (recent.progressPercent != null && recent.progressPercent >= 90)
        ? 'complete'
        : 'meaningful';
    recentFingerprints.add(fingerprint);
    addSeed(seedMap, { fingerprint, contentType, strength, occurredMs: recent.lastOpenedAt }, now);
  }

  for (const item of context.favoriteMovies) {
    const fingerprint = contentFingerprint(item, 'movie');
    if (fingerprint) addSeed(seedMap, { fingerprint, contentType: 'movie', strength: 'favorite', occurredMs: item.addedAt ?? now }, now);
  }
  for (const item of context.watchlistMovies) {
    const fingerprint = contentFingerprint(item, 'movie');
    if (fingerprint) addSeed(seedMap, { fingerprint, contentType: 'movie', strength: 'watchlist', occurredMs: item.addedAt ?? now }, now);
  }
  for (const item of context.favoriteSeries) {
    const fingerprint = contentFingerprint({ title: item.title, year: item.year }, 'series');
    if (fingerprint) addSeed(seedMap, { fingerprint, contentType: 'series', strength: 'favorite', occurredMs: item.addedAt ?? now }, now);
  }
  for (const item of context.watchlistSeries) {
    const fingerprint = contentFingerprint({ title: item.title, year: item.year }, 'series');
    if (fingerprint) addSeed(seedMap, { fingerprint, contentType: 'series', strength: 'watchlist', occurredMs: item.addedAt ?? now }, now);
  }

  const seeds = [...seedMap.values()]
    .sort((left, right) => right.priority - left.priority || right.occurredMs - left.occurredMs || left.fingerprint.localeCompare(right.fingerprint))
    .slice(0, MAX_SEEDS)
    .map(({ priority: _priority, occurredMs: _occurredMs, ...seed }) => seed);
  const strongCount = seeds.filter((seed) => seed.strength === 'repeat' || seed.strength === 'complete' || seed.strength === 'favorite').length;
  const confidence = seeds.length === 0 ? 'cold' : seeds.length >= 4 || strongCount >= 3 ? 'rich' : 'light';
  return { seeds, confidence, signature: seeds.map((seed) => `${seed.fingerprint}|${seed.contentType}|${seed.strength}`).join('||') };
}

export function buildNovaPulseCatalogBridge(movies: readonly MovieSummary[], series: readonly SeriesSummary[]): NovaPulseCatalogBridge {
  const entries: NovaPulseCatalogBridgeEntry[] = [];
  const seen = new Set<string>();
  for (const movie of movies) {
    const fingerprint = contentFingerprint(movie, 'movie');
    const itemKey = `movie:${movie.id}`;
    if (fingerprint && !seen.has(fingerprint)) {
      seen.add(fingerprint);
      entries.push({ token: itemKey, itemKey, fingerprint, contentType: 'movie' });
    }
    if (entries.length >= MAX_CATALOG) return { entries, signature: entries.map((entry) => entry.token).join('|') };
  }
  for (const item of series) {
    const fingerprint = contentFingerprint({ title: item.title, year: item.year }, 'series');
    const itemKey = `series:${item.id || item.seriesId}`;
    if (fingerprint && !seen.has(fingerprint)) {
      seen.add(fingerprint);
      entries.push({ token: itemKey, itemKey, fingerprint, contentType: 'series' });
    }
    if (entries.length >= MAX_CATALOG) break;
  }
  return { entries, signature: entries.map((entry) => `${entry.token}:${entry.fingerprint}`).join('|') };
}

function normalized(value: number, scale: number) {
  return Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0, value) / scale)));
}

export function recommendationSignalForCandidate(candidate: RecommendationCandidate, confidence: NovaPulseSeedBuildResult['confidence']): NovaPulseRecommendationSignals {
  const blend = confidence === 'rich' ? 0.9 : confidence === 'light' ? 0.55 : 0.45;
  const behavioral = normalized(candidate.behaviorScore, 40);
  const affinity = normalized(candidate.affinityScore, 40);
  const trend = normalized(candidate.trendScore, 50);
  const velocity = Math.max(0, Math.min(1, (candidate.velocity + 1) / 3));
  const behaviorScore = blend * (behavioral * 0.55 + affinity * 0.25 + trend * 0.15 + velocity * 0.05);
  return {
    reason: candidate.reason,
    behaviorScore,
    affinityScore: candidate.affinityScore,
    trendScore: candidate.trendScore,
    velocity: candidate.velocity,
    scope: candidate.scope,
    seedCorrelationToken: candidate.seedCorrelationToken,
    catalogMatchToken: candidate.catalogMatchToken,
  };
}

export function createLocalSignalMap(context: NovaPulseLocalRecommendationContext): ReadonlyMap<string, NovaPulseRecommendationSignals> {
  const signals = new Map<string, NovaPulseRecommendationSignals>();
  for (const item of context.favoriteMovies) signals.set(`movie:${item.id}`, { reason: 'favorite_affinity', behaviorScore: 0.65, affinityScore: 0 });
  for (const item of context.watchlistMovies) if (!signals.has(`movie:${item.id}`)) signals.set(`movie:${item.id}`, { reason: 'watchlist_affinity', behaviorScore: 0.55, affinityScore: 0 });
  for (const item of context.favoriteSeries) signals.set(`series:${item.id || item.seriesId}`, { reason: 'favorite_affinity', behaviorScore: 0.65, affinityScore: 0 });
  for (const item of context.watchlistSeries) if (!signals.has(`series:${item.id || item.seriesId}`)) signals.set(`series:${item.id || item.seriesId}`, { reason: 'watchlist_affinity', behaviorScore: 0.55, affinityScore: 0 });
  return signals;
}
