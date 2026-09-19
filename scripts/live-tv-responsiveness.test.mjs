import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveLiveSurfAdjacent, resolveLiveSurfTarget } from '../src/features/live/liveTvSurf.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const screen = read('src/features/live/LiveTvScreen.tsx');
const router = read('src/features/live/LiveTvFocusRouter.tsx');
const model = read('src/features/live/useLiveTvScreenModel.ts');
const preview = read('src/features/live/liveTvFocusPreview.ts');
const epg = read('src/features/live/liveTvChannelEpg.ts');
const navDiagnostics = read('src/features/live/liveTvDiagnostics.ts');

assert.match(model, /LIVE_EPG_FOCUS_DEBOUNCE_MS/);
assert.match(model, /focusedEpgTimerRef\.current/);
assert.match(model, /shouldIssueFocusedEpgRequest/);
assert.match(screen, /PREVIEW_FOCUS_DEBOUNCE_MS/);
assert.match(screen, /stale-preview-ignored/);
assert.match(preview, /LIVE_TV_PREVIEW_FOCUS_DEBOUNCE_MS = 300/);

assert.match(screen, /pendingSurfDeltaRef/);
assert.match(screen, /Math\.max\(-5, Math\.min\(5/);
assert.match(screen, /event: 'selection-updated'/);
assert.match(screen, /event: 'selection-updated-during-tune'/);
assert.match(screen, /event: 'coalesced-follow-up'/);
assert.match(screen, /event: 'settled'/);
assert.match(screen, /}, 250\);/);
assert.match(screen, /event: 'tune-after-settle'/);
assert.match(screen, /fullscreen-surf-preserve-current-until-next-source/);
assert.match(router, /event: 'surf-focus-queued'/);
assert.match(screen, /surfTransitionInFlight: false/);

assert.match(model, /focusedEpgActiveChannelRef/);
assert.match(model, /focusedEpgLatestChannelRef/);
assert.match(model, /focused-request-queued-latest/);
assert.match(model, /focusedEpgActiveChannelRef\.current = null/);
assert.match(model, /enrichFocusedChannelEpg\(latestChannelId\)/);
assert.match(model, /runAfterLiveTvFocusIdle/);
assert.match(model, /setEpgByChannelId\(\(current\) =>/);
assert.match(model, /const next = new Map\(current\)/);
assert.match(model, /setEpgRevision\(\(revision\) => revision \+ 1\)/);
assert.doesNotMatch(model, /applyEpgBatch[\s\S]{0,700}setChannels\(\(current\)/);
assert.match(epg, /bulk-paused/);
assert.match(epg, /await waitForLiveTvFocusIdle\(\)/);
assert.match(epg, /bulk-resumed/);
assert.match(navDiagnostics, /\[NovaCast Live Nav Perf\]/);
assert.match(navDiagnostics, /\[NovaCast Live Focus Perf\]/);
assert.match(read('src/features/providers/providerRepositories.ts'), /authoritativeLiveCategoryIndex/);
assert.match(read('src/features/providers/providerRepositories.ts'), /authoritativeLiveCategoryIndex\?\.get\(categoryId\)/);

{
  const ids = ['20', '21', '22', '23', '24', '25', '26'];
  const first = resolveLiveSurfAdjacent({ channelIds: ids, currentId: '20', direction: 1 });
  assert.equal(first.kind, 'adjacent');
  assert.equal(first.toChannelId, '21');
  const target = resolveLiveSurfTarget({ channelIds: ids, currentId: '21', targetId: '24' });
  assert.equal(target.kind, 'adjacent');
  assert.equal(target.toChannelId, '24');
  assert.equal(target.toIndex, 4);
}

{
  const ids = ['20', '21', '22', '23', '24', '25'];
  let pending = 0;
  let target = '21';
  for (const direction of [1, 1, 1, -1]) {
    pending = Math.max(-5, Math.min(5, pending + direction));
    const next = resolveLiveSurfAdjacent({ channelIds: ids, currentId: target, direction });
    if (next.kind === 'adjacent') target = next.toChannelId;
  }
  assert.equal(pending, 2);
  assert.equal(target, '23');
}

assert.match(screen, /Math\.max\(-5, Math\.min\(5/);
assert.match(screen, /desiredTargetId/);
assert.match(screen, /focus-owner-changed/);
assert.match(screen, /focusOwnerRef\.current = 'channels'[\s\S]{0,180}preferCategoryFocusRef\.current = false/);
assert.match(screen, /triggerLatencyMs/);
assert.doesNotMatch(screen, /fullscreen-surf-preserve-current-until-next-source[\s\S]{0,120}setPreviewStreamSource\(null\)/);

assert.match(screen, /\[NovaCast Live Back Perf\].*back-key-received/);
assert.match(screen, /\[NovaCast Live Back Perf\].*fullscreen-close-requested/);
assert.match(screen, /\[NovaCast Live Back Perf\].*fullscreen-state-cleared/);

console.log('live TV responsiveness contracts passed');
