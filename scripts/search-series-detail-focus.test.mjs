import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const searchLayer = fs.readFileSync('src/features/search/SearchMediaDetailLayer.tsx', 'utf8');
const searchOverlay = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
const searchScreen = fs.readFileSync('src/features/search/SearchScreen.tsx', 'utf8');
const seriesPopup = fs.readFileSync('src/features/series/components/SeriesDetailPopupV2.tsx', 'utf8');
const providerSeriesDataSource = fs.readFileSync('src/features/series/data/ProviderSeriesDataSource.ts', 'utf8');

test('search media details reuse the accepted V2 popup implementations', () => {
  assert.match(searchLayer, /import \{ MovieDetailPopupV2 \}/);
  assert.match(searchLayer, /import \{ SeriesDetailPopupV2 \}/);
  assert.match(searchLayer, /<MovieDetailPopupV2/);
  assert.match(searchLayer, /<SeriesDetailPopupV2/);
  assert.doesNotMatch(searchLayer, /MediaDetailOverlay/);
});

test('Search disables its content and navbar focus while detail is open', () => {
  assert.match(searchScreen, /navigationFocusable=\{!searchMedia\.detailOpen && !searchMedia\.playbackActive\}/);
  assert.match(searchScreen, /pointerEvents=\{searchMedia\.detailOpen \|\| searchMedia\.playbackActive \? 'none' : 'auto'\}/);
  assert.match(searchScreen, /importantForAccessibility=\{searchMedia\.detailOpen \? 'no-hide-descendants' : 'auto'\}/);
});

test('Series collection menu stays inside a trapped detail focus boundary', () => {
  assert.match(seriesPopup, /region: 'collection-menu'/);
  assert.match(seriesPopup, /trapFocusLeft: true/);
  assert.match(seriesPopup, /trapFocusRight: true/);
  assert.match(seriesPopup, /trapFocusUp: true/);
  assert.match(seriesPopup, /trapFocusDown: true/);
  assert.match(seriesPopup, /reason: 'season-dropdown-open'/);
  assert.match(seriesPopup, /reason: 'collection-menu-back'/);
  assert.match(seriesPopup, /setCollectionOpen\(false\)/);
  assert.match(seriesPopup, /reason: 'collection-menu-close'/);
});

test('Series Search hosts search-origin detail inside the Search overlay', () => {
  const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
  assert.match(searchOverlay, /detailLayer\?: ReactNode/);
  assert.match(searchOverlay, /\{detailLayer\}/);
  assert.match(searchOverlay, /onDetailBack\?: \(\) => void/);
  assert.match(searchOverlay, /if \(detailOpen\)/);
  assert.match(searchOverlay, /const interactive = visible && !detailOpen/);
  assert.match(searchOverlay, /pointerEvents=\{interactive \? 'auto' : 'none'\}/);
  assert.match(searchOverlay, /importantForAccessibility=\{interactive \? 'auto' : 'no-hide-descendants'\}/);
  assert.match(searchOverlay, /\[NovaCast Search Modal State\]/);
  assert.match(searchOverlay, /if \(!visible\) \{\s*return null;\s*\}/);
  assert.match(searchOverlay, /visible=\{visible\}/);
  assert.match(searchOverlay, /retainMounted/);
  assert.match(searchOverlay, /onRequestClose=\{scope === 'live'/);
  assert.match(searchOverlay, /detailOpen \? \(onDetailBack \?\? onClose\) : onClose/);
  assert.match(searchOverlay, /restoreFocusResultKey\?: string \| null/);
  assert.match(searchOverlay, /restore-after-hosted-detail-close/);
  assert.match(seriesScreen, /detailOpen=\{detailLaunchOriginRef\.current === 'search' && seriesDetailPopup\.open\}/);
  assert.match(seriesScreen, /detailLaunchOriginRef\.current === 'search' && seriesDetailPopup\.open \? \(/);
  assert.match(seriesScreen, /detailLaunchOriginRef\.current !== 'search' \? \(/);
  assert.match(seriesScreen, /retainMounted=\{searchOpen \|\| seriesDetailPopup\.open \|\| playbackUiActive\}/);
  assert.match(seriesScreen, /restoreFocusResultKey=\{searchOriginResultKey\}/);
  assert.match(seriesScreen, /onDetailBack=\{\(\) => closeSeriesDetailPopup\('back'\)\}/);
  assert.match(seriesScreen, /setSearchOriginResultKey\(`series:\$\{result\.id\}`\)/);
  assert.match(seriesScreen, /setSeriesDetailPopup\(\{ open: true, series, originItemId: series\.id \}\)/);
  assert.doesNotMatch(seriesScreen, /handleSearchSelect[\s\S]{0,300}setSearchOpen\(false\)/);
});

test('Series detail hydration keeps the sanitized provider audit at the data boundary', () => {
  assert.match(providerSeriesDataSource, /logSeriesInfoAudit\(\{/);
  assert.match(providerSeriesDataSource, /datasource: 'ProviderSeriesDataSource'/);
  assert.match(providerSeriesDataSource, /responseSource: 'provider'/);
  assert.match(providerSeriesDataSource, /canonicalSeriesId:/);
  assert.match(providerSeriesDataSource, /parsedEpisodeCountBySeason:/);
  assert.doesNotMatch(providerSeriesDataSource, /streamUrl|username|password|authorization/);
});
