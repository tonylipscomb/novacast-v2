import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('src/components/nova/NovaTvShell.tsx', 'utf8');
const navbar = readFileSync('src/components/nova/NovaGlassNavbar.tsx', 'utf8');

const order = ['home', 'movies', 'series', 'live', 'search', 'guide', 'settings'];
const expectedGraph = order.map((itemId, index) => ({
  itemId,
  leftTargetId: order[Math.max(0, index - 1)],
  rightTargetId: order[Math.min(order.length - 1, index + 1)],
}));

test('navbar graph uses self-traps at both horizontal edges and adjacent neighbors', () => {
  assert.deepEqual(expectedGraph[0], { itemId: 'home', leftTargetId: 'home', rightTargetId: 'movies' });
  assert.deepEqual(expectedGraph.at(-1), { itemId: 'settings', leftTargetId: 'guide', rightTargetId: 'settings' });
  for (let index = 1; index < order.length - 1; index += 1) {
    assert.equal(expectedGraph[index].leftTargetId, order[index - 1]);
    assert.equal(expectedGraph[index].rightTargetId, order[index + 1]);
  }
  assert.match(shell, /const horizontalFocusTarget = \(itemIndex: number, direction: 'left' \| 'right'\)/);
  assert.match(shell, /Math\.max\(0, itemIndex - 1\)/);
  assert.match(shell, /Math\.min\(NAV_ITEMS\.length - 1, itemIndex \+ 1\)/);
  assert.match(shell, /navbarHandles\[NAV_ITEMS\[neighborIndex\]\.id\] \?\? navbarHandles\[item\.id\]/);
});

test('every focusable navbar item receives explicit horizontal native targets', () => {
  assert.match(navbar, /nextFocusLeft\?: number/);
  assert.match(navbar, /nextFocusRight\?: number/);
  assert.match(navbar, /nextFocusLeft != null \? \{ nextFocusLeft \}/);
  assert.match(navbar, /nextFocusRight != null \? \{ nextFocusRight \}/);
  assert.match(shell, /nextFocusLeft=\{horizontalFocusTarget\(itemIndex, 'left'\)\}/);
  assert.match(shell, /nextFocusRight=\{horizontalFocusTarget\(itemIndex, 'right'\)\}/);
  assert.match(shell, /const setNavItemRef = useCallback/);
  assert.match(shell, /const \[navbarHandles, setNavbarHandles\] = useState/);
  assert.match(shell, /findNodeHandle\(node\)/);
});

test('navbar horizontal graph cannot fall through to content handles', () => {
  const graphBlock = shell.slice(
    shell.indexOf('const horizontalFocusTarget'),
    shell.indexOf('const contentDownHandle'),
  );
  assert.doesNotMatch(graphBlock, /navigationContentFocusHandle|navigationNextFocusRight/);
  assert.match(navbar, /trapFocusLeft: true, trapFocusRight: true/);
  assert.match(shell, /<GlassNavbarFocusGuide trapFocusUp>/);
  assert.doesNotMatch(shell, /<GlassNavbarFocusGuide[^>]*trapFocusDown/);
  assert.match(shell, /router\.replace\(item\.route as Href\)/);
});

test('navbar top edge traps UP on every item without trapping DOWN', () => {
  assert.match(navbar, /nextFocusUp\?: number/);
  assert.match(shell, /nextFocusUp=\{navbarHandles\[item\.id\]\}/);
  assert.match(shell, /<GlassNavbarFocusGuide trapFocusUp>/);
  assert.doesNotMatch(shell, /<GlassNavbarFocusGuide[^>]*trapFocusDown/);
  assert.match(shell, /nextFocusDown=\{downHandle\}/);
});

test('focus graph is not rebuilt from focusedId changes', () => {
  const graphEffect = shell.slice(
    shell.indexOf("console.info('[NovaCast Navbar Focus Graph]'") - 900,
    shell.indexOf('const horizontalFocusTarget'),
  );
  assert.doesNotMatch(graphEffect, /focusedId/);
  assert.match(graphEffect, /\}, \[navbarHandles, navigationFocusable\]\);/);
});
