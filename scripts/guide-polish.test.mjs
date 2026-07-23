import assert from 'node:assert/strict';
import test from 'node:test';

import { filterGuideRows } from '../src/features/guide/guideSearch.ts';
import { getGuideMemory, rememberGuideMemory, resetGuideMemory } from '../src/features/guide/guideMemory.ts';
import {
  applyGuideCategoryResult,
  dedupeRowsByChannelId,
  GUIDE_FAVORITES_CATEGORY_ID,
  resolveGuideNotificationForStatus,
  shouldAcceptGuideTune,
  statusForRows,
} from '../src/features/guide/guideLogic.ts';
import {
  findProgramForTimestamp,
  findVerticalProgram,
  formatRelativeGuideTime,
  getProgramOffset,
  getProgramStatus,
  getProgramWidth,
  normalizeGuideRows,
  parseGuideTimestamp,
  timeToTimelinePixels,
} from '../src/features/guide/guideTimeline.ts';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const rows = normalizeGuideRows([
  {
    channel: { id: 'one', name: 'Nova One', categoryId: 'news', number: 1, shortName: 'N1', tone: '#123456', logoUrl: undefined },
    programs: [
      { id: 'past', title: 'Past News', meta: '10:00 - 11:00', startAt: now - 2 * 60 * 60 * 1000, endAt: now - 60 * 60 * 1000 },
      { id: 'live', title: '<b>Live News</b>', meta: '11:00 - 13:00', startAt: now - 60 * 60 * 1000, endAt: now + 60 * 60 * 1000, description: '<p>Current&nbsp;events</p>' },
    ],
  },
  {
    channel: { id: 'two', name: 'Movie Network', categoryId: 'movies', number: 2, shortName: 'MN', tone: '#654321', logoUrl: undefined },
    programs: [{ id: 'movie', title: 'Tonight Movie', meta: 'Now', startAt: now + 60 * 60 * 1000, endAt: now + 3 * 60 * 60 * 1000 }],
  },
]);

test('Guide timestamps accept seconds, milliseconds, ISO dates, and clock labels safely', () => {
  assert.equal(parseGuideTimestamp(1_752_844_800, now), 1_752_844_800_000);
  assert.equal(parseGuideTimestamp('2026-07-18T12:00:00.000Z', now), now);
  assert.equal(typeof parseGuideTimestamp('8:30 PM', now), 'number');
  assert.equal(parseGuideTimestamp('not a date', now), undefined);
});

test('Guide normalization removes duplicate programs and cleans unsafe metadata', () => {
  const normalized = normalizeGuideRows([
    {
      channel: rows[0].channel,
      programs: [
        { id: 'same', title: 'One', meta: 'Now', startAt: now, endAt: now + 60_000 },
        { id: 'same', title: 'Duplicate', meta: 'Now', startAt: now, endAt: now + 60_000 },
        { id: 'bad', title: '<b>Safe</b>', meta: '', description: '<p>Text&nbsp;here</p>', startAt: now + 1000, endAt: now },
      ],
    },
  ], now);

  assert.equal(normalized[0].programs.length, 2);
  assert.equal(normalized[0].programs[0].title, 'One');
  assert.equal(normalized[0].programs[1].description, 'Text here');
  assert.equal(normalized[0].programs[1].hasValidWindow, false);
});

test('Guide normalization trims overlapping EPG windows instead of rendering collisions', () => {
  const normalized = normalizeGuideRows([
    {
      channel: rows[0].channel,
      programs: [
        { id: 'first', title: 'First', meta: 'Now', startAt: now, endAt: now + 60 * 60 * 1000 },
        { id: 'overlap', title: 'Overlap', meta: 'Next', startAt: now + 30 * 60 * 1000, endAt: now + 2 * 60 * 60 * 1000 },
        { id: 'contained', title: 'Contained', meta: 'Next', startAt: now + 45 * 60 * 1000, endAt: now + 50 * 60 * 1000 },
      ],
    },
  ], now);

  assert.equal(normalized[0].programs.length, 2);
  assert.equal(normalized[0].programs[1].startAt, now + 60 * 60 * 1000);
  assert.equal(getProgramOffset(normalized[0].programs[1], now - 60 * 60 * 1000), 180);
});

test('Guide timeline widths and current status use real program duration', () => {
  const live = rows[0].programs[1];
  assert.equal(getProgramStatus(rows[0].programs[0], now), 'past');
  assert.equal(getProgramStatus(live, now), 'live');
  assert.equal(getProgramStatus(rows[1].programs[0], now), 'upcoming');
  assert.equal(getProgramWidth(live), 180);
  assert.equal(timeToTimelinePixels(now, now - 60 * 60 * 1000), 90);
  assert.equal(formatRelativeGuideTime(live, now), '60 min remaining');
});

test('Guide finds the current program and preserves its timestamp when moving vertically', () => {
  assert.equal(findProgramForTimestamp(rows[0], now)?.id, 'live');
  assert.equal(findVerticalProgram(rows, 1, now, 'up')?.id, 'live');
  assert.equal(findVerticalProgram(rows, 0, now, 'up'), null);
});

test('Guide search matches channel and program names without a network request', () => {
  assert.equal(filterGuideRows(rows, 'all', new Set(), 'movie')[0]?.channel.id, 'two');
  assert.equal(filterGuideRows(rows, 'all', new Set(), 'news')[0]?.programs.length, 2);
  assert.equal(filterGuideRows(rows, 'favorites', new Set(['two']), '').length, 1);
  assert.equal(filterGuideRows(rows, 'favorites', new Set(), '').length, 0);
});

test('Guide memory restores focus, filter, and search independently per provider', () => {
  resetGuideMemory();
  rememberGuideMemory('provider-a', { focusedChannelId: 'one', focusedProgramId: 'live', filter: 'favorites', searchQuery: 'news' });
  rememberGuideMemory('provider-b', { focusedChannelId: 'two', focusedProgramId: 'movie' });

  assert.equal(getGuideMemory('provider-a').focusedProgramId, 'live');
  assert.equal(getGuideMemory('provider-a').filter, 'favorites');
  assert.equal(getGuideMemory('provider-a').searchQuery, 'news');
  assert.equal(getGuideMemory('provider-b').focusedProgramId, 'movie');
  assert.equal(getGuideMemory('provider-b').filter, 'all');
});

test('Guide tuning accepts one OK press and rejects an immediate duplicate', () => {
  const first = { key: 'one-live', at: now };

  assert.equal(shouldAcceptGuideTune(null, 'one-live', now), true);
  assert.equal(shouldAcceptGuideTune(first, 'one-live', now + 100), false);
  assert.equal(shouldAcceptGuideTune(first, 'one-live', now + 400), true);
  assert.equal(shouldAcceptGuideTune(first, 'two-live', now + 100), true);
});

function makeRow(channelId, hasValidWindow) {
  return {
    channel: { id: channelId, name: `Channel ${channelId}`, categoryId: 'news', number: 1, shortName: 'C', tone: '#000', logoUrl: undefined },
    programs: hasValidWindow
      ? [{ id: `${channelId}-p`, title: 'Program', meta: 'Now', startAt: now, endAt: now + 60_000, hasValidWindow: true }]
      : [],
  };
}

test('One channel with no EPG does not force the whole category into a no-EPG state', () => {
  const mixed = [makeRow('a', true), makeRow('b', false)];
  const allMissing = [makeRow('c', false), makeRow('d', false)];

  assert.equal(statusForRows('news', mixed, false), 'ready');
  assert.equal(statusForRows('news', allMissing, false), 'no-epg');
  assert.equal(statusForRows('news', [], false), 'empty');
});

test('Favorites category reports no-favorites only when nothing is favorited', () => {
  assert.equal(statusForRows(GUIDE_FAVORITES_CATEGORY_ID, [], false), 'no-favorites');
  assert.equal(statusForRows(GUIDE_FAVORITES_CATEGORY_ID, [], true), 'empty');
  assert.equal(statusForRows(GUIDE_FAVORITES_CATEGORY_ID, [makeRow('a', true)], true), 'ready');
});

test('Channels stay unique by stable id when pages are merged, keeping the first occurrence', () => {
  const merged = dedupeRowsByChannelId([makeRow('a', true), makeRow('b', false), makeRow('a', false)]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].programs.length, 1);
  assert.deepEqual(merged.map((row) => row.channel.id), ['a', 'b']);
});

test('Changing category ignores a stale page result that resolves after the category changed', () => {
  const rowsForA = [makeRow('a1', true)];
  const rowsForB = [makeRow('b1', true)];

  // Request 1 was issued for category A; request 2 (category B) has already
  // become current by the time A's slow response arrives.
  const staleResult = applyGuideCategoryResult([], {
    requestId: 1,
    currentRequestId: 2,
    categoryId: 'a',
    nextRows: rowsForA,
    hasMore: false,
    totalCount: 1,
    append: false,
    favoritesAvailable: false,
  });

  assert.equal(staleResult.applied, false);
  assert.deepEqual(staleResult.rows, []);

  // The current request (category B) applies normally.
  const currentResult = applyGuideCategoryResult([], {
    requestId: 2,
    currentRequestId: 2,
    categoryId: 'b',
    nextRows: rowsForB,
    hasMore: false,
    totalCount: 1,
    append: false,
    favoritesAvailable: false,
  });

  assert.equal(currentResult.applied, true);
  assert.deepEqual(currentResult.rows.map((row) => row.channel.id), ['b1']);
  assert.equal(currentResult.status, 'ready');
});

test('Loading a second page appends and dedupes instead of replacing the first page', () => {
  const firstPage = applyGuideCategoryResult([], {
    requestId: 1,
    currentRequestId: 1,
    categoryId: 'all',
    nextRows: [makeRow('a', true), makeRow('b', true)],
    hasMore: true,
    totalCount: 4,
    append: false,
    favoritesAvailable: false,
  });

  const secondPage = applyGuideCategoryResult(firstPage.rows, {
    requestId: 1,
    currentRequestId: 1,
    categoryId: 'all',
    nextRows: [makeRow('b', true), makeRow('c', true)],
    hasMore: false,
    totalCount: 4,
    append: true,
    favoritesAvailable: false,
  });

  assert.deepEqual(secondPage.rows.map((row) => row.channel.id), ['a', 'b', 'c']);
  assert.equal(secondPage.hasMore, false);
});

test('Guide notification mapping only turns error/no-epg statuses into a toast', () => {
  assert.equal(resolveGuideNotificationForStatus('ready', false), null);
  assert.equal(resolveGuideNotificationForStatus('empty', false), null);
  assert.equal(resolveGuideNotificationForStatus('no-favorites', false), null);
  assert.equal(resolveGuideNotificationForStatus('loading', false), null);

  const noEpg = resolveGuideNotificationForStatus('no-epg', false);
  assert.equal(noEpg.persistent, false);
  assert.equal(typeof noEpg.title, 'string');
  assert.equal(typeof noEpg.message, 'string');

  const error = resolveGuideNotificationForStatus('error', false);
  assert.equal(error.persistent, false);
  assert.equal(typeof error.title, 'string');
  assert.equal(typeof error.message, 'string');
});

test('Guide notification becomes persistent once a retry has already failed again', () => {
  assert.equal(resolveGuideNotificationForStatus('no-epg', true).persistent, true);
  assert.equal(resolveGuideNotificationForStatus('error', true).persistent, true);
});

test('Guide category selection round-trips through guideMemory, including category id', () => {
  resetGuideMemory('provider-guide-category');
  rememberGuideMemory('provider-guide-category', { selectedCategoryId: 'sports', focusedChannelId: 'ch-9' });

  const restored = getGuideMemory('provider-guide-category');
  assert.equal(restored.selectedCategoryId, 'sports');
  assert.equal(restored.focusedChannelId, 'ch-9');
});
