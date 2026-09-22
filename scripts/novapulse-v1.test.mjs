import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { composeNovaPulseFeed, preserveNovaPulseIndex } from '../src/features/novapulse/novaPulseComposer.ts';
import { createNovaPulseArtworkPrefetchPlan, inspectNovaPulseArtworkPrefetch } from '../src/features/novapulse/novaPulseArtworkPrefetch.ts';
import { canNovaPulseAutoRotate, describeNovaPulseArtwork, formatNovaPulseAnnouncementTiming, formatNovaPulseCatalogMeta, formatNovaPulseCountdown, formatNovaPulseEpisodeMeta, formatNovaPulseEventTime, formatNovaPulseRating, formatNovaPulseResultSummary, formatNovaPulseStage, formatNovaPulseStart, formatNovaPulseTeamLabel, formatNovaPulseUpcomingStatus, getNovaPulseAnnouncementBadge, getNovaPulseCatalogBadge, getNovaPulseDisplayCountry, getNovaPulseDisplayYear, getNovaPulseTeamInitials, getNovaPulseWinner, nextNovaPulseIndex, normalizeNovaPulseGenres, resolveNovaPulseAction, resolveNovaPulseDescription, sanitizeNovaPulseDisplayTitle } from '../src/features/novapulse/novaPulseLogic.ts';
import { createNovaPulseCatalogSource, createNovaPulseMockSource } from '../src/features/novapulse/novaPulseSources.ts';
import { mapNovaPulseSportsRow } from '../src/features/novapulse/novaPulseSportsSource.ts';

const item = (action) => ({ id: 'demo', type: 'movie', title: 'Demo', priority: 1, action });

test('auto-rotation advances while unfocused and wraps', () => {
  assert.equal(nextNovaPulseIndex(5, 0, 1), 1);
  assert.equal(nextNovaPulseIndex(5, 4, 1), 0);
  assert.equal(nextNovaPulseIndex(5, 0, -1), 4);
  assert.equal(canNovaPulseAutoRotate(5, false), true);
});

test('focused or single-item feeds do not auto-rotate', () => {
  assert.equal(canNovaPulseAutoRotate(5, true), false);
  assert.equal(canNovaPulseAutoRotate(1, false), false);
  assert.equal(nextNovaPulseIndex(1, 0, 1), 0);
});

test('unfocused rotation wraps through two complete cycles', () => {
  let index = 0;
  const visited = [];
  for (let step = 0; step < 10; step += 1) {
    index = nextNovaPulseIndex(5, index, 1);
    visited.push(index);
  }
  assert.deepEqual(visited, [1, 2, 3, 4, 0, 1, 2, 3, 4, 0]);
});

test('rotation timer is keyed to stable active identity rather than feed array identity', () => {
  const hookSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulse.ts', import.meta.url), 'utf8');
  assert.match(hookSource, /\[activeItems\.length, item\?\.id, clearTimer, focused, move\]/);
  assert.doesNotMatch(hookSource, /\[activeItems, clearTimer, focused, index, move\]/);
});

test('valid actions resolve once while none and missing targets are safe', () => {
  assert.deepEqual(resolveNovaPulseAction(item({ type: 'details', target: '/movies' })), { type: 'details', target: '/movies' });
  assert.equal(resolveNovaPulseAction(item({ type: 'none' })), null);
  assert.equal(resolveNovaPulseAction(item({ type: 'play' })), null);
});

test('upcoming sports timing is TV-readable and bounded', () => {
  assert.equal(formatNovaPulseStart('2026-09-19T13:00:00.000Z', Date.parse('2026-09-19T12:00:00.000Z')), 'Starts in 1h 0m');
  assert.equal(formatNovaPulseStart('2026-09-19T12:00:00.000Z', Date.parse('2026-09-19T12:01:00.000Z')), 'Starting soon');
  assert.equal(formatNovaPulseStart(undefined), null);
});

test('sports status distinguishes tonight, tomorrow, and future events', () => {
  const now = new Date(2026, 8, 19, 12, 0).getTime();
  assert.equal(formatNovaPulseUpcomingStatus(new Date(2026, 8, 19, 20, 0).toISOString(), now), 'TONIGHT');
  assert.equal(formatNovaPulseUpcomingStatus(new Date(2026, 8, 20, 20, 0).toISOString(), now), 'TOMORROW');
  assert.equal(formatNovaPulseUpcomingStatus('not-a-date', now), 'UPCOMING');
});

test('sports display helpers hide raw numeric stages and provide compact identities', () => {
  assert.equal(formatNovaPulseStage('500'), null);
  assert.equal(formatNovaPulseStage('26'), null);
  assert.equal(formatNovaPulseStage('regular_season'), 'Regular Season');
  assert.equal(formatNovaPulseStage('Week 2'), 'Week 2');
  assert.equal(getNovaPulseTeamInitials('Montreal Canadiens'), 'MC');
  assert.equal(getNovaPulseTeamInitials(undefined), '—');
});

test('event date and countdown helpers are presentational and invalid-safe', () => {
  assert.match(formatNovaPulseEventTime('2026-09-19T20:15:00.000Z'), /SEP/);
  assert.equal(formatNovaPulseEventTime('invalid'), null);
  assert.equal(formatNovaPulseCountdown(undefined), 'Starts soon');
});

test('sports data supports team and fight competitors without requiring a network', () => {
  const team = { format: 'team', awayName: 'Baltimore Ravens', homeName: 'Detroit Lions' };
  const fight = { format: 'fight', competitorA: 'Canelo Alvarez', competitorB: 'Terence Crawford' };
  assert.equal(team.awayName, 'Baltimore Ravens');
  assert.equal(team.homeName, 'Detroit Lions');
  assert.equal(fight.competitorA, 'Canelo Alvarez');
  assert.equal(fight.competitorB, 'Terence Crawford');
  assert.equal(fight.network, undefined);
});

test('final team results identify the winner and format both scores', () => {
  const result = { format: 'team', awayName: 'Portland FC', homeName: 'Bay City United', finalScoreA: 2, finalScoreB: 1, winnerName: 'Portland FC' };
  assert.equal(getNovaPulseWinner(result), 'Portland FC');
  assert.equal(formatNovaPulseResultSummary(result), 'Portland FC wins 2–1');
});

test('final tie and draw results remain safe', () => {
  const teamTie = { format: 'team', awayName: 'A', homeName: 'B', finalScoreA: 2, finalScoreB: 2, isDraw: true };
  const fightDraw = { format: 'fight', competitorA: 'A', competitorB: 'B', resultStatus: 'DRAW' };
  assert.equal(getNovaPulseWinner(teamTie), null);
  assert.equal(formatNovaPulseResultSummary(teamTie), 'Draw');
  assert.equal(formatNovaPulseResultSummary(fightDraw), 'Fight ends in a draw');
});

test('final fight results format winner, method, round, and time', () => {
  const result = { format: 'fight', competitorA: 'Canelo Alvarez', competitorB: 'Terence Crawford', winnerName: 'Canelo Alvarez', loserName: 'Terence Crawford', decisionType: 'unanimous decision', resultRound: 12, resultTime: '2:14' };
  assert.equal(getNovaPulseWinner(result), 'Canelo Alvarez');
  assert.equal(formatNovaPulseResultSummary(result), 'Canelo Alvarez wins by unanimous decision in Round 12 at 2:14');
});

test('missing final scores and non-actionable sports ENTER remain safe', () => {
  const missing = { format: 'team', awayName: 'A', homeName: 'B' };
  assert.equal(formatNovaPulseResultSummary(missing), 'Final result unavailable');
  assert.equal(resolveNovaPulseAction({ id: 'final', type: 'sports', subtype: 'final', title: 'Final', priority: 1, action: { type: 'none' } }), null);
});

test('movie metadata renders title fields, genres, runtime, and optional rating', () => {
  const movie = { id: 'movie', type: 'movie', title: 'Superman', priority: 1, year: 2026, genres: ['Action', 'Adventure', 'Drama'], runtimeMinutes: 128, rating: 7.8, ratingSource: 'IMDb' };
  assert.equal(formatNovaPulseCatalogMeta(movie), '2026 • Action • Adventure • 2h 8m');
  assert.equal(formatNovaPulseRating(movie), 'IMDb 7.8');
  assert.equal(getNovaPulseCatalogBadge(movie), 'MOVIE');
});

test('series metadata renders season and episode context and remains safe when absent', () => {
  const series = { id: 'series', type: 'series', title: 'The Last Horizon', priority: 1, year: 2026, genres: ['Drama', 'Sci-Fi'], seasonNumber: 2, episodeNumber: 4, episodeTitle: 'Signal Lost' };
  const missing = { id: 'series-2', type: 'series', title: 'Untitled', priority: 1 };
  assert.equal(formatNovaPulseCatalogMeta(series), '2026 • Drama • Sci-Fi');
  assert.equal(formatNovaPulseEpisodeMeta(series), 'Season 2 • Episode 4 • "Signal Lost"');
  assert.equal(formatNovaPulseEpisodeMeta(missing), null);
});

test('provider titles are sanitized for display without mutating the raw value', () => {
  const rawMovie = '4K-AMZ - American Fiction (2023)';
  assert.equal(sanitizeNovaPulseDisplayTitle(rawMovie), 'American Fiction');
  assert.equal(sanitizeNovaPulseDisplayTitle('4K - Example Movie (2024)'), 'Example Movie');
  assert.equal(sanitizeNovaPulseDisplayTitle('AMZ - Example Series'), 'Example Series');
  assert.equal(sanitizeNovaPulseDisplayTitle('TOP - The End of Oak Street'), 'The End of Oak Street');
  assert.equal(sanitizeNovaPulseDisplayTitle('Top Gun'), 'Top Gun');
  assert.equal(rawMovie, '4K-AMZ - American Fiction (2023)');
  assert.equal(sanitizeNovaPulseDisplayTitle('HDMI'), 'HDMI');
  assert.equal(sanitizeNovaPulseDisplayTitle('Dope Thief (2025) (US)'), 'Dope Thief');
  assert.equal(sanitizeNovaPulseDisplayTitle("The Thing (1982) (Director's Cut)"), "The Thing (1982) (Director's Cut)");
  assert.equal(getNovaPulseDisplayCountry('Dope Thief (2025) (US)'), 'US');
  assert.equal(getNovaPulseDisplayCountry("The Thing (1982) (Director's Cut)"), undefined);
  assert.equal(formatNovaPulseTeamLabel('Toronto Maple Leafs'), 'Toronto Maple Leafs');
});

test('catalog artwork uses contain for poster-only cards and cover for backdrops', () => {
  const sources = fs.readFileSync(new URL('../src/features/novapulse/novaPulseSources.ts', import.meta.url), 'utf8');
  const presentation = fs.readFileSync(new URL('../src/features/novapulse/novaPulsePresentation.ts', import.meta.url), 'utf8');
  assert.match(sources, /artworkFit: movie\.backdropUrl \? 'cover' : 'contain'/);
  assert.match(presentation, /artworkFit: backdropUrl \? 'cover' as const : 'contain' as const/);
});

test('stale sports promos cannot create a TONIGHT card without a verified kickoff', () => {
  const stale = mapNovaPulseSportsRow({ source: 'test', source_event_id: 'stale', event_name: 'Stale promo', status: 'starting_soon' });
  assert.equal(stale, null);
  const verified = mapNovaPulseSportsRow({
    source: 'test', source_event_id: 'verified', event_name: 'Verified game', status: 'starting_soon',
    starts_at: '2026-09-22T00:00:00.000Z', away_name: 'Away', home_name: 'Home',
  });
  assert.equal(verified?.subtype, 'upcoming');
  assert.equal(verified?.sports?.eventStatus, undefined);
  assert.equal(verified?.startsAt, '2026-09-22T00:00:00.000Z');
});

test('catalog metadata keeps validated country beside the year', () => {
  assert.equal(formatNovaPulseCatalogMeta({ id: 'm', type: 'movie', title: 'Dope Thief', priority: 1, year: 2025, countryCode: 'US', genres: [] }), '2025 • US');
});

test('display year validation keeps plausible years and omits malformed/future values', () => {
  const now = new Date(2026, 0, 1);
  assert.equal(getNovaPulseDisplayYear(1923, now), 1923);
  assert.equal(getNovaPulseDisplayYear(1887, now), undefined);
  assert.equal(getNovaPulseDisplayYear(2029, now), undefined);
  assert.equal(getNovaPulseDisplayYear(2028, now), 2028);
  assert.equal(getNovaPulseDisplayYear(1923.5, now), undefined);
});

test('presentation quality prefers richer candidates while preserving provider-order ties', () => {
  const source = createNovaPulseCatalogSource([
    { id: 'bare', categoryId: 'c', title: 'Bare', genres: [], posterStyleKey: 'ember' },
    { id: 'rich', categoryId: 'c', title: 'Rich', genres: ['Drama'], description: 'A real synopsis.', posterUrl: 'https://img/rich', rating: '8.1', year: 2024, posterStyleKey: 'ember' },
    { id: 'tie-a', categoryId: 'c', title: 'Tie A', genres: [], posterStyleKey: 'ember' },
    { id: 'tie-b', categoryId: 'c', title: 'Tie B', genres: [], posterStyleKey: 'ember' },
  ], []).getItems();
  assert.deepEqual(source.items.slice(0, 4).map((item) => item.sourceItemId), ['rich', 'bare', 'tie-a', 'tie-b']);
});

test('bounded local quality window can select a richer item beyond the first eight', () => {
  const movies = Array.from({ length: 12 }, (_, index) => ({
    id: `bare-${index}`,
    categoryId: 'c',
    title: `Bare ${index}`,
    genres: [],
    posterStyleKey: 'ember',
  }));
  movies[11] = {
    ...movies[11],
    id: 'rich-late',
    title: 'Rich Late Movie',
    description: 'A real locally cached synopsis.',
    posterUrl: 'https://img/rich-late',
    rating: '8.4',
    year: 2024,
  };
  const result = createNovaPulseCatalogSource(movies, []).getItems();
  assert.equal(result.items[0].sourceItemId, 'rich-late');
});

test('catalog metadata uses real descriptions, useful genres, and safe fallbacks', () => {
  assert.equal(resolveNovaPulseDescription({ overview: 'Overview', plot: 'Plot', description: 'Description' }), 'Overview');
  assert.equal(resolveNovaPulseDescription({ plot: 'Plot', description: 'Description' }), 'Plot');
  assert.equal(resolveNovaPulseDescription({ description: 'Description' }), 'Description');
  assert.equal(resolveNovaPulseDescription({}, ''), '');
  assert.deepEqual(normalizeNovaPulseGenres(['Movies', 'Drama, Comedy', 'Drama / Thriller']), ['Drama', 'Comedy']);
  assert.equal(formatNovaPulseCatalogMeta({ id: 'm', type: 'movie', title: 'M', priority: 1, genres: ['Movies'] }), '');
  assert.equal(formatNovaPulseCatalogMeta({ id: 'm', type: 'movie', title: 'M', priority: 1, year: 2024, genres: ['Movies'] }), '2024');
});

test('real series cards do not claim episode freshness without episode evidence', () => {
  const source = fs.readFileSync(new URL('../src/features/novapulse/novaPulseSources.ts', import.meta.url), 'utf8');
  const sqliteSource = fs.readFileSync(new URL('../src/features/series/data/SqliteSeriesDataSource.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /catalogStatus:\s*['"]NEW EPISODE['"]/);
  assert.match(source, /description: resolveNovaPulseDescription/);
  assert.match(sqliteSource, /seasons\/episodes are never stored/);
});

test('provider changes rebind NovaPulse indexes and restart bounded hydration for the new provider', () => {
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  const localSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseLocalCatalog.ts', import.meta.url), 'utf8');
  assert.match(homeSource, /getMovieCatalogIndex\(activeProviderId\)/);
  assert.match(homeSource, /getSeriesCatalogIndex\(activeProviderId\)/);
  assert.match(homeSource, /setNovaPulseCatalogRevision\(0\)/);
  assert.match(homeSource, /inFlight\?\.providerId === providerId/);
  assert.match(homeSource, /novaPulsePreviousProviderIdRef/);
  assert.match(localSource, /loadNovaPulseLocalCatalog\(providerId: string\)/);
});

test('bounded catalog signatures ignore total index-size churn', () => {
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(homeSource, /buildNovaPulseCandidateSignature/);
  assert.match(homeSource, /listSummaries\(32\)/);
  assert.match(homeSource, /previous\.movie === movieSignature && previous\.series === seriesSignature/);
  assert.doesNotMatch(homeSource, /if \(movieCatalogIndex\.size !==/);
});

test('provider-scoped hydration reports attempted and populated local counts', () => {
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  const feedSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');
  assert.match(homeSource, /movieLocalHydrationAttempted: true/);
  assert.match(homeSource, /seriesLocalHydrationAttempted: true/);
  assert.match(homeSource, /movieLocalHydrationCount: movies\.length/);
  assert.match(homeSource, /seriesLocalHydrationCount: series\.length/);
  assert.match(feedSource, /activeProviderChanged/);
  assert.match(feedSource, /movieLocalHydrationCount/);
  assert.match(feedSource, /seriesLocalHydrationCount/);
});

test('real catalog candidates suppress only their matching fallback type', () => {
  const feedSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');
  assert.match(feedSource, /movie: boundedMovies\.length === 0/);
  assert.match(feedSource, /series: boundedSeries\.length === 0/);
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /NOVACAST_FALLBACK_CARD/);
  assert.match(cardSource, /fallbackArtwork/);
  assert.match(cardSource, /hasRemoteArtwork && !artworkFailed/);
});

test('catalog status and fixed card layout have safe fallbacks', () => {
  assert.equal(getNovaPulseCatalogBadge({ id: 'movie', type: 'movie', title: 'Demo', priority: 1 }), 'MOVIE');
  assert.equal(getNovaPulseCatalogBadge({ id: 'series', type: 'series', title: 'Demo', priority: 1 }), 'SERIES');
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /height: 272/);
  assert.match(cardSource, /numberOfLines=\{3\} style=\{styles\.description\}/);
  assert.match(cardSource, /sportsCopy: \{ width: '55%'/);
  assert.match(cardSource, /<TvRemoteImage uri=\{remoteArtworkUrl \?\? undefined\}/);
  assert.match(cardSource, /backdropFallback/);
  assert.match(cardSource, /artworkStateRef\.current = 'loaded'; setArtworkTimedOut\(false\); setArtworkLoaded\(true\); onArtworkStatusRef\.current\?\.\('loaded'/);
  assert.match(cardSource, /setArtworkLoaded\(false\); setArtworkFailed\(true\)/);
  assert.match(cardSource, /const mediaKey = `\$\{item\.id\}\|\$\{remoteArtworkUrl \?\? ''\}`/);
  assert.match(cardSource, /\}, \[mediaKey\]\);/);
  assert.match(cardSource, /key=\{mediaKey\}/);
  assert.match(cardSource, /TvRemoteImage/);
  assert.match(cardSource, /hasRemoteArtwork && !artworkFailed/);
  assert.match(cardSource, /onLoad=/);
  assert.match(cardSource, /NOVA_PULSE_ARTWORK_TIMEOUT_MS/);
  assert.match(cardSource, /onArtworkStatusRef\.current\?\.\('timeout'/);
  assert.match(cardSource, /mediaMountCountRef/);
  assert.match(cardSource, /mediaUnmountCountRef/);
  assert.match(cardSource, /mediaKeyChangeCountRef/);
  assert.doesNotMatch(cardSource, /remoteArtworkUrl && artworkLoaded && !artworkFailed/);
  assert.match(cardSource, /overflow: 'hidden'/);
});

test('artwork diagnostics classify URI shape without exposing URL contents', () => {
  assert.deepEqual(describeNovaPulseArtwork('https://cdn.example/poster.jpg'), { present: true, scheme: 'https', hostPresent: true });
  assert.deepEqual(describeNovaPulseArtwork('http://cdn.example/poster.jpg?username=secret'), { present: true, scheme: 'http', hostPresent: true });
  assert.deepEqual(describeNovaPulseArtwork('//cdn.example/poster.jpg'), { present: true, scheme: 'protocol-relative', hostPresent: true });
  assert.deepEqual(describeNovaPulseArtwork('/images/poster.jpg'), { present: true, scheme: 'relative', hostPresent: false });
  assert.deepEqual(describeNovaPulseArtwork(''), { present: false, scheme: 'unknown', hostPresent: false });
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /const initialStatus = hasRemoteArtwork \? 'loading' : 'idle'/);
  assert.match(cardSource, /<TvRemoteImage uri=\{remoteArtworkUrl \?\? undefined\}/);
  assert.match(homeSource, /remoteImageMounted/);
  assert.match(homeSource, /remoteArtworkSucceeded = artwork\.present && \(status === 'loaded' \|\| status === 'displayed'\)/);
  assert.match(homeSource, /remoteArtworkFailed = artwork\.present && status === 'error'/);
  assert.match(homeSource, /remoteArtworkTimedOut = artwork\.present && status === 'timeout'/);
  assert.match(homeSource, /remote-image-timeout/);
  assert.match(homeSource, /\[NOVAPULSE_MEDIA\]/);
});

test('TvRemoteImage exposes native load success separately from load-end', () => {
  const imageSource = fs.readFileSync(new URL('../src/components/media/TvRemoteImage.tsx', import.meta.url), 'utf8');
  assert.match(imageSource, /onLoad\?: \(\) => void/);
  assert.match(imageSource, /onLoad=\{\(\) => \{\s*onLoad\?\.\(\);/);
  assert.match(imageSource, /onLoadEnd=\{\(\) => \{/);
});

test('NovaPulse timeout is one-shot and keyed to media identity', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /setArtworkTimedOut\(false\)/);
  assert.match(cardSource, /setArtworkTimedOut\(true\)/);
  assert.match(cardSource, /clearTimeout\(artworkTimeoutRef\.current\)/);
  assert.match(cardSource, /setArtworkFailed\(true\);\s*setArtworkTimedOut\(true\);\s*onArtworkStatusRef\.current\?\.\('timeout'/);
  assert.doesNotMatch(cardSource, /setInterval/);
});

test('catalog action hints are subtle and limited to actionable cards', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /resolveNovaPulseAction/);
  assert.match(cardSource, /Press OK/);
  assert.doesNotMatch(cardSource, /Explore the latest from NovaCast/);
  assert.doesNotMatch(cardSource, /Open featured content/);
});

test('sports artwork fallback is exclusive to the pre-load and error states', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /!remoteArtworkUrl && !artworkLoaded/);
  assert.match(cardSource, /hasRemoteArtwork && !artworkFailed/);
  assert.match(cardSource, /artworkFrameContained/);
  assert.doesNotMatch(cardSource, /mediaBlendOne|mediaBlendTwo|mediaBlendThree|mediaScrim/);
});

test('remote NovaPulse artwork is visible without waiting for a load callback', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /hasRemoteArtwork && !artworkFailed/);
  assert.match(cardSource, /style=\{styles\.backdrop\}/);
  assert.match(cardSource, /fallback.*artworkFailed.*artworkTimedOut.*\(!remoteArtworkUrl && !artworkLoaded\)/s);
  assert.doesNotMatch(cardSource, /remoteArtworkUrl && artworkLoaded && !artworkFailed/);
});

test('NovaPulse media layout owns a non-collapsing 55/45 width split', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /contentRow: \{ width: '100%', height: '100%'.*flexDirection: 'row'/s);
  assert.match(cardSource, /media: \{ position: 'relative', width: '45%', height: '100%'/);
  assert.match(cardSource, /copy: \{ width: '55%', height: '100%', minWidth: 0/);
  assert.match(cardSource, /artworkFrame: \{ width: '100%', height: '100%'/);
  assert.match(homeSource, /\[NOVAPULSE_LAYOUT\]/);
});

test('sports matchup keeps away-first ordering and compact team labels', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseSportsCard.tsx', import.meta.url), 'utf8');
  const logicSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseLogic.ts', import.meta.url), 'utf8');
  assert.match(cardSource, /sports\?\.awayName/);
  assert.match(cardSource, /sports\?\.homeName/);
  assert.match(cardSource, /formatNovaPulseTeamLabel/);
  assert.match(cardSource, /width: '42%'/);
  assert.match(cardSource, /width: '16%'/);
  assert.match(logicSource, /export function formatNovaPulseTeamLabel/);
});

test('sports footer keeps venue metadata and countdown in one bounded row', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseSportsCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /styles\.footer/);
  assert.match(cardSource, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.footerText\}/);
  assert.match(cardSource, /maxWidth: '43%'/);
  assert.match(cardSource, /marginTop: 7/);
});

test('late catalog index hydration invalidates NovaPulse candidates without Home reload', () => {
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(homeSource, /subscribeMovieCatalogIndex/);
  assert.match(homeSource, /subscribeSeriesCatalogIndex/);
  assert.match(homeSource, /novaPulseCatalogRevision/);
  assert.match(homeSource, /novaPulseCatalogRevision\]\);/);
  assert.doesNotMatch(homeSource, /setPersonalization\(\{[\s\S]{0,120}continueWatching/);
});

test('Home hydrates the same provider-keyed indexes from the published local catalog', () => {
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  const localSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseLocalCatalog.ts', import.meta.url), 'utf8');
  assert.match(homeSource, /getMovieCatalogIndex\(providerId\)/);
  assert.match(homeSource, /getSeriesCatalogIndex\(providerId\)/);
  assert.match(homeSource, /movieIndex\.ingest\(movies\)/);
  assert.match(homeSource, /seriesIndex\.ingest\(series\)/);
  assert.match(localSource, /createSqliteMovieDataSource/);
  assert.match(localSource, /createSqliteSeriesDataSource/);
  assert.match(localSource, /limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT/);
  assert.equal((localSource.match(/limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT/g) ?? []).length, 2);
});

test('local NovaPulse catalog hydration has no provider request or screen-wrapper fallback path', () => {
  const localSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseLocalCatalog.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(localSource, /createSqliteFirstMovieDataSource|createSqliteFirstSeriesDataSource/);
  assert.doesNotMatch(localSource, /providerRepositories|XtreamClient|fetch\(/);
  const syncSource = fs.readFileSync(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
  assert.match(syncSource, /const smartCategoriesEnabled = !settings\.hideSmartCategories/);
});

test('sports card uses balanced full-width matchup presentation and omits raw stages', () => {
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  const sportsSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseSportsCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /sportsCopy: \{ width: '55%'/);
  assert.match(cardSource, /media: \{[\s\S]*width: '45%'/);
  assert.match(cardSource, /sportsTitle: \{ maxWidth: '100%'/);
  assert.match(sportsSource, /getNovaPulseTeamInitials/);
  assert.match(sportsSource, /styles\.centerColumn/);
  assert.match(sportsSource, /formatNovaPulseStage/);
  assert.match(sportsSource, /isFinal && !isFight/);
  assert.match(sportsSource, /getNovaPulseTeamInitials/);
  assert.match(sportsSource, /width: '42%'/);
  assert.match(sportsSource, /width: '16%'/);
  assert.match(sportsSource, /ellipsizeMode="tail"/);
});

test('movie and series actions remain actionable while sports remains non-actionable', () => {
  assert.deepEqual(resolveNovaPulseAction({ id: 'movie', type: 'movie', title: 'Movie', priority: 1, action: { type: 'details', target: '/movies' } }), { type: 'details', target: '/movies' });
  assert.deepEqual(resolveNovaPulseAction({ id: 'series', type: 'series', title: 'Series', priority: 1, action: { type: 'details', target: '/series' } }), { type: 'details', target: '/series' });
  assert.equal(resolveNovaPulseAction({ id: 'sports', type: 'sports', title: 'Final', priority: 1, action: { type: 'none' } }), null);
});

test('announcement types map to premium badges and explicit overrides win', () => {
  assert.equal(getNovaPulseAnnouncementBadge({ id: 'feature', type: 'announcement', title: 'Feature', priority: 1, announcementType: 'feature' }), 'NEW FEATURE');
  assert.equal(getNovaPulseAnnouncementBadge({ id: 'update', type: 'announcement', title: 'Update', priority: 1, announcementType: 'update', version: '1.0.6' }), 'UPDATE');
  assert.equal(getNovaPulseAnnouncementBadge({ id: 'alert', type: 'announcement', title: 'Alert', priority: 1, announcementType: 'maintenance', badgeOverride: 'SERVICE ALERT' }), 'SERVICE ALERT');
});

test('announcement timing and optional fields fail cleanly', () => {
  const now = Date.parse('2026-09-19T12:00:00.000Z');
  assert.equal(formatNovaPulseAnnouncementTiming('2026-09-25T12:00:00.000Z', undefined, now), 'Available Sep 25');
  assert.equal(formatNovaPulseAnnouncementTiming(undefined, '2026-09-30T12:00:00.000Z', now), 'Ends Sep 30');
  assert.equal(formatNovaPulseAnnouncementTiming(undefined, undefined, now), null);
  assert.equal(formatNovaPulseAnnouncementTiming('invalid', undefined, now), null);
});

test('announcement priority is presentation-only and announcements remain non-actionable', () => {
  const source = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(source, /height: 272/);
  assert.match(source, /announcementPriority === 'critical'/);
  assert.equal(resolveNovaPulseAction({ id: 'notice', type: 'announcement', title: 'Notice', priority: 1, announcementPriority: 'critical', action: { type: 'none' } }), null);
});

test('catalog sources normalize actionable movie and series records', () => {
  const result = createNovaPulseCatalogSource([
    { id: 'm1', categoryId: 'c', title: 'Movie One', genres: ['Action'], posterStyleKey: 'ember', priority: 1 },
  ], [
    { id: 's1', seriesId: 's1', categoryId: 'c', title: 'Series One', genres: ['Drama'], posterStyleKey: 'orbit' },
  ]).getItems();
  assert.equal(result.items[0].sourceItemId, 'm1');
  assert.deepEqual(result.items[0].action, { type: 'details', target: '/movies', contentId: 'm1' });
  assert.deepEqual(result.items[1].action, { type: 'details', target: '/series', contentId: 's1', seriesId: 's1' });
});

test('catalog candidate extraction is bounded and prefers the prepared collection order', () => {
  const movies = Array.from({ length: 20 }, (_, index) => ({ id: `m${index}`, categoryId: 'c', title: `Movie ${index}`, genres: [], posterStyleKey: 'ember', priority: 1 }));
  const result = createNovaPulseCatalogSource(movies, []).getItems();
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].sourceItemId, 'm0');
  assert.equal(result.items.at(-1)?.sourceItemId, 'm19');
});

test('composer caps the rail, balances types, and removes duplicate source items', () => {
  const source = (items) => ({ id: 'test', getItems: () => ({ sourceId: 'test', items }) });
  const items = [
    { id: 'm1', type: 'movie', title: 'Movie', priority: 1, dedupeKey: 'movie:m1' },
    { id: 'm1-copy', type: 'movie', title: 'Movie duplicate', priority: 1, dedupeKey: 'movie:m1' },
    { id: 's1', type: 'series', title: 'Series', priority: 1 },
    { id: 'up', type: 'sports', subtype: 'upcoming', title: 'Upcoming', priority: 1 },
    { id: 'final', type: 'sports', subtype: 'final', title: 'Final', priority: 1 },
    { id: 'notice', type: 'announcement', title: 'Notice', priority: 1 },
  ];
  const result = composeNovaPulseFeed([source(items)]);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((item) => item.id), ['m1', 's1', 'up', 'final', 'notice']);
});

test('catalog absence or a failing source does not break remaining mock sources', () => {
  const failing = { id: 'broken', getItems: () => { throw new Error('source failed'); } };
  const mock = createNovaPulseMockSource([{ id: 'notice', type: 'announcement', title: 'Notice', priority: 1 }]);
  assert.deepEqual(composeNovaPulseFeed([failing, mock]).map((item) => item.id), ['notice']);
  assert.deepEqual(composeNovaPulseFeed([]), []);
});

test('release feed keeps per-type local fallback slots when catalog data is unavailable', () => {
  const source = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');
  const mockSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseSources.ts', import.meta.url), 'utf8');
  const homeSource = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  const mockFeedSource = fs.readFileSync(new URL('../src/features/novapulse/novaPulseMockFeed.ts', import.meta.url), 'utf8');
  assert.match(source, /movie: boundedMovies\.length === 0/);
  assert.match(source, /series: boundedSeries\.length === 0/);
  assert.match(source, /NOVAPULSE_FEED_RELEASE/);
  assert.match(source, /recordDiagnostic/);
  assert.match(mockSource, /includeMovieFallback/);
  assert.match(mockSource, /includeSeriesFallback/);
  assert.match(homeSource, /fetchMovieDetail: bundle\?\.movies\.enrichMovieInfo \?\? bundle\?\.movies\.getMovieInfo/);
  assert.doesNotMatch(mockFeedSource, /featured-movie-demo|Superman/);
  assert.doesNotMatch(mockFeedSource, /featured-series-demo|The Last Horizon/);
});

test('stable item IDs preserve the active card across recomposition without focus requests', () => {
  const before = [{ id: 'a', type: 'movie', title: 'A', priority: 1 }, { id: 'b', type: 'series', title: 'B', priority: 1 }];
  const after = [{ id: 'b', type: 'series', title: 'B updated', priority: 1 }, { id: 'c', type: 'movie', title: 'C', priority: 1 }];
  assert.equal(preserveNovaPulseIndex(after, 'b', 0), 0);
  assert.equal(preserveNovaPulseIndex(after, 'missing', 1), 1);
  const hookSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulse.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(hookSource, /requestFocus/);
  assert.equal(before[0].id, 'a');
});

test('catalog adaptor introduces no provider fetch path', () => {
  const source = fs.readFileSync(new URL('../src/features/novapulse/novaPulseSources.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|XtreamClient|providerRepositories|bundle\.syncCatalog/);
});

test('NovaPulse source keeps only non-catalog demonstration variants', () => {
  const source = fs.readFileSync(new URL('../src/features/novapulse/novaPulseMockFeed.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/id: '/g) ?? []).length, 3);
  assert.match(source, /type: 'announcement'/);
  assert.doesNotMatch(source, /featured-movie-demo|featured-series-demo|Superman|The Last Horizon|Ravens|Lions|Rams|Canelo|Portland FC/);
  assert.doesNotMatch(source, /type: 'sports'/);
  assert.match(source, /title: 'NovaCast Beta 24'/);
  assert.match(source, /title: 'Scheduled Maintenance'/);
});

test('selected NovaPulse artwork prefetch is bounded, normalized, deduplicated, and provider-scoped', () => {
  const items = Array.from({ length: 32 }, (_, index) => ({
    id: `candidate-${index}`,
    type: 'movie',
    title: `Candidate ${index}`,
    priority: index,
    artworkUrl: `https://cdn.example/${index}.jpg`,
  }));
  const selected = [
    { ...items[0], artworkUrl: '  https://cdn.example/shared.jpg ' },
    { ...items[1], type: 'series', artworkUrl: 'https://cdn.example/shared.jpg' },
    { ...items[2], type: 'announcement', artworkUrl: '' },
  ];
  const plan = createNovaPulseArtworkPrefetchPlan(selected, 'provider-a');
  assert.deepEqual(plan.urls, ['https://cdn.example/shared.jpg']);
  assert.equal(plan.selectedRemoteArtworkCount, 1);
  assert.equal(plan.deduped, 1);
  assert.match(plan.signature, /^provider-a\|candidate-0\|https:\/\/cdn\.example\/shared\.jpg/);
  const providerChanged = createNovaPulseArtworkPrefetchPlan(selected, 'provider-b');
  assert.notEqual(providerChanged.signature, plan.signature);
});

test('prefetch false is failure and cache/decode diagnostics remain separate', async () => {
  const items = [
    { id: 'movie-1', type: 'movie', title: 'Movie', artworkUrl: 'https://cdn.example/movie.jpg', priority: 1 },
    { id: 'series-1', type: 'series', title: 'Series', artworkUrl: 'https://cdn.example/series.jpg', priority: 1 },
  ];
  const plan = createNovaPulseArtworkPrefetchPlan(items, 'provider-1');
  const result = await inspectNovaPulseArtworkPrefetch(items, plan, {
    prefetch: async (url) => url.endsWith('movie.jpg'),
    getCachePathAsync: async () => null,
    readFromCacheAsync: async () => null,
    loadAsync: async ({ uri }) => { if (uri.endsWith('series.jpg')) throw new Error(`decode ${uri}`); return {}; },
  });
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.cachePresent, 0);
  assert.equal(result.cacheMissing, 1);
  assert.equal(result.cacheReadSuccess, 0);
  assert.equal(result.decodeSuccess, 1);
  assert.equal(result.decodeFailed, 1);
  assert.equal(result.decodeRequested, 2);
  assert.equal(result.prefetchRenderUriMatch, true);
  assert.equal(result.customCacheKeyUsed, false);
  assert.equal(result.cacheKeyMatch, true);
  assert.doesNotMatch(JSON.stringify(result), /https:\/\//);
});

test('prefetch true reports cache presence and cache read success', async () => {
  const items = [{ id: 'movie-1', type: 'movie', title: 'Movie', artworkUrl: 'https://cdn.example/movie.jpg', priority: 1 }];
  const plan = createNovaPulseArtworkPrefetchPlan(items, 'provider-1');
  const result = await inspectNovaPulseArtworkPrefetch(items, plan, {
    prefetch: async () => true,
    getCachePathAsync: async () => '/redacted-cache-path',
    readFromCacheAsync: async () => ({ ref: true }),
    loadAsync: async () => ({ ref: true }),
  });
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.cachePresent, 1);
  assert.equal(result.cacheMissing, 0);
  assert.equal(result.cacheReadSuccess, 1);
  assert.equal(result.decodeSuccess, 1);
  assert.equal(result.decodeFailed, 0);
  assert.equal(result.decodeRequested, 1);
  assert.equal(result.cacheRefs.size, 1);
});

test('TvRemoteImage forwards native display diagnostics without a visibility gate', () => {
  const imageSource = fs.readFileSync(new URL('../src/components/media/TvRemoteImage.tsx', import.meta.url), 'utf8');
  const cardSource = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  assert.match(imageSource, /onDisplay\?: \(\) => void/);
  assert.match(imageSource, /onDisplay=\{\(\) => \{\s*onDisplay\?\.\(\);/);
  assert.match(imageSource, /source=\{source\}/);
  assert.match(imageSource, /imageRef\?: ImageRef/);
  assert.match(cardSource, /onDisplay=\{\(\) => \{\s*onArtworkStatusRef\.current\?\.\('displayed'/);
  assert.match(cardSource, /hasRemoteArtwork && !artworkFailed/);
});

test('NovaPulse prefetch uses composed feed items and leaves rotation cadence unchanged', () => {
  const feedSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');
  const pulseSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulse.ts', import.meta.url), 'utf8');
  assert.match(feedSource, /createNovaPulseArtworkPrefetchPlan\(presentation\.items, providerId\)/);
  assert.match(feedSource, /inspectNovaPulseArtworkPrefetch\(presentation\.items, artworkPrefetchPlan/);
  assert.match(feedSource, /NOVAPULSE_MEDIA_PREFETCH/);
  assert.doesNotMatch(feedSource, /listSummaries/);
  assert.match(pulseSource, /8_000/);
});
