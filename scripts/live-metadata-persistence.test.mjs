import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  getCatalogDatabase,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import { nativeRecordToLiveChannel } from '../src/features/providers/liveCatalogCompletion.ts';
import {
  publishedLiveRowToChannel,
  resolvePersistedLiveCategoryName,
} from '../src/features/search/livePublishedCatalogRead.ts';
import {
  getPublishedLiveCategories,
  getPublishedLiveChannels,
  publishLiveSearchCatalogFromDump,
  resetLiveSearchCatalogForTests,
} from '../src/features/search/liveSearchSqliteCatalog.ts';

const sqliteSource = fs.readFileSync(new URL('../src/features/search/liveSearchSqliteCatalog.ts', import.meta.url), 'utf8');
const nativeSource = fs.readFileSync(new URL('../modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt', import.meta.url), 'utf8');
const epgSource = fs.readFileSync(new URL('../src/features/live/liveTvChannelEpg.ts', import.meta.url), 'utf8');

test('published Live category names survive the published read-model contract', () => {
  assert.equal(resolvePersistedLiveCategoryName('p1', '10', { '10': 'News' }), 'News');
  assert.equal(resolvePersistedLiveCategoryName('p1', '10', {}), 'Live 10');
  assert.match(sqliteSource, /category_name TEXT/);
  assert.match(sqliteSource, /ensureLiveSearchColumn\(db, 'live_search_category_counts', 'category_name'/);
});

test('native and published Live records preserve epg_channel_id', () => {
  const native = nativeRecordToLiveChannel({
    contentId: '1573476',
    categoryId: '10',
    title: 'Channel',
    epgChannelId: 'ABC.US',
  }, 0);
  assert.equal(native.epgChannelId, 'ABC.US');
  const published = publishedLiveRowToChannel({
    channel_id: '1573476',
    category_id: '10',
    title: 'Channel',
    current_program: null,
    logo_url: null,
    channel_number: 1,
    stream_extension: null,
    epg_channel_id: 'ABC.US',
    tone: null,
  }, 0);
  assert.equal(published.epgChannelId, 'ABC.US');
  assert.match(nativeSource, /preserveLiveEpgChannelId/);
  assert.match(nativeSource, /epg_channel_id/);
  assert.match(sqliteSource, /epg_channel_id TEXT/);
  assert.match(sqliteSource, /ensureLiveSearchColumn\(db, 'live_search_channels', 'epg_channel_id'/);
  assert.match(epgSource, /getShortEpg\(channel\.id, 3, undefined, channel\.epgChannelId\)/);
});

test('schema upgrade only marks the Live search state stale', () => {
  assert.match(sqliteSource, /UPDATE live_search_state SET status = 'stale'/);
  assert.doesNotMatch(sqliteSource, /DELETE FROM (catalog_items|catalog_items_v2|catalog_categories|catalog_categories_v2)/);
});

test('old Live schema migrates, rebuilds once, and remains ready on second initialization', async () => {
  resetLiveSearchCatalogForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  try {
    await initializeCatalogDatabase(':memory:');
    const db = await getCatalogDatabase();
    await db.exec(`
      CREATE TABLE live_search_state (
        provider_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        active_generation INTEGER NOT NULL,
        building_generation INTEGER NOT NULL,
        channel_count INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error_code TEXT
      );
      CREATE TABLE live_search_channels (
        provider_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        category_id TEXT,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        current_program TEXT,
        normalized_current TEXT NOT NULL DEFAULT '',
        logo_url TEXT,
        channel_number INTEGER,
        stream_extension TEXT,
        direct_source TEXT,
        tone TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, generation, channel_id)
      );
      CREATE TABLE live_search_category_counts (
        provider_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        category_id TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        PRIMARY KEY (provider_id, generation, category_id)
      );
    `);
    await db.run(`INSERT INTO live_search_state VALUES (?, 'ready', 7, 0, 1, NULL, NULL, NULL)`, ['p1']);
    await db.run(`INSERT INTO live_search_channels VALUES (?, 7, ?, ?, ?, ?, '', '', NULL, 1, NULL, NULL, NULL, ?)`, ['p1', 'old', '10', 'Old', 'old', Date.now()]);
    await db.run(`INSERT INTO live_search_category_counts VALUES (?, 7, ?, ?)`, ['p1', '10', 1]);
    await db.run(`INSERT OR REPLACE INTO catalog_sync_state (provider_id, media_type, status) VALUES ('p1', 'movie', 'ready'), ('p1', 'series', 'ready')`);

    await publishLiveSearchCatalogFromDump({
      providerId: 'p1',
      categories: [{ id: '10', name: 'Real Provider Name' }],
      channels: [{
        id: '1573476', categoryId: '10', name: 'Example Channel', number: 1,
        current: '', next: '', following: '', description: '', resolution: 'HD',
        audio: 'Stereo', remaining: 'Live', progress: 0, tone: '#173B67',
        currentStart: 'Now', currentEnd: 'Later', epgChannelId: 'ABC.US',
      }],
    });

    const columns = await db.getAll(`PRAGMA table_info(live_search_channels)`);
    const categoryColumns = await db.getAll(`PRAGMA table_info(live_search_category_counts)`);
    assert.ok(columns.some((row) => row.name === 'epg_channel_id'));
    assert.ok(categoryColumns.some((row) => row.name === 'category_name'));
    const state = await db.getFirst(`SELECT status, error_code FROM live_search_state WHERE provider_id = 'p1'`);
    assert.equal(state?.status, 'ready');
    assert.equal(state?.error_code, null);
    const categoryRow = await db.getFirst(`SELECT category_name FROM live_search_category_counts WHERE provider_id = 'p1' AND generation = (SELECT active_generation FROM live_search_state WHERE provider_id = 'p1')`);
    const channelRow = await db.getFirst(`SELECT epg_channel_id FROM live_search_channels WHERE provider_id = 'p1' AND channel_id = '1573476'`);
    assert.equal(categoryRow?.category_name, 'Real Provider Name');
    assert.equal(channelRow?.epg_channel_id, 'ABC.US');

    const categories = await getPublishedLiveCategories('p1');
    const channels = await getPublishedLiveChannels('p1', '10');
    assert.equal(categories[0]?.name, 'Real Provider Name');
    assert.equal(channels[0]?.id, '1573476');
    assert.equal(channels[0]?.epgChannelId, 'ABC.US');

    resetLiveSearchCatalogForTests();
    await publishLiveSearchCatalogFromDump({ providerId: 'p1', channels: [], isCancelled: () => true });
    const secondState = await db.getFirst(`SELECT status, error_code FROM live_search_state WHERE provider_id = 'p1'`);
    assert.equal(secondState?.status, 'ready');
    assert.equal(secondState?.error_code, null);
    assert.equal((await db.getFirst(`SELECT category_name FROM live_search_category_counts WHERE provider_id = 'p1' AND generation = (SELECT active_generation FROM live_search_state WHERE provider_id = 'p1')`))?.category_name, 'Real Provider Name');
    assert.equal((await db.getFirst(`SELECT epg_channel_id FROM live_search_channels WHERE provider_id = 'p1' AND channel_id = '1573476'`))?.epg_channel_id, 'ABC.US');
    assert.equal((await db.getFirst(`SELECT status FROM catalog_sync_state WHERE provider_id = 'p1' AND media_type = 'movie'`))?.status, 'ready');
    assert.equal((await db.getFirst(`SELECT status FROM catalog_sync_state WHERE provider_id = 'p1' AND media_type = 'series'`))?.status, 'ready');
  } finally {
    resetLiveSearchCatalogForTests();
    await resetCatalogDatabaseForTests();
    setCatalogDatabaseOpenerForTests(null);
  }
});
