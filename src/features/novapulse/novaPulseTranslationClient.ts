import AsyncStorage from '@react-native-async-storage/async-storage';

import { analyticsConfig } from '../analytics/analyticsConfig.ts';

export const NOVA_PULSE_TRANSLATION_MAX_LENGTH = 4_000;
const STORAGE_KEY = '@novacast/novapulse-translations-v1';
const CACHE_LIMIT = 64;
const REQUEST_TIMEOUT_MS = 5_000;
const inFlight = new Map<string, Promise<string | null>>();

export const NOVA_PULSE_TRANSLATION_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_TRANSLATION_ENABLED === 'true';

export type NovaPulseTranslationInput = {
  providerId: string;
  mediaType: 'movie' | 'series';
  itemId: string;
  sourceText: string;
  targetLanguage?: 'en';
};

type CachedTranslation = { translation: string; updatedAt: number };

export function novaPulseSourceTextHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cacheKey(input: NovaPulseTranslationInput, hash = novaPulseSourceTextHash(input.sourceText)) {
  return [input.providerId, input.mediaType, input.itemId, hash, input.targetLanguage ?? 'en'].join(':');
}

async function readCache() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, CachedTranslation> : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

async function writeCache(cache: Record<string, CachedTranslation>) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* optional cache */ }
}

async function requestTranslation(input: NovaPulseTranslationInput, key: string) {
  const endpoint = analyticsConfig.endpoint;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!endpoint || !anonKey || !input.sourceText.trim() || input.sourceText.length > NOVA_PULSE_TRANSLATION_MAX_LENGTH) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const { deviceAuthHeaders } = await import('../device/deviceRegistration.ts');
    const response = await fetch(`${endpoint}/novapulse-description-translate`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        ...(await deviceAuthHeaders()),
      },
      body: JSON.stringify({ providerId: input.providerId, mediaType: input.mediaType, itemId: input.itemId, sourceText: input.sourceText, sourceTextHash: key.split(':')[3], targetLanguage: input.targetLanguage ?? 'en' }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; translation?: unknown } | null;
    const translation = payload?.ok === true && typeof payload.translation === 'string' ? payload.translation.trim().slice(0, NOVA_PULSE_TRANSLATION_MAX_LENGTH) : '';
    if (!response.ok || !translation) return null;
    const cache = await readCache();
    cache[key] = { translation, updatedAt: Date.now() };
    const keys = Object.keys(cache).sort((left, right) => cache[left].updatedAt - cache[right].updatedAt);
    while (keys.length > CACHE_LIMIT) delete cache[keys.shift()!];
    await writeCache(cache);
    return translation;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

export async function translateNovaPulseDescription(input: NovaPulseTranslationInput) {
  if (!NOVA_PULSE_TRANSLATION_ENABLED) return null;
  const sourceText = input.sourceText.trim();
  if (!sourceText || sourceText.length > NOVA_PULSE_TRANSLATION_MAX_LENGTH) return null;
  const key = cacheKey({ ...input, sourceText });
  const cached = await readCache();
  if (cached[key]?.translation) return cached[key].translation;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = requestTranslation({ ...input, sourceText }, key).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function clearNovaPulseTranslationCacheForTests() {
  inFlight.clear();
}
