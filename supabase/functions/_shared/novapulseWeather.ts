export type NovaPulseWeatherProjection = {
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
  marketTheme: 'generic' | 'urban' | 'coastal' | 'desert' | 'mountain';
};

export type NovaPulseWeatherConfig = {
  latitude: number;
  longitude: number;
  locationLabel: string;
  timezone: string;
  marketTheme: NovaPulseWeatherProjection['marketTheme'];
};

const MAX_LOCATION_LABEL = 80;
const MAX_FORECAST_AGE_MS = 30 * 60_000;
const MAX_STALE_AGE_MS = 2 * 60 * 60_000;

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function conditionForCode(value: unknown) {
  const code = finiteNumber(value);
  if (code == null || !Number.isInteger(code) || code < 0 || code > 99) return null;
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  return 'Thunderstorms';
}

function marketThemeForValue(value: unknown): NovaPulseWeatherConfig['marketTheme'] {
  return value === 'urban' || value === 'coastal' || value === 'desert' || value === 'mountain' ? value : 'generic';
}

export function readNovaPulseWeatherConfig(env: Pick<Deno.Env, 'get'> = Deno.env): NovaPulseWeatherConfig | null {
  const latitude = finiteNumber(env.get('NOVAPULSE_WEATHER_LATITUDE'));
  const longitude = finiteNumber(env.get('NOVAPULSE_WEATHER_LONGITUDE'));
  const locationLabel = env.get('NOVAPULSE_WEATHER_LOCATION_LABEL')?.replace(/\s+/g, ' ').trim() ?? '';
  const timezone = env.get('NOVAPULSE_WEATHER_TIMEZONE')?.trim() || 'auto';
  const marketTheme = marketThemeForValue(env.get('NOVAPULSE_WEATHER_MARKET_THEME')?.trim().toLowerCase());
  if (latitude == null || latitude < -90 || latitude > 90 || longitude == null || longitude < -180 || longitude > 180 || !locationLabel || locationLabel.length > MAX_LOCATION_LABEL) return null;
  return { latitude, longitude, locationLabel, timezone, marketTheme };
}

function arrayNumber(value: unknown, index = 0) {
  return Array.isArray(value) ? finiteNumber(value[index]) : null;
}

export function normalizeNovaPulseWeatherResponse(
  payload: unknown,
  config: NovaPulseWeatherConfig,
  nowMs = Date.now(),
): NovaPulseWeatherProjection | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const current = root.current;
  const daily = root.daily;
  if (!current || typeof current !== 'object' || !daily || typeof daily !== 'object') return null;
  const currentRecord = current as Record<string, unknown>;
  const dailyRecord = daily as Record<string, unknown>;
  const temperatureF = finiteNumber(currentRecord.temperature_2m);
  const condition = conditionForCode(currentRecord.weather_code);
  const highF = arrayNumber(dailyRecord.temperature_2m_max);
  const lowF = arrayNumber(dailyRecord.temperature_2m_min);
  const observedAt = typeof currentRecord.time === 'string' ? Date.parse(currentRecord.time) : Number.NaN;
  const precipitation = arrayNumber(dailyRecord.precipitation_probability_max);
  const isDay = typeof currentRecord.is_day === 'number' && (currentRecord.is_day === 0 || currentRecord.is_day === 1)
    ? currentRecord.is_day === 1
    : undefined;
  if (temperatureF == null || condition == null || highF == null || lowF == null || !Number.isFinite(observedAt) || observedAt > nowMs + 24 * 60 * 60_000 || observedAt < nowMs - 24 * 60 * 60_000) return null;
  const fetchedAt = new Date(nowMs).toISOString();
  return {
    locationLabel: config.locationLabel,
    temperatureF: Math.round(temperatureF),
    condition,
    highF: Math.round(highF),
    lowF: Math.round(lowF),
    ...(precipitation != null && precipitation >= 0 && precipitation <= 100 ? { precipitationProbability: Math.round(precipitation) } : {}),
    observedAt: new Date(observedAt).toISOString(),
    expiresAt: new Date(nowMs + MAX_FORECAST_AGE_MS).toISOString(),
    staleAt: new Date(nowMs + MAX_STALE_AGE_MS).toISOString(),
    attribution: 'Open-Meteo',
    ...(isDay !== undefined ? { isDay } : {}),
    marketTheme: config.marketTheme,
  };
}

export function weatherProjectionLimits() {
  return { freshMs: MAX_FORECAST_AGE_MS, staleMs: MAX_STALE_AGE_MS };
}

export function buildOpenMeteoUrl(config: NovaPulseWeatherConfig) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(config.latitude));
  url.searchParams.set('longitude', String(config.longitude));
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('timezone', config.timezone);
  url.searchParams.set('forecast_days', '1');
  return url;
}
