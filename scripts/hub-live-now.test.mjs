import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findLiveNowCategory,
  findUsEntertainmentCategory,
  loadRandomUsEntertainmentChannels,
  pickRandomChannels,
} from '../src/features/hub/hubLiveNow.ts';

test('findUsEntertainmentCategory matches US entertainment naming variants', () => {
  const categories = [
    { id: '1', name: 'UK - Entertainment', renderKey: '1', count: 10 },
    { id: '2', name: 'US | Entertainment', renderKey: '2', count: 120 },
    { id: '3', name: 'Sports', renderKey: '3', count: 40 },
  ];

  assert.equal(findUsEntertainmentCategory(categories)?.id, '2');
});

test('findLiveNowCategory falls back to the largest entertainment category', () => {
  const categories = [
    { id: '1', name: 'UK - Entertainment', renderKey: '1', count: 10 },
    { id: '2', name: 'Canada Entertainment', renderKey: '2', count: 45 },
    { id: '3', name: 'Sports', renderKey: '3', count: 40 },
  ];

  assert.equal(findLiveNowCategory(categories)?.id, '2');
});

test('findLiveNowCategory falls back to the largest category when no entertainment match exists', () => {
  const categories = [
    { id: '1', name: 'News', renderKey: '1', count: 10 },
    { id: '2', name: 'Sports', renderKey: '2', count: 40 },
  ];

  assert.equal(findLiveNowCategory(categories)?.id, '2');
});

test('pickRandomChannels returns unique random picks', () => {
  const channels = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    categoryId: '2',
    name: `Channel ${index}`,
    shortName: `C${index}`,
    current: 'Live',
    tone: '#000',
    streamUrl: '',
    number: index,
  }));

  const picks = pickRandomChannels(channels, 3);
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map((channel) => channel.id)).size, 3);
});

test('loadRandomUsEntertainmentChannels enriches the picked live rows with EPG', async () => {
  const channels = [
    {
      id: 'alpha',
      categoryId: 'ent',
      name: 'Alpha',
      shortName: 'A',
      current: 'Live',
      next: 'Later',
      following: 'After',
      description: 'Raw',
      tone: '#000',
      streamUrl: '',
      number: 1,
      currentStart: '',
      currentEnd: '',
      remaining: '',
      progress: 0,
      resolution: '',
      audio: '',
    },
  ];

  const liveNow = await loadRandomUsEntertainmentChannels(
    async () => [{ id: 'ent', name: 'US Entertainment', renderKey: 'ent', count: 1 }],
    async () => channels,
    async () => [
      { id: 'p1', title: 'Morning News', meta: '10 min left', description: 'Top story', start: '10:00', end: '10:30' },
      { id: 'p2', title: 'Next Up', meta: '', start: '10:30', end: '11:00' },
    ],
    1,
  );

  assert.equal(liveNow[0].current, 'Morning News');
  assert.equal(liveNow[0].next, 'Next Up');
  assert.equal(liveNow[0].description, 'Top story');
});
