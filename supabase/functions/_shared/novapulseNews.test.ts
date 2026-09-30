import { buildGNewsUrl, GNEWS_API_BASE_URL, GNEWS_MAX_RECORDS, mergeNovaPulseNewsItems, normalizeGNewsArticles, newsLimits } from './novapulseNews.ts';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const now = Date.parse('2026-09-28T12:00:00.000Z');
const article = (overrides: Record<string, unknown> = {}) => ({ url: 'https://example.com/story?utm_source=test', image: 'https://images.example.com/story.jpg?utm_source=test', title: 'A bounded headline', description: 'A bounded summary', publishedAt: '2026-09-28T11:30:00.000Z', source: { name: 'Example News' }, ...overrides });

Deno.test('news normalization accepts bounded recent HTTPS articles and omits unsafe or stale rows', () => {
  const rows = normalizeGNewsArticles({ articles: [article(), article({ url: 'javascript:alert(1)' }), article({ url: 'https://example.com/old', publishedAt: '2020-01-01T00:00:00.000Z' }), null] }, 'top', now);
  assert(rows.length === 1 && rows[0].articleUrl === 'https://example.com/story', 'safe article accepted and tracking query removed');
  assert(rows[0].artworkUrl === 'https://images.example.com/story.jpg', 'safe HTTPS artwork accepted and tracking query removed');
  assert(rows[0].attribution === 'GNews', 'attribution retained');
});

Deno.test('news artwork remains optional and rejects unsafe or malformed images', () => {
  const rows = normalizeGNewsArticles({ articles: [
    article({ url: 'https://example.com/no-image', image: undefined }),
    article({ url: 'https://example.com/http-image', image: 'http://images.example.com/story.jpg' }),
    article({ url: 'https://example.com/javascript-image', image: 'javascript:alert(1)' }),
    article({ url: 'https://example.com/malformed-image', image: 'not a url' }),
  ] }, 'top', now);
  assert(rows.length === 4, 'News remains eligible without safe artwork');
  assert(rows.every((row) => row.artworkUrl === undefined), 'unsafe and malformed artwork is omitted');
});

Deno.test('news normalization handles missing summaries and malformed fields fail closed', () => {
  const rows = normalizeGNewsArticles({ articles: [article({ title: '', source: { name: 4 } }), article({ url: 'https://example.com/no-summary', description: undefined })] }, 'sports', now);
  assert(rows.length === 1 && rows[0].summary === undefined, 'summary remains optional');
});

Deno.test('news merge deduplicates canonical URLs and prioritizes top then entertainment then sports', () => {
  const top = normalizeGNewsArticles({ articles: [article({ url: 'https://example.com/shared' })] }, 'top', now);
  const entertainment = normalizeGNewsArticles({ articles: [article({ url: 'https://example.com/entertainment', publishedAt: '2026-09-28T11:45:00.000Z' })] }, 'entertainment', now);
  const sports = normalizeGNewsArticles({ articles: [article({ url: 'https://example.com/sports', publishedAt: '2026-09-28T11:59:00.000Z' })] }, 'sports', now);
  const merged = mergeNovaPulseNewsItems(new Map([['top', top], ['entertainment', entertainment], ['sports', sports]]), 2);
  assert(merged.length === 2 && merged[0].category === 'top' && merged[1].category === 'entertainment', 'category priority is deterministic');
});

Deno.test('news request is bounded and server-side', () => {
  const url = buildGNewsUrl('entertainment', 'test-key');
  assert(url.origin === 'https://gnews.io' && url.pathname === '/api/v4/top-headlines', 'provider is server-side');
  assert(url.searchParams.get('category') === 'entertainment' && url.searchParams.get('lang') === 'en' && url.searchParams.get('country') === 'us', 'GNews request is scoped');
  assert(url.searchParams.get('max') === String(GNEWS_MAX_RECORDS) && url.searchParams.get('apikey') === 'test-key', 'request is bounded and keyed server-side');
  assert(GNEWS_API_BASE_URL === 'https://gnews.io/api/v4/top-headlines', 'GNews endpoint is fixed');
  assert(newsLimits().maxAgeMs === 24 * 60 * 60_000 && newsLimits().maxItems === 18, 'limits retained');
});
