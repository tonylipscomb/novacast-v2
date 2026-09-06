import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  buildCatalogSyncKey,
  clearActiveCatalogSqliteWritersForTests,
  clearCatalogSqliteWriterGatesForTests,
  clearCatalogSyncCoordinatorForTests,
  getCatalogSyncJobStatus,
  getCatalogSyncState,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  runCatalogSyncNow,
  setCatalogDatabaseOpenerForTests,
  startCatalogSqliteMediaSync,
  finishCatalogSqliteMediaSync,
  upsertCatalogProvider,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import {
  classifyCatalogMediaJobResults,
} from '../src/features/providers/catalogSyncJobAggregation.ts';
import {
  createMovieSqliteOwnershipState,
  enforceMovieSqliteTerminal,
  finishOwnedMovieSqlite,
  MOVIE_SYNC_CANCELLED_ERROR,
  MOVIE_SYNC_OPEN_SQLITE_ERROR,
  noteMovieSqliteHandle,
  ownsOpenMovieSqliteGeneration,
  terminateMovieSqliteEarlyReturn,
} from '../src/features/providers/movieSqliteOwnership.ts';

function fakeHandle(overrides = {}) {
  return {
    enabled: true,
    providerId: 'movie-ownership',
    mediaType: 'movie',
    generation: 7,
    accounting: {
      decodedCount: 0,
      normalizedCount: 0,
      queuedCount: 0,
      committedCount: 0,
      duplicateCount: 0,
      pendingWriteCount: 0,
      peakBatchMs: 0,
      pressurePauseCount: 0,
      nativeDone: false,
      writerDrained: true,
      processedCategoryCount: 0,
      successfulCategoryCount: 0,
      failedCategoryCount: 0,
      emptyCategoryCount: 0,
      checkpointCategoryIndex: 0,
    },
    pendingCategories: [],
    ...overrides,
  };
}

function createProbeRecorder() {
  const events = [];
  return {
    events,
    probe(event, fields) {
      events.push({ event, ...fields });
    },
  };
}

async function withMovieCatalogDb(fn) {
  clearCatalogSyncCoordinatorForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
  try {
    await fn();
  } finally {
    await resetCatalogDatabaseForTests();
    clearActiveCatalogSqliteWritersForTests();
    clearCatalogSqliteWriterGatesForTests();
    setCatalogDatabaseOpenerForTests(null);
    clearCatalogSyncCoordinatorForTests();
  }
}

test('source: runMovieCatalogSync enforces open sqlite generation terminality', async () => {
  const sync = await fs.readFile(
    new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url),
    'utf8',
  );
  const ownership = await fs.readFile(
    new URL('../src/features/providers/movieSqliteOwnership.ts', import.meta.url),
    'utf8',
  );
  assert.match(sync, /enforceMovieSqliteTerminal/);
  assert.match(sync, /abandoned-open-sqlite-generation/);
  assert.match(sync, /runMovieCatalogSync-enter/);
  assert.match(sync, /startCatalogSqliteMediaSync-returned/);
  assert.match(sync, /rejectAfterOpenSqlite\('return-cancelled-during-probe'/);
  assert.match(sync, /rejectAfterOpenSqlite\('return-playback-deferral-category-loop'/);
  assert.match(sync, /throw new Error\(MOVIE_SYNC_CANCELLED_ERROR\)/);
  assert.match(ownership, /movie_sync_returned_with_open_sqlite_generation/);
  assert.match(ownership, /finishCatalogSqliteMediaSync-enter/);
  assert.match(ownership, /finishCatalogSqliteMediaSync-exit/);
  assert.doesNotMatch(
    sync.slice(sync.indexOf('sqliteHandle = await startCatalogSqliteMediaSync'), sync.indexOf('export async function runSeriesCatalogSync')),
    /markMovieEarlyReturn\('return-cancelled-during-probe'/,
  );
});

test('1. runner starts SQLite then early-returns before finish: coordinator rejects and generation is terminal', async () => {
  await withMovieCatalogDb(async () => {
    const providerId = 'movie-early-return';
    await upsertCatalogProvider({ providerId, providerType: 'xtream', displayName: 'Early Return' });
    const ownership = createMovieSqliteOwnershipState();
    const recorder = createProbeRecorder();
    const key = buildCatalogSyncKey(providerId, 'movie');

    await assert.rejects(
      runCatalogSyncNow(key, async () => {
        const handle = await startCatalogSqliteMediaSync({
          providerId,
          mediaType: 'movie',
          providerType: 'xtream',
        });
        noteMovieSqliteHandle(ownership, handle);
        ownership.returnReason = 'return-playback-deferral-category-loop';
        try {
          return;
        } finally {
          await enforceMovieSqliteTerminal(ownership, {
            finish: finishCatalogSqliteMediaSync,
            probe: recorder.probe,
          });
        }
      }),
      (error) => error instanceof Error && error.message === MOVIE_SYNC_OPEN_SQLITE_ERROR,
    );

    const durable = await getCatalogSyncState(providerId, 'movie');
    assert.equal(durable?.status, 'error');
    assert.equal(durable?.errorCode, MOVIE_SYNC_OPEN_SQLITE_ERROR);
    assert.notEqual(durable?.status, 'syncing');
    assert.equal(getCatalogSyncJobStatus(providerId, 'movie').status, 'failed');
    assert.equal(ownership.movieFinishCalled, true);
    assert.equal(ownership.movieFinishOutcome, 'failed');
    assert.ok(recorder.events.some((event) => event.event === 'abandoned-open-sqlite-generation'));
  });
});

test('2. normal successful Movie path: finish called and coordinator fulfilled', async () => {
  const ownership = createMovieSqliteOwnershipState();
  const finishCalls = [];
  const recorder = createProbeRecorder();
  const deps = {
    finish: async (input) => {
      finishCalls.push(input);
      return true;
    },
    probe: recorder.probe,
  };
  const key = buildCatalogSyncKey('movie-success', 'movie');

  await runCatalogSyncNow(key, async () => {
    noteMovieSqliteHandle(ownership, fakeHandle({ providerId: 'movie-success', generation: 3 }));
    const ok = await finishOwnedMovieSqlite(ownership, deps, {
      ok: true,
      nativeDone: true,
      processedCount: 12,
      outcome: 'completed',
    });
    assert.equal(ok, true);
    ownership.returnReason = 'completed-after-sqlite';
    await enforceMovieSqliteTerminal(ownership, deps);
  });

  assert.equal(getCatalogSyncJobStatus('movie-success', 'movie').status, 'completed');
  assert.equal(finishCalls.length, 1);
  assert.equal(finishCalls[0].ok, true);
  assert.equal(ownership.movieFinishCalled, true);
  assert.equal(ownership.movieFinishOutcome, 'completed');
  assert.equal(ownsOpenMovieSqliteGeneration(ownership), false);
  assert.ok(recorder.events.some((event) => event.event === 'finishCatalogSqliteMediaSync-enter'));
  assert.ok(recorder.events.some((event) => event.event === 'finishCatalogSqliteMediaSync-exit'));
});

test('3. Movie decode/write failure: generation failed and coordinator rejected', async () => {
  await withMovieCatalogDb(async () => {
    const providerId = 'movie-decode-fail';
    await upsertCatalogProvider({ providerId, providerType: 'xtream', displayName: 'Decode Fail' });
    const ownership = createMovieSqliteOwnershipState();
    const recorder = createProbeRecorder();
    const deps = {
      finish: finishCatalogSqliteMediaSync,
      probe: recorder.probe,
    };
    const key = buildCatalogSyncKey(providerId, 'movie');

    await assert.rejects(
      runCatalogSyncNow(key, async () => {
        const handle = await startCatalogSqliteMediaSync({
          providerId,
          mediaType: 'movie',
          providerType: 'xtream',
        });
        noteMovieSqliteHandle(ownership, handle);
        try {
          throw new Error('movie_decode_failed');
        } catch (error) {
          await finishOwnedMovieSqlite(ownership, deps, {
            ok: false,
            errorCode: 'movie_decode_failed',
            nativeDone: false,
            outcome: 'failed',
          });
          throw error;
        } finally {
          await enforceMovieSqliteTerminal(ownership, deps);
        }
      }),
      /movie_decode_failed/,
    );

    const durable = await getCatalogSyncState(providerId, 'movie');
    assert.equal(durable?.status, 'error');
    assert.equal(durable?.errorCode, 'movie_decode_failed');
    assert.equal(getCatalogSyncJobStatus(providerId, 'movie').status, 'failed');
    assert.equal(ownership.movieFinishOutcome, 'failed');
    assert.equal(
      recorder.events.filter((event) => event.event === 'finishCatalogSqliteMediaSync-enter').length,
      1,
    );
  });
});

test('4. cancellation after beginCatalogSync: generation terminal and coordinator does not fulfill', async () => {
  await withMovieCatalogDb(async () => {
    const providerId = 'movie-cancel';
    await upsertCatalogProvider({ providerId, providerType: 'xtream', displayName: 'Cancel' });
    const ownership = createMovieSqliteOwnershipState();
    const recorder = createProbeRecorder();
    const deps = {
      finish: finishCatalogSqliteMediaSync,
      probe: recorder.probe,
    };
    const key = buildCatalogSyncKey(providerId, 'movie');

    await assert.rejects(
      runCatalogSyncNow(key, async () => {
        const handle = await startCatalogSqliteMediaSync({
          providerId,
          mediaType: 'movie',
          providerType: 'xtream',
        });
        noteMovieSqliteHandle(ownership, handle);
        try {
          await terminateMovieSqliteEarlyReturn(ownership, deps, {
            reason: 'return-cancelled-after-full-dump',
            kind: 'cancelled',
          });
        } finally {
          await enforceMovieSqliteTerminal(ownership, deps);
        }
      }),
      (error) => error instanceof Error && error.message === MOVIE_SYNC_CANCELLED_ERROR,
    );

    const durable = await getCatalogSyncState(providerId, 'movie');
    assert.equal(durable?.status, 'error');
    assert.equal(durable?.errorCode, 'cancelled');
    assert.notEqual(durable?.status, 'syncing');
    assert.equal(getCatalogSyncJobStatus(providerId, 'movie').status, 'failed');
    assert.equal(ownership.movieFinishOutcome, 'cancelled');
    assert.ok(recorder.events.some((event) => event.event === 'movie-early-return'));
  });
});

test('5. no-SQLite early return before beginCatalogSync still fulfills', async () => {
  const ownership = createMovieSqliteOwnershipState();
  const recorder = createProbeRecorder();
  const key = buildCatalogSyncKey('movie-skip', 'movie');

  await runCatalogSyncNow(key, async () => {
    ownership.returnReason = 'return-skipped-cached';
    recorder.probe('movie-early-return', { reason: ownership.returnReason });
    await enforceMovieSqliteTerminal(ownership, {
      finish: async () => {
        throw new Error('finish-should-not-run');
      },
      probe: recorder.probe,
    });
  });

  assert.equal(getCatalogSyncJobStatus('movie-skip', 'movie').status, 'completed');
  assert.equal(ownership.sqliteHandleCreated, false);
  assert.equal(ownership.movieFinishCalled, false);
  assert.equal(ownsOpenMovieSqliteGeneration(ownership), false);
});

test('6. Promise.allSettled does not report movie fulfilled while sqlite generation remains syncing', async () => {
  await withMovieCatalogDb(async () => {
    const providerId = 'movie-allsettled';
    await upsertCatalogProvider({ providerId, providerType: 'xtream', displayName: 'AllSettled' });
    const ownership = createMovieSqliteOwnershipState();
    const recorder = createProbeRecorder();
    const movieKey = buildCatalogSyncKey(providerId, 'movie');

    const movieJob = runCatalogSyncNow(movieKey, async () => {
      const handle = await startCatalogSqliteMediaSync({
        providerId,
        mediaType: 'movie',
        providerType: 'xtream',
      });
      noteMovieSqliteHandle(ownership, handle);
      try {
        return;
      } finally {
        await enforceMovieSqliteTerminal(ownership, {
          finish: finishCatalogSqliteMediaSync,
          probe: recorder.probe,
        });
      }
    });
    const seriesJob = Promise.resolve();
    const [movieResult, seriesResult] = await Promise.allSettled([movieJob, seriesJob]);
    const classified = classifyCatalogMediaJobResults(movieResult, seriesResult);
    const durable = await getCatalogSyncState(providerId, 'movie');

    assert.equal(movieResult.status, 'rejected');
    assert.equal(seriesResult.status, 'fulfilled');
    assert.equal(classified.movieOk, false);
    assert.equal(classified.seriesOk, true);
    assert.notEqual(durable?.status, 'syncing');
    assert.equal(durable?.status, 'error');
  });
});

test('finishOwnedMovieSqlite is idempotent and does not double-finish', async () => {
  const ownership = createMovieSqliteOwnershipState();
  const finishCalls = [];
  const deps = {
    finish: async (input) => {
      finishCalls.push(input);
      return true;
    },
    probe() {},
  };
  noteMovieSqliteHandle(ownership, fakeHandle());
  await finishOwnedMovieSqlite(ownership, deps, {
    ok: false,
    errorCode: 'cancelled',
    outcome: 'cancelled',
  });
  await finishOwnedMovieSqlite(ownership, deps, {
    ok: false,
    errorCode: 'should-not-run',
    outcome: 'failed',
  });
  await enforceMovieSqliteTerminal(ownership, deps);
  assert.equal(finishCalls.length, 1);
  assert.equal(finishCalls[0].errorCode, 'cancelled');
  assert.equal(ownership.movieFinishOutcome, 'cancelled');
});
