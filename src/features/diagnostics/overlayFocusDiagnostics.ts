type OverlayFocusAction = 'preferred-focus' | 'focus-received' | 'focus-lost' | 'press';

const SAFE_CONTROL_ID = /^[a-z0-9_-]{1,64}$/i;

export function logOverlayFocus(
  screen: string,
  controlId: string,
  action: OverlayFocusAction,
) {
  const safeScreen = SAFE_CONTROL_ID.test(screen) ? screen : 'unknown';
  const safeControlId = SAFE_CONTROL_ID.test(controlId) ? controlId : 'unknown';
  console.info('[NovaCast Overlay Focus]', JSON.stringify({ screen: safeScreen, controlId: safeControlId, action }));
}
