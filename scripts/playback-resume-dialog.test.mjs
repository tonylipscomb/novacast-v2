import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelPlaybackResumePrompt,
  getPlaybackResumePrompt,
  requestPlaybackResumeChoice,
  resetPlaybackResumeGateForTests,
  resolveLaunchResumePosition,
  resolvePlaybackResumePrompt,
} from '../src/features/playback/continuity/playbackResumeGate.ts';

function countSnapshotDrivenRenders(getSnapshot, max = 25) {
  let renders = 0;
  let snapshot = getSnapshot();
  while (renders < max) {
    renders += 1;
    const next = getSnapshot();
    if (Object.is(snapshot, next)) {
      return renders;
    }
    snapshot = next;
  }
  throw new Error('resume prompt snapshot never stabilized');
}

const resumableMovie = {
  policy: 'prompt',
  contentId: 'movie-1',
  mediaType: 'movie',
  title: 'Resume Movie',
  positionMs: 120_000,
  durationMs: 600_000,
};

test('resumable movie opens prompt without a render loop', async () => {
  resetPlaybackResumeGateForTests();
  const decision = resolveLaunchResumePosition(resumableMovie);
  const first = getPlaybackResumePrompt();
  assert.ok(first);
  assert.equal(first.contentId, 'movie-1');
  assert.equal(countSnapshotDrivenRenders(getPlaybackResumePrompt), 1);
  assert.equal(getPlaybackResumePrompt(), first);
  resolvePlaybackResumePrompt('cancel');
  await decision;
});

test('opening a prompt does not invoke Resume or Restart automatically', async () => {
  resetPlaybackResumeGateForTests();
  let resolved = null;
  const pending = requestPlaybackResumeChoice({
    contentId: 'movie-2',
    mediaType: 'movie',
    title: 'Pending Movie',
    positionMs: 90_000,
    durationMs: 600_000,
  }).then((choice) => {
    resolved = choice;
    return choice;
  });

  for (let index = 0; index < 40; index += 1) {
    getPlaybackResumePrompt();
  }
  assert.equal(resolved, null);
  assert.ok(getPlaybackResumePrompt());
  resolvePlaybackResumePrompt('cancel');
  assert.equal(await pending, 'cancel');
});

test('identical snapshot rereads do not allocate a new prompt object', async () => {
  resetPlaybackResumeGateForTests();
  const pending = requestPlaybackResumeChoice({
    contentId: 'movie-3',
    mediaType: 'movie',
    title: 'Stable Movie',
    positionMs: 80_000,
    durationMs: 600_000,
  });
  const first = getPlaybackResumePrompt();
  const second = getPlaybackResumePrompt();
  const third = getPlaybackResumePrompt();
  assert.equal(first, second);
  assert.equal(second, third);
  resolvePlaybackResumePrompt('cancel');
  await pending;
});

test('Resume resolves the gate exactly once', async () => {
  resetPlaybackResumeGateForTests();
  const item = { streamUrl: 'http://example.invalid/movie.mkv' };
  const decision = resolveLaunchResumePosition({ ...resumableMovie, contentId: 'movie-4' });
  resolvePlaybackResumePrompt('resume');
  resolvePlaybackResumePrompt('resume');
  assert.deepEqual(await decision, { action: 'launch', resumePositionMs: 120_000, resetProgress: false });
  assert.equal(item.streamUrl, 'http://example.invalid/movie.mkv');
  assert.equal(getPlaybackResumePrompt(), null);
});

test('Restart resolves the gate exactly once', async () => {
  resetPlaybackResumeGateForTests();
  const decision = resolveLaunchResumePosition({ ...resumableMovie, contentId: 'movie-5' });
  resolvePlaybackResumePrompt('restart');
  resolvePlaybackResumePrompt('restart');
  assert.deepEqual(await decision, { action: 'launch', resumePositionMs: 0, resetProgress: true });
  assert.equal(getPlaybackResumePrompt(), null);
});

test('Back/cancel resolves and closes the prompt exactly once', async () => {
  resetPlaybackResumeGateForTests();
  const decision = resolveLaunchResumePosition({ ...resumableMovie, contentId: 'movie-6' });
  cancelPlaybackResumePrompt();
  cancelPlaybackResumePrompt();
  assert.deepEqual(await decision, { action: 'cancel' });
  assert.equal(getPlaybackResumePrompt(), null);
});

test('valid stream source is preserved through the prompt', async () => {
  resetPlaybackResumeGateForTests();
  const item = {
    id: 'movie-7',
    streamUrl: 'http://example.invalid/stable-source.mkv',
    resumePositionMs: 0,
  };
  const decision = resolveLaunchResumePosition({
    ...resumableMovie,
    contentId: item.id,
    positionMs: 150_000,
  });
  assert.equal(item.streamUrl, 'http://example.invalid/stable-source.mkv');
  resolvePlaybackResumePrompt('resume');
  const result = await decision;
  assert.equal(item.streamUrl, 'http://example.invalid/stable-source.mkv');
  assert.equal(result.action, 'launch');
  if (result.action === 'launch') {
    item.resumePositionMs = result.resumePositionMs;
  }
  assert.equal(item.resumePositionMs, 150_000);
});

test('prompt unmounts before playback proceeds', async () => {
  resetPlaybackResumeGateForTests();
  const decision = resolveLaunchResumePosition({ ...resumableMovie, contentId: 'movie-8' });
  assert.ok(getPlaybackResumePrompt());
  resolvePlaybackResumePrompt('resume');
  assert.equal(getPlaybackResumePrompt(), null);
  const result = await decision;
  assert.equal(result.action, 'launch');
});

test('no-history Play bypasses the dialog', async () => {
  resetPlaybackResumeGateForTests();
  const result = await resolveLaunchResumePosition({
    policy: 'prompt',
    contentId: 'movie-9',
    mediaType: 'movie',
    title: 'Fresh Movie',
    positionMs: 0,
    durationMs: 600_000,
  });
  assert.deepEqual(result, { action: 'launch', resumePositionMs: 0, resetProgress: false });
  assert.equal(getPlaybackResumePrompt(), null);
});

test('silent Continue Watching resume bypasses the dialog', async () => {
  resetPlaybackResumeGateForTests();
  const result = await resolveLaunchResumePosition({
    ...resumableMovie,
    policy: 'silent',
    contentId: 'movie-10',
  });
  assert.deepEqual(result, { action: 'launch', resumePositionMs: 120_000, resetProgress: false });
  assert.equal(getPlaybackResumePrompt(), null);
});

test('Resume Playback off / start policy starts at zero without a dialog', async () => {
  resetPlaybackResumeGateForTests();
  const result = await resolveLaunchResumePosition({
    ...resumableMovie,
    policy: 'start',
    contentId: 'movie-11',
  });
  assert.deepEqual(result, { action: 'launch', resumePositionMs: 0, resetProgress: true });
  assert.equal(getPlaybackResumePrompt(), null);
});
