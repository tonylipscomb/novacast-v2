export const SERIES_CANCELLATION_AUDIT = '[NovaCast Series Cancellation Audit]';

export type SeriesCancellationAuditEvent =
  | 'dump-created'
  | 'signal-attached'
  | 'native-job-started'
  | 'cancel-requested'
  | 'signal-aborted'
  | 'native-job-cancel-called'
  | 'native-job-returned'
  | 'worker-cancelled'
  | 'worker-completed';

export type SeriesCancelSource =
  | 'coordinator-replacement'
  | 'provider-bundle-generation-change'
  | 'heartbeat-refresh-replacement'
  | 'screen-navigation-cleanup'
  | 'component-unmount'
  | 'stale-catalog-request'
  | 'app-background'
  | 'sync-lifecycle-cleanup'
  | 'native-decoder-cleanup'
  | 'network-gate-cancellation'
  | 'provider-switch'
  | 'provider-replaced'
  | 'bundle-invalidated'
  | 'sync-generation-changed'
  | 'js-isCancelled'
  | 'native-job-missing'
  | 'native-batch-cancelled'
  | 'native-module-ondestroy'
  | 'unknown';

export type SeriesCancellationAuditFields = {
  event: SeriesCancellationAuditEvent;
  providerId?: string | null;
  runId?: string | null;
  generation?: number | null;
  requestId?: string | null;
  nativeJobId?: string | null;
  signalAborted?: boolean | null;
  abortReason?: string | null;
  cancelSource?: string | null;
  cancelCaller?: string | null;
  catalogRequestSource?: string | null;
  workerEpoch?: number | null;
  coordinatorEpoch?: number | null;
  bundleGeneration?: number | null;
  screen?: string | null;
  appState?: string | null;
  timestamp?: number;
  elapsedMs?: number | null;
  cancelStack?: string | null;
  firstCancel?: boolean;
  ignored?: boolean;
  [key: string]: unknown;
};

export type SeriesDumpAuditSession = {
  providerId: string;
  runId: string | null;
  generation: number | null;
  requestId: string | null;
  nativeJobId: string | null;
  catalogRequestSource: string | null;
  workerEpoch: number | null;
  bundleGeneration: number | null;
  screen: string;
  startedAt: number;
  signalAborted: boolean;
  abortReason: string | null;
  firstCancel: {
    source: string;
    caller: string;
    reason: string | null;
    stack: string;
    at: number;
  } | null;
};

const UI_LIFECYCLE_CANCEL_SOURCES = new Set<string>([
  'screen-navigation-cleanup',
  'component-unmount',
  'stale-catalog-request',
  'app-background',
  'heartbeat-refresh-replacement',
]);

let session: SeriesDumpAuditSession | null = null;

function nowMs(): number {
  return Date.now();
}

function readAppState(): string {
  try {
    // Lazy require so Node catalog tests do not load react-native.
    const reactNative = require('react-native') as { AppState?: { currentState?: string } };
    return reactNative.AppState?.currentState ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function captureSeriesCancelStack(): string {
  const stack = new Error('series-cancel-requested').stack ?? '';
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 14)
    .join(' | ');
}

export function isUiLifecycleCancelSource(source: string | null | undefined): boolean {
  return Boolean(source && UI_LIFECYCLE_CANCEL_SOURCES.has(source));
}

export function getSeriesDumpAuditSession(): SeriesDumpAuditSession | null {
  return session;
}

export function beginSeriesDumpCancellationAudit(input: {
  providerId: string;
  runId?: string | null;
  generation?: number | null;
  requestId?: string | null;
  catalogRequestSource?: string | null;
  workerEpoch?: number | null;
  bundleGeneration?: number | null;
  screen?: string | null;
}): SeriesDumpAuditSession {
  session = {
    providerId: input.providerId,
    runId: input.runId ?? null,
    generation: input.generation ?? null,
    requestId: input.requestId ?? null,
    nativeJobId: null,
    catalogRequestSource: input.catalogRequestSource ?? null,
    workerEpoch: input.workerEpoch ?? null,
    bundleGeneration: input.bundleGeneration ?? null,
    screen: input.screen ?? 'background-catalog-sync',
    startedAt: nowMs(),
    signalAborted: false,
    abortReason: null,
    firstCancel: null,
  };
  logSeriesCancellationAudit('dump-created', {
    catalogRequestSource: session.catalogRequestSource,
    workerEpoch: session.workerEpoch,
  });
  return session;
}

export function attachSeriesDumpCancelSignal(input: {
  abortReason?: string | null;
  signalAborted?: boolean;
  cancelSource?: string | null;
  cancelCaller?: string | null;
}): void {
  if (!session) {
    return;
  }
  if (typeof input.signalAborted === 'boolean') {
    session.signalAborted = input.signalAborted;
  }
  if (input.abortReason) {
    session.abortReason = input.abortReason;
  }
  logSeriesCancellationAudit('signal-attached', {
    signalAborted: session.signalAborted,
    abortReason: session.abortReason ?? input.abortReason ?? null,
    cancelSource: input.cancelSource ?? null,
    cancelCaller: input.cancelCaller ?? 'runSeriesCatalogSync.captured-cancel-token',
  });
}

export function noteSeriesNativeJobStarted(nativeJobId: string): void {
  if (session) {
    session.nativeJobId = nativeJobId;
  }
  logSeriesCancellationAudit('native-job-started', { nativeJobId });
}

export function noteSeriesNativeJobReturned(input: {
  cancelled?: boolean;
  nativeJobId?: string | null;
  abortReason?: string | null;
}): void {
  logSeriesCancellationAudit('native-job-returned', {
    nativeJobId: input.nativeJobId ?? session?.nativeJobId ?? null,
    signalAborted: Boolean(input.cancelled || session?.signalAborted),
    abortReason: input.abortReason ?? session?.abortReason ?? null,
  });
}

export function noteSeriesCancelRequested(input: {
  cancelSource: string;
  cancelCaller: string;
  abortReason?: string | null;
  nativeJobId?: string | null;
  providerId?: string | null;
  runId?: string | null;
  generation?: number | null;
  requestId?: string | null;
  catalogRequestSource?: string | null;
  workerEpoch?: number | null;
  coordinatorEpoch?: number | null;
  bundleGeneration?: number | null;
  screen?: string | null;
  ignored?: boolean;
}): { firstCancel: boolean; ignored: boolean } {
  const ignored = Boolean(input.ignored || isUiLifecycleCancelSource(input.cancelSource));
  const firstCancel = !session?.firstCancel;
  if (session && firstCancel) {
    session.signalAborted = true;
    session.abortReason = input.abortReason ?? input.cancelSource;
    session.firstCancel = {
      source: input.cancelSource,
      caller: input.cancelCaller,
      reason: input.abortReason ?? null,
      stack: captureSeriesCancelStack(),
      at: nowMs(),
    };
  }
  logSeriesCancellationAudit('cancel-requested', {
    ...input,
    signalAborted: true,
    firstCancel,
    ignored,
    cancelStack: firstCancel ? session?.firstCancel?.stack ?? captureSeriesCancelStack() : null,
  });
  if (firstCancel) {
    logSeriesCancellationAudit('signal-aborted', {
      ...input,
      signalAborted: true,
      firstCancel: true,
      ignored,
      cancelStack: session?.firstCancel?.stack ?? null,
    });
  }
  return { firstCancel, ignored };
}

export function noteSeriesNativeJobCancelCalled(input: {
  nativeJobId?: string | null;
  cancelSource?: string | null;
  cancelCaller?: string | null;
  abortReason?: string | null;
}): void {
  logSeriesCancellationAudit('native-job-cancel-called', {
    nativeJobId: input.nativeJobId ?? session?.nativeJobId ?? null,
    cancelSource: input.cancelSource ?? session?.firstCancel?.source ?? 'unknown',
    cancelCaller: input.cancelCaller ?? 'nativeCatalogDecode.cancelDecodeJob',
    abortReason: input.abortReason ?? session?.abortReason ?? null,
    signalAborted: true,
    firstCancel: false,
  });
}

export function endSeriesDumpCancellationAudit(
  event: 'worker-cancelled' | 'worker-completed',
  extra: Record<string, unknown> = {},
): void {
  if (!session) {
    return;
  }
  logSeriesCancellationAudit(event, extra);
  session = null;
}

export function resetSeriesCancellationAuditForTests(): void {
  session = null;
}

export function logSeriesCancellationAudit(
  event: SeriesCancellationAuditEvent,
  fields: Omit<SeriesCancellationAuditFields, 'event'> = {},
): void {
  const timestamp = typeof fields.timestamp === 'number' ? fields.timestamp : nowMs();
  const elapsedMs =
    typeof fields.elapsedMs === 'number'
      ? fields.elapsedMs
      : session
        ? timestamp - session.startedAt
        : null;
  console.info(
    SERIES_CANCELLATION_AUDIT,
    JSON.stringify({
      event,
      providerId: fields.providerId ?? session?.providerId ?? null,
      runId: fields.runId ?? session?.runId ?? null,
      generation: fields.generation ?? session?.generation ?? null,
      requestId: fields.requestId ?? session?.requestId ?? null,
      nativeJobId: fields.nativeJobId ?? session?.nativeJobId ?? null,
      signalAborted: fields.signalAborted ?? session?.signalAborted ?? false,
      abortReason: fields.abortReason ?? session?.abortReason ?? null,
      cancelSource: fields.cancelSource ?? session?.firstCancel?.source ?? null,
      cancelCaller: fields.cancelCaller ?? session?.firstCancel?.caller ?? null,
      catalogRequestSource: fields.catalogRequestSource ?? session?.catalogRequestSource ?? null,
      workerEpoch: fields.workerEpoch ?? session?.workerEpoch ?? null,
      coordinatorEpoch: fields.coordinatorEpoch ?? null,
      bundleGeneration: fields.bundleGeneration ?? session?.bundleGeneration ?? null,
      screen: fields.screen ?? session?.screen ?? 'background-catalog-sync',
      appState: fields.appState ?? readAppState(),
      timestamp,
      elapsedMs,
      firstCancel: fields.firstCancel ?? false,
      ignored: fields.ignored ?? false,
      cancelStack: fields.cancelStack ?? null,
    }),
  );
}
