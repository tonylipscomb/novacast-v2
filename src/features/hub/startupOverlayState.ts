let startupOverlayShown = false;

export function shouldShowStartupOverlay() {
  return !startupOverlayShown;
}

export function markStartupOverlayShown() {
  startupOverlayShown = true;
}

export function resetStartupOverlayState() {
  startupOverlayShown = false;
}
