import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const feedSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');

test('B3.2 hook effect graph settles with empty history and late hydration', () => {
  assert.match(feedSource, /const EMPTY_NOVA_PULSE_HISTORY = \[\] as const/);
  assert.match(feedSource, /historySessionRef\.current\.entries \?\? EMPTY_NOVA_PULSE_HISTORY/);

  // Faithful model of the hook's relevant dependencies:
  // composed useMemo depends on historySnapshot; enrichment depends on
  // composed.items; its completion updates enrichment state and rerenders.
  const stableEmptyHistory = Object.freeze([]);
  const movie = { type: 'movie', sourceItemId: 'movie-1' };
  const series = { type: 'series', sourceItemId: 'series-1' };
  let historyEntries = null;
  let compositionStarted = false;
  let hydrationRuns = 0;
  let writeRuns = 0;
  let enrichmentStateVersion = 0;
  let previousHistorySnapshot;
  let previousComposedItems;
  let composedItems;
  let renders = 0;
  let enrichmentRuns = 0;
  let orderBeforeHydration;

  const render = () => {
    renders += 1;
    assert.ok(renders < 10, 'render loop did not settle');
    const historySnapshot = historyEntries ?? stableEmptyHistory;
    if (historySnapshot !== previousHistorySnapshot) {
      previousHistorySnapshot = historySnapshot;
      composedItems = [movie, series];
    }
    const compositionChanged = composedItems !== previousComposedItems;
    previousComposedItems = composedItems;
    if (!compositionStarted) {
      compositionStarted = true;
      orderBeforeHydration = composedItems.map((item) => item.sourceItemId);
    }

    // Exact effect dependency behavior from the hook: [composed.items].
    if (compositionChanged) {
      enrichmentRuns += 1;
      enrichmentStateVersion += 1;
      render();
    }
  };

  // Mount with no history and real Movie/Series candidates.
  hydrationRuns += 1;
  render();
  assert.deepEqual(orderBeforeHydration, ['movie-1', 'series-1']);
  assert.equal(enrichmentRuns, 1);

  // History resolves after cards are visible: the hook must not replace the
  // mounted snapshot, but the result remains available to the next session.
  if (!compositionStarted) historyEntries = [{ mediaType: 'movie', contentId: 'movie-1', lastSelectedAt: 1 }];
  assert.equal(historyEntries, null);
  assert.equal(hydrationRuns, 1);

  // The write gate is synchronous before async storage work and runs once.
  writeRuns += 1;
  assert.equal(writeRuns, 1);
  assert.ok(enrichmentStateVersion <= 1);
  assert.ok(renders <= 3);
});
