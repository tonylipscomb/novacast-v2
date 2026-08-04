/**
 * ONN Movies / TV Back diagnostics — audit-only.
 * Enabled only when EXPO_PUBLIC_NOVACAST_MOVIES_TRACE=1.
 * When disabled, public APIs are nearly zero-cost no-ops.
 *
 * Do not log credentials, URLs, tokens, or personal data.
 */

export type OnnMoviesTraceTag =
  | 'Movies'
  | 'Catalog'
  | 'Render'
  | 'Back'
  | 'Focus'
  | 'Scroll'
  | 'Overlay';

export type OnnMoviesTraceScenario =
  | 'detail-back'
  | 'detail-x'
  | 'playback-back'
  | 'search-back'
  | 'category-navigation'
  | 'section-return'
  | 'refresh-during-detail'
  | 'repair-with-healthy-snapshot'
  | 'manual';

type TraceEvent = {
  traceId: string;
  sequence: number;
  elapsedMs: number;
  tag: OnnMoviesTraceTag;
  event: string;
  payload: Record<string, unknown>;
};

const LOG_PREFIX = '[NovaCast ONN Trace]';
const SENSITIVE_KEY =
  /(password|passwd|secret|credential|authorization|cookie|url|uri|hostname|host|baseUrl|player_api|username|user|pass|accessToken|refreshToken|authToken|apiToken)/i;
/** Audit restore/focus tokens are safe identifiers, not credentials. */
const AUDIT_TOKEN_KEY = /^(token|restorationToken|instanceToken|backPressId|traceId)$/i;

let enabledCache: boolean | null = null;

export function isOnnMoviesTraceEnabled(): boolean {
  if (enabledCache != null) {
    return enabledCache;
  }
  enabledCache =
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE === '1';
  return enabledCache;
}

/** Test-only override. */
export function setOnnMoviesTraceEnabledForTests(value: boolean | null) {
  enabledCache = value;
}

let activeTraceId: string | null = null;
let activeScenario: OnnMoviesTraceScenario | null = null;
let startedAt = 0;
let sequence = 0;
let eventCount = 0;

const MAX_EVENTS_PER_TRACE = 800;
const MAX_PAYLOAD_STRING = 240;
const MAX_PAYLOAD_KEYS = 48;

const renderCounts = new Map<string, number>();
const lastScrollTraceAt = new Map<string, number>();
const SCROLL_THROTTLE_MS = 120;

let currentBackPressId: string | null = null;
let backPressSeq = 0;
let backPressClearScheduled = false;

let gridInstanceSeq = 0;
let activeGridInstanceId: string | null = null;
let gridMounted = false;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatTraceId(scenario: string, at = new Date()): string {
  const stamp = `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `onn-${stamp}-${scenario}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Strip / redact sensitive keys and bound payload size. */
export function sanitizeOnnMoviesTracePayload(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!input) {
    return {};
  }
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(input)) {
    if (keys >= MAX_PAYLOAD_KEYS) {
      out._truncatedKeys = true;
      break;
    }
    if (SENSITIVE_KEY.test(key) && !AUDIT_TOKEN_KEY.test(key)) {
      out[key] = '[redacted]';
      keys += 1;
      continue;
    }
    out[key] = sanitizeValue(value, 0);
    keys += 1;
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || value.includes('player_api.php')) {
      return '[redacted-url]';
    }
    return value.length > MAX_PAYLOAD_STRING
      ? `${value.slice(0, MAX_PAYLOAD_STRING)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 12).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= 2) {
      return '[object]';
    }
    return sanitizeOnnMoviesTracePayload(value);
  }
  return String(value);
}

function emit(tag: OnnMoviesTraceTag, event: string, payload: Record<string, unknown>) {
  if (!isOnnMoviesTraceEnabled() || !activeTraceId) {
    return;
  }
  if (eventCount >= MAX_EVENTS_PER_TRACE) {
    if (eventCount === MAX_EVENTS_PER_TRACE) {
      eventCount += 1;
      console.info(
        LOG_PREFIX +
          ' ' +
          JSON.stringify({
            traceId: activeTraceId,
            sequence: sequence + 1,
            elapsedMs: Date.now() - startedAt,
            tag: 'Movies',
            event: 'trace_event_cap_reached',
            payload: { maxEvents: MAX_EVENTS_PER_TRACE },
          }),
      );
    }
    return;
  }

  sequence += 1;
  eventCount += 1;
  const row: TraceEvent = {
    traceId: activeTraceId,
    sequence,
    elapsedMs: Date.now() - startedAt,
    tag,
    event,
    payload: sanitizeOnnMoviesTracePayload(payload),
  };
  console.info(LOG_PREFIX + ' ' + JSON.stringify(row));
}

export function beginOnnMoviesTrace(scenario: OnnMoviesTraceScenario = 'manual'): string | null {
  if (!isOnnMoviesTraceEnabled()) {
    return null;
  }
  if (activeTraceId) {
    endOnnMoviesTrace('superseded');
  }
  activeScenario = scenario;
  activeTraceId = formatTraceId(scenario);
  startedAt = Date.now();
  sequence = 0;
  eventCount = 0;
  renderCounts.clear();
  lastScrollTraceAt.clear();
  emit('Movies', 'trace_begin', { scenario, traceId: activeTraceId });
  return activeTraceId;
}

export function getActiveOnnMoviesTraceId(): string | null {
  return activeTraceId;
}

export function endOnnMoviesTrace(result: string = 'complete'): void {
  if (!isOnnMoviesTraceEnabled() || !activeTraceId) {
    activeTraceId = null;
    activeScenario = null;
    return;
  }
  emit('Movies', 'trace_end', {
    result,
    scenario: activeScenario,
    eventCount,
    gridMounted,
    activeGridInstanceId,
  });
  activeTraceId = null;
  activeScenario = null;
}

export function traceOnnMoviesEvent(
  tag: OnnMoviesTraceTag,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  if (!isOnnMoviesTraceEnabled()) {
    return;
  }
  if (!activeTraceId) {
    // Auto-start a manual trace so opportunistic events during an ONN session are captured.
    beginOnnMoviesTrace('manual');
  }
  emit(tag, event, payload);
}

export function captureOnnMoviesScreenState(payload: Record<string, unknown>): void {
  traceOnnMoviesEvent('Movies', 'screen_state', payload);
}

export function nextOnnMoviesGridInstanceId(): string {
  gridInstanceSeq += 1;
  return `grid-${gridInstanceSeq}`;
}

export function setOnnMoviesGridMounted(mounted: boolean, instanceId: string | null): void {
  gridMounted = mounted;
  activeGridInstanceId = mounted ? instanceId : activeGridInstanceId;
}

export function isOnnMoviesGridMounted(): boolean {
  return gridMounted;
}

export function getOnnMoviesGridInstanceId(): string | null {
  return activeGridInstanceId;
}

export function traceOnnMoviesCategoriesCleared(
  callSite: string,
  payload: Record<string, unknown> = {},
): void {
  traceOnnMoviesEvent('Catalog', 'categories_cleared', {
    callSite,
    reason: callSite,
    gridMounted,
    gridInstanceId: activeGridInstanceId,
    ...payload,
  });
}

export function traceOnnMoviesScrollCommand(payload: {
  requestedOffset: number;
  currentOffset: number;
  animated: boolean;
  reason:
    | 'initial-detail-restore'
    | 'corrective-native-focus-drift'
    | 'user-navigation'
    | 'pagination'
    | 'category-change'
    | 'other';
  restorationToken?: string | null;
  restoreAttempt?: number | null;
  detailPhase?: string | null;
  categoryId?: string | null;
}): void {
  const delta = payload.requestedOffset - payload.currentOffset;
  traceOnnMoviesEvent('Scroll', 'scroll_command', {
    ...payload,
    delta,
    method: 'scrollToOffset',
    gridInstanceId: activeGridInstanceId,
  });
}

export function traceOnnMoviesScrollSample(
  key: string,
  payload: Record<string, unknown>,
  force = false,
): void {
  if (!isOnnMoviesTraceEnabled() || !activeTraceId) {
    return;
  }
  const now = Date.now();
  const last = lastScrollTraceAt.get(key) ?? 0;
  if (!force && now - last < SCROLL_THROTTLE_MS) {
    return;
  }
  lastScrollTraceAt.set(key, now);
  traceOnnMoviesEvent('Scroll', 'scroll_sample', { key, ...payload });
}

export function noteOnnMoviesRender(component: string): void {
  if (!isOnnMoviesTraceEnabled() || !activeTraceId) {
    return;
  }
  const next = (renderCounts.get(component) ?? 0) + 1;
  renderCounts.set(component, next);
  if (next === 1 || next === 5 || next === 10 || next === 25 || next % 50 === 0) {
    traceOnnMoviesEvent('Render', 'render_count', { component, count: next });
  }
}

export function noteOnnMoviesMount(component: string, payload: Record<string, unknown> = {}): void {
  traceOnnMoviesEvent('Render', 'component_mount', { component, ...payload });
}

export function noteOnnMoviesUnmount(component: string, payload: Record<string, unknown> = {}): void {
  traceOnnMoviesEvent('Render', 'component_unmount', { component, ...payload });
}

function ensureBackPressId(): string {
  if (!currentBackPressId) {
    backPressSeq += 1;
    currentBackPressId = `bp-${backPressSeq}-${Date.now()}`;
    if (!backPressClearScheduled) {
      backPressClearScheduled = true;
      queueMicrotask(() => {
        backPressClearScheduled = false;
        currentBackPressId = null;
      });
    }
  }
  return currentBackPressId;
}

/**
 * Wrap a hardwareBackPress listener without changing order or return semantics.
 * When tracing is disabled, returns the original handler reference.
 */
export function wrapOnnMoviesBackHandler(
  handlerId: string,
  handler: () => boolean,
  getContext?: () => Record<string, unknown>,
): () => boolean {
  if (!isOnnMoviesTraceEnabled()) {
    return handler;
  }
  return () => {
    if (!activeTraceId) {
      beginOnnMoviesTrace('manual');
    }
    const backPressId = ensureBackPressId();
    const context = getContext?.() ?? {};
    try {
      const consumed = Boolean(handler());
      traceOnnMoviesEvent('Back', 'back_handler', {
        handlerId,
        backPressId,
        decision: consumed ? 'consumed' : 'pass',
        returned: consumed,
        ...context,
      });
      return consumed;
    } catch (error) {
      traceOnnMoviesEvent('Back', 'back_handler', {
        handlerId,
        backPressId,
        decision: 'threw',
        returned: false,
        error: error instanceof Error ? error.message : String(error),
        ...context,
      });
      throw error;
    }
  };
}

/** Dev/audit helper: begin a named scenario from console or debug menu. */
export function startOnnMoviesScenario(scenario: OnnMoviesTraceScenario): string | null {
  return beginOnnMoviesTrace(scenario);
}

export function clearOnnMoviesTraceForTests() {
  activeTraceId = null;
  activeScenario = null;
  startedAt = 0;
  sequence = 0;
  eventCount = 0;
  renderCounts.clear();
  lastScrollTraceAt.clear();
  currentBackPressId = null;
  backPressClearScheduled = false;
  gridMounted = false;
  activeGridInstanceId = null;
  enabledCache = null;
}

export function getOnnMoviesTraceTestState() {
  return {
    enabled: isOnnMoviesTraceEnabled(),
    activeTraceId,
    activeScenario,
    eventCount,
    gridMounted,
    activeGridInstanceId,
    maxEventsPerTrace: MAX_EVENTS_PER_TRACE,
  };
}

export type OnnMoviesTraceConsoleApi = {
  begin: typeof beginOnnMoviesTrace;
  end: typeof endOnnMoviesTrace;
  startScenario: typeof startOnnMoviesScenario;
  getActiveTraceId: typeof getActiveOnnMoviesTraceId;
  isEnabled: typeof isOnnMoviesTraceEnabled;
};

/** Dev/audit console helper — no production UI. */
export function installOnnMoviesTraceConsoleApi(): void {
  if (!isOnnMoviesTraceEnabled()) {
    return;
  }
  const root = globalThis as typeof globalThis & {
    __NOVACAST_ONN_MOVIES_TRACE__?: OnnMoviesTraceConsoleApi;
  };
  root.__NOVACAST_ONN_MOVIES_TRACE__ = {
    begin: beginOnnMoviesTrace,
    end: endOnnMoviesTrace,
    startScenario: startOnnMoviesScenario,
    getActiveTraceId: getActiveOnnMoviesTraceId,
    isEnabled: isOnnMoviesTraceEnabled,
  };
}

if (isOnnMoviesTraceEnabled()) {
  installOnnMoviesTraceConsoleApi();
}
