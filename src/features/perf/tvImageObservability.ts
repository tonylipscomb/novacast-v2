/**
 * Image pipeline observability (dev HUD only).
 * Does not store full URIs — only counts and hashed path segments.
 */

import { isTvPerfHudEnabled, tvPerfSetPendingImages } from './tvPerfStore';

type ImageObservability = {
  pending: number;
  failed: number;
  mounts: number;
  sourceChanges: number;
  duplicateHits: number;
};

const imageState: ImageObservability = {
  pending: 0,
  failed: 0,
  mounts: 0,
  sourceChanges: 0,
  duplicateHits: 0,
};

const recentUriKeys = new Map<string, number>();

function uriKey(uri: string) {
  // Drop query/auth fragments; keep a short stable fingerprint.
  try {
    const parsed = new URL(uri);
    return `${parsed.host}${parsed.pathname}`.slice(0, 120);
  } catch {
    return uri.replace(/\?.*/, '').slice(0, 120);
  }
}

export function tvImageRecordMount(uri: string) {
  if (!isTvPerfHudEnabled()) {
    return;
  }
  imageState.mounts += 1;
  const key = uriKey(uri);
  const prior = recentUriKeys.get(key) ?? 0;
  if (prior > 0) {
    imageState.duplicateHits += 1;
  }
  recentUriKeys.set(key, prior + 1);
  if (recentUriKeys.size > 200) {
    const first = recentUriKeys.keys().next().value;
    if (first) {
      recentUriKeys.delete(first);
    }
  }
}

export function tvImageRecordSourceChange() {
  if (!isTvPerfHudEnabled()) {
    return;
  }
  imageState.sourceChanges += 1;
}

export function tvImageRecordFailure() {
  if (!isTvPerfHudEnabled()) {
    return;
  }
  imageState.failed += 1;
}

export function tvImageSetPending(count: number) {
  imageState.pending = count;
  tvPerfSetPendingImages(count);
}

export function getTvImageObservability(): ImageObservability {
  if (!isTvPerfHudEnabled()) {
    return { pending: 0, failed: 0, mounts: 0, sourceChanges: 0, duplicateHits: 0 };
  }
  return { ...imageState };
}
