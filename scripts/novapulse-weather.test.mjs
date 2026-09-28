import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';
import {
  normalizeNovaPulseWeatherCondition,
  normalizeNovaPulseWeatherTheme,
  parseNovaPulseWeatherArtKey,
  resolveNovaPulseWeatherArt,
  weatherArtFallbackChain,
} from '../src/features/novapulse/novaPulseWeatherArt.ts';

const client = fs.readFileSync('src/features/novapulse/novaPulseWeather.ts', 'utf8');
const feed = fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8');
const card = fs.readFileSync('src/features/novapulse/NovaPulseCard.tsx', 'utf8');
const source = fs.readFileSync('src/features/novapulse/novaPulseSources.ts', 'utf8');
const server = fs.readFileSync('supabase/functions/novapulse-weather-feed/index.ts', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');

function item(id, type = 'movie', overrides = {}) {
  return { id, type, title: id, priority: 50, sourceItemId: id, description: 'usable', artworkUrl: 'asset', action: { type: 'none' }, ...overrides };
}

test('valid weather projection creates one non-actionable Weather card', () => {
  const weather = item('novapulse-weather', 'weather', { title: 'Weather Now', badgeOverride: 'WEATHER' });
  const result = composeNovaPulseFeedV2([{ id: 'weather', getItems: () => ({ sourceId: 'weather', items: [weather] }) }], { seed: 'weather' });
  assert.equal(result.items.filter((entry) => entry.type === 'weather').length, 1);
  assert.equal(result.items.find((entry) => entry.type === 'weather')?.action?.type, 'none');
});

test('Weather remains bounded by one card, the information cap, and the rail cap', () => {
  const weather = item('weather', 'weather');
  const announcement = item('notice', 'announcement', { announcementPriority: 'normal' });
  const catalog = Array.from({ length: 20 }, (_, index) => item(`movie-${index}`));
  const result = composeNovaPulseFeedV2([
    { id: 'weather', getItems: () => ({ sourceId: 'weather', items: [weather] }) },
    { id: 'notice', getItems: () => ({ sourceId: 'notice', items: [announcement] }) },
    { id: 'catalog', getItems: () => ({ sourceId: 'catalog', items: catalog }) },
  ]);
  assert.equal(result.items.filter((entry) => entry.type === 'weather').length, 1);
  assert.equal(result.items.filter((entry) => entry.type === 'announcement' || entry.type === 'weather').length, 2);
  assert.ok(result.items.length <= 12);
});

test('missing configuration and provider failures cannot become client provider requests', () => {
  assert.match(client, /EXPO_PUBLIC_NOVAPULSE_WEATHER_ENABLED === 'true'/);
  assert.match(client, /if \(!apiUrl \|\| !anonKey\) return null/);
  assert.match(client, /source: 'none'/);
  assert.match(client, /source: age < NOVA_PULSE_WEATHER_MEMORY_MAX_AGE_MS \? 'remote' : 'lkg'/);
  assert.match(client, /NOVA_PULSE_WEATHER_STALE_MAX_AGE_MS/);
});

test('client uses only the NovaCast weather endpoint and device authentication', () => {
  assert.match(client, /novapulse-weather-feed/);
  assert.match(client, /deviceAuthHeaders\(\)/);
  assert.doesNotMatch(client, /api\.open-meteo\.com/);
  assert.match(feed, /loadNovaPulseWeather/);
  assert.match(feed, /createNovaPulseWeatherSource/);
});

test('server weather function authenticates and returns authoritative empty safely', () => {
  assert.match(server, /authenticateActiveDevice/);
  assert.match(server, /weather: null/);
  assert.match(server, /method_not_allowed/);
  assert.match(server, /Cache-Control/);
});

test('weather uses a server-configured location and does not add device location permission', () => {
  assert.match(server, /readNovaPulseWeatherConfig/);
  assert.match(fs.readFileSync('supabase/functions/_shared/novapulseWeather.ts', 'utf8'), /NOVAPULSE_WEATHER_LOCATION_LABEL/);
  assert.match(env, /EXPO_PUBLIC_NOVAPULSE_WEATHER_ENABLED=false/);
  assert.doesNotMatch(fs.readFileSync('package.json', 'utf8'), /expo-location/);
});

test('weather presentation is bounded, branded, and non-actionable', () => {
  assert.match(source, /id: 'weather'/);
  assert.match(card, /const weather = item\.type === 'weather'/);
  assert.match(card, /item\.badgeOverride \?\? 'WEATHER'/);
  assert.match(card, /action = providerAlert \? null : resolveNovaPulseAction/);
});

test('weather art maps condition, day/night, and configured market theme', () => {
  assert.equal(normalizeNovaPulseWeatherCondition('Thunderstorms'), 'storm');
  assert.equal(normalizeNovaPulseWeatherCondition('light rain'), 'rain');
  assert.equal(normalizeNovaPulseWeatherCondition('unknown provider phrase'), 'cloudy');
  assert.equal(normalizeNovaPulseWeatherTheme('DESERT'), 'desert');
  assert.equal(normalizeNovaPulseWeatherTheme('unsupported'), 'generic');

  assert.deepEqual(resolveNovaPulseWeatherArt({ condition: 'Clear', isDay: true, marketTheme: 'urban' }), {
    key: 'urban_clear_day', conditionGroup: 'clear', theme: 'urban', time: 'day',
  });
  assert.deepEqual(resolveNovaPulseWeatherArt({ condition: 'Rain', isDay: false, marketTheme: 'coastal' }), {
    key: 'coastal_rain_night', conditionGroup: 'rain', theme: 'coastal', time: 'night',
  });
});

test('weather art falls back safely for missing themes and malformed art keys', () => {
  const selection = resolveNovaPulseWeatherArt({ condition: 'Snow', isDay: true });
  assert.equal(selection.key, 'generic_snow_day');
  assert.deepEqual(weatherArtFallbackChain({ key: 'desert_storm_night', conditionGroup: 'storm', theme: 'desert', time: 'night' }), [
    'desert_storm_night', 'generic_storm_night', 'generic_cloudy_night', 'generic_cloudy_day',
  ]);
  assert.deepEqual(parseNovaPulseWeatherArtKey('urban_partly_cloudy_night'), {
    key: 'urban_partly_cloudy_night', conditionGroup: 'partly_cloudy', theme: 'urban', time: 'night',
  });
  assert.equal(parseNovaPulseWeatherArtKey('not-an-art-key').key, 'generic_cloudy_day');
});

test('weather card is wired to the selected hero art without changing action semantics', () => {
  assert.match(client, /weatherArtKey: art\.key/);
  assert.match(card, /<NovaPulseWeatherArt artKey=\{item\.weatherArtKey\}/);
  assert.match(card, /hasWeatherArt/);
  assert.match(card, /action = providerAlert \? null : resolveNovaPulseAction/);
});

test('existing Movie and Series cards remain actionable detail cards', () => {
  const sources = fs.readFileSync('src/features/novapulse/novaPulseSources.ts', 'utf8');
  assert.match(sources, /target: '\/movies', contentId: id/);
  assert.match(sources, /target: '\/series', contentId: id/);
});
