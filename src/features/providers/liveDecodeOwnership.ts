export const LIVE_DECODE_OWNERSHIP = '[NovaCast Live Decode Ownership]';

export type LiveDecodeCaller = 'live-worker' | 'completeness-audit';

export type LiveDecodeOwnershipSnapshot = {
  providerId: string;
  runId: string | null;
  caller: LiveDecodeCaller;
  requestId: string;
};

const activeByProvider = new Map<string, LiveDecodeOwnershipSnapshot>();
let ownershipSequence = 0;

export function resetLiveDecodeOwnershipForTests() {
  activeByProvider.clear();
  ownershipSequence = 0;
}

export function getActiveLiveDecodeRequest(providerId: string): LiveDecodeOwnershipSnapshot | null {
  return activeByProvider.get(providerId) ?? null;
}

export function logLiveDecodeOwnership(fields: Record<string, unknown>) {
  console.info(
    LIVE_DECODE_OWNERSHIP,
    JSON.stringify({
      providerId: fields.providerId ?? null,
      runId: fields.runId ?? null,
      caller: fields.caller ?? null,
      requestId: fields.requestId ?? null,
      activeRequestBefore: fields.activeRequestBefore ?? null,
      activeRequestAfter: fields.activeRequestAfter ?? null,
      cancelReason: fields.cancelReason ?? null,
      replacedByCaller: fields.replacedByCaller ?? null,
      ...fields,
    }),
  );
}

export function claimLiveUnfilteredDump(input: {
  providerId: string;
  caller: LiveDecodeCaller;
  runId?: string | null;
}): { requestId: string; release: () => void } {
  const requestId = `live-dump-${++ownershipSequence}`;
  const activeRequestBefore = activeByProvider.get(input.providerId) ?? null;
  const activeRequestAfter: LiveDecodeOwnershipSnapshot = {
    providerId: input.providerId,
    runId: input.runId ?? null,
    caller: input.caller,
    requestId,
  };
  logLiveDecodeOwnership({
    providerId: input.providerId,
    runId: input.runId ?? null,
    caller: input.caller,
    requestId,
    activeRequestBefore,
    activeRequestAfter,
    cancelReason: activeRequestBefore ? 'replaced-active-unfiltered-live-dump' : null,
    replacedByCaller: activeRequestBefore ? input.caller : null,
  });
  activeByProvider.set(input.providerId, activeRequestAfter);
  return {
    requestId,
    release: () => {
      const current = activeByProvider.get(input.providerId);
      if (current?.requestId === requestId) {
        activeByProvider.delete(input.providerId);
      }
    },
  };
}
