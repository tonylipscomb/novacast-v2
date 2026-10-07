import AsyncStorage from '@react-native-async-storage/async-storage';

import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';
import { deviceAuthHeaders } from '@/features/device/deviceRegistration';
import type { NovaPulseItem, NovaPulseNewsCategory } from './novaPulseTypes';

export const NOVA_PULSE_NEWS_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_NEWS_ENABLED === 'true';
export const NOVA_PULSE_NEWS_SERVER_UPSTREAM_TIMEOUT_MS = 10_000;
export const NOVA_PULSE_NEWS_TIMEOUT_MS = 12_000;
export const NOVA_PULSE_NEWS_MEMORY_MAX_AGE_MS = 5 * 60_000;
export const NOVA_PULSE_NEWS_LKG_MAX_AGE_MS = 30 * 60_000;
export const NOVA_PULSE_NEWS_MAX_ITEMS = 1;
export const NOVA_PULSE_NEWS_STORAGE_KEY = '@novacast/novapulse-news-v1';
export const NOVA_PULSE_NEWS_DIAGNOSTICS = process.env.EXPO_PUBLIC_NOVAPULSE_NEWS_DIAGNOSTICS === 'true';

type NewsProjection = {
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
  attribution: string;
};

type CachedPayload = { schemaVersion: 1; fetchedAt: number; kind: 'items' | 'empty'; items: NewsProjection[] };
export type NovaPulseNewsResult = { source: 'remote' | 'lkg' | 'empty' | 'none'; item: NovaPulseItem | null; cacheAgeBucket?: 'fresh' | 'under_30m' | 'expired' };

const categories = new Set<NovaPulseNewsCategory>(['top', 'entertainment', 'sports']);
let memoryCache: CachedPayload | null = null;
let inFlight: Promise<NovaPulseNewsResult> | null = null;
let storageRead: Promise<CachedPayload | null> | null = null;

export function recordNovaPulseNewsReleaseDiagnostic(event: string, fields: Record<string, string | number | boolean | undefined> = {}) {
  if (!NOVA_PULSE_NEWS_DIAGNOSTICS) return;
  console.info('[NOVAPULSE_NEWS_RELEASE]', JSON.stringify({ event, ...fields }));
}

function newsDiagnostic(errorType: string, outcome: string) {
  recordSanitizedDiagnostic({ operation: 'novapulse_news', screen: 'home', errorType, outcome });
}

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) return null;
  return { apiUrl, anonKey };
}

function safeText(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
}

function safeArticleUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

function toItem(row: NewsProjection): NovaPulseItem {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(row.publishedAt)) / 60_000));
  const age = ageMinutes < 1 ? 'Just now' : ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
  return {
    id: `news:${row.id}`, type: 'news', subtype: 'featured', title: row.headline,
    message: row.summary, subtitle: row.publisher,
    secondaryText: `${row.publisher} - ${age}`, newsCategory: row.category,
    publishedAt: Date.parse(row.publishedAt), expiresAt: row.expiresAt,
    priority: row.category === 'top' ? 38 : row.category === 'entertainment' ? 35 : 32,
    sourceId: row.sourceId, sourceItemId: row.id, action: { type: 'none' },
    dedupeKey: `news:${row.sourceId}:${row.id}`,
    ...(row.artworkUrl ? { artworkUrl: row.artworkUrl } : {}),
  };
}

function validateRow(value: unknown, nowMs: number): NewsProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = safeText(row.id, 120);
  const sourceId = safeText(row.sourceId, 40);
  const category = row.category;
  const headline = safeText(row.headline, 160);
  const publisher = safeText(row.publisher, 100);
  const publishedAt = typeof row.publishedAt === 'string' && Number.isFinite(Date.parse(row.publishedAt)) ? new Date(row.publishedAt).toISOString() : undefined;
  const expiresAt = typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt)) ? new Date(row.expiresAt).toISOString() : undefined;
  const articleUrl = safeArticleUrl(row.articleUrl);
  const artworkUrl = row.artworkUrl === undefined ? undefined : safeArticleUrl(row.artworkUrl);
  if (!id || !sourceId || !categories.has(category as NovaPulseNewsCategory) || !headline || !publisher || !publishedAt || !expiresAt || !articleUrl || Date.parse(publishedAt) < nowMs - 24 * 60 * 60_000 || Date.parse(publishedAt) > nowMs + 5 * 60_000 || Date.parse(expiresAt) <= nowMs) return null;
  const summary = safeText(row.summary, 420);
  return { id, sourceId, category: category as NovaPulseNewsCategory, headline, ...(summary ? { summary } : {}), publisher, publishedAt, articleUrl, ...(artworkUrl ? { artworkUrl } : {}), fetchedAt: typeof row.fetchedAt === 'string' ? row.fetchedAt : new Date(nowMs).toISOString(), expiresAt, attribution: 'GDELT' };
}

function parseCache(value: unknown, nowMs = Date.now()): CachedPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !Number.isFinite(row.fetchedAt) || (row.kind !== 'items' && row.kind !== 'empty') || !Array.isArray(row.items)) return null;
  const items = row.items.map((item) => validateRow(item, nowMs)).filter((item): item is NewsProjection => Boolean(item));
  return { schemaVersion: 1, fetchedAt: row.fetchedAt as number, kind: row.kind as CachedPayload['kind'], items };
}

function fromCache(cache: CachedPayload | null, nowMs = Date.now()): NovaPulseNewsResult | null {
  if (!cache) return null;
  const age = nowMs - cache.fetchedAt;
  if (age < 0 || age >= NOVA_PULSE_NEWS_LKG_MAX_AGE_MS) return null;
  if (cache.kind === 'empty') return { source: 'empty', item: null, cacheAgeBucket: age < NOVA_PULSE_NEWS_MEMORY_MAX_AGE_MS ? 'fresh' : 'under_30m' };
  const item = cache.items.find((candidate) => Date.parse(candidate.expiresAt) > nowMs);
  return item ? { source: age < NOVA_PULSE_NEWS_MEMORY_MAX_AGE_MS ? 'remote' : 'lkg', item: toItem(item), cacheAgeBucket: age < NOVA_PULSE_NEWS_MEMORY_MAX_AGE_MS ? 'fresh' : 'under_30m' } : null;
}

async function readCache() {
  if (!storageRead) storageRead = AsyncStorage.getItem(NOVA_PULSE_NEWS_STORAGE_KEY).then((raw) => raw ? parseCache(JSON.parse(raw)) : null).catch(() => null);
  return storageRead;
}

async function writeCache(cache: CachedPayload) {
  try { await AsyncStorage.setItem(NOVA_PULSE_NEWS_STORAGE_KEY, JSON.stringify(cache)); } catch { /* optional LKG */ }
}

async function fetchRemote(): Promise<NovaPulseNewsResult> {
  const api = apiConfig();
  if (!api) {
    recordNovaPulseNewsReleaseDiagnostic('fallback', { reason: 'config_missing' });
    return { source: 'none', item: null };
  }
  newsDiagnostic('request_started', 'fetch');
  recordNovaPulseNewsReleaseDiagnostic('request-start');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOVA_PULSE_NEWS_TIMEOUT_MS);
  try {
    const response = await fetch(`${api.apiUrl}/novapulse-news-feed`, { method: 'GET', cache: 'no-store', headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Cache-Control': 'no-cache', ...(await deviceAuthHeaders()) }, signal: controller.signal });
    const statusCategory = response.status >= 200 && response.status < 300 ? '2xx' : response.status >= 400 && response.status < 500 ? '4xx' : response.status >= 500 ? '5xx' : 'network';
    newsDiagnostic('http_outcome', statusCategory);
    recordNovaPulseNewsReleaseDiagnostic('http', { statusCategory });
    if (!response.ok) throw new Error(statusCategory === '4xx' ? 'news_http_4xx' : statusCategory === '5xx' ? 'news_http_5xx' : 'news_unavailable');
    let payload: { ok?: boolean; items?: unknown[] } | null;
    try {
      payload = await response.json() as { ok?: boolean; items?: unknown[] };
    } catch {
      recordNovaPulseNewsReleaseDiagnostic('response-body-parse', { reason: 'invalid_or_timeout' });
      throw new Error('news_response_body_parse');
    }
    const serverItemCount = Array.isArray(payload?.items) ? payload.items.length : 0;
    newsDiagnostic('server_items', String(serverItemCount));
    recordNovaPulseNewsReleaseDiagnostic('server-count', { count: serverItemCount });
    if (!payload || payload.ok !== true || !Array.isArray(payload.items)) throw new Error('news_response_body_parse');
    const nowMs = Date.now();
    const items = payload.items.map((row) => validateRow(row, nowMs)).filter((row): row is NewsProjection => Boolean(row)).slice(0, NOVA_PULSE_NEWS_MAX_ITEMS);
    recordNovaPulseNewsReleaseDiagnostic('fresh-count', { count: items.length });
    recordNovaPulseNewsReleaseDiagnostic('normalized-count', { count: items.length });
    const cache: CachedPayload = { schemaVersion: 1, fetchedAt: nowMs, kind: items.length ? 'items' : 'empty', items };
    memoryCache = cache;
    await writeCache(cache);
    recordNovaPulseNewsReleaseDiagnostic('cache-source', { source: 'remote' });
    newsDiagnostic('feed_result', `remote:${items.length}`);
    return items[0] ? { source: 'remote', item: toItem(items[0]), cacheAgeBucket: 'fresh' } : { source: 'empty', item: null, cacheAgeBucket: 'fresh' };
  } catch (error) {
    const fallback = fromCache(memoryCache);
    newsDiagnostic('feed_failure', fallback ? 'lkg' : 'none');
    const errorType = error instanceof Error ? error.message : '';
    const reason = errorType === 'news_http_4xx'
      ? 'http_4xx'
      : errorType === 'news_http_5xx'
        ? 'http_5xx'
        : errorType === 'news_response_body_parse'
          ? 'response_body_parse'
          : errorType === 'AbortError'
            ? 'network_abort'
            : 'network';
    recordNovaPulseNewsReleaseDiagnostic('fallback', { reason: fallback ? 'lkg' : reason });
    return fallback ?? { source: 'none', item: null };
  } finally { clearTimeout(timeout); }
}

export async function loadNovaPulseNews(): Promise<NovaPulseNewsResult> {
  if (!NOVA_PULSE_NEWS_ENABLED) return { source: 'none', item: null };
  const memory = fromCache(memoryCache);
  if (memory?.cacheAgeBucket === 'fresh') {
    newsDiagnostic('cache_source', 'memory');
    recordNovaPulseNewsReleaseDiagnostic('cache-source', { source: 'memory' });
    return memory;
  }
  const stored = await readCache();
  if (stored) {
    memoryCache = stored;
    const cached = fromCache(stored);
    if (cached) {
      newsDiagnostic('cache_source', cached.source === 'lkg' ? 'storage_lkg' : 'storage');
      recordNovaPulseNewsReleaseDiagnostic('cache-source', { source: cached.source === 'lkg' ? 'lkg' : 'storage' });
      return cached;
    }
  }
  if (inFlight) return inFlight;
  inFlight = fetchRemote().finally(() => { inFlight = null; });
  return inFlight;
}

export function getCachedNovaPulseNews(nowMs = Date.now()) { return fromCache(memoryCache, nowMs); }
export function clearNovaPulseNewsCacheForTests() { memoryCache = null; inFlight = null; storageRead = null; }
