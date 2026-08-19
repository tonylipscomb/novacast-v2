import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CONSTRAINED_VOD_BUFFER,
  NORMAL_VOD_BUFFER,
  VOD_CONSTRAINED_HEAP_BYTES,
  getActiveVodPlayerCount,
  noteVodPlayerCreated,
  noteVodPlayerReleased,
  resetVodPlayerMemoryForTests,
  resolveVodBufferProfile,
} from '../src/features/playback/vodPlayerMemory.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const playerHook = read('src/features/playback/NovaStreamPlayer.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const overlay = read('src/features/playback/unified/UnifiedPlayerOverlay.tsx');
const live = read('src/features/live/LiveTvScreen.tsx');

test('constrained VOD profile caps allocator well below the 128MB Fire TV heap', () => {
  const maxBytes = CONSTRAINED_VOD_BUFFER.bufferOptions.maxBufferBytes;
  assert.equal(typeof maxBytes, 'number');
  assert.ok(maxBytes > 0);
  assert.ok(maxBytes <= 12 * 1024 * 1024);
  assert.equal(CONSTRAINED_VOD_BUFFER.bufferOptions.prioritizeTimeOverSizeThreshold, false);
  assert.ok((CONSTRAINED_VOD_BUFFER.bufferOptions.preferredForwardBufferDuration ?? 0) <= 15);
});

test('unknown or 128MB heap selects constrained; larger heap selects normal', () => {
  assert.equal(resolveVodBufferProfile(null).name, 'constrained');
  assert.equal(resolveVodBufferProfile(128 * 1024 * 1024).name, 'constrained');
  assert.equal(resolveVodBufferProfile(VOD_CONSTRAINED_HEAP_BYTES).name, 'constrained');
  assert.equal(resolveVodBufferProfile(384 * 1024 * 1024).name, 'normal');
  assert.ok((NORMAL_VOD_BUFFER.bufferOptions.maxBufferBytes ?? 0) < 32 * 1024 * 1024);
});

test('VOD player generations are counted and released', () => {
  resetVodPlayerMemoryForTests();
  noteVodPlayerCreated(1);
  noteVodPlayerCreated(2);
  assert.equal(getActiveVodPlayerCount(), 2);
  noteVodPlayerReleased(1);
  assert.equal(getActiveVodPlayerCount(), 1);
  noteVodPlayerReleased(2);
  assert.equal(getActiveVodPlayerCount(), 0);
});

test('UnifiedPlayer VOD requests the bounded policy; Live TV does not', () => {
  assert.match(controller, /bufferPolicy: vodBufferPolicy/);
  assert.match(controller, /mediaType === 'live' \? 'live' : 'vod'/);
  assert.match(playerHook, /bufferPolicy = 'live'/);
  assert.match(playerHook, /applyVodBufferProfile/);
  assert.match(playerHook, /source-bound-on-new-generation/);
  assert.doesNotMatch(live, /bufferPolicy/);
  assert.doesNotMatch(live, /vodPlayerMemory/);
  assert.doesNotMatch(live, /applyVodBufferProfile/);
});

test('TextureView VOD chrome repair remains in place', () => {
  assert.match(overlay, /rc-firetv-vod-textureview/);
  assert.match(overlay, /return 'textureView'/);
  assert.match(overlay, /surfaceType=\{effectiveSurfaceType\}/);
});

test('OOM source errors are classified without infinite retry wiring', () => {
  assert.match(playerHook, /outofmemory\|out of memory\|oom/);
  assert.match(controller, /lastPlaybackRetryAtRef/);
  assert.doesNotMatch(controller, /setInterval\(.*retry/);
});
