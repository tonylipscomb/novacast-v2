import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const card = fs.readFileSync(path.join(root, 'src/features/series/components/SeriesPosterCard.tsx'), 'utf8');
const movies = fs.readFileSync(path.join(root, 'src/features/movies/components/MoviePosterCard.tsx'), 'utf8');

assert.match(card, /<Text numberOfLines=\{2\} style=\{\[styles\.title/);
assert.match(card, /title: \{[\s\S]*fontSize: 10[\s\S]*lineHeight: 12/);
assert.doesNotMatch(card, /<View style=\{styles\.metaRow\}>/);
assert.match(card, /width: 80/);
assert.match(card, /height: 120/);
assert.match(card, /fontSize: 10/);
assert.match(card, /lineHeight: 12/);
assert.doesNotMatch(movies, /numberOfLines=\{2\} style=\{\[styles\.title/);

const grid = fs.readFileSync(path.join(root, 'src/features/series/components/SeriesPosterGrid.tsx'), 'utf8');
assert.match(grid, /const SERIES_GRID_COLUMN_GAP = 6/);
assert.match(grid, /const SERIES_GRID_LEFT_PADDING = 2/);
assert.match(grid, /const SERIES_GRID_RIGHT_PADDING = 2/);
// RC2 series-stage-fit-v1: column width comes ONLY from the current measured
// stage (return 0 when unmeasured — no 120px fallback / no stale cached width),
// then floors (stageWidth - paddings - gaps) / columns to guarantee 5-column fit.
assert.match(grid, /const columnWidth = useMemo\(\(\) => \{/);
assert.match(grid, /if \(gridWidth <= 0\) \{\s*return 0;/);
assert.match(grid, /gridWidth -[\s\S]*SERIES_GRID_LEFT_PADDING -[\s\S]*SERIES_GRID_RIGHT_PADDING -[\s\S]*SERIES_GRID_COLUMN_GAP \* Math\.max\(0, columns - 1\)/);
assert.match(grid, /Math\.floor\(available \/ Math\.max\(1, columns\)\)/);
assert.match(grid, /SERIES_COMPACT_CARD_HEIGHT = 147/);
assert.match(grid, /extraData=\{columnWidth\}/);

const effectiveWidth = 580;
const columns = 5;
const cardSlotWidth = Math.floor((effectiveWidth - 4 - 6 * (columns - 1)) / columns);
assert.equal(cardSlotWidth, 110);
assert.equal(80 * (3 / 2), 120);
assert.ok(147 <= 150);
const rowUsedWidth = cardSlotWidth * columns + 4 + 6 * (columns - 1);
assert.equal(rowUsedWidth, 578);
assert.ok(rowUsedWidth <= effectiveWidth);
assert.match(card, /fontSize: 10/);
assert.doesNotMatch(card, /minHeight: 42/);
assert.doesNotMatch(card, /numberOfLines=\{1\} style=\{\[styles\.title/);

console.log('series title display test passed');
