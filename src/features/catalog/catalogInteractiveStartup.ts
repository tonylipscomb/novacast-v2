let startupProtectionActive = false;
let interactiveUiReady = false;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

function ensureReadyPromise() {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }
  return readyPromise;
}

export function enableCatalogInteractiveStartupProtection() {
  startupProtectionActive = true;
  interactiveUiReady = false;
  readyPromise = null;
  resolveReady = null;
  console.info('[NovaCast Catalog Startup]', JSON.stringify({
    event: 'startup-protection-enabled',
    timestamp: Date.now(),
  }));
}

export function markCatalogInteractiveUiReady() {
  if (!startupProtectionActive || interactiveUiReady) {
    return;
  }
  interactiveUiReady = true;
  resolveReady?.();
  resolveReady = null;
  console.info('[NovaCast Catalog Startup]', JSON.stringify({
    event: 'interactive-ui-ready',
    timestamp: Date.now(),
  }));
}

export async function waitForCatalogInteractiveUiReady() {
  if (!startupProtectionActive || interactiveUiReady) {
    return;
  }
  await ensureReadyPromise();
}

export function resetCatalogInteractiveStartupForTests() {
  startupProtectionActive = false;
  interactiveUiReady = false;
  readyPromise = null;
  resolveReady = null;
}
