import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceAuthHeaders } from '@/features/device/deviceRegistration';
import type { NovaPulseItem } from './novaPulseTypes';
import { resolveNovaPulseWeatherArt } from './novaPulseWeatherArt';

export const NOVA_PULSE_WEATHER_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_WEATHER_ENABLED === 'true';
export const NOVA_PULSE_WEATHER_MEMORY_MAX_AGE_MS = 20 * 60_000;
export const NOVA_PULSE_WEATHER_STALE_MAX_AGE_MS = 2 * 60 * 60_000;
export const NOVA_PULSE_WEATHER_STORAGE_KEY = '@novacast/novapulse-weather-v1';

export type WeatherProjection = {
  locationLabel: string;
  temperatureF: number;
  condition: string;
  highF: number;
  lowF: number;
  precipitationProbability?: number;
  observedAt: string;
  expiresAt: string;
  staleAt: string;
  attribution: 'Open-Meteo';
  isDay?: boolean;
  marketTheme?: string;
};

type CachedWeather = { schemaVersion: 1; fetchedAt: number; kind: 'weather' | 'empty'; weather: WeatherProjection | null };
export type NovaPulseWeatherResult = { source: 'remote' | 'lkg' | 'empty' | 'none'; item: NovaPulseItem | null; cacheAgeBucket?: 'fresh' | 'under_2h' | 'expired' };

let memoryCache: CachedWeather | null = null;
let inFlight: Promise<NovaPulseWeatherResult> | null = null;
let storageRead: Promise<CachedWeather | null> | null = null;

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) return null;
  return { apiUrl, anonKey };
}

function toWeatherItem(weather: WeatherProjection): NovaPulseItem {
  const art = resolveNovaPulseWeatherArt({ condition: weather.condition, isDay: weather.isDay, marketTheme: weather.marketTheme });
  const rain = weather.precipitationProbability == null ? '' : ` · ${weather.precipitationProbability}% rain`;
  return {
    id: 'novapulse-weather',
    type: 'weather',
    subtype: 'featured',
    title: 'Weather Now',
    subtitle: weather.locationLabel,
    message: `${weather.temperatureF}°F · ${weather.condition}`,
    description: `H ${weather.highF}°F · L ${weather.lowF}°F${rain}`,
    secondaryText: 'Source: Open-Meteo',
    badgeOverride: 'WEATHER',
    priority: 42,
    publishedAt: Date.parse(weather.observedAt),
    expiresAt: weather.expiresAt,
    updatedAt: Date.parse(weather.observedAt),
    action: { type: 'none' },
    weatherArtKey: art.key,
    sourceId: 'weather',
    sourceItemId: 'configured-weather',
  };
}

function validateWeather(value: unknown, nowMs = Date.now()): WeatherProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const strings = ['locationLabel', 'condition', 'observedAt', 'expiresAt', 'staleAt'] as const;
  if (strings.some((key) => typeof row[key] !== 'string' || !(row[key] as string).trim())) return null;
  const numbers = ['temperatureF', 'highF', 'lowF'] as const;
  if (numbers.some((key) => typeof row[key] !== 'number' || !Number.isFinite(row[key]))) return null;
  if (row.attribution !== 'Open-Meteo') return null;
  const observedAt = Date.parse(row.observedAt as string);
  const staleAt = Date.parse(row.staleAt as string);
  if (!Number.isFinite(observedAt) || !Number.isFinite(staleAt) || staleAt <= nowMs || observedAt > nowMs + 24 * 60 * 60_000 || observedAt < nowMs - 24 * 60 * 60_000) return null;
  const probability = row.precipitationProbability;
  if (probability != null && (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 100)) return null;
  return row as unknown as WeatherProjection;
}

function parseCache(value: unknown, nowMs = Date.now()): CachedWeather | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || (row.kind !== 'weather' && row.kind !== 'empty') || typeof row.fetchedAt !== 'number' || !Number.isFinite(row.fetchedAt)) return null;
  if (row.kind === 'empty') return { schemaVersion: 1, fetchedAt: row.fetchedAt, kind: 'empty', weather: null };
  const weather = validateWeather(row.weather, nowMs);
  return weather ? { schemaVersion: 1, fetchedAt: row.fetchedAt, kind: 'weather', weather } : null;
}

function resultFromCache(cache: CachedWeather, nowMs = Date.now()): NovaPulseWeatherResult | null {
  const age = nowMs - cache.fetchedAt;
  if (age < 0 || age >= NOVA_PULSE_WEATHER_STALE_MAX_AGE_MS) return null;
  if (cache.kind === 'empty') return { source: 'empty', item: null, cacheAgeBucket: age < NOVA_PULSE_WEATHER_MEMORY_MAX_AGE_MS ? 'fresh' : 'under_2h' };
  const weather = cache.weather && validateWeather(cache.weather, nowMs);
  if (!weather) return null;
  return { source: age < NOVA_PULSE_WEATHER_MEMORY_MAX_AGE_MS ? 'remote' : 'lkg', item: toWeatherItem(weather), cacheAgeBucket: age < NOVA_PULSE_WEATHER_MEMORY_MAX_AGE_MS ? 'fresh' : 'under_2h' };
}

async function readStoredCache() {
  if (!storageRead) {
    storageRead = AsyncStorage.getItem(NOVA_PULSE_WEATHER_STORAGE_KEY).then((raw) => {
      if (!raw) return null;
      try { return parseCache(JSON.parse(raw)); } catch { return null; }
    }).catch(() => null);
  }
  return storageRead;
}

async function writeCache(cache: CachedWeather) {
  try { await AsyncStorage.setItem(NOVA_PULSE_WEATHER_STORAGE_KEY, JSON.stringify(cache)); } catch { /* optional cache */ }
}

async function fetchRemote(): Promise<NovaPulseWeatherResult> {
  const api = apiConfig();
  if (!api) return { source: 'none', item: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${api.apiUrl}/novapulse-weather-feed`, {
      method: 'GET',
      cache: 'no-store',
      headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Cache-Control': 'no-cache', ...(await deviceAuthHeaders()) },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; weather?: unknown } | null;
    if (!response.ok || !payload || payload.ok !== true) throw new Error('weather_unavailable');
    const weather = payload.weather == null ? null : validateWeather(payload.weather);
    if (payload.weather != null && !weather) throw new Error('weather_payload_invalid');
    const cache: CachedWeather = { schemaVersion: 1, fetchedAt: Date.now(), kind: weather ? 'weather' : 'empty', weather };
    memoryCache = cache;
    await writeCache(cache);
    return weather ? { source: 'remote', item: toWeatherItem(weather), cacheAgeBucket: 'fresh' } : { source: 'empty', item: null, cacheAgeBucket: 'fresh' };
  } catch {
    const fallback = memoryCache ? resultFromCache(memoryCache) : null;
    return fallback ?? { source: 'none', item: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadNovaPulseWeather(): Promise<NovaPulseWeatherResult> {
  if (!NOVA_PULSE_WEATHER_ENABLED) return { source: 'none', item: null };
  const memory = memoryCache ? resultFromCache(memoryCache) : null;
  if (memory?.cacheAgeBucket === 'fresh') return memory;
  const stored = await readStoredCache();
  if (stored) {
    memoryCache = stored;
    const cached = resultFromCache(stored);
    if (cached?.cacheAgeBucket === 'fresh') return cached;
  }
  if (inFlight) return inFlight;
  inFlight = fetchRemote().finally(() => { inFlight = null; });
  return inFlight;
}

export function clearNovaPulseWeatherCacheForTests() {
  memoryCache = null;
  inFlight = null;
  storageRead = null;
}

export function createNovaPulseWeatherItemForTests(weather: WeatherProjection) {
  return toWeatherItem(weather);
}
