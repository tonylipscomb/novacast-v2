import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const player = read('src/features/playback/NovaStreamPlayer.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const live = read('src/features/live/LiveTvScreen.tsx');
const xtream = read('src/features/providers/xtreamClient.ts');
const repository = read('src/features/providers/providerRepositories.ts');
const source = read('src/features/series/data/ProviderSeriesDataSource.ts');
const model = read('src/features/series/useSeriesScreenModel.ts');

assert.match(controller, /EXPO_PUBLIC_NOVACAST_BARE_VIDEO_AUDIT === '1'/);
assert.match(controller, /BareVideoAuditSurface player=\{player\}/);
assert.doesNotMatch(controller, /BareVideoAuditSurface[\s\S]{0,200}streamUrl/);
assert.match(player, /BARE_VIDEO_AUDIT_SURFACE_TYPE/);
assert.match(player, /BARE_VIDEO_AUDIT_SURFACE_TYPE: BareVideoAuditSurfaceType = 'surfaceView'/);
assert.match(player, /style=\{\[styles\.bareAuditRoot, \{ width, height \}\]\}/);
assert.match(player, /invalid-video-layout/);
assert.match(player, /first-frame-render/);
assert.match(player, /video-layout/);
assert.match(player, /bare-video-unmounted/);
assert.match(live, /live-surface-mounted/);
assert.match(live, /live-surface-layout/);
assert.match(live, /live-player-status/);
assert.match(live, /live-first-frame-render/);
assert.match(live, /live-surface-state/);
assert.match(live, /surfaceOpacity: fullscreenFrameStatus === 'ready' \? 1 : 0/);
assert.match(live, /hiddenStreamSurface/);
assert.match(live, /opacity: 0/);
assert.match(xtream, /stage: 'http-response' \| 'json-parsed'/);
assert.match(xtream, /parsedNull: parsed === null/);
assert.match(repository, /provider-returned-null/);
assert.match(source, /boundary: info == null \? 'provider-returned-null' : 'normalized-object'/);
assert.match(model, /reason: 'select' \| 'retry'/);
assert.match(model, /event: 'detail-request'/);
assert.match(model, /event: 'datasource-result'/);
assert.match(xtream, /buildUrl\('get_series_info'/);

console.log('playback/series boundary audit checks passed');
