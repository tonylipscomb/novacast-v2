import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const FILES = {
  screen: 'src/features/movies/MoviesScreen.tsx',
  grid: 'src/features/movies/components/MoviePosterGrid.tsx',
  model: 'src/features/movies/useMoviesScreenModel.ts',
  sqliteSource: 'src/features/movies/data/SqliteMovieDataSource.ts',
  smartSource: 'src/features/movies/smart/SmartMovieDataSource.ts',
  repository: 'src/features/catalog/catalogRepository.ts',
  diagnosticsState: 'src/features/movies/moviesDiagnosticsState.ts',
  detailFocusLifecycle: 'src/features/movies/moviesDetailFocusLifecycle.ts',
};

const source = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]),
);

const BUILD_MARKER = '[NovaCast Movies Diagnostics Build]';

const MARKERS = [
  '[NovaCast Movies Category Contract]',
  '[NovaCast Movies Read Contract]',
  '[NovaCast Movies Viewport Restore]',
  '[NovaCast Movies Scroll Command]',
  '[NovaCast Movies Detail Focus Lifecycle]',
  '[NovaCast Movies Detail Focus Conflict]',
  '[NovaCast Movies Category Refresh Rejected]',
  '[NovaCast Movies FlatList Data]',
  '[NovaCast Movies FlatList]',
  '[NovaCast Movies Data]',
  '[NovaCast Movies Detail/List Audit]',
  '[Catalog Read Generation]',
  BUILD_MARKER,
];

const REQUIRED_FIELDS = {
  '[NovaCast Movies Category Contract]': [
    'providerId',
    'readableGeneration',
    'repositoryCategoryCount',
    'sqliteProviderCategoryCount',
    'wrappedCategoryCount',
    'appliedProviderCategoryCount',
    'totalMovieCount',
    'firstProviderCategoryIds',
    'reason',
  ],
  '[NovaCast Movies Read Contract]': [
    'providerId',
    'readableGeneration',
    'requestedCategoryId',
    'itemsGeneration',
    'categoriesGeneration',
    'pageOffset',
    'pageLimit',
    'pageRowCount',
    'totalCount',
    'providerCategoryCount',
    'reason',
  ],
  '[NovaCast Movies Viewport Restore]': [
    'token',
    'targetMovieId',
    'targetIndex',
    'savedOffset',
    'currentOffset',
    'visibleFirstIndex',
    'visibleLastIndex',
    'targetVisible',
    'focusConfirmed',
    'highlightVisible',
    'outcome',
  ],
  '[NovaCast Movies Scroll Command]': [
    'token',
    'source',
    'method',
    'requestedIndex',
    'requestedOffset',
    'currentOffset',
    'focusedMovieId',
    'restorationActive',
    'timestamp',
  ],
  '[NovaCast Movies Detail Focus Lifecycle]': [
    'token',
    'phase',
    'targetMovieId',
    'targetIndex',
    'targetVisible',
    'currentOffset',
    'scrollIssued',
    'focusIssued',
    'actuallyFocusedMovieId',
    'highlightVisible',
    'overlayMounted',
  ],
  '[NovaCast Movies Detail Focus Conflict]': [
    'token',
    'phase',
    'winningComponent',
    'targetMovieId',
    'actuallyFocusedMovieId',
    'reason',
  ],
  '[NovaCast Movies FlatList Data]': [
    'reason',
    'arrayIdentityChanged',
    'previousLength',
    'nextLength',
    'previousFirstId',
    'nextFirstId',
    'previousLastId',
    'nextLastId',
  ],
  '[NovaCast Movies FlatList]': [
    'action',
    'key',
    'rowCount',
    'firstId',
    'lastId',
    'detailOpen',
    'restorationActive',
  ],
  '[NovaCast Movies Data]': [
    'reason',
    'arrayIdentityChanged',
    'previousLength',
    'nextLength',
    'previousFirstId',
    'nextFirstId',
    'previousLastId',
    'nextLastId',
  ],
  '[NovaCast Movies Detail/List Audit]': [
    'action',
    'detailOpen',
    'selectedMovieId',
    'focusedMovieId',
    'visibleMoviesLength',
    'currentOffset',
    'categoryId',
  ],
  '[Catalog Read Generation]': [
    'providerId',
    'mediaType',
    'currentAttemptGeneration',
    'lastCompletedGeneration',
    'resolvedReadableGeneration',
    'readableRowCount',
    'reason',
  ],
  [BUILD_MARKER]: ['version'],
};

/**
 * Extracts every `console.info('[Marker] ' + JSON.stringify({...}))` site,
 * returning the marker, the stringified payload text, and the text that
 * immediately follows the payload (used to prove there is no second argument).
 */
function collectJsonDiagnostics(text) {
  const sites = [];
  const callPattern = /console\.info\(\s*'(\[[^']+\]) ' \+\s*JSON\.stringify\(/g;
  let match = callPattern.exec(text);
  while (match) {
    const payloadStart = callPattern.lastIndex;
    let depth = 1;
    let cursor = payloadStart;
    while (cursor < text.length && depth > 0) {
      const character = text[cursor];
      if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      cursor += 1;
    }
    sites.push({
      marker: match[1],
      payload: text.slice(payloadStart, cursor - 1),
      tail: text.slice(cursor, cursor + 64),
    });
    match = callPattern.exec(text);
  }
  return sites;
}

function collectAllJsonDiagnostics() {
  return Object.entries(source).flatMap(([fileKey, text]) =>
    collectJsonDiagnostics(text).map((site) => ({ ...site, file: FILES[fileKey] })),
  );
}

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function hasField(payload, field) {
  return new RegExp(`(^|[\\s{,])${field}\\s*[,:]`).test(payload);
}

/** Top-level keys of a stringified diagnostic payload. */
function payloadKeys(payload) {
  return payload
    .split('\n')
    .map((line) => line.trim().match(/^([a-zA-Z][a-zA-Z0-9]*)\s*[,:]/)?.[1])
    .filter((key) => Boolean(key));
}

const diagnostics = collectAllJsonDiagnostics();
const listedDiagnostics = diagnostics.filter((site) => MARKERS.includes(site.marker));

test('every listed Movies marker is logged through JSON.stringify', () => {
  for (const marker of MARKERS) {
    const sites = listedDiagnostics.filter((site) => site.marker === marker);
    assert.ok(sites.length > 0, `expected at least one JSON.stringify log site for ${marker}`);
  }
});

test('no listed marker is still logged as a truncatable object argument', () => {
  const offenders = [];
  for (const file of listSourceFiles('src')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
      const literal = `'${marker}',`;
      if (text.includes(literal)) {
        offenders.push(`${file} -> ${marker}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('listed diagnostics are emitted as exactly one string argument', () => {
  for (const site of listedDiagnostics) {
    assert.match(
      site.tail,
      /^\s*,?\s*\)/,
      `${site.marker} in ${site.file} must close console.info right after JSON.stringify`,
    );
  }
});

test('every listed marker log site in src is accounted for', () => {
  let markerOccurrences = 0;
  for (const file of listSourceFiles('src')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
      markerOccurrences += text.split(`'${marker} '`).length - 1;
    }
  }
  assert.equal(markerOccurrences, listedDiagnostics.length);
});

test('each listed diagnostic carries its complete field set', () => {
  for (const [marker, fields] of Object.entries(REQUIRED_FIELDS)) {
    const sites = listedDiagnostics.filter((site) => site.marker === marker);
    assert.ok(sites.length > 0, `missing diagnostic sites for ${marker}`);
    for (const site of sites) {
      for (const field of fields) {
        assert.ok(
          hasField(site.payload, field),
          `${marker} in ${site.file} is missing field "${field}"`,
        );
      }
    }
  }
});

test('no listed diagnostic can leak credentials, URLs, or full movie payloads', () => {
  const forbiddenAnywhere = [
    /password/i,
    /secret/i,
    /username/i,
    /credential/i,
    /api[_-]?key/i,
    /auth(orization)?[_-]?token/i,
    /access[_-]?token/i,
    /bearer/i,
    /url/i,
    /https?:\/\//i,
    /\.\.\.[a-z]/i,
  ];
  const forbiddenKeys = ['movie', 'movies', 'item', 'items', 'record', 'records', 'payload', 'detail', 'provider'];

  for (const site of listedDiagnostics) {
    for (const pattern of forbiddenAnywhere) {
      assert.doesNotMatch(
        site.payload,
        pattern,
        `${site.marker} in ${site.file} must not log ${pattern}`,
      );
    }

    for (const key of payloadKeys(site.payload)) {
      assert.ok(
        !forbiddenKeys.includes(key),
        `${site.marker} in ${site.file} logs a whole object under key "${key}"`,
      );
    }
  }
});

test('diagnostic "token" fields only carry restoration tokens', () => {
  const allowedTokenSources = [
    'token: restorationToken,',
    'token: restore.token,',
    'token: token.token,',
    'token,',
    'token: null,',
  ];

  for (const site of listedDiagnostics) {
    const tokenLines = site.payload
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^token\s*:/.test(line) || line === 'token,');
    for (const line of tokenLines) {
      assert.ok(
        allowedTokenSources.some((allowed) => line === allowed || line.startsWith('token:')),
        `${site.marker} in ${site.file} logs an unexpected token source: ${line}`,
      );
    }
  }
});

test('the diagnostics build marker is emitted exactly once at Movies startup', () => {
  assert.match(
    source.screen,
    /console\.info\('\[NovaCast Movies Diagnostics Build\] ' \+ JSON\.stringify\(\{ version: 'movies-detail-focus-lifecycle-v1' \}\)\);/,
  );

  let occurrences = 0;
  for (const file of listSourceFiles('src')) {
    occurrences += fs.readFileSync(file, 'utf8').split(BUILD_MARKER).length - 1;
  }
  assert.equal(occurrences, 1);

  const markerIndex = source.screen.indexOf(BUILD_MARKER);
  const componentIndex = source.screen.indexOf('export function MoviesScreen()');
  assert.ok(markerIndex > 0 && componentIndex > markerIndex, 'build marker must log at module scope');
  assert.doesNotMatch(source.screen, /stage3b2-data-audit/);
});

test('the diagnostics state mirror stays diagnostics-only', () => {
  assert.doesNotMatch(source.diagnosticsState, /^import /m);
  assert.doesNotMatch(source.diagnosticsState, /^(?!\s*\*).*\b(useEffect|useState|requestAnimationFrame|focus\()/m);
  assert.equal((source.diagnosticsState.match(/^export function /gm) ?? []).length, 2);
  assert.match(source.diagnosticsState, /setMoviesDetailOpenForDiagnostics/);
  assert.match(source.diagnosticsState, /getMoviesDetailOpenForDiagnostics/);
});

test('Movies Stage 3D detail focus lifecycle wiring is present', () => {
  assert.match(source.screen, /suppressNavbarPreferredFocus=\{navbarPreferredSuppressed\}/);
  assert.match(source.screen, /navigationFocusable=\{chromeFocusable && !searchBlocksBrowse\}/);
  assert.match(source.screen, /focusable=\{chromeFocusable && !searchBlocksBrowse\}/);
  assert.match(source.screen, /postersFocusable=\{postersFocusable && primaryLoaderMode !== 'category-blocking'\}/);
  assert.match(source.screen, /closingFocusMovieId=\{activeClosingFocusMovieId\}/);
  assert.match(source.screen, /postRestorePreferredMovieId=\{postRestorePreferredMovieId\}/);
  assert.match(source.screen, /focusHandoffActive=\{focusHandoffActive\}/);
  assert.match(source.screen, /restore-exact-poster-after-detail-close/);
  assert.match(source.screen, /createMoviesBrowseFocusSnapshot/);
  assert.match(source.screen, /restoreVisibleFirstIndex=\{restoreToken\?\.snapshot\.visibleFirstIndex/);
  assert.match(source.screen, /restoreVisibleLastIndex=\{restoreToken\?\.snapshot\.visibleLastIndex/);
  assert.doesNotMatch(source.screen, /MoviesFocusOwner|deriveMoviesFocusOwner|focusOwner=/);
  assert.doesNotMatch(source.screen, /detailCloseSentinelActive/);
});

test('poster grid scroll and FlatList configuration is unchanged', () => {
  assert.match(source.grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
  assert.match(source.grid, /viewportRestoreCommand/);
  assert.match(source.grid, /snapshotTargetWasVisible/);

  const flatListStart = source.grid.search(/<FlatList\r?\n/);
  assert.ok(flatListStart > 0, 'poster grid must render a FlatList');
  const flatListBlock = source.grid.slice(flatListStart, source.grid.indexOf('/>', flatListStart));
  const propNames = flatListBlock
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^([a-zA-Z]+)(=|$)/)?.[1])
    .filter((name) => Boolean(name));
  assert.deepEqual(propNames, [
    'ref',
    'data',
    'key',
    'numColumns',
    'keyExtractor',
    'scrollEnabled',
    'showsVerticalScrollIndicator',
    'contentContainerStyle',
    'columnWrapperStyle',
    'removeClippedSubviews',
    'windowSize',
    'maxToRenderPerBatch',
    'updateCellsBatchingPeriod',
    'initialNumToRender',
    'getItemLayout',
    'onEndReachedThreshold',
    'onEndReached',
    'onScroll',
    'scrollEventThrottle',
    'onViewableItemsChanged',
    'renderItem',
  ]);
});

test('Movies SQLite reads, category resolution, and loaders are unchanged', () => {
  assert.match(source.repository, /SELECT COUNT\(\*\) AS total FROM \$\{itemsTable\} WHERE \$\{where\}/);
  assert.match(source.repository, /ORDER BY \$\{orderByClauseCompatible\(query\.sort\)\}/);
  assert.match(source.repository, /LIMIT \? OFFSET \?/);
  assert.match(source.sqliteSource, /generation: readableGeneration/);
  assert.match(source.sqliteSource, /SQLITE_MOVIES_DISCOVER_ID/);
  assert.match(source.model, /mergeCategoriesPreservingCounts/);
  assert.match(source.model, /return previous/);
  assert.match(source.model, /MOVIES_SQLITE_READS_ENABLED/);
  assert.match(source.smartSource, /buildSmartCategories\(providerCategories\)/);
});
