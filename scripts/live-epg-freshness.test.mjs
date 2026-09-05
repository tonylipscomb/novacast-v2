import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_PROGRAM_OVERLAY_TTL_MS,
  isCurrentProgramFresh,
  selectCurrentEpgProgram,
} from '../src/features/live/liveProgramFreshness.ts';
import { enrichChannelWithEpg } from '../src/features/live/liveTvChannelEpg.ts';

const channel = { id: 'sports', categoryId: 'sports', number: 1, name: 'Sports', shortName: 'SP', current: 'old', next: '', following: '', description: '', resolution: '', audio: '', remaining: '', progress: 0, tone: '#000', currentStart: '', currentEnd: '' };
const program = (title, startAt, endAt) => ({ id: title, title, meta: '', startAt, endAt });

test('ended and future programs are rejected; airing program is selected', () => {
  const now = Date.now();
  assert.equal(selectCurrentEpgProgram([program('ended', now - 120000, now - 60000)], now).program, undefined);
  assert.equal(selectCurrentEpgProgram([program('future', now + 60000, now + 120000)], now).program, undefined);
  assert.equal(selectCurrentEpgProgram([program('airing', now - 60000, now + 60000)], now).program.title, 'airing');
});

test('six-hour catalog age cannot make a current-program snapshot fresh', () => {
  const now = Date.now();
  assert.equal(isCurrentProgramFresh({ fetchedAt: now - 6 * 60 * 60 * 1000, now }), false);
  assert.equal(isCurrentProgramFresh({ fetchedAt: now - CURRENT_PROGRAM_OVERLAY_TTL_MS + 1, now }), true);
});

test('empty EPG clears only current metadata and keeps channel publication usable', () => {
  const enriched = enrichChannelWithEpg(channel, []);
  assert.equal(enriched.current, '');
  assert.equal(enriched.id, 'sports');
});
