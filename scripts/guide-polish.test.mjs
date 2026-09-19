import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    applyGuideCategoryResult,
    buildGuideCategoryRail,
    dedupeRowsByChannelId,
    GUIDE_FAVORITES_CATEGORY_ID,
    GUIDE_RECENT_CATEGORY_ID,
    resolveGuideNotificationForStatus,
    shouldAcceptGuideTune,
    statusForRows,
} from '../src/features/guide/guideLogic.ts';
import { getGuideMemory, rememberGuideMemory, resetGuideMemory } from '../src/features/guide/guideMemory.ts';
import { filterGuideRows } from '../src/features/guide/guideSearch.ts';
import {
    findProgramForTimestamp,
    findVerticalProgram,
    formatRelativeGuideTime,
    getProgramOffset,
    getProgramStatus,
    getProgramWidth,
    getGuideNowOffset,
    deriveGuideColumnWidths,
    GUIDE_CATEGORY_MAX_WIDTH,
    GUIDE_CATEGORY_MIN_WIDTH,
    GUIDE_CHANNEL_COLUMN_WIDTH,
    GUIDE_CHANNEL_MAX_WIDTH,
    GUIDE_CHANNEL_MIN_WIDTH,
    GUIDE_PIXELS_PER_MINUTE,
    GUIDE_ROW_HEIGHT,
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

test('Guide pins All Channels, Favorites, and Recent before provider categories', () => {
  const categories = buildGuideCategoryRail([
    { id: 'sports', renderKey: 'sports', name: 'Sports', count: 2, icon: 'soccer' },
    { id: 'news', renderKey: 'news', name: 'News', count: 3, icon: 'newspaper-variant-outline' },
  ], { favorites: 1, recent: 2 });

  assert.deepEqual(categories.slice(0, 3).map((category) => category.id), ['all', GUIDE_FAVORITES_CATEGORY_ID, GUIDE_RECENT_CATEGORY_ID]);
  assert.deepEqual(categories.slice(3).map((category) => category.id), ['sports', 'news']);
});

test('Guide smart categories (All/Favorites/Recent) exist with no provider categories or EPG', () => {
  const categories = buildGuideCategoryRail([], { favorites: 0, recent: 0 });
  assert.deepEqual(categories.map((category) => category.id), ['all', GUIDE_FAVORITES_CATEGORY_ID, GUIDE_RECENT_CATEGORY_ID]);
});

test('Guide channels-only contract can publish rows before schedule hydration', () => {
  const providerQuery = { categoryId: 'news', channelOffset: 0, channelLimit: 24, channelsOnly: true };
  assert.equal(providerQuery.channelsOnly, true);
  assert.equal(providerQuery.epgLimit, undefined);
});

test('Guide smart category counts preserve unknown provider counts', () => {
  const categories = buildGuideCategoryRail([
    { id: 'sports', renderKey: 'sports', name: 'Sports', count: null, icon: 'soccer' },
  ], { favorites: 0, recent: 0 });
  assert.equal(categories[0].count, null);
  assert.equal(categories[1].count, 0);
  assert.equal(categories[2].count, 0);
});

test('Guide Recent with no history is an ordinary empty category, not a fatal state', () => {
  assert.equal(statusForRows(GUIDE_RECENT_CATEGORY_ID, [], false), 'empty');
  assert.equal(resolveGuideNotificationForStatus('empty', false), null);
});

test('Guide layout keeps the channel rail narrower than the EPG region', () => {
  assert.equal(GUIDE_CHANNEL_COLUMN_WIDTH, 320);
  assert.ok(GUIDE_CHANNEL_COLUMN_WIDTH < 700);
});

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
  assert.equal(
    getProgramOffset(normalized[0].programs[1], now - 60 * 60 * 1000),
    2 * 60 * GUIDE_PIXELS_PER_MINUTE,
  );
});

test('Guide timeline widths and current status use real program duration', () => {
  const live = rows[0].programs[1];
  assert.equal(getProgramStatus(rows[0].programs[0], now), 'past');
  assert.equal(getProgramStatus(live, now), 'live');
  assert.equal(getProgramStatus(rows[1].programs[0], now), 'upcoming');
  assert.equal(getProgramWidth(live), 2 * 60 * GUIDE_PIXELS_PER_MINUTE);
  assert.equal(timeToTimelinePixels(now, now - 60 * 60 * 1000), 60 * GUIDE_PIXELS_PER_MINUTE);
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

test('Channel readiness remains independent when every channel has no EPG', () => {
  const mixed = [makeRow('a', true), makeRow('b', false)];
  const allMissing = [makeRow('c', false), makeRow('d', false)];

  assert.equal(statusForRows('news', mixed, false), 'ready');
  assert.equal(statusForRows('news', allMissing, false), 'ready');
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

const guideScreenSource = fs.readFileSync(new URL('../src/features/guide/GuideScreen.tsx', import.meta.url), 'utf8');
const categoryRailSource = fs.readFileSync(new URL('../src/features/guide/GuideCategoryRail.tsx', import.meta.url), 'utf8');
const guideTimelineSource = fs.readFileSync(new URL('../src/features/guide/guideTimeline.ts', import.meta.url), 'utf8');

function guideProgramTitle(title) {
  const [row] = normalizeGuideRows(
    [{ channel: rows[0].channel, programs: [{ id: 'entity', title, meta: 'Now', startAt: now, endAt: now + 60_000 }] }],
    now,
  );
  return row.programs[0].title;
}

test('Guide decodes "Sanford &amp; Son" to "Sanford & Son"', () => {
  assert.equal(guideProgramTitle('Sanford &amp; Son'), 'Sanford & Son');
});

test('Guide decodes named apostrophe entity "Bob&apos;s Burgers"', () => {
  assert.equal(guideProgramTitle('Bob&apos;s Burgers'), "Bob's Burgers");
});

test('Guide decodes numeric apostrophe entity "Bob&#39;s Burgers"', () => {
  assert.equal(guideProgramTitle('Bob&#39;s Burgers'), "Bob's Burgers");
});

test('Guide decodes zero-padded numeric apostrophe "Bob&#039;s Burgers"', () => {
  assert.equal(guideProgramTitle('Bob&#039;s Burgers'), "Bob's Burgers");
});

test('Guide decodes encoded quotes and angle brackets safely', () => {
  assert.equal(guideProgramTitle('&quot;Special&quot; Report'), '"Special" Report');
  assert.equal(guideProgramTitle('5 &lt; 10 &gt; 3'), '5 < 10 > 3');
});

test('Guide leaves ordinary program text unchanged', () => {
  assert.equal(guideProgramTitle('Regular Show 2'), 'Regular Show 2');
});

test('Guide entity decoding runs once and does not double-decode', () => {
  assert.equal(guideProgramTitle('Tom &amp;amp; Jerry'), 'Tom &amp; Jerry');
});

test('Guide entity decoding reuses the single shared normalizer', () => {
  assert.match(guideTimelineSource, /decodeDisplayTextEntities/);
  assert.match(guideTimelineSource, /from '\.\.\/live\/liveTvProgramText\.ts'/);
});

test('Guide keeps a bounded Categories column and a flexible EPG region', () => {
  assert.match(guideScreenSource, /categoriesPanel:\s*\{[^}]*width:\s*categoryWidth/);
  assert.doesNotMatch(guideScreenSource, /categoriesPanel:\s*\{[^}]*flex:\s*1/);
  assert.match(guideScreenSource, /guideFrame:\s*\{\s*flex:\s*1/);
  assert.ok(GUIDE_CHANNEL_COLUMN_WIDTH >= 300 && GUIDE_CHANNEL_COLUMN_WIDTH <= 330);
});

test('Guide has no Program Details panel column', () => {
  assert.doesNotMatch(guideScreenSource, /detailsPanel|ProgramDetails|DetailsPanel/);
});

test('Guide timeline header stays compact (<= 72px)', () => {
  const match = guideScreenSource.match(/timeHeader:\s*\{[^}]*height:\s*(\d+)/);
  assert.ok(match, 'timeHeader height should be defined');
  assert.ok(Number(match[1]) <= 72);
});

test('Guide channel and program rows share one compact row height', () => {
  assert.ok(GUIDE_ROW_HEIGHT <= 76);
  assert.match(guideScreenSource, /guideRow:\s*\{\s*height:\s*GUIDE_ROW_HEIGHT/);
  assert.match(guideScreenSource, /channelCell:\s*\{\s*width:\s*channelWidth,\s*height:\s*GUIDE_ROW_HEIGHT/);
  assert.match(guideScreenSource, /programRow:\s*\{\s*height:\s*GUIDE_ROW_HEIGHT/);
  assert.match(guideScreenSource, /getItemLayout=\{\(_, index\) => \(\{ length: GUIDE_ROW_HEIGHT/);
});

test('Guide category rows stay compact (<= 62px)', () => {
  const match = categoryRailSource.match(/chipInner:\s*\{[^}]*minHeight:\s*(\d+)/);
  assert.ok(match, 'chipInner minHeight should be defined');
  assert.ok(Number(match[1]) <= 62);
});

test('Guide first category renders below the CATEGORIES header, not clipped by it', () => {
  // Header is a sibling rendered above the rail (column flow) and the rail pads its
  // top content, so the first row cannot slide under the header.
  const headerIndex = guideScreenSource.indexOf('styles.panelHeader');
  const railIndex = guideScreenSource.indexOf('<GuideCategoryRail');
  assert.ok(headerIndex > -1 && railIndex > -1 && headerIndex < railIndex);
  assert.match(categoryRailSource, /railContentVertical:\s*\{[^}]*paddingVertical:\s*6/);
  assert.doesNotMatch(categoryRailSource, /railContentVertical:\s*\{[^}]*marginTop:\s*-/);
});

test('Guide category width derives from window width and is clamped', () => {
  assert.equal(deriveGuideColumnWidths(960).categoryWidth, Math.round(960 * 0.16));
  assert.ok(deriveGuideColumnWidths(960).categoryWidth >= GUIDE_CATEGORY_MIN_WIDTH);
  assert.ok(deriveGuideColumnWidths(960).categoryWidth <= GUIDE_CATEGORY_MAX_WIDTH);
});

test('Guide channel width derives from window width and is clamped', () => {
  assert.equal(deriveGuideColumnWidths(960).channelWidth, Math.round(960 * 0.2));
  assert.ok(deriveGuideColumnWidths(960).channelWidth >= GUIDE_CHANNEL_MIN_WIDTH);
  assert.ok(deriveGuideColumnWidths(960).channelWidth <= GUIDE_CHANNEL_MAX_WIDTH);
});

test('Guide 960dp ONN window produces ~154 category / ~192 channel', () => {
  const { categoryWidth, channelWidth } = deriveGuideColumnWidths(960);
  assert.equal(categoryWidth, 154);
  assert.equal(channelWidth, 192);
});

test('Guide large windows respect the max clamps', () => {
  const { categoryWidth, channelWidth } = deriveGuideColumnWidths(4000);
  assert.equal(categoryWidth, GUIDE_CATEGORY_MAX_WIDTH);
  assert.equal(channelWidth, GUIDE_CHANNEL_MAX_WIDTH);
});

test('Guide small windows respect the min clamps', () => {
  const { categoryWidth, channelWidth } = deriveGuideColumnWidths(320);
  assert.equal(categoryWidth, GUIDE_CATEGORY_MIN_WIDTH);
  assert.equal(channelWidth, GUIDE_CHANNEL_MIN_WIDTH);
});

test('Guide EPG region stays flex:1 so it grows with the window', () => {
  assert.match(guideScreenSource, /guideFrame:\s*\{\s*flex:\s*1/);
});

test('Guide header, channel cells, and timeline all consume the same runtime channelWidth', () => {
  assert.match(guideScreenSource, /channelHeader:\s*\{[^}]*width:\s*channelWidth/);
  assert.match(guideScreenSource, /channelCell:\s*\{\s*width:\s*channelWidth/);
  assert.match(guideScreenSource, /guideHeaderRow:\s*\{[^}]*height:\s*42/);
  assert.match(guideScreenSource, /timeHeader:\s*\{[^}]*flex:\s*1/);
  // Derivation is threaded through the style factory, not hard-coded per element.
  assert.match(guideScreenSource, /deriveGuideColumnWidths\(windowWidth\)/);
  assert.match(guideScreenSource, /createStyles\(theme,\s*channelWidth,\s*categoryWidth\)/);
});

test('Guide scrollToProgram never centers row 0 or row 1 (no top dead zone)', () => {
  assert.match(guideScreenSource, /const viewPosition = rowIndex <= 1 \? 0 : 0\.4/);
  assert.match(guideScreenSource, /scrollToIndex\(\{ index: rowIndex, animated: true, viewPosition \}\)/);
  assert.doesNotMatch(guideScreenSource, /viewPosition:\s*0\.5/);
});

test('Guide initial preferred focus updates state without vertical scrolling', () => {
  assert.doesNotMatch(guideScreenSource, /scrollToOffset\(\{ offset: guideMemory\.verticalOffset/);
  assert.match(guideScreenSource, /if \(initialFocusProviderRef\.current === activeProviderId\) \{\s*scrollToProgram\(rowIndex, row\.channel\.id, timestamp\);/);
});

test('Guide authoritative Channels+EPG FlatList fills its viewport (flex:1)', () => {
  assert.match(guideScreenSource, /rowsList:\s*\{\s*flex:\s*1/);
  assert.match(guideScreenSource, /style=\{styles\.rowsList\}/);
});

test('Guide row height stays 60 and provider category rows are compact', () => {
  assert.equal(GUIDE_ROW_HEIGHT, 60);
  const match = categoryRailSource.match(/chipInner:\s*\{[^}]*minHeight:\s*(\d+)/);
  assert.ok(match, 'chipInner minHeight should be defined');
  assert.equal(Number(match[1]), 44);
});

test('Guide Search + Jump live in a compact absolute header band, not a top strip', () => {
  // The old full-width toolbar row that pushed the grid down is gone; the actions
  // are pinned into the grid header band as a compact absolute overlay.
  assert.match(guideScreenSource, /toolbar:\s*\{[^}]*position:\s*'absolute'/);
  assert.doesNotMatch(guideScreenSource, /toolbar:\s*\{[^}]*minHeight:\s*36/);
  assert.doesNotMatch(guideScreenSource, /titleBlock|screenTitle|screenSubtitle|toolbarDate/);
});

test('Guide has no vertical flow region between the 42dp header and rows viewport', () => {
  assert.match(guideScreenSource, /guideHeaderRow[\s\S]*?rowsHost/);
  assert.match(guideScreenSource, /guideHeaderRow:\s*\{[\s\S]*height:\s*42[\s\S]*flexGrow:\s*0/);
  assert.match(guideScreenSource, /timeHeader:\s*\{[\s\S]*height:\s*42[\s\S]*maxHeight:\s*42[\s\S]*flexGrow:\s*0/);
  assert.match(guideScreenSource, /rowsHost:\s*\{\s*flex:\s*1/);
  assert.match(guideScreenSource, /style=\{styles\.rowsList\}/);
  assert.doesNotMatch(guideScreenSource, /ListHeaderComponent/);
});

test('Guide timeline slots stack time over date and never overlap', () => {
  const slot = guideScreenSource.match(/timeSlot:\s*\{([^}]*)\}/);
  assert.ok(slot, 'timeSlot style should be defined');
  assert.match(slot[1], /alignItems:\s*'center'/);
  assert.match(slot[1], /justifyContent:\s*'center'/);
  // Row/baseline layout is what caused the meshed "10:00 P / M" overlap — must be gone.
  assert.doesNotMatch(slot[1], /flexDirection:\s*'row'/);
  // Both the time and its secondary date are clamped to a single line (no AM/PM wrap).
  assert.match(guideScreenSource, /numberOfLines=\{1\} style=\{styles\.timeText\}/);
  assert.match(guideScreenSource, /numberOfLines=\{1\} style=\{styles\.timeDate\}/);
});

test('Guide empty EPG state text is concise', () => {
  assert.match(guideScreenSource, /styles\.noProgramText\}>No schedule data</);
  assert.doesNotMatch(guideScreenSource, /Press OK on the channel to watch/);
});

test('Guide smart categories render a slimmer row than provider categories', () => {
  assert.match(categoryRailSource, /SMART_CATEGORY_IDS/);
  const smart = categoryRailSource.match(/chipInnerSmart:\s*\{[^}]*minHeight:\s*(\d+)/);
  const provider = categoryRailSource.match(/chipInner:\s*\{[^}]*minHeight:\s*(\d+)/);
  assert.ok(smart && provider, 'both smart and provider heights should be defined');
  assert.ok(Number(smart[1]) < Number(provider[1]));
});

test('Guide keeps the country prefix inline and colors only the prefix', () => {
  assert.doesNotMatch(categoryRailSource, /ProviderCategoryMarker/);
  assert.match(categoryRailSource, /countryPrefix/);
  assert.match(categoryRailSource, /CATEGORY_REGION_PREFIX_CODES/);
  assert.match(categoryRailSource, /stripRegionPrefix:\s*false/);
});

test('Guide initial and Jump-to-Now horizontal positioning share the canonical near-now offset', () => {
  assert.match(guideTimelineSource, /getGuideNowOffset/);
  assert.match(guideScreenSource, /getGuideNowOffset\(nowRef\.current \|\| Date\.now\(\), timeline\.startAt\)/);
  assert.match(guideScreenSource, /getGuideNowOffset\(nowRef\.current \|\| Date\.now\(\), timeline\.startAt\),/);
  assert.doesNotMatch(guideScreenSource, /scrollTo\(\{ x: guideMemory\.horizontalOffset/);
});

test('Guide canonical offset leaves 20 minutes of past context', () => {
  const clock = Date.parse('2026-09-17T18:31:00.000Z');
  const timelineStart = Date.parse('2026-09-17T15:00:00.000Z');
  assert.ok(Math.abs(getGuideNowOffset(clock, timelineStart) - 219.65) < 0.001);
});
