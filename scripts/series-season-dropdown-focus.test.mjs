import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/features/series/components/SeriesDetailPopupV2.tsx', 'utf8');
const selector = source.slice(source.indexOf('function CollectionSelector'), source.indexOf('function EpisodeChip'));

test('season dropdown uses one session-scoped native focus handoff', () => {
  assert.match(selector, /collectionMenuFocusOwned/);
  assert.match(selector, /reason: 'season-dropdown-open'/);
  assert.match(selector, /maxFrames: 6/);
  assert.match(selector, /isActive: \(\) => menuOpenRef\.current && menuOpenSessionRef\.current === session/);
  assert.match(selector, /\}, \[open\]\);/);
  assert.equal((selector.match(/reason: 'season-dropdown-open'/g) ?? []).length, 1);
  assert.match(selector, /setCollectionMenuFocusOwned\(true\)/);
  assert.match(selector, /style=\{\[styles\.collectionControl, \(focused \|\| \(open && !collectionMenuFocusOwned\)\)/);
  assert.match(selector, /focusable=\{false\}[\s\S]{0,120}showsVerticalScrollIndicator/);
  assert.doesNotMatch(selector, /nextFocusUp=\{controlHandle\}/);
});

test('season options are contained by the nested focus guide', () => {
  assert.match(selector, /trapFocusLeft: true/);
  assert.match(selector, /trapFocusRight: true/);
  assert.match(selector, /trapFocusUp: true/);
  assert.match(selector, /trapFocusDown: true/);
  assert.match(source, /reason: 'collection-menu-back'/);
  assert.match(source, /reason: 'collection-menu-close'/);
});

test('season option refs use stable storage without a ref-to-render loop', () => {
  assert.match(selector, /const optionRefCallbacks = useRef\(new Map/);
  assert.match(selector, /const optionHandlesRef = useRef\(new Map/);
  assert.match(selector, /const registerSeasonOption = useCallback/);
  assert.match(selector, /const getSeasonOptionRef = useCallback/);
  assert.match(selector, /ref=\{getSeasonOptionRef\(season\.seasonNumber\)\}/);
  assert.match(selector, /optionHandlesRef\.current\.get\(seasonNumber\) === handle/);
  assert.doesNotMatch(selector, /setOptionHandles/);
  assert.doesNotMatch(selector, /ref=\{\(instance\) => \{[\s\S]*setOptionHandles/);
});

test('season option focus is distinct from selected state and visibly owned', () => {
  assert.match(selector, /focusedSeasonOption/);
  assert.match(selector, /setFocusedSeasonOption\(season\.seasonNumber\)/);
  assert.match(selector, /focusedSeasonOption === season\.seasonNumber && styles\.collectionOptionFocused/);
  assert.match(selector, /selectedRow && styles\.collectionOptionSelected/);
  assert.match(source, /collectionOptionFocused: \{/);
  assert.match(source, /borderWidth: 2/);
  assert.match(source, /collectionOptionTextFocused/);
  assert.doesNotMatch(selector, /nextFocusUp:/);
  assert.doesNotMatch(selector, /nextFocusDown:/);
  assert.doesNotMatch(selector, /nextFocusLeft: optionHandles/);
  assert.doesNotMatch(selector, /nextFocusRight: optionHandles/);
  assert.doesNotMatch(selector, /optionHandles\[seasons\[seasonIndex - 1\]/);
  assert.doesNotMatch(selector, /optionHandles\[seasons\[seasonIndex \+ 1\]/);
  assert.match(selector, /seasonScrollRef\.current\?\.scrollTo/);
  assert.match(selector, /focusable=\{false\}[^\n]*\n\s*\{\.\.\./);
  assert.match(selector, /event: 'option-focus'/);
  assert.match(selector, /event: 'option-blur'/);
  assert.match(source, /event: 'selector-restored'/);
});

test('series detail owns a stable native focus graph at every modal boundary', () => {
  assert.match(source, /const detailRefCallbacks = useRef\(new Map/);
  assert.match(source, /const detailHandlesRef = useRef\(new Map/);
  assert.match(source, /const registerDetailHandle = useCallback/);
  assert.match(source, /const getDetailRef = useCallback/);
  assert.match(source, /setDetailHandles\(\(current\) => current\[id\] === handle/);
  assert.match(source, /ref=\{getDetailRef\('close'\)\}/);
  assert.match(source, /buttonRef=\{getDetailRef\(`action:\$\{action\.id\}`\)\}/);
  assert.match(source, /controlRef=\{getDetailRef\('collection'\)\}/);
  assert.match(source, /chipRef=\{getDetailRef\(`episode:\$\{episode\.id\}`\)\}/);
  assert.match(source, /const detailFocusProps = useCallback/);
  assert.match(source, /left: 'close', right: firstActionId, up: 'close', down: firstContentId/);
  assert.match(source, /left: previous,[\s\S]{0,180}down: renderedSeasonOptions\.length > 0 \? 'collection'/);
  assert.match(source, /left: 'collection', right: 'collection', up: lastActionId/);
  assert.match(source, /left: id, right: id, up: episodeIds\[index - 1\]/);
  assert.match(source, /trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true/);
});

test('popup directional props never depend on unstable inline handle refs', () => {
  assert.match(source, /registerControlRef = useCallback/);
  assert.match(source, /ref=\{registerControlRef\}/);
  assert.doesNotMatch(source, /buttonRef=\{\(instance\) => \{/);
  assert.doesNotMatch(source, /controlRef=\{\(instance\) => \{/);
  assert.doesNotMatch(source, /chipRef=\{\(instance\) => \{/);
  assert.match(source, /nextFocusLeft\?: number/);
  assert.match(source, /nextFocusRight\?: number/);
  assert.match(source, /nextFocusUp\?: number/);
  assert.match(source, /nextFocusDown\?: number/);
});

test('all detail actions hand DOWN to Collection when it is available', () => {
  assert.match(source, /actionIds\.forEach\(\(id, index\) =>/);
  assert.match(source, /down: renderedSeasonOptions\.length > 0 \? 'collection' : \(episodeIds\[0\] \?\? id\)/);
  assert.match(source, /renderedSeasonOptions\.length > 0/);
});

test('confirmed empty seasons are removed without hiding loading seasons', () => {
  assert.match(source, /const selectableSeasons = useMemo\(/);
  assert.match(source, /loading \? seasons : seasons\.filter\(\(season\) => season\.episodeCount > 0\)/);
  assert.match(source, /resolveSeriesDetailPopupV2SeasonNumber\(renderedSeasonOptions/);
});

test('dropdown seasons use one snapshot for the lifetime of an open session', () => {
  assert.match(source, /const \[openSeasonOptions, setOpenSeasonOptions\] = useState/);
  assert.match(source, /setOpenSeasonOptions\(collectionOpen \? selectableSeasons : null\)/);
  assert.match(source, /Deliberately depend only on the open\/close boundary/);
  assert.match(source, /const renderedSeasonOptions = collectionOpen && openSeasonOptions/);
  assert.match(source, /seasons=\{renderedSeasonOptions\}/);
  assert.match(source, /renderedSeasonOptions\.length > 0/);
});

test('season option focus uses ensure-visible scrolling instead of recentering every move', () => {
  assert.match(selector, /seasonScrollOffsetRef/);
  assert.match(selector, /seasonMenuHeightRef/);
  assert.match(selector, /rowTop < seasonScrollOffsetRef\.current/);
  assert.match(selector, /rowBottom > viewportBottom/);
  assert.doesNotMatch(selector, /scrollTo\(\{ y: seasonIndex \* 54/);
});

test('dropdown guide owns every directional edge without per-option self handles', () => {
  assert.match(selector, /trapFocusLeft: true, trapFocusRight: true, trapFocusUp: true, trapFocusDown: true/);
  assert.match(selector, /<ScrollView[\s\S]*seasons\.map/);
  assert.doesNotMatch(selector, /const \[optionHandles/);
});
