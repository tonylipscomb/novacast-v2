import { authenticateActiveDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { buildGNewsUrl, mergeNovaPulseNewsItems, normalizeGNewsArticles, type NovaPulseNewsCategory, type NovaPulseNewsItem } from '../_shared/novapulseNews.ts';
import { getAdminClient } from '../_shared/supabase.ts';

// Keep the upstream budget below the mobile client's 12-second request timeout.
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const categories: NovaPulseNewsCategory[] = ['top', 'entertainment', 'sports'];
let cache: { fetchedAt: number; items: NovaPulseNewsItem[] } | null = null;

function response(body: Record<string, unknown>, status = 200) {
  const output = jsonResponse(body, status);
  output.headers.set('Cache-Control', 'no-store, max-age=0');
  return output;
}

async function fetchCategory(category: NovaPulseNewsCategory, apiKey: string, nowMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(buildGNewsUrl(category, apiKey), { signal: controller.signal, headers: { Accept: 'application/json' } });
    const contentType = upstream.headers.get('content-type')?.split(';', 1)[0] ?? 'missing';
    const body = await upstream.text();
    if (!upstream.ok) {
      console.info('[NOVAPULSE_NEWS_UPSTREAM]', JSON.stringify({
        category,
        status: upstream.status,
        elapsedMs: Date.now() - startedAt,
        contentType,
        bodyBytes: body.length,
        parseSuccess: false,
        resultCount: 0,
        failureClass: `http_${upstream.status}`,
      }));
      return { ok: false, items: [] as NovaPulseNewsItem[] };
    }
    let payload: unknown = null;
    let parseSuccess = false;
    try {
      payload = JSON.parse(body);
      parseSuccess = true;
    } catch {
      console.info('[NOVAPULSE_NEWS_UPSTREAM]', JSON.stringify({
        category,
        status: upstream.status,
        elapsedMs: Date.now() - startedAt,
        contentType,
        bodyBytes: body.length,
        parseSuccess: false,
        resultCount: 0,
        failureClass: 'parse_error',
      }));
      return { ok: false, items: [] as NovaPulseNewsItem[] };
    }
    const items = normalizeGNewsArticles(payload, category, nowMs);
    console.info('[NOVAPULSE_NEWS_UPSTREAM]', JSON.stringify({
      category,
      status: upstream.status,
      elapsedMs: Date.now() - startedAt,
      contentType,
      bodyBytes: body.length,
      parseSuccess,
      resultCount: items.length,
      failureClass: null,
    }));
    return { ok: true, items };
  } catch (error) {
    console.info('[NOVAPULSE_NEWS_UPSTREAM]', JSON.stringify({
      category,
      status: null,
      elapsedMs: Date.now() - startedAt,
      contentType: null,
      bodyBytes: 0,
      parseSuccess: false,
      resultCount: 0,
      failureClass: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : error instanceof TypeError ? 'network_error' : 'request_error',
    }));
    return { ok: false, items: [] as NovaPulseNewsItem[] };
  } finally {
    clearTimeout(timeout);
  }
}

async function readNews() {
  const nowMs = Date.now();
  const apiKey = Deno.env.get('GNEWS_API_KEY')?.trim();
  if (!apiKey) throw new Error('news_upstream_unavailable');
  if (cache && nowMs - cache.fetchedAt < CACHE_TTL_MS) return { ok: true, items: cache.items, freshness: { source: 'cache', fetchedAt: new Date(cache.fetchedAt).toISOString() } };
  const groups = await Promise.all(categories.map(async (category) => [category, await fetchCategory(category, apiKey, nowMs)] as const));
  if (!groups.some(([, result]) => result.ok)) throw new Error('news_upstream_unavailable');
  const items = mergeNovaPulseNewsItems(new Map(groups.map(([category, result]) => [category, result.items])));
  cache = { fetchedAt: nowMs, items };
  return { ok: true, items, freshness: { source: items.length ? 'remote' : 'empty', fetchedAt: new Date(nowMs).toISOString() } };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return response({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    await authenticateActiveDevice(request, getAdminClient());
    return response(await readNews());
  } catch (error) {
    const category = error instanceof Error && error.message === 'invalid_device' ? 'invalid_device' : error instanceof Error && error.message === 'device_not_authorized' ? 'device_not_authorized' : 'news_unavailable';
    return response({ ok: false, error: category }, category === 'invalid_device' ? 401 : category === 'device_not_authorized' ? 403 : 503);
  }
});
