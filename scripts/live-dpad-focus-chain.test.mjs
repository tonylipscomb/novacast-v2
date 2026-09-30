import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const screen = read('src/features/live/LiveTvScreen.tsx');
const channelList = read('src/features/live/LiveTvChannelList.tsx');
const channelRow = read('src/features/live/LiveTvChannelRow.tsx');
const toolbar = read('src/features/movies/components/MovieToolbar.tsx');

test('channel rows keep normal vertical movement and only the top row targets Search', () => {
  assert.match(channelList, /nextFocusUp=\{index === 0 \? channelNextFocusUpHandle : undefined\}/);
  assert.match(channelRow, /nextFocusUp\?: number/);
  assert.match(channelRow, /Platform\.OS === 'android' && nextFocusUp/);
  assert.doesNotMatch(channelList, /useTVEventHandler|onKeyDown/);
});

test('top channel Up targets Search and never directly targets the navbar', () => {
  assert.match(screen, /setChannelNextFocusUpHandle/);
  assert.match(screen, /findNodeHandle\(searchToolbarRef\.current\)/);
  assert.match(screen, /searchNextFocusDown=\{channelNextFocusUpHandle\}/);
  assert.doesNotMatch(channelList, /nextFocusUp=\{[^}]*nav|nextFocusUp=\{[^}]*navbar/i);
});

test('Search Down returns to the channel boundary while Search Up remains native/spatial', () => {
  assert.match(toolbar, /searchNextFocusDown\?: number/);
  assert.match(toolbar, /searchNextFocusUp\?: number/);
  assert.match(toolbar, /nextFocusDown: searchNextFocusDown/);
  assert.doesNotMatch(screen, /searchNextFocusUp=/);
});

test('category/channel anti-jump and horizontal paths remain intact', () => {
  assert.match(channelList, /nextFocusLeft=\{categoryFocusLeftHandle\}/);
  assert.match(screen, /nextFocusRight=\{[\s\S]*categoryNextFocusRightHandle/);
  assert.match(channelRow, /nextFocusLeft\?: number/);
  assert.match(channelRow, /nextFocusRight\?: number/);
  assert.match(channelRow, /nextFocusLeft\s*\}/);
  assert.match(channelRow, /nextFocusRight\s*\}/);
});

test('Movies and Series focus paths are not given Live-specific key interception', () => {
  const movies = read('src/features/movies/MoviesScreen.tsx');
  const series = read('src/features/series/SeriesScreen.tsx');
  assert.doesNotMatch(movies, /LiveTvChannelList|channelNextFocusUpHandle/);
  assert.doesNotMatch(series, /LiveTvChannelList|channelNextFocusUpHandle/);
});
