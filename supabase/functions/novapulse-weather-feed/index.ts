import { authenticateActiveDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { buildOpenMeteoUrl, normalizeNovaPulseWeatherResponse, readNovaPulseWeatherConfig } from '../_shared/novapulseWeather.ts';
import { getAdminClient } from '../_shared/supabase.ts';

const REQUEST_TIMEOUT_MS = 8_000;

function response(body: Record<string, unknown>, status = 200) {
  const output = jsonResponse(body, status);
  output.headers.set('Cache-Control', 'no-store, max-age=0');
  return output;
}

async function readWeather() {
  const config = readNovaPulseWeatherConfig();
  if (!config) return { ok: true, weather: null, freshness: { source: 'empty', fetchedAt: null } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(buildOpenMeteoUrl(config), { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!upstream.ok) throw new Error('weather_upstream_unavailable');
    const payload = await upstream.json().catch(() => null);
    const weather = normalizeNovaPulseWeatherResponse(payload, config);
    if (!weather) throw new Error('weather_payload_invalid');
    return { ok: true, weather, freshness: { source: 'remote', fetchedAt: weather.observedAt } };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return response({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    await authenticateActiveDevice(request, getAdminClient());
    return response(await readWeather());
  } catch (error) {
    const category = error instanceof Error
      ? error.message === 'invalid_device'
        ? 'invalid_device'
        : error.message === 'device_not_authorized'
          ? 'device_not_authorized'
          : 'weather_unavailable'
      : 'weather_unavailable';
    return response({ ok: false, error: category }, category === 'invalid_device' ? 401 : category === 'device_not_authorized' ? 403 : 503);
  }
});
