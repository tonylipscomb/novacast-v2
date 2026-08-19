// NOVACAST_GUIDE_V2_3D_CATALOG_PRIORITY_V1
//
// XMLTV refresh is an interactive Guide dependency.
// While it is running, background Movies/Series catalog work
// yields at its existing category checkpoints.
//
// Multiple Guide reads may share the same in-flight XMLTV
// refresh, so this uses a claim counter instead of a boolean.

let activeClaims = 0;

const idleWaiters =
  new Set<() => void>();

export function beginCatalogGuidePriority() {
  activeClaims += 1;
}

export function endCatalogGuidePriority() {
  activeClaims =
    Math.max(0, activeClaims - 1);

  if (activeClaims > 0) {
    return;
  }

  for (const resolve of idleWaiters) {
    resolve();
  }

  idleWaiters.clear();
}

export function isCatalogGuidePriorityActive() {
  return activeClaims > 0;
}

export async function waitUntilCatalogGuidePriorityIdle() {
  if (!isCatalogGuidePriorityActive()) {
    return;
  }

  await new Promise<void>((resolve) => {
    idleWaiters.add(resolve);
  });
}