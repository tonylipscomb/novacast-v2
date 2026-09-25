import AsyncStorage from '@react-native-async-storage/async-storage';

import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';
import { deviceAuthHeaders } from '@/features/device/deviceRegistration';
import type { NovaPulseItem, NovaPulseAnnouncementImportance } from './novaPulseTypes';

export const NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED === 'true';
export const NOVA_PULSE_ANNOUNCEMENTS_TIMEOUT_MS = 5_000;
export const NOVA_PULSE_ANNOUNCEMENTS_MEMORY_MAX_AGE_MS = 5 * 60_000;
export const NOVA_PULSE_ANNOUNCEMENTS_LKG_MAX_AGE_MS = 60 * 60_000;
export const NOVA_PULSE_ANNOUNCEMENTS_MAX_ITEMS = 2;
export const NOVA_PULSE_ANNOUNCEMENTS_STORAGE_KEY = '@novacast/novapulse-announcements-v1';
export const NOVA_PULSE_ANNOUNCEMENT_BUCKET = '/storage/v1/object/public/novapulse-announcement-artwork/';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 500;
const MAX_SECONDARY = 80;
const MAX_BADGE = 32;
const IMPORTANCE = new Set<NovaPulseAnnouncementImportance>(['normal', 'important', 'critical']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NovaPulseRemoteAnnouncement = {
  id: string;
  revision: number;
  title: string;
  description: string;
  secondaryText?: string;
  badge?: string;
  kind: string;
  importance: NovaPulseAnnouncementImportance;
  priority: number;
  startsAt?: string;
  endsAt?: string;
  artworkUrl?: string;
};

export type NovaPulseAnnouncementsResult = {
  source: 'remote' | 'lkg' | 'static' | 'empty' | 'none';
  items: NovaPulseItem[];
  acceptedCount: number;
  rejectedCount: number;
  cacheAgeBucket?: 'fresh' | 'under_5m' | 'under_60m' | 'expired';
};

type CachedPayload = {
  schemaVersion: 1;
  fetchedAt: number;
  kind: 'items' | 'empty';
  items: NovaPulseRemoteAnnouncement[];
};

let memoryCache: CachedPayload | null = null;
let inFlight: Promise<NovaPulseAnnouncementsResult> | null = null;

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const configuredOrigin = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (!apiUrl || !anonKey) return null;
  try {
    const endpoint = new URL(apiUrl);
    const origin = new URL(configuredOrigin || apiUrl.replace(/\/functions\/v1$/i, '')).origin;
    return { apiUrl, anonKey, origin: endpoint.protocol === 'https:' ? origin : '' };
  } catch {
    return null;
  }
}

function normalizeText(value: unknown, max: number, required = false) {
  if (typeof value !== 'string') return required ? null : undefined;
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !normalized) return null;
  return normalized ? normalized.slice(0, max) : undefined;
}

function validSchedule(value: unknown, nowMs: number, starts: boolean) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  if (starts ? parsed > nowMs : parsed <= nowMs) return null;
  return new Date(parsed).toISOString();
}

function validArtwork(value: unknown, origin: string) {
  if (typeof value !== 'string' || !value.trim() || !origin) return undefined;
  try {
    const url = new URL(value);
    const expected = new URL(origin);
    const rawPath = value.split(/[?#]/, 1)[0].replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
    const decodedRawPath = decodeURIComponent(rawPath);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.protocol !== 'https:' || url.origin !== expected.origin || url.username || url.password || decodedRawPath.split(/[\\/]+/).includes('..') || !decodedPath.startsWith(NOVA_PULSE_ANNOUNCEMENT_BUCKET) || decodedPath.includes('..')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function validateNovaPulseAnnouncement(value: unknown, nowMs = Date.now(), artworkOrigin = ''): NovaPulseRemoteAnnouncement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const revision = row.revision;
  const title = normalizeText(row.title, MAX_TITLE, true);
  const description = normalizeText(row.description, MAX_DESCRIPTION, true);
  const importance = row.importance;
  const priority = row.priority;
  const startsAt = validSchedule(row.startsAt, nowMs, true);
  const endsAt = validSchedule(row.endsAt, nowMs, false);
  if (!UUID.test(id) || !Number.isInteger(revision) || Number(revision) <= 0 || !title || !description || typeof importance !== 'string' || !IMPORTANCE.has(importance as NovaPulseAnnouncementImportance) || !Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 100 || startsAt === null || endsAt === null) return null;
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const item: NovaPulseRemoteAnnouncement = {
    id,
    revision: Number(revision),
    title,
    description,
    kind: normalizeText(row.kind, 32) ?? 'general',
    importance: importance as NovaPulseAnnouncementImportance,
    priority: Number(priority),
  };
  const secondaryText = normalizeText(row.secondaryText, MAX_SECONDARY);
  const badge = normalizeText(row.badge, MAX_BADGE);
  if (secondaryText) item.secondaryText = secondaryText;
  if (badge) item.badge = badge;
  if (startsAt) item.startsAt = startsAt;
  if (endsAt) item.endsAt = endsAt;
  const artworkUrl = validArtwork(row.artworkUrl, artworkOrigin);
  if (artworkUrl) item.artworkUrl = artworkUrl;
  return item;
}

export function normalizeNovaPulseAnnouncements(payload: unknown, nowMs = Date.now(), artworkOrigin = '') {
  const rawItems = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true && Array.isArray((payload as { items?: unknown }).items) ? (payload as { items: unknown[] }).items : null;
  if (!rawItems) return { items: [] as NovaPulseRemoteAnnouncement[], rejectedCount: 0, validPayload: false };
  const seen = new Set<string>();
  const items: NovaPulseRemoteAnnouncement[] = [];
  let rejectedCount = 0;
  for (const raw of rawItems) {
    const item = validateNovaPulseAnnouncement(raw, nowMs, artworkOrigin);
    if (!item || seen.has(item.id)) { rejectedCount += 1; continue; }
    seen.add(item.id);
    items.push(item);
  }
  return { items: items.slice(0, NOVA_PULSE_ANNOUNCEMENTS_MAX_ITEMS), rejectedCount, validPayload: rawItems.length === 0 || items.length > 0 };
}

function isUsable(item: NovaPulseRemoteAnnouncement, nowMs: number) {
  return (!item.startsAt || Date.parse(item.startsAt) <= nowMs) && (!item.endsAt || Date.parse(item.endsAt) > nowMs);
}

function cacheAgeBucket(age: number): NovaPulseAnnouncementsResult['cacheAgeBucket'] {
  if (age < NOVA_PULSE_ANNOUNCEMENTS_MEMORY_MAX_AGE_MS) return 'fresh';
  if (age < NOVA_PULSE_ANNOUNCEMENTS_LKG_MAX_AGE_MS) return 'under_60m';
  return 'expired';
}

function result(source: NovaPulseAnnouncementsResult['source'], items: NovaPulseRemoteAnnouncement[], rejectedCount = 0, fetchedAt?: number): NovaPulseAnnouncementsResult {
  return {
    source,
    items: items.map(toNovaPulseItem),
    acceptedCount: items.length,
    rejectedCount,
    ...(fetchedAt ? { cacheAgeBucket: cacheAgeBucket(Date.now() - fetchedAt) } : {}),
  };
}

function toNovaPulseItem(item: NovaPulseRemoteAnnouncement): NovaPulseItem {
  return {
    id: `announcement:${item.id}`,
    type: 'announcement',
    subtype: 'featured',
    title: item.title,
    message: item.description,
    description: item.description,
    secondaryText: item.secondaryText,
    badgeOverride: item.badge,
    announcementType: item.kind === 'service_alert' ? 'service_alert' : item.kind === 'update' ? 'update' : 'general',
    announcementPriority: item.importance === 'important' ? 'high' : item.importance,
    priority: item.priority,
    startsAt: item.startsAt,
    expiresAt: item.endsAt,
    artworkUrl: item.artworkUrl,
    action: { type: 'none' },
    sourceId: 'remote-announcements',
    sourceItemId: item.id,
    updatedAt: item.revision,
  };
}

function diagnostics(outcome: string, metadata: { source: NovaPulseAnnouncementsResult['source']; acceptedCount: number; rejectedCount: number; cacheAgeBucket?: NovaPulseAnnouncementsResult['cacheAgeBucket']; transient?: boolean }) {
  recordSanitizedDiagnostic({ operation: 'novapulse_announcements', screen: 'home', errorType: outcome, outcome: `${metadata.source}:${metadata.acceptedCount}:${metadata.rejectedCount}:${metadata.cacheAgeBucket ?? 'none'}:${metadata.transient ? 'transient' : 'nontransient'}` });
}

async function readCache(nowMs = Date.now(), artworkOrigin = ''): Promise<CachedPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(NOVA_PULSE_ANNOUNCEMENTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (parsed?.schemaVersion !== 1 || !Number.isFinite(parsed.fetchedAt) || !Array.isArray(parsed.items) || !['items', 'empty'].includes(parsed.kind)) return null;
    if (parsed.kind === 'empty') return { ...parsed, items: [] };
    const normalized = normalizeNovaPulseAnnouncements({ ok: true, items: parsed.items }, nowMs, artworkOrigin);
    return normalized.validPayload && normalized.items.length > 0 ? { ...parsed, items: normalized.items } : null;
  } catch { return null; }
}

async function writeCache(payload: CachedPayload) {
  try { await AsyncStorage.setItem(NOVA_PULSE_ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify(payload)); } catch { /* cache failure is non-fatal */ }
}

function usableCached(cache: CachedPayload | null, nowMs: number) {
  if (!cache || Date.now() - cache.fetchedAt >= NOVA_PULSE_ANNOUNCEMENTS_LKG_MAX_AGE_MS) return null;
  const items = cache.items.filter((item) => isUsable(item, nowMs));
  return { cache, items };
}

export function getCachedNovaPulseAnnouncements(nowMs = Date.now()): NovaPulseAnnouncementsResult | null {
  const cached = usableCached(memoryCache, nowMs);
  if (!cached) return null;
  return cached.cache.kind === 'empty' ? result('empty', [], 0, cached.cache.fetchedAt) : result('lkg', cached.items, 0, cached.cache.fetchedAt);
}

async function fetchRemote(signal?: AbortSignal): Promise<NovaPulseAnnouncementsResult> {
  const api = apiConfig();
  if (!api) { diagnostics('configuration_missing', { source: 'none', acceptedCount: 0, rejectedCount: 0 }); return result('none', []); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOVA_PULSE_ANNOUNCEMENTS_TIMEOUT_MS);
  let callerAborted = false;
  const abort = () => { callerAborted = true; controller.abort(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${api.apiUrl}/novapulse-announcements-feed`, { method: 'GET', cache: 'no-store', headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Cache-Control': 'no-cache', ...(await deviceAuthHeaders()) }, signal: controller.signal });
    const transient = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!response.ok) {
          const cached = transient ? usableCached(await readCache(Date.now(), api.origin), Date.now()) : null;
      const fallback = cached ? (cached.cache.kind === 'empty' ? result('empty', [], 0, cached.cache.fetchedAt) : result('lkg', cached.items, 0, cached.cache.fetchedAt)) : result(transient ? 'static' : 'none', []);
      diagnostics(`http_${Math.floor(response.status / 100)}xx`, { source: fallback.source, acceptedCount: fallback.acceptedCount, rejectedCount: 0, cacheAgeBucket: fallback.cacheAgeBucket, transient });
      return fallback;
    }
    const payload = await response.json().catch(() => null);
    const normalized = normalizeNovaPulseAnnouncements(payload, Date.now(), api.origin);
        if (!normalized.validPayload) { diagnostics('invalid_payload', { source: 'none', acceptedCount: 0, rejectedCount: normalized.rejectedCount }); return result('none', []); }
    const cache: CachedPayload = { schemaVersion: 1, fetchedAt: Date.now(), kind: normalized.items.length ? 'items' : 'empty', items: normalized.items };
    memoryCache = cache;
    await writeCache(cache);
    const output = normalized.items.length ? result('remote', normalized.items, normalized.rejectedCount, cache.fetchedAt) : result('empty', [], normalized.rejectedCount, cache.fetchedAt);
    diagnostics('success', { source: output.source, acceptedCount: output.acceptedCount, rejectedCount: output.rejectedCount, cacheAgeBucket: output.cacheAgeBucket });
    return output;
  } catch {
        const cached = usableCached(await readCache(Date.now(), api.origin), Date.now());
        const output = cached ? (cached.cache.kind === 'empty' ? result('empty', [], 0, cached.cache.fetchedAt) : result('lkg', cached.items, 0, cached.cache.fetchedAt)) : result('static', []);
        diagnostics(callerAborted ? 'unmounted' : controller.signal.aborted ? 'timeout' : 'network_failure', { source: output.source, acceptedCount: output.acceptedCount, rejectedCount: 0, cacheAgeBucket: output.cacheAgeBucket, transient: true });
    return output;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loadNovaPulseAnnouncements(signal?: AbortSignal): Promise<NovaPulseAnnouncementsResult> {
  if (!NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED) return result('static', []);
  const memory = getCachedNovaPulseAnnouncements();
  if (memory?.cacheAgeBucket === 'fresh') return memory;
  if (inFlight) return inFlight;
  inFlight = fetchRemote(signal).finally(() => { inFlight = null; });
  return inFlight;
}

export function clearNovaPulseAnnouncementsCacheForTests() {
  memoryCache = null;
  inFlight = null;
}
