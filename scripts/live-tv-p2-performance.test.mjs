import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  areLiveFocusGraphPropsEqual,
  buildLiveFocusGraph,
} from '../src/features/live/liveFocusGraph.ts';
import {
  getLiveChannelIndexSize,
  ingestLiveChannelsYielding,
  resetLiveChannelIndex,
} from '../src/features/search/liveChannelIndex.ts';

const makeChannel = (id, number = 1) => ({
  id,
  categoryId: 'news',
  number,
  name: `Channel ${id}`,
  shortName: id,
  current: 'Program',
  next: '',
  following: '',
  description: '',
  resolution: '',
  audio: '',
  remaining: '',
  progress: 0,
  tone: '#173B67',
  currentStart: '',
  currentEnd: '',
});

test('focus graph reconciles mounted rows once with correct boundaries', () => {
  const graph = buildLiveFocusGraph([
    { id: 'row-0', index: 0, handle: 10 },
    { id: 'row-1', index: 1, handle: 11 },
    { id: 'row-2', index: 2, handle: 12 },
  ], 99);

  assert.deepEqual(graph.get('row-0'), { nextFocusUp: 99, nextFocusDown: 11, nextFocusRight: 10 });
  assert.deepEqual(graph.get('row-1'), { nextFocusUp: 10, nextFocusDown: 12, nextFocusRight: 11 });
  assert.deepEqual(graph.get('row-2'), { nextFocusUp: 11, nextFocusDown: 12, nextFocusRight: 12 });
  assert.equal(areLiveFocusGraphPropsEqual(graph.get('row-1'), graph.get('row-1')), true);
  assert.equal(areLiveFocusGraphPropsEqual(graph.get('row-1'), { nextFocusUp: 10, nextFocusDown: 99, nextFocusRight: 11 }), false);
});

test('focus graph supports sparse long-list mounts without crossing category boundaries', () => {
  const graph = buildLiveFocusGraph([
    { id: 'row-20', index: 20, handle: 20 },
    { id: 'row-22', index: 22, handle: 22 },
  ]);
  assert.deepEqual(graph.get('row-20'), { nextFocusUp: 20, nextFocusDown: 20, nextFocusRight: 20 });
  assert.deepEqual(graph.get('row-22'), { nextFocusUp: 22, nextFocusDown: 22, nextFocusRight: 22 });
});

test('live index yielding publishes only a complete newest generation', async () => {
  resetLiveChannelIndex('p2-yield-test');
  const first = Array.from({ length: 1200 }, (_, index) => makeChannel(`first-${index}`, index));
  const second = [makeChannel('second-only', 2000)];

  const firstBuild = ingestLiveChannelsYielding('p2-yield-test', first, 1);
  assert.equal(getLiveChannelIndexSize('p2-yield-test'), 0);
  const secondBuild = ingestLiveChannelsYielding('p2-yield-test', second, 1);
  const [firstResult, secondResult] = await Promise.all([firstBuild, secondBuild]);

  assert.equal(firstResult.committed, false);
  assert.equal(secondResult.committed, true);
  assert.equal(getLiveChannelIndexSize('p2-yield-test'), 1201);
  resetLiveChannelIndex('p2-yield-test');
});

test('P2 source contract keeps P1 player and EPG paths intact', async () => {
  const [channelList, player, model, diagnostics] = await Promise.all([
    readFile(new URL('../src/features/live/LiveTvChannelList.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/playback/NovaStreamPlayer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/live/useLiveTvScreenModel.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/live/liveTvDiagnostics.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(channelList, /requestAnimationFrame/);
  assert.match(channelList, /cancelAnimationFrame/);
  assert.match(channelList, /recordLiveMountedRowChange/);
  assert.match(channelList, /extraData=\{listExtraData\}/);
  assert.match(player, /replaceAsync/);
  assert.match(model, /ingestLiveChannelsYielding/);
  assert.match(model, /buildLiveTvChannelEpgMap/);
  assert.match(diagnostics, /liveBrowseInputCount % 8/);
  assert.match(diagnostics, /lastLoggedAt < 1_000/);
  assert.match(diagnostics, /live_browse_correlation/);
});
