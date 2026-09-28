import {
  buildOpenMeteoUrl,
  normalizeNovaPulseWeatherResponse,
  readNovaPulseWeatherConfig,
  weatherProjectionLimits,
} from './novapulseWeather.ts';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const now = Date.parse('2026-09-28T12:00:00.000Z');
const config = { latitude: 37.54, longitude: -77.43, locationLabel: 'Configured Market', timezone: 'America/New_York', marketTheme: 'urban' as const };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    current: { temperature_2m: 72.4, weather_code: 2, time: '2026-09-28T11:55:00-04:00', is_day: 1 },
    daily: { temperature_2m_max: [78.1], temperature_2m_min: [59.2], precipitation_probability_max: [20] },
    ...overrides,
  };
}

Deno.test('weather config requires a bounded server location and never uses client location', () => {
  const env = { get: (name: string) => ({ NOVAPULSE_WEATHER_LATITUDE: '37.54', NOVAPULSE_WEATHER_LONGITUDE: '-77.43', NOVAPULSE_WEATHER_LOCATION_LABEL: 'Configured Market', NOVAPULSE_WEATHER_TIMEZONE: 'America/New_York' } as Record<string, string>)[name] };
  assert(readNovaPulseWeatherConfig(env)?.locationLabel === 'Configured Market', 'configured location accepted');
  assert(readNovaPulseWeatherConfig({ get: () => undefined }) === null, 'missing configuration is empty');
});

Deno.test('valid weather payload is projected into bounded public fields', () => {
  const result = normalizeNovaPulseWeatherResponse(payload(), config, now);
  assert(result?.temperatureF === 72, 'temperature rounded');
  assert(result?.condition === 'Partly Cloudy', 'condition normalized');
  assert(result?.highF === 78 && result?.lowF === 59, 'daily range projected');
  assert(result?.precipitationProbability === 20, 'precipitation projected');
  assert(result?.attribution === 'Open-Meteo', 'attribution retained');
  assert(result?.isDay === true && result?.marketTheme === 'urban', 'presentation context projected');
});

Deno.test('malformed, missing, and implausibly dated weather fail closed', () => {
  assert(normalizeNovaPulseWeatherResponse(null, config, now) === null, 'null rejected');
  assert(normalizeNovaPulseWeatherResponse(payload({ current: {} }), config, now) === null, 'missing current rejected');
  assert(normalizeNovaPulseWeatherResponse(payload({ current: { temperature_2m: 72, weather_code: 2, time: '2030-01-01T00:00:00Z' } }), config, now) === null, 'future observation rejected');
});

Deno.test('provider URL is server-only and the request shape is bounded', () => {
  const url = buildOpenMeteoUrl(config);
  assert(url.origin === 'https://api.open-meteo.com', 'provider URL stays in shared server code');
  assert(url.searchParams.get('forecast_days') === '1', 'one-day forecast');
  assert(url.searchParams.get('temperature_unit') === 'fahrenheit', 'TV unit');
  assert(url.searchParams.get('current')?.includes('is_day') === true, 'day/night signal requested');
  assert(weatherProjectionLimits().freshMs === 30 * 60_000, 'fresh window');
  assert(weatherProjectionLimits().staleMs === 2 * 60 * 60_000, 'stale window');
});
