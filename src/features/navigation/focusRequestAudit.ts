type FocusAuditEvent = {
  component: string;
  action: string;
  itemId?: string | null;
  reason?: string;
  detail?: Record<string, unknown>;
};

const auditStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
let auditSequence = 0;
let auditCycle = 0;

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
  console.info('[NovaCast Focus Audit]', {
    cycle: auditCycle,
    sequence: ++auditSequence,
    elapsedMs: elapsedMs(),
    ...event,
  });
}
