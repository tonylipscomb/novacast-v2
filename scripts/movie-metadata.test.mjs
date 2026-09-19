import assert from 'node:assert/strict';
import test from 'node:test';

import { parseYearFromStreamFields, parseYearFromTitle } from '../src/features/movies/smart/movieMetadata.ts';

test('movie title year fallback is conservative and preserves title numbers', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(parseYearFromTitle('Blade Runner 2049', now), undefined);
  assert.equal(parseYearFromTitle('Death Race 2050', now), undefined);
  assert.equal(parseYearFromTitle('2001: A Space Odyssey', now), undefined);
  assert.equal(parseYearFromTitle('Class of 1999', now), undefined);
  assert.equal(parseYearFromTitle('Apollo 13', now), undefined);
  assert.equal(parseYearFromTitle('1917', now), undefined);
  assert.equal(parseYearFromTitle('Team! (2026)', now), 2026);
}
);

test('authoritative provider release metadata wins over title numbers', () => {
  assert.equal(
    parseYearFromStreamFields('Blade Runner 2049', { releasedate: '2017-01-01' }),
    2017,
  );
  assert.equal(
    parseYearFromStreamFields('Death Race 2050', { releasedate: '2017-01-01' }),
    2017,
  );
});
