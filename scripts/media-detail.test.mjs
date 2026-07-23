import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMoviePreviewDetail,
  buildSeriesMediaDetail,
  normalizeCast,
} from '../src/features/media-browser/mediaDetail.ts';
import { createXtreamProviderRepositories } from '../src/features/providers/providerRepositories.ts';

test('normalizes provider cast values into safe display records', () => {
  assert.deepEqual(normalizeCast('Emma D\'Arcy, Matt Smith'), [
    { name: "Emma D'Arcy" },
    { name: 'Matt Smith' },
  ]);

  assert.deepEqual(normalizeCast([
    { actor: 'Olivia Cooke', role: 'Alicent Hightower', profile_path: '/olivia.jpg' },
    { name: 'Paddy Considine' },
  ]), [
    { name: 'Olivia Cooke', character: 'Alicent Hightower', imageUrl: '/olivia.jpg' },
    { name: 'Paddy Considine' },
  ]);
});

test('builds movie preview details without provider implementation values', () => {
  const detail = buildMoviePreviewDetail({
    id: 'movie-42',
    title: 'The Example',
    categoryId: 'movies',
    posterUrl: 'https://images.test/example.jpg',
    year: 2026,
    durationMinutes: 124,
    genres: ['Drama'],
    cast: ['A Performer'],
    description: undefined,
  });

  assert.equal(detail.id, 'movie-42');
  assert.equal(detail.mediaType, 'movie');
  assert.equal(detail.runtime, '2h 4m');
  assert.deepEqual(detail.cast, [{ name: 'A Performer' }]);
  assert.equal(detail.synopsis, undefined);
});

test('flattens and sorts provider series episodes for the overlay', () => {
  const detail = buildSeriesMediaDetail({
    seriesId: 'series-7',
    title: 'Example Series',
    year: '2026',
    genres: ['Drama'],
    cast: ['Lead Performer'],
    seasons: [
      { id: 'season-2', label: 'Season 2', seasonNumber: '2', episodeCount: 1 },
      { id: 'season-1', label: 'Season 1', seasonNumber: '1', episodeCount: 1 },
    ],
    episodesBySeason: {
      '2': [{
        id: 'episode-2',
        seriesId: 'series-7',
        title: 'Second Episode',
        seasonNumber: '2',
        episodeNumber: '1',
        streamId: 'stream-2',
        extension: 'mp4',
      }],
      '1': [{
        id: 'episode-1',
        seriesId: 'series-7',
        title: 'First Episode',
        seasonNumber: '1',
        episodeNumber: '1',
        streamId: 'stream-1',
        extension: 'mp4',
      }],
    },
  });

  assert.equal(detail.mediaType, 'series');
  assert.deepEqual(detail.episodes.map((episode) => episode.id), ['episode-1', 'episode-2']);
  assert.deepEqual(detail.seasons.map((season) => season.seasonNumber), [2, 1]);
});

test('maps the Xtream VOD detail endpoint into the normalized model', async () => {
  const repositories = createXtreamProviderRepositories({
    baseUrl: 'https://provider.test',
    getVodInfo: async () => ({
      info: {
        name: 'The Provider Movie',
        plot: 'A safe synopsis.',
        genre: 'Drama, Mystery',
        cast: [{ actor: 'A Performer', character: 'The Lead' }],
        duration_secs: 5400,
        rating: '8.4',
        youtube_trailer: 'example-trailer',
      },
      movie_data: { movie_image: '/poster.jpg' },
    }),
  });

  const detail = await repositories.movies.getMovieInfo?.('42');

  assert.equal(detail?.title, 'The Provider Movie');
  assert.equal(detail?.synopsis, 'A safe synopsis.');
  assert.deepEqual(detail?.genres, ['Drama', 'Mystery']);
  assert.deepEqual(detail?.cast, [{ name: 'A Performer', character: 'The Lead' }]);
  assert.equal(detail?.runtime, '1h 30m');
  assert.equal(detail?.trailerUrl, 'https://www.youtube.com/watch?v=example-trailer');
  assert.equal(detail?.posterUrl, 'https://provider.test/poster.jpg');
});
