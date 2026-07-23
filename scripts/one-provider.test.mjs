import assert from 'node:assert/strict';
import test from 'node:test';

import { createRepositoryBundle, invalidateRepositoryBundle } from '../src/features/providers/providerBundle.ts';
import {
  createDefaultProviderState,
  createEmptyProviderState,
  hasSavedProvider,
  normalizeProviderState,
  setDemoModeForTests,
} from '../src/features/providers/providerModel.ts';
import { formatProviderExpirationLabel } from '../src/features/providers/providerExpiration.ts';
import { buildLiveChannelPlaybackUrl, buildMoviePlaybackUrl, buildEpisodePlaybackUrl } from '../src/features/providers/providerPlayback.ts';
import { createXtreamProviderRepositories } from '../src/features/providers/providerRepositories.ts';

function makeFakeClient() {
  return {
    async getAccountInfo() {
      return { user_info: { status: 'Active', exp_date: '1893456000' } };
    },
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Action' }];
    },
    async getVodStreams() {
      return [{ stream_id: '101', name: 'Action Movie', category_id: '1' }];
    },
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams() {
      return [{ stream_id: '201', name: 'News Live', category_id: '10', container_extension: 'ts' }];
    },
    async getShortEpg() {
      return { epg_listings: [] };
    },
    async getSeriesCategories() {
      return [{ category_id: '20', category_name: 'Drama' }];
    },
    async getSeries() {
      return [{ series_id: '301', name: 'Drama Series', category_id: '20' }];
    },
    async getSeriesInfo(seriesId) {
      return {
        info: { series_id: seriesId, name: 'Drama Series' },
        episodes: {
          '1': {
            '1': { id: '901', title: 'Pilot', episode_num: '1', season: '1', container_extension: 'ts' },
          },
        },
      };
    },
    buildLiveStreamUrl(streamId) {
      return `https://provider.example/live/${streamId}.ts`;
    },
    buildVodStreamUrl(streamId) {
      return `https://provider.example/movie/${streamId}.mp4`;
    },
    buildSeriesStreamUrl(streamId) {
      return `https://provider.example/series/${streamId}.ts`;
    },
  };
}

test.before(() => setDemoModeForTests(true));
test.after(() => setDemoModeForTests(null));

test('Fresh installs start with no saved provider', () => {
  const empty = createEmptyProviderState();
  assert.equal(empty.providers.length, 0);
  assert.equal(hasSavedProvider(empty), false);
});

test('Saved xtream bundle loads live channels and playback URLs from the builder', async () => {
  const repositories = createXtreamProviderRepositories(makeFakeClient());
  const categories = await repositories.live.getCategories();
  const channels = await repositories.live.getChannels('10');
  const bundle = {
    ...repositories,
    providerId: 'xtream-test',
    providerName: 'Test Provider',
    connectionType: 'xtream',
    generation: 1,
    createdAt: Date.now(),
    accountMetadata: null,
    ready: Promise.resolve(),
    invalidate() {},
  };

  assert.equal(categories[0]?.name, 'News');
  assert.equal(channels[0]?.name, 'News Live');
  assert.match(buildLiveChannelPlaybackUrl(bundle, channels[0]), /\/live\/201\.ts$/);
});

test('Movies and episodes use the active bundle stream URL builder', async () => {
  const repositories = createXtreamProviderRepositories(makeFakeClient());
  const movies = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 5 });
  const bundle = {
    ...repositories,
    providerId: 'xtream-test',
    providerName: 'Test Provider',
    connectionType: 'xtream',
    generation: 1,
    createdAt: Date.now(),
    accountMetadata: null,
    ready: Promise.resolve(),
    invalidate() {},
  };

  assert.equal(movies.items[0]?.title, 'Action Movie');
  assert.match(buildMoviePlaybackUrl(bundle, movies.items[0].id), /\/movie\/101\.mp4$/);
  assert.match(buildEpisodePlaybackUrl(bundle, '901'), /\/series\/901\.ts$/);
});

test('Guide rows stay available without inventing EPG when listings are missing', async () => {
  const repositories = createXtreamProviderRepositories(makeFakeClient());
  const rows = await repositories.guide.getRows();

  assert.equal(rows.length > 0, true);
  assert.equal(rows[0]?.programs.length, 0);
});

test('Xtream providers never show demo expiration labels by default', () => {
  const provider = {
    id: 'xtream-1',
    name: 'Real Provider',
    status: 'active',
    expirationLabel: 'July 30, 2026',
    selected: true,
    connection: {
      type: 'xtream',
      baseUrl: 'https://provider.example',
      username: 'user',
      password: 'secret',
    },
  };

  assert.equal(formatProviderExpirationLabel(provider, null), 'Expiration unavailable');
  assert.equal(formatProviderExpirationLabel(provider, null), 'Expiration unavailable');
});

test('Mock demo provider bundles remain available for focused tests', async () => {
  invalidateRepositoryBundle();

  const provider = createDefaultProviderState().providers[0];
  const bundle = createRepositoryBundle(provider);
  await bundle.ready;

  assert.equal(bundle.connectionType, 'mock');
  assert.match(bundle.streamUrlBuilder.buildLiveStreamUrl('101'), /demo-provider/);
});

test('Invalid saved provider state normalizes to empty instead of demo content', () => {
  const normalized = normalizeProviderState(null);
  assert.equal(normalized.providers.length, 0);
  assert.equal(hasSavedProvider(normalized), false);
});
