/**
 * Stage 2.8 — quiet window while Movies/Series category SQLite upserts run.
 * Home accent live-category handling must not land mid-yield on the JS thread.
 */

let quietUntilMs = 0;
let quietDepth = 0;

function nowMs() {
  return Date.now();
}

export function resetCatalogWriteQuietPeriodForTests() {
  quietUntilMs = 0;
  quietDepth = 0;
}

export function beginCatalogWriteQuietPeriod(durationMs = 15_000) {
  quietDepth += 1;
  quietUntilMs = Math.max(quietUntilMs, nowMs() + durationMs);
}

export function endCatalogWriteQuietPeriod() {
  quietDepth = Math.max(0, quietDepth - 1);
  if (quietDepth === 0) {
    quietUntilMs = 0;
  }
}

export function isCatalogWriteQuietPeriodActive() {
  return quietDepth > 0 || nowMs() < quietUntilMs;
}

export async function waitOutCatalogWriteQuietPeriod(options?: {
  pollMs?: number;
  maxWaitMs?: number;
}): Promise<void> {
  const pollMs = options?.pollMs ?? 50;
  const maxWaitMs = options?.maxWaitMs ?? 20_000;
  const deadline = nowMs() + maxWaitMs;
  while (isCatalogWriteQuietPeriodActive() && nowMs() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}
