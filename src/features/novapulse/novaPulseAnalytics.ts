import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';

import type { NovaPulseItem } from './novaPulseTypes';

export function recordNovaPulseEvent(event: string, item?: NovaPulseItem | null) {
  if (!item) return;
  const metadata = { itemId: item.id, itemType: item.type, subtype: item.subtype ?? null };
  console.info('[NovaPulse]', event, metadata);
  recordDiagnostic({ eventType: 'live_performance', metadata: { summary: event, ...metadata } });
}
