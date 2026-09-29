type FocusAuditEvent = {
  component: string;
  action: string;
  itemId?: string | null;
  reason?: string;
  detail?: Record<string, unknown>;
};

const auditStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
const auditStartedAtTimestamp = Date.now();
let auditSequence = 0;
let auditCycle = 0;
let shellMountedAt: number | null = null;
let navbarMountedAt: number | null = null;
let preferredFocusAt: number | null = null;

function elapsedMs() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, Math.round(now - auditStartedAt));
}

export function beginFocusAuditCycle(reason: string, detail?: Record<string, unknown>) {
  auditCycle += 1;
  recordFocusAudit({ component: 'FocusAudit', action: 'cycle-start', reason, detail });
  return auditCycle;
}

export function recordFocusAudit(event: FocusAuditEvent) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info('[NovaCast Focus Audit]', {
    cycle: auditCycle,
    sequence: ++auditSequence,
    auditStartedAt: auditStartedAtTimestamp,
    timestamp: Date.now(),
    elapsedMs: Math.max(0, Math.round(now - auditStartedAt)),
    ...event,
  });
}

export function noteFocusLifecycleEvent(event: 'shell-mount' | 'navbar-mount' | 'hasTVPreferredFocus' | 'native-focus', detail?: Record<string, unknown>) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (event === 'shell-mount') {
    shellMountedAt = now;
    navbarMountedAt = null;
    preferredFocusAt = null;
  } else if (event === 'navbar-mount') {
    navbarMountedAt = now;
  } else if (event === 'hasTVPreferredFocus') {
    preferredFocusAt = now;
  }
  const shellMountToPreferredFocusMs =
    event === 'hasTVPreferredFocus' && shellMountedAt != null
      ? Math.max(0, Math.round(now - shellMountedAt))
      : undefined;
  const preferredFocusToNativeFocusMs =
    event === 'native-focus' && preferredFocusAt != null
      ? Math.max(0, Math.round(now - preferredFocusAt))
      : undefined;
  recordFocusAudit({
    component: 'FocusLifecycle',
    action: event,
    detail: {
      ...detail,
      shellMountToPreferredFocusMs,
      preferredFocusToNativeFocusMs,
    },
  });
  return { shellMountToPreferredFocusMs, preferredFocusToNativeFocusMs };
}
