import {
  announcementIsEligible,
  compareAnnouncements,
  toTvAnnouncement,
  validateAnnouncementInput,
  validateArtworkBytes,
  AnnouncementValidationError,
  NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS,
} from './novapulseAnnouncements.ts';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const equal = (actual: unknown, expected: unknown, message: string) => { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); };
const now = new Date('2026-09-23T18:00:00.000Z');

function pngFixture(width = 1280, height = 720) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  return bytes;
}

function jpegFixture(width = 1280, height = 720, progressive = false) {
  return new Uint8Array([0xff, 0xd8, 0xff, progressive ? 0xc2 : 0xc0, 0, 8, 8, (height >>> 8) & 255, height & 255, (width >>> 8) & 255, width & 255, 0]);
}

function webpFixture(kind: 'VP8 ' | 'VP8L' | 'VP8X', width = 1280, height = 720) {
  const bytes = new Uint8Array(40);
  bytes.set([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP'), ...new TextEncoder().encode(kind)], 0);
  if (kind === 'VP8X') {
    const w = width - 1; const h = height - 1;
    bytes[24] = w & 255; bytes[25] = (w >>> 8) & 255; bytes[26] = (w >>> 16) & 255;
    bytes[27] = h & 255; bytes[28] = (h >>> 8) & 255; bytes[29] = (h >>> 16) & 255;
  } else if (kind === 'VP8L') {
    const bits = ((height - 1) << 14) | (width - 1);
    bytes[20] = 0x2f; bytes[21] = bits & 255; bytes[22] = (bits >>> 8) & 255; bytes[23] = (bits >>> 16) & 255; bytes[24] = (bits >>> 24) & 255;
  } else {
    bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
    bytes[26] = (width >>> 8) & 255; bytes[27] = width & 255; bytes[28] = (height >>> 8) & 255; bytes[29] = height & 255;
  }
  return bytes;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001', title: 'Notice', description: 'Details', secondary_text: null, badge: null,
    kind: 'general', importance: 'normal', artwork_path: null, status: 'published', priority: 0, starts_at: null,
    ends_at: null, published_at: '2026-09-23T17:00:00.000Z', disabled_at: null, deleted_at: null,
    created_at: '2026-09-23T16:00:00.000Z', updated_at: '2026-09-23T17:00:00.000Z', revision: 1, ...overrides,
  } as any;
}

Deno.test('announcement input enforces bounded fields, kinds, priority, and schedule order', () => {
  const valid = validateAnnouncementInput({ title: 'Draft', description: 'Body', startsAt: '2026-10-01T00:00:00Z' }, { published: false });
  equal(valid.title, 'Draft', 'title normalized');
  try { validateAnnouncementInput({ title: 'x'.repeat(121), description: 'Body' }, { published: false }); throw new Error('expected title rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'title_too_long', 'title limit'); }
  try { validateAnnouncementInput({ title: 'x', description: 'y', priority: 101 }, { published: false }); throw new Error('expected priority rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'invalid_priority', 'priority limit'); }
  try { validateAnnouncementInput({ title: 'x', description: 'y', startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }, { published: false }); throw new Error('expected schedule rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'ends_at_must_follow_starts_at', 'schedule order'); }
  try { validateAnnouncementInput({ title: 'x', description: '' }, { published: true }); throw new Error('expected content rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'invalid_description', 'published content'); }
});

Deno.test('future, active, expired, disabled, archived, deleted, and draft rows are filtered safely', () => {
  assert(!announcementIsEligible(row({ starts_at: '2026-09-23T19:00:00.000Z' }), now), 'future excluded');
  assert(announcementIsEligible(row(), now), 'active included');
  assert(!announcementIsEligible(row({ ends_at: '2026-09-23T17:59:59.000Z' }), now), 'expired excluded');
  for (const status of ['disabled', 'archived', 'draft']) assert(!announcementIsEligible(row({ status }), now), `${status} excluded`);
  assert(!announcementIsEligible(row({ deleted_at: '2026-09-23T17:00:00.000Z' }), now), 'deleted excluded');
});

Deno.test('importance, priority, schedule, and id ordering is deterministic and feed is capped at two', () => {
  const rows = [
    row({ id: '00000000-0000-4000-8000-000000000003', importance: 'normal', priority: 100 }),
    row({ id: '00000000-0000-4000-8000-000000000002', importance: 'important', priority: 0 }),
    row({ id: '00000000-0000-4000-8000-000000000001', importance: 'critical', priority: 0 }),
  ];
  const ordered = rows.sort(compareAnnouncements);
  equal(ordered[0].importance, 'critical', 'critical first');
  equal(ordered[1].importance, 'important', 'important second');
  equal(ordered.slice(0, NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS).length, 2, 'two item cap');
});

Deno.test('TV response contains only public announcement fields and supports artwork fallback', () => {
  const item = toTvAnnouncement(row({ artwork_path: 'announcements/id/2.webp' }), 'https://example.supabase.co');
  equal(item.artworkUrl, 'https://example.supabase.co/storage/v1/object/public/novapulse-announcement-artwork/announcements/id/2.webp', 'public artwork URL');
  assert(!('artwork_path' in item) && !('created_by' in item) && !('deleted_at' in item), 'internal fields omitted');
  equal(toTvAnnouncement(row(), 'https://example.supabase.co').artworkUrl, null, 'branded fallback');
});

Deno.test('artwork validation uses magic bytes, rejects SVG/oversize, and enforces TV dimensions', () => {
  const png = pngFixture();
  equal(validateArtworkBytes(png, 'image/png').mimeType, 'image/png', 'PNG magic');
  equal(validateArtworkBytes(jpegFixture()).mimeType, 'image/jpeg', 'baseline JPEG');
  equal(validateArtworkBytes(jpegFixture(1280, 720, true)).mimeType, 'image/jpeg', 'progressive JPEG');
  equal(validateArtworkBytes(webpFixture('VP8 ')).mimeType, 'image/webp', 'WebP VP8');
  equal(validateArtworkBytes(webpFixture('VP8L')).mimeType, 'image/webp', 'WebP VP8L');
  equal(validateArtworkBytes(webpFixture('VP8X')).mimeType, 'image/webp', 'WebP VP8X');
  for (const bytes of [new TextEncoder().encode('<svg></svg>'), new TextEncoder().encode('<?xml version="1.0"?><svg/>'), new Uint8Array(5 * 1024 * 1024 + 1), png.slice(0, 12), jpegFixture().slice(0, 8), webpFixture('VP8X').slice(0, 20)]) {
    try { validateArtworkBytes(bytes); throw new Error('expected artwork rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError, 'artwork rejection'); }
  }
  try { validateArtworkBytes(png, 'image/jpeg'); throw new Error('expected MIME rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'artwork_mime_mismatch', 'MIME mismatch'); }
  for (const bytes of [pngFixture(1279, 720), pngFixture(1280, 719), pngFixture(3841, 720), pngFixture(1280, 2161), pngFixture(0, 0)]) {
    try { validateArtworkBytes(bytes); throw new Error('expected dimension rejection'); } catch (error) { assert(error instanceof AnnouncementValidationError && error.code === 'invalid_artwork_dimensions', 'dimension rejection'); }
  }
  equal(validateArtworkBytes(pngFixture(3840, 2160)).width, 3840, 'maximum dimensions');
});

Deno.test('migration and handlers keep direct access closed and use explicit authentication', async () => {
  const migration = await Deno.readTextFile(new URL('../../migrations/20260923183202_novapulse_announcements.sql', import.meta.url));
  const admin = await Deno.readTextFile(new URL('../admin-novapulse-announcements/index.ts', import.meta.url));
  const feed = await Deno.readTextFile(new URL('../novapulse-announcements-feed/index.ts', import.meta.url));
  assert(migration.includes('enable row level security') && migration.includes('revoke all on table public.novapulse_announcements from anon, authenticated'), 'table access closed');
  assert(migration.includes("'novapulse-announcement-artwork'") && migration.includes('5242880') && migration.includes("array['image/jpeg', 'image/png', 'image/webp']"), 'bucket limits');
  assert(admin.includes('requireAdmin(request, { distinguishForbidden: true })'), 'admin auth');
  assert(feed.includes('authenticateDevice(request, client)') && feed.includes('device_not_authorized'), 'device auth');
  assert(admin.includes('declared <= 0 || declared > MAX_MULTIPART_BYTES'), 'bounded multipart upload');
  assert(!migration.includes('SECURITY DEFINER'), 'no security definer');
});

Deno.test('mutations use optimistic revision predicates and server-owned audit fields', async () => {
  const admin = await Deno.readTextFile(new URL('../admin-novapulse-announcements/index.ts', import.meta.url));
  assert(admin.includes(".eq('id', id).eq('revision', revision)"), 'revision predicate');
  assert(admin.includes('announcement_revision_conflict'), 'revision conflict');
  assert(admin.includes('updated_by: userId'), 'server actor');
  assert(!admin.includes('revision: body.revision'), 'caller cannot set revision');
  assert(!admin.includes('created_by: body.created_by'), 'caller cannot set created_by');
  assert(!admin.includes('published_at: body.published_at'), 'caller cannot set published_at');
});
