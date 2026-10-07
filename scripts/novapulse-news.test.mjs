import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

const card = fs.readFileSync('src/features/novapulse/NovaPulseCard.tsx', 'utf8');
const client = fs.readFileSync('src/features/novapulse/novaPulseNews.ts', 'utf8');
const hook = fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8');
const server = fs.readFileSync('supabase/functions/novapulse-news-feed/index.ts', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');
const item = (id, type, overrides = {}) => ({ id, type, title: id, priority: 50, sourceId: 'test', sourceItemId: id, description: 'summary', action: { type: 'none' }, ...overrides });

test('News is disabled by default and uses the authenticated server feed', () => {
  assert.match(env, /EXPO_PUBLIC_NOVAPULSE_NEWS_ENABLED=false/);
  assert.match(client, /novapulse-news-feed/);
  assert.match(client, /deviceAuthHeaders\(\)/);
  assert.match(server, /authenticateActiveDevice/);
  assert.doesNotMatch(client, /gnews\.io|GNEWS_API_KEY/);
});

test('News is non-actionable, category-badged, and bounded to one source item', () => {
  assert.match(card, /const news = item\.type === 'news'/);
  assert.match(card, /newsBadge/);
assert.match(card, /hasRemoteArtwork/);
assert.match(client, /artworkUrl/);
  assert.match(card, /const action = providerAlert \? null : resolveNovaPulseAction/);
  assert.match(hook, /createNovaPulseNewsSource/);
  const news = item('news-1', 'news', { newsCategory: 'top' });
  const result = composeNovaPulseFeedV2([{ id: 'news', getItems: () => ({ sourceId: 'news', items: [news] }) }]);
  assert.equal(result.items.filter((entry) => entry.type === 'news').length, 1);
  assert.equal(result.items[0].action.type, 'none');
});

test('News remains eligible when Weather is also present', () => {
  const news = item('news', 'news', { newsCategory: 'top', priority: 38 });
  const weather = item('weather', 'weather', { priority: 50 });
  const result = composeNovaPulseFeedV2([
    { id: 'news', getItems: () => ({ sourceId: 'news', items: [news] }) },
    { id: 'weather', getItems: () => ({ sourceId: 'weather', items: [weather] }) },
  ], { seed: 'news-weather' });
  assert.deepEqual(result.items.map((entry) => entry.type), ['weather', 'news']);
  assert.equal(result.items.filter((entry) => entry.type === 'news').length, 1);
  assert.ok((result.diagnostics.newsRank ?? 0) >= 1);
  assert.equal(result.diagnostics.newsFilterReason, 'selected');
});

test('News never displaces provider health and information remains capped at two', () => {
  const provider = item('provider', 'provider_alert', { providerHealthState: 'unavailable', priority: 88 });
  const news = item('news', 'news', { newsCategory: 'top', priority: 38 });
  const weather = item('weather', 'weather', { priority: 50 });
  const movies = Array.from({ length: 8 }, (_, index) => item(`movie-${index}`, 'movie', { sourceId: 'catalog', artworkUrl: 'asset', sourceItemId: `movie-${index}` }));
  const result = composeNovaPulseFeedV2([
    { id: 'provider', getItems: () => ({ sourceId: 'provider', items: [provider] }) },
    { id: 'news', getItems: () => ({ sourceId: 'news', items: [news] }) },
    { id: 'weather', getItems: () => ({ sourceId: 'weather', items: [weather] }) },
    { id: 'catalog', getItems: () => ({ sourceId: 'catalog', items: movies }) },
  ]);
  const providerIndex = result.items.findIndex((entry) => entry.type === 'provider_alert');
  const newsIndex = result.items.findIndex((entry) => entry.type === 'news');
  const critical = item('critical', 'announcement', { announcementPriority: 'critical', announcementType: 'service_alert', priority: 100 });
  const criticalResult = composeNovaPulseFeedV2([
    { id: 'provider', getItems: () => ({ sourceId: 'provider', items: [provider] }) },
    { id: 'critical', getItems: () => ({ sourceId: 'critical', items: [critical] }) },
    { id: 'news', getItems: () => ({ sourceId: 'news', items: [news] }) },
    { id: 'weather', getItems: () => ({ sourceId: 'weather', items: [weather] }) },
  ], { seed: 'critical-news-weather' });
  assert.ok(providerIndex >= 0 && (newsIndex < 0 || providerIndex < newsIndex), 'provider health outranks News');
  assert.ok(result.items.filter((entry) => entry.type === 'news').length <= 1);
  assert.ok(result.items.length <= 12);
  assert.equal(criticalResult.items[0]?.type, 'provider_alert');
  assert.equal(criticalResult.items.filter((entry) => entry.type === 'announcement' || entry.type === 'weather' || entry.type === 'news').length, 2);
  assert.equal(criticalResult.diagnostics.newsFilterReason, 'information_cap');
  assert.equal(criticalResult.items.length <= 12, true);
});

test('News card source and cache limits are present without changing rail caps', () => {
  assert.match(client, /NOVA_PULSE_NEWS_SERVER_UPSTREAM_TIMEOUT_MS = 10_000/);
  assert.match(client, /NOVA_PULSE_NEWS_TIMEOUT_MS = 12_000/);
  assert.ok(client.indexOf("recordNovaPulseNewsReleaseDiagnostic('http'") < client.indexOf('response.json()'));
  assert.match(client, /response-body-parse/);
  assert.match(client, /http_4xx/);
  assert.match(client, /http_5xx/);
  assert.match(client, /network_abort/);
  assert.match(client, /NOVA_PULSE_NEWS_MEMORY_MAX_AGE_MS = 5 \* 60_000/);
  assert.match(client, /NOVA_PULSE_NEWS_LKG_MAX_AGE_MS = 30 \* 60_000/);
  assert.match(client, /cache: 'no-store'/);
  assert.match(server, /Cache-Control/);
  assert.match(server, /Promise\.all/);
  assert.match(server, /GNEWS_API_KEY/);
  assert.match(server, /REQUEST_TIMEOUT_MS = 10_000/);
  assert.match(server, /news_upstream_unavailable/);
  assert.match(client, /kind: items\.length \? 'items' : 'empty'/);
  assert.match(client, /fallback \? 'lkg' : 'none'/);
  assert.match(client, /Date\.parse\(expiresAt\) <= nowMs/);
  assert.match(client, /NOVA_PULSE_NEWS_MAX_ITEMS = 1/);
  assert.match(client, /request_started/);
  assert.match(client, /http_outcome/);
  assert.match(client, /server_items/);
  assert.match(client, /cache_source/);
  assert.match(client, /feed_failure/);
  assert.match(fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8'), /candidate:\$\{composed\.diagnostics\.candidateNews\}:selected:\$\{composed\.diagnostics\.selectedNews\}/);
  assert.doesNotMatch(client, /JSON\.stringify\(payload\)/);
  assert.doesNotMatch(client, /deviceSecret|privateCredential|providerPassword/);
});

test('release-safe News diagnostics are opt-in and aggregate-only', () => {
  assert.match(client, /NOVA_PULSE_NEWS_DIAGNOSTICS = process\.env\.EXPO_PUBLIC_NOVAPULSE_NEWS_DIAGNOSTICS === 'true'/);
  assert.match(client, /if \(!NOVA_PULSE_NEWS_DIAGNOSTICS\) return/);
  assert.match(client, /recordNovaPulseNewsReleaseDiagnostic\('request-start'/);
  assert.match(client, /statusCategory/);
  assert.match(client, /server-count/);
  assert.match(client, /normalized-count/);
  assert.match(client, /fresh-count/);
  assert.match(hook, /informationSelectedCount/);
  assert.match(hook, /candidateCreated/);
  assert.match(hook, /filterReason/);
  assert.match(hook, /newsRank/);
  const helper = client.slice(client.indexOf('export function recordNovaPulseNewsReleaseDiagnostic'), client.indexOf('function newsDiagnostic'));
  assert.doesNotMatch(helper, /apiUrl|anonKey|Authorization|deviceAuthHeaders|article|headline|summary|error/);
  assert.doesNotMatch(client, /EXPO_PUBLIC_NOVAPULSE_NEWS_DIAGNOSTICS\s*=\s*true/);
});

test('runtime News diagnostics begin before early returns and remain sanitized', () => {
  assert.match(client, /\[NOVAPULSE_NEWS\]/);
  for (const event of ['news-runtime-entry', 'news-feature-state', 'news-fetch-start', 'news-fetch-result', 'news-normalized', 'news-freshness-result', 'news-candidate-created', 'news-ranked', 'news-selected', 'news-skipped']) {
    assert.match(client + hook, new RegExp(event));
  }
  assert.match(client, /reason: 'feature-disabled'/);
  assert.match(client, /reason: 'missing-endpoint'/);
  assert.match(client, /reason === 'response_body_parse'/);
  assert.match(client, /invalid-payload/);
  assert.match(client, /fetch-error/);
  assert.doesNotMatch(client + hook, /console\.info\([^\n]*(?:apiUrl|anonKey|Authorization|deviceAuthHeaders|headline|articleUrl|providerId)/);
});

test('indexed Movie and Series summaries retain regional metadata for NovaPulse curation', async () => {
  const { getMovieCatalogIndex, resetMovieCatalogIndex } = await import('../src/features/movies/smart/movieCatalogIndex.ts');
  const { getSeriesCatalogIndex, resetSeriesCatalogIndex } = await import('../src/features/series/smart/seriesCatalogIndex.ts');
  const { curateNovaPulseCatalog } = await import('../src/features/novapulse/novaPulseCuration.ts');
  const movieProvider = 'news-regional-movie-index';
  const seriesProvider = 'news-regional-series-index';
  resetMovieCatalogIndex(movieProvider);
  resetSeriesCatalogIndex(seriesProvider);
  getMovieCatalogIndex(movieProvider).ingest([{
    id: 'foreign-movie', categoryId: 'foreign', categoryName: 'PL | Movies', rawTitle: 'PL | Foreign Movie',
    title: 'Foreign Movie', genres: ['Drama'], posterStyleKey: 'ember', posterUrl: 'https://img.example/movie.jpg',
  }]);
  getSeriesCatalogIndex(seriesProvider).ingest([{
    id: 'foreign-series', seriesId: 'foreign-series', categoryId: 'foreign', categoryName: 'JP | Series', rawTitle: 'JP | Foreign Series',
    title: 'Foreign Series', genres: ['Drama'], posterStyleKey: 'ember', posterUrl: 'https://img.example/series.jpg',
  }]);
  const movie = getMovieCatalogIndex(movieProvider).listSummaries(1)[0];
  const series = getSeriesCatalogIndex(seriesProvider).listSummaries(1)[0];
  assert.equal(movie.categoryName, 'PL | Movies');
  assert.equal(movie.rawTitle, 'PL | Foreign Movie');
  assert.equal(series.categoryName, 'JP | Series');
  assert.equal(series.rawTitle, 'JP | Foreign Series');
  assert.equal(curateNovaPulseCatalog([movie], [series], 'us_only').movies.length, 0);
  assert.equal(curateNovaPulseCatalog([movie], [series], 'us_only').series.length, 0);
});
