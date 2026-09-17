import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Worker-authoritative EPG execution contract.
// The GitHub Actions worker (scripts/epg-ingest/index.mjs) is the single live EPG executor.
// The admin edge function only enqueues requests, reconciles zombie jobs, and reports status.
const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');

const refreshBranch = admin.slice(
  admin.indexOf("if (action === 'start_epg_refresh'"),
  admin.indexOf("if (action === 'get_epg_refresh_status'"),
);
const continueBranch = admin.slice(
  admin.indexOf("if (action === 'continue_epg_refresh')"),
  admin.indexOf("if (action === 'test_epg_source')"),
);
const queueEntry = admin.slice(
  admin.indexOf('async function queueManagedEpgRefresh'),
  admin.indexOf('async function previewEpgResolution'),
);
const recoverOrphans = admin.slice(
  admin.indexOf('async function recoverOrphanedRefreshJobs'),
  admin.indexOf('// Live refresh executor'),
);
const workerLoop = worker.slice(
  worker.indexOf('for (const request of requests'),
  worker.lastIndexOf('if (targetedRun)'),
);

test('1. worker failure after ensureRefreshJob marks the ENSURED job failed', () => {
  assert.match(workerLoop, /const failJobId = \(ensuredJob && !ensuredJob\.skipped \? ensuredJob\.jobId : null\) \?\? request\.refresh_job_id/);
  assert.match(workerLoop, /if \(failJobId && UUID_PATTERN\.test\(failJobId\)\) await patch\('managed_provider_epg_refresh_jobs', failJobId, \{ status: 'failed'/);
  // ensuredJob must be hoisted so the catch can read it.
  assert.match(workerLoop, /let ensuredJob = null;\s*try \{/);
});

test('2. worker failure also marks the request failed', () => {
  assert.match(workerLoop, /if \(UUID_PATTERN\.test\(requestId\)\) await patch\('managed_provider_epg_refresh_requests', requestId, \{ status: 'failed'/);
});

test('3. terminal FAILED request + active linked job is reconciled to failed', () => {
  assert.match(recoverOrphans, /if \(owner\?\.status === 'failed'\) \{[\s\S]*?await markRefreshJobFailed\(client, job, owner\.failure_code \?\? 'refresh_orphaned'\);/);
});

test('4. terminal COMPLETE request cannot leave the linked job active', () => {
  assert.match(recoverOrphans, /if \(owner\?\.status === 'complete'\) \{[\s\S]*?status: 'complete', stage: null, progress_percent: 100/);
  assert.match(recoverOrphans, /\.eq\('id', job\.id\)\.in\('status', ACTIVE_REFRESH_STATUSES\)/);
});

test('5. healthy running/pending owner + active job is only expired on heartbeat staleness', () => {
  assert.match(recoverOrphans, /const beat = Date\.parse\(job\.updated_at \?\? job\.started_at \?\? job\.created_at \?\? ''\)/);
  assert.match(recoverOrphans, /const stale = !Number\.isFinite\(beat\) \|\| now - beat > EPG_REFRESH_JOB_HEARTBEAT_MS/);
  // never expired purely because progress/checkpoint/artifact are null.
  assert.doesNotMatch(recoverOrphans, /started_at IS NULL|processed_channels === 0|checkpoint === null/);
});

test('6. a fresh no-owner job is not killed immediately', () => {
  // No-owner path falls through to the shared heartbeat guard, not an unconditional fail.
  assert.match(recoverOrphans, /if \(stale\) \{\s*await markRefreshJobFailed\(client, job, 'refresh_expired'\)/);
});

test('7. a stale no-owner job expires as refresh_expired', () => {
  assert.match(recoverOrphans, /markRefreshJobFailed\(client, job, 'refresh_expired'\)/);
  assert.match(admin, /const EPG_REFRESH_JOB_HEARTBEAT_MS =/);
});

test('8. Admin start_epg_refresh ENQUEUES but does not execute the edge ingest pipeline', () => {
  assert.match(refreshBranch, /await queueManagedEpgRefresh\(client, source\)/);
  assert.doesNotMatch(refreshBranch, /startEpgRefresh|continueEpgRefresh|runEpgSourceTest|runManagedEpgRefresh/);
});

test('9. Admin refresh_epg_source shares the same worker-owned enqueue contract', () => {
  assert.match(refreshBranch, /action === 'start_epg_refresh' \|\| action === 'refresh_epg_source'/);
  assert.match(refreshBranch, /await queueManagedEpgRefresh\(client, source\)/);
});

test('10. the live Admin refresh route no longer calls runManagedEpgRefresh', () => {
  assert.doesNotMatch(refreshBranch, /runManagedEpgRefresh/);
  // enqueue-only entry reconciles zombies then writes the pending request.
  assert.match(queueEntry, /await recoverStaleRefreshRequests\(client, source\)/);
  assert.match(queueEntry, /await recoverOrphanedRefreshJobs\(client, source\)/);
  assert.match(queueEntry, /await enqueueEpgRefresh\(client, source\)/);
});

test('11. status polling does not run edge continuation against worker_ingest jobs', () => {
  assert.doesNotMatch(continueBranch, /await continueEpgRefresh\(/);
  assert.match(continueBranch, /publicRefreshJob\(await getRefreshJob\(client, jobId\)\)/);
  assert.match(continueBranch, /await closeRequestForJob\(client, jobId, refresh\)/);
});

test('12. a duplicate legitimate active refresh still rejects with refresh_in_progress', () => {
  assert.match(admin, /if \(active\) throw new Error\('refresh_in_progress'\)/);
  assert.match(admin, /requestError\?\.code === '23505'/);
});

test('13. enqueueEpgRefresh stays a pure request writer (no job coupling)', () => {
  const enqueue = admin.slice(admin.indexOf('async function enqueueEpgRefresh'), admin.indexOf('async function startEpgRefresh'));
  assert.doesNotMatch(enqueue, /managed_provider_epg_refresh_jobs|refresh_job_id/);
  assert.match(enqueue, /return \{ requestId: request\.id, sourceId: source\.id, status: 'pending', requestedAt: now \}/);
});

test('14. worker owns the worker_ingest stage; the edge function never writes it', () => {
  assert.match(worker, /stage: 'worker_ingest'/);
  assert.doesNotMatch(admin, /worker_ingest/);
});

