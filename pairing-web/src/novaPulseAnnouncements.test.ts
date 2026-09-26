import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementActionPath,
  announcementStatusLabel,
  deriveAnnouncementStatus,
  isoToLocalInput,
  localInputToIso,
  validateAnnouncementDraft,
  announcementKindLabel,
  validateArtworkFile,
  type AnnouncementRecord,
  emptyAnnouncementDraft,
} from './novaPulseAnnouncements.ts';
import { shouldShowGlobalAdminHeaderAction } from './adminHeaderActions.ts';
import { announcementListRequestInit, createAnnouncementRefreshGate, normalizeAnnouncementItems } from './adminAnnouncementRefresh.ts';

test('uses the B4.1 action contract', () => {
  assert.equal(announcementActionPath('list'), 'admin-novapulse-announcements?action=list');
  assert.equal(announcementActionPath('upload_artwork'), 'admin-novapulse-announcements?action=upload_artwork');
  assert.equal(announcementActionPath('revision conflict'), 'admin-novapulse-announcements?action=revision%20conflict');
});

const base: AnnouncementRecord = {
  id: 'a', title: 'Notice', description: 'Details', secondaryText: null, badge: null, kind: 'general', importance: 'normal', status: 'published', priority: 0,
  startsAt: null, endsAt: null, publishedAt: null, disabledAt: null, deletedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1, artworkUrl: null,
};

test('datetime-local values convert to UTC and round-trip in local time', () => {
  const value = '2026-01-15T13:45';
  const iso = localInputToIso(value);
  assert.equal(isoToLocalInput(iso), value);
});

test('schedule validation preserves open values and rejects reversed or equal times', () => {
  assert.equal(validateAnnouncementDraft({ ...emptyAnnouncementDraft, title: 'x', description: 'y', startsAt: '', endsAt: '' }, false), null);
  assert.match(validateAnnouncementDraft({ ...emptyAnnouncementDraft, title: 'x', description: 'y', startsAt: '2026-01-02T10:00', endsAt: '2026-01-02T09:00' }, false) ?? '', /later/);
  assert.match(validateAnnouncementDraft({ ...emptyAnnouncementDraft, title: 'x', description: 'y', startsAt: '2026-01-02T10:00', endsAt: '2026-01-02T10:00' }, false) ?? '', /later/);
  assert.match(validateAnnouncementDraft({ ...emptyAnnouncementDraft, title: 'x', description: 'y', kind: 'provider_alert' }, false) ?? '', /not available/);
  assert.match(validateAnnouncementDraft({ ...emptyAnnouncementDraft, title: 'x', description: 'y', importance: 'critical', endsAt: '' }, true) ?? '', /future end/);
  assert.equal(announcementKindLabel('service_alert'), 'Service Alert');
});

test('status derivation distinguishes draft, scheduled, live, expired, disabled, and archived', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  assert.equal(deriveAnnouncementStatus({ ...base, status: 'draft' }, now), 'draft');
  assert.equal(deriveAnnouncementStatus({ ...base, startsAt: '2026-01-10T13:00:00Z' }, now), 'scheduled');
  assert.equal(deriveAnnouncementStatus(base, now), 'live');
  assert.equal(deriveAnnouncementStatus({ ...base, endsAt: '2026-01-10T12:00:00Z' }, now), 'expired');
  assert.equal(deriveAnnouncementStatus({ ...base, status: 'disabled', disabledAt: '2026-01-10T11:00:00Z' }, now), 'disabled');
  assert.equal(deriveAnnouncementStatus({ ...base, status: 'archived', deletedAt: '2026-01-10T11:00:00Z' }, now), 'archived');
  assert.equal(announcementStatusLabel('scheduled'), 'Scheduled');
});

test('schedule boundaries are deterministic at exact start and end instants', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  assert.equal(deriveAnnouncementStatus({ ...base, startsAt: '2026-01-10T12:00:00Z' }, now), 'live');
  assert.equal(deriveAnnouncementStatus({ ...base, endsAt: '2026-01-10T12:00:00Z' }, now), 'expired');
});

test('client artwork convenience validation accepts supported images and rejects SVG/oversize', () => {
  assert.equal(validateArtworkFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' })), null);
  assert.equal(validateArtworkFile(new File(['x'], 'a.webp', { type: 'image/webp' })), null);
  assert.match(validateArtworkFile(new File(['x'], 'a.svg', { type: 'image/svg+xml' })) ?? '', /JPEG/);
  assert.match(validateArtworkFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' })) ?? '', /5 MB/);
});

test('NovaPulse contextual header keeps only its local actions', () => {
  assert.equal(shouldShowGlobalAdminHeaderAction('announcements', 'refresh'), false);
  assert.equal(shouldShowGlobalAdminHeaderAction('announcements', 'new_invitation'), false);
  assert.equal(shouldShowGlobalAdminHeaderAction('invitations', 'refresh'), true);
  assert.equal(shouldShowGlobalAdminHeaderAction('invitations', 'new_invitation'), true);
  assert.equal(shouldShowGlobalAdminHeaderAction('dashboard', 'refresh'), true);
});

test('direct announcements route and local refresh contract remain valid', () => {
  assert.equal(announcementActionPath('list'), 'admin-novapulse-announcements?action=list');
  assert.equal(announcementListRequestInit().cache, 'no-store');
  assert.equal(normalizeAnnouncementItems<{ id: string }>({ items: [{ id: 'fresh' }] })[0]?.id, 'fresh');
  assert.deepEqual(normalizeAnnouncementItems({ items: [] }), []);
});

test('refresh gate allows one request, replaces stale data, and accepts empty success', async () => {
  const gate = createAnnouncementRefreshGate();
  let requests = 0;
  let items = [{ id: 'stale' }];
  const refresh = async (next: typeof items) => {
    if (!gate.tryStart()) return;
    requests += 1;
    await Promise.resolve();
    items = next;
    gate.finish();
  };
  const first = refresh([{ id: 'fresh' }]);
  const second = refresh([]);
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.deepEqual(items, [{ id: 'fresh' }]);
  await refresh([]);
  assert.deepEqual(items, []);
});

test('failed refresh retains the visible list while the gate recovers', () => {
  const gate = createAnnouncementRefreshGate();
  const previous = [{ id: 'visible' }];
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.deepEqual(previous, [{ id: 'visible' }]);
  assert.equal(gate.tryStart(), true);
  gate.finish();
});
