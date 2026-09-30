export type NovaPulseNewsCategory = 'top' | 'entertainment' | 'sports';

export type NovaPulseNewsItem = {
  id: string;
  sourceId: string;
  category: NovaPulseNewsCategory;
  headline: string;
  summary?: string;
  publisher: string;
  publishedAt: string;
  articleUrl: string;
  artworkUrl?: string;
  fetchedAt: string;
  expiresAt: string;
  attribution: 'GNews';
};

const MAX_HEADLINE = 160;
const MAX_SUMMARY = 420;
const MAX_PUBLISHER = 100;
const NEWS_MAX_AGE_MS = 24 * 60 * 60_000;
const NEWS_MAX_ITEMS = 18;
const CATEGORY_RANK: Record<NovaPulseNewsCategory, number> = { top: 0, entertainment: 1, sports: 2 };

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return undefined;
  }
}

function dateValue(value: unknown) {
  if (typeof value !== 'string') return undefined;
  if (/^\d{14}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function idFor(url: string) {
  let hash = 2166136261;
  for (const character of url) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
    return `gnews-${(hash >>> 0).toString(16)}`;
}

export function normalizeGNewsArticles(payload: unknown, category: NovaPulseNewsCategory, nowMs = Date.now()): NovaPulseNewsItem[] {
  const articles = payload && typeof payload === 'object' && Array.isArray((payload as { articles?: unknown }).articles)
    ? (payload as { articles: unknown[] }).articles : [];
  const seen = new Set<string>();
  const result: NovaPulseNewsItem[] = [];
  for (const raw of articles) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const articleUrl = safeUrl(row.url);
    const headline = text(row.title, MAX_HEADLINE);
    const source = row.source && typeof row.source === 'object' ? row.source as Record<string, unknown> : null;
    const publisher = text(source?.name, MAX_PUBLISHER);
    const publishedMs = dateValue(row.publishedAt);
    if (!articleUrl || !headline || !publisher || publishedMs == null || publishedMs < nowMs - NEWS_MAX_AGE_MS || publishedMs > nowMs + 5 * 60_000) continue;
    const id = idFor(articleUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    const summary = text(row.description, MAX_SUMMARY);
    const artworkUrl = safeUrl(row.image);
    result.push({
      id, sourceId: 'gnews', category, headline, ...(summary ? { summary } : {}), publisher,
      publishedAt: new Date(publishedMs).toISOString(), articleUrl, ...(artworkUrl ? { artworkUrl } : {}),
      fetchedAt: new Date(nowMs).toISOString(), expiresAt: new Date(Math.min(publishedMs + NEWS_MAX_AGE_MS, nowMs + NEWS_MAX_AGE_MS)).toISOString(),
      attribution: 'GNews',
    });
  }
  return result.slice(0, NEWS_MAX_ITEMS);
}

export const GNEWS_API_BASE_URL = 'https://gnews.io/api/v4/top-headlines';
export const GNEWS_MAX_RECORDS = 10;

function providerCategory(category: NovaPulseNewsCategory) {
  return category === 'top' ? 'general' : category;
}

export function buildGNewsUrl(category: NovaPulseNewsCategory, apiKey: string) {
  const url = new URL(GNEWS_API_BASE_URL);
  url.searchParams.set('category', providerCategory(category));
  url.searchParams.set('lang', 'en');
  url.searchParams.set('country', 'us');
  url.searchParams.set('max', String(GNEWS_MAX_RECORDS));
  url.searchParams.set('sortby', 'publishedAt');
  url.searchParams.set('apikey', apiKey);
  return url;
}

export function mergeNovaPulseNewsItems(groups: ReadonlyMap<NovaPulseNewsCategory, readonly NovaPulseNewsItem[]>, max = 18) {
  const seen = new Set<string>();
  return [...groups.entries()].flatMap(([category, items]) => items.map((item) => ({ ...item, category })))
    .filter((item) => !seen.has(item.articleUrl) && (seen.add(item.articleUrl), true))
    .sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, max);
}

export function newsLimits() { return { maxAgeMs: NEWS_MAX_AGE_MS, maxItems: NEWS_MAX_ITEMS }; }
