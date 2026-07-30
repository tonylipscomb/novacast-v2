/**
 * Diagnostics-only CatalogAudit probes.
 * Measure + log only. No throttling, yielding, deferring, or sync policy changes.
 */

const LOG_TAG = '[NovaCast CatalogAudit]';

function envEnabled() {
  return (
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1'
  );
}

let enabled = false;
let bootAt = 0;
let lastSampleAt = 0;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let lagTimer: ReturnType<typeof setInterval> | null = null;
let expectedLagTick = 0;

type PhaseAccum = {
  count: number;
  totalMs: number;
  maxMs: number;
};

const phases = new Map<string, PhaseAccum>();

const state = {
  syncJobsStarted: 0,
  syncJobsCompleted: 0,
  syncJobsFailed: 0,
  movieCategoryFetches: 0,
  seriesCategoryFetches: 0,
  catalogItemsProcessed: 0,
  httpStarted: 0,
  httpCompleted: 0,
  httpInFlight: 0,
  httpMaxInFlight: 0,
  httpTotalMs: 0,
  asyncStorageReads: 0,
  asyncStorageWrites: 0,
  sqliteReads: 0,
  sqliteWrites: 0,
  downloadMs: 0,
  parseMs: 0,
  indexMs: 0,
  notifyPhaseCount: 0,
  progressWrites: 0,
  longestJsBlockMs: 0,
  lagSamples: 0,
  lagSumMs: 0,
  focusChanges: 0,
  firstResponsiveInputAt: 0 as number | null,
  homeIdleAt: 0 as number | null,
  renders: {
    NovaTvShell: 0,
    MainMenuScreen: 0,
    HomeMediaCard: 0,
    MoviesScreen: 0,
    SeriesScreen: 0,
  } as Record<string, number>,
};

function now() {
  return Date.now();
}

function log(message: string, payload: Record<string, unknown> = {}) {
  if (!enabled) {
    return;
  }
  console.info(LOG_TAG, message, { t: now() - bootAt, ...payload });
}

function bumpPhase(name: string, durationMs: number) {
  const current = phases.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  phases.set(name, current);
}

export function isCatalogAuditEnabled() {
  return enabled;
}

export function markCatalogAuditRender(component: keyof typeof state.renders | string) {
  if (!enabled) {
    return;
  }
  state.renders[component] = (state.renders[component] ?? 0) + 1;
}

export function markCatalogAuditFocus(source = 'unknown') {
  if (!enabled) {
    return;
  }
  state.focusChanges += 1;
  if (state.firstResponsiveInputAt == null) {
    state.firstResponsiveInputAt = now();
    log('first_responsive_input', { source, sinceBootMs: state.firstResponsiveInputAt - bootAt });
  }
}

export function markCatalogAuditSync(event: 'requested' | 'started' | 'completed' | 'failed', payload: Record<string, unknown> = {}) {
  if (!enabled) {
    return;
  }
  if (event === 'started') {
    state.syncJobsStarted += 1;
  } else if (event === 'completed') {
    state.syncJobsCompleted += 1;
  } else if (event === 'failed') {
    state.syncJobsFailed += 1;
  }
  log(`sync_${event}`, payload);
}

export function markCatalogAuditCategory(
  mediaType: 'movie' | 'series',
  event: 'fetch_start' | 'fetch_done',
  payload: Record<string, unknown> = {},
) {
  if (!enabled) {
    return;
  }
  if (event === 'fetch_start') {
    if (mediaType === 'movie') {
      state.movieCategoryFetches += 1;
    } else {
      state.seriesCategoryFetches += 1;
    }
  }
  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
  if (event === 'fetch_done' && durationMs > 0) {
    bumpPhase(`${mediaType}_category_fetch`, durationMs);
  }
  log(`${mediaType}_category_${event}`, payload);
}

export function markCatalogAuditItems(count: number, kind: 'download' | 'parse' | 'index' | 'processed', durationMs = 0) {
  if (!enabled) {
    return;
  }
  if (kind === 'processed') {
    state.catalogItemsProcessed += count;
  } else if (kind === 'download') {
    state.downloadMs += durationMs;
  } else if (kind === 'parse') {
    state.parseMs += durationMs;
  } else if (kind === 'index') {
    state.indexMs += durationMs;
  }
  if (durationMs > 0) {
    bumpPhase(`catalog_${kind}`, durationMs);
  }
}

export function markCatalogAuditHttp(event: 'start' | 'end', payload: Record<string, unknown> = {}) {
  if (!enabled) {
    return;
  }
  if (event === 'start') {
    state.httpStarted += 1;
    state.httpInFlight += 1;
    state.httpMaxInFlight = Math.max(state.httpMaxInFlight, state.httpInFlight);
  } else {
    state.httpCompleted += 1;
    state.httpInFlight = Math.max(0, state.httpInFlight - 1);
    const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
    state.httpTotalMs += durationMs;
    if (durationMs > 0) {
      bumpPhase('http_request', durationMs);
    }
  }
  log(`http_${event}`, { inFlight: state.httpInFlight, ...payload });
}

export function markCatalogAuditAsyncStorage(op: 'read' | 'write') {
  if (!enabled) {
    return;
  }
  if (op === 'read') {
    state.asyncStorageReads += 1;
  } else {
    state.asyncStorageWrites += 1;
  }
}

export function markCatalogAuditSqlite(op: 'read' | 'write') {
  if (!enabled) {
    return;
  }
  if (op === 'read') {
    state.sqliteReads += 1;
  } else {
    state.sqliteWrites += 1;
  }
}

export function markCatalogAuditNotifyPhase(phase: string) {
  if (!enabled) {
    return;
  }
  state.notifyPhaseCount += 1;
  log('notify_phase', { phase });
}

export function markCatalogAuditProgressWrite(kind: string) {
  if (!enabled) {
    return;
  }
  state.progressWrites += 1;
  log('progress_write', { kind });
}

/**
 * End-to-end breakdown for one VOD category load (get_vod_streams path).
 * Nested phases accumulate while a profile is active.
 */
export type VodCategoryPhaseProfile = {
  categoryId: string;
  startedAt: number;
  fetchHeadersMs: number;
  bodyDownloadMs: number;
  jsonParseMs: number;
  mediaListBoundMs: number;
  filterPartitionMs: number;
  mapObjectsMs: number;
  ingestMs: number;
  progressWriteMs: number;
  notifyMs: number;
  otherMs: number;
  responseBytes: number;
  rawStreamCount: number;
  mappedCount: number;
  httpWallMs: number;
};

let activeVodProfile: VodCategoryPhaseProfile | null = null;

export function beginVodCategoryPhaseProfile(categoryId: string) {
  if (!enabled) {
    return;
  }
  activeVodProfile = {
    categoryId,
    startedAt: now(),
    fetchHeadersMs: 0,
    bodyDownloadMs: 0,
    jsonParseMs: 0,
    mediaListBoundMs: 0,
    filterPartitionMs: 0,
    mapObjectsMs: 0,
    ingestMs: 0,
    progressWriteMs: 0,
    notifyMs: 0,
    otherMs: 0,
    responseBytes: 0,
    rawStreamCount: 0,
    mappedCount: 0,
    httpWallMs: 0,
  };
}

export function getActiveVodCategoryPhaseProfile() {
  return activeVodProfile;
}

export function addVodCategoryPhaseMs(
  phase: keyof Omit<
    VodCategoryPhaseProfile,
    'categoryId' | 'startedAt' | 'responseBytes' | 'rawStreamCount' | 'mappedCount'
  >,
  durationMs: number,
) {
  if (!enabled || !activeVodProfile || durationMs <= 0) {
    return;
  }
  activeVodProfile[phase] += durationMs;
}

export function finishVodCategoryPhaseProfile(extra: Record<string, unknown> = {}) {
  if (!enabled || !activeVodProfile) {
    activeVodProfile = null;
    return;
  }
  const profile = activeVodProfile;
  activeVodProfile = null;
  const totalMs = now() - profile.startedAt;
  const accountedMs =
    profile.fetchHeadersMs +
    profile.bodyDownloadMs +
    profile.jsonParseMs +
    profile.mediaListBoundMs +
    profile.filterPartitionMs +
    profile.mapObjectsMs +
    profile.ingestMs +
    profile.progressWriteMs +
    profile.notifyMs;
  profile.otherMs = Math.max(0, totalMs - accountedMs);
  const pct = (ms: number) => (totalMs > 0 ? Number(((ms * 100) / totalMs).toFixed(1)) : 0);

  bumpPhase('vod_category_total', totalMs);
  if (profile.bodyDownloadMs) bumpPhase('vod_body_download', profile.bodyDownloadMs);
  if (profile.jsonParseMs) bumpPhase('vod_json_parse', profile.jsonParseMs);
  if (profile.mapObjectsMs) bumpPhase('vod_map_objects', profile.mapObjectsMs);
  if (profile.ingestMs) bumpPhase('vod_ingest', profile.ingestMs);
  if (profile.filterPartitionMs) bumpPhase('vod_filter_partition', profile.filterPartitionMs);

  state.downloadMs += profile.bodyDownloadMs;
  state.parseMs += profile.jsonParseMs;
  state.indexMs += profile.ingestMs;

  log('vod_category_profile', {
    categoryId: profile.categoryId,
    totalMs,
    responseBytes: profile.responseBytes,
    rawStreamCount: profile.rawStreamCount,
    mappedCount: profile.mappedCount,
    phases: {
      fetchHeadersMs: profile.fetchHeadersMs,
      bodyDownloadMs: profile.bodyDownloadMs,
      jsonParseMs: profile.jsonParseMs,
      mediaListBoundMs: profile.mediaListBoundMs,
      filterPartitionMs: profile.filterPartitionMs,
      mapObjectsMs: profile.mapObjectsMs,
      ingestMs: profile.ingestMs,
      progressWriteMs: profile.progressWriteMs,
      notifyMs: profile.notifyMs,
      otherMs: profile.otherMs,
      httpWallMs: profile.httpWallMs,
    },
    pct: {
      fetchHeaders: pct(profile.fetchHeadersMs),
      bodyDownload: pct(profile.bodyDownloadMs),
      jsonParse: pct(profile.jsonParseMs),
      mediaListBound: pct(profile.mediaListBoundMs),
      filterPartition: pct(profile.filterPartitionMs),
      mapObjects: pct(profile.mapObjectsMs),
      ingest: pct(profile.ingestMs),
      progressWrite: pct(profile.progressWriteMs),
      notify: pct(profile.notifyMs),
      other: pct(profile.otherMs),
    },
    accountedMs,
    ...extra,
  });
}

export function catalogAuditTimed<T>(phase: string, work: () => Promise<T>): Promise<T> {
  if (!enabled) {
    return work();
  }
  const started = now();
  return work().finally(() => {
    const durationMs = now() - started;
    bumpPhase(phase, durationMs);
    if (durationMs > state.longestJsBlockMs && durationMs > 16) {
      // Wall time of awaited work; not pure JS-CPU, but flags long critical sections.
    }
    log('phase_done', { phase, durationMs });
  });
}

function snapshot() {
  const elapsedMs = now() - bootAt;
  const itemsPerSec =
    elapsedMs > 0 ? Number(((state.catalogItemsProcessed * 1000) / elapsedMs).toFixed(2)) : 0;
  const avgLagMs = state.lagSamples > 0 ? Number((state.lagSumMs / state.lagSamples).toFixed(2)) : 0;
  const topPhases = [...phases.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      totalMs: value.totalMs,
      maxMs: value.maxMs,
      avgMs: value.count ? Math.round(value.totalMs / value.count) : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10);

  return {
    elapsedMs,
    firstResponsiveInputMs:
      state.firstResponsiveInputAt == null ? null : state.firstResponsiveInputAt - bootAt,
    homeIdleMs: state.homeIdleAt == null ? null : state.homeIdleAt - bootAt,
    syncJobsStarted: state.syncJobsStarted,
    syncJobsCompleted: state.syncJobsCompleted,
    syncJobsFailed: state.syncJobsFailed,
    movieCategoryFetches: state.movieCategoryFetches,
    seriesCategoryFetches: state.seriesCategoryFetches,
    catalogItemsProcessed: state.catalogItemsProcessed,
    catalogItemsPerSec: itemsPerSec,
    httpStarted: state.httpStarted,
    httpCompleted: state.httpCompleted,
    httpInFlight: state.httpInFlight,
    httpMaxInFlight: state.httpMaxInFlight,
    httpTotalMs: state.httpTotalMs,
    asyncStorageReads: state.asyncStorageReads,
    asyncStorageWrites: state.asyncStorageWrites,
    sqliteReads: state.sqliteReads,
    sqliteWrites: state.sqliteWrites,
    downloadMs: state.downloadMs,
    parseMs: state.parseMs,
    indexMs: state.indexMs,
    notifyPhaseCount: state.notifyPhaseCount,
    progressWrites: state.progressWrites,
    longestObservedBlockMs: state.longestJsBlockMs,
    avgEventLoopLagMs: avgLagMs,
    focusChanges: state.focusChanges,
    focusPerSec: elapsedMs > 0 ? Number(((state.focusChanges * 1000) / elapsedMs).toFixed(2)) : 0,
    renders: { ...state.renders },
    topPhases,
  };
}

function maybeMarkHomeIdle() {
  if (state.homeIdleAt != null) {
    return;
  }
  // Heuristic: sync completed at least once and event-loop lag settled + no HTTP in flight.
  if (
    state.syncJobsCompleted > 0 &&
    state.httpInFlight === 0 &&
    state.longestJsBlockMs < 50 &&
    state.lagSamples > 10
  ) {
    const recentAvg = state.lagSumMs / Math.max(1, state.lagSamples);
    if (recentAvg < 40) {
      state.homeIdleAt = now();
      log('home_idle_heuristic', { sinceBootMs: state.homeIdleAt - bootAt });
    }
  }
}

async function patchAsyncStorageCounters() {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default as {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    };
    const originalGetItem = AsyncStorage.getItem.bind(AsyncStorage);
    const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    const originalRemoveItem = AsyncStorage.removeItem.bind(AsyncStorage);

    AsyncStorage.getItem = async (key: string) => {
      markCatalogAuditAsyncStorage('read');
      return originalGetItem(key);
    };
    AsyncStorage.setItem = async (key: string, value: string) => {
      markCatalogAuditAsyncStorage('write');
      return originalSetItem(key, value);
    };
    AsyncStorage.removeItem = async (key: string) => {
      markCatalogAuditAsyncStorage('write');
      return originalRemoveItem(key);
    };
  } catch {
    // ignore
  }
}

export function initializeCatalogAudit() {
  if (!envEnabled() || enabled) {
    return;
  }
  enabled = true;
  bootAt = now();
  lastSampleAt = bootAt;
  expectedLagTick = bootAt + 50;
  log('boot', { enabled: true });

  void patchAsyncStorageCounters();

  lagTimer = setInterval(() => {
    const tickAt = now();
    const lag = Math.max(0, tickAt - expectedLagTick);
    expectedLagTick = tickAt + 50;
    state.lagSamples += 1;
    state.lagSumMs += lag;
    if (lag > state.longestJsBlockMs) {
      state.longestJsBlockMs = lag;
      if (lag >= 50) {
        let lastEarlyBootMark: { name: string; t: number } | undefined;
        try {
          // Lazy require avoids a circular import with earlyBootAudit consumers.
          const { getLastEarlyBootMark } = require('./earlyBootAudit') as {
            getLastEarlyBootMark: () => { name: string; t: number };
          };
          lastEarlyBootMark = getLastEarlyBootMark();
        } catch {
          lastEarlyBootMark = undefined;
        }
        log('long_task_candidate', { lagMs: lag, lastEarlyBootMark });
      }
    }
    maybeMarkHomeIdle();
  }, 50);

  sampleTimer = setInterval(() => {
    const snap = snapshot();
    // Counts/timings only — omit nested render maps & phase arrays from the hot log path.
    log('sample_5s', {
      elapsedMs: snap.elapsedMs,
      syncJobsStarted: snap.syncJobsStarted,
      syncJobsCompleted: snap.syncJobsCompleted,
      catalogItemsProcessed: snap.catalogItemsProcessed,
      httpInFlight: snap.httpInFlight,
      asyncStorageWrites: snap.asyncStorageWrites,
      longestObservedBlockMs: snap.longestObservedBlockMs,
      avgEventLoopLagMs: snap.avgEventLoopLagMs,
      focusChanges: snap.focusChanges,
    });
    lastSampleAt = now();
  }, 5000);
}

export function getCatalogAuditSnapshot() {
  return snapshot();
}

export function stopCatalogAuditForTests() {
  if (sampleTimer) {
    clearInterval(sampleTimer);
    sampleTimer = null;
  }
  if (lagTimer) {
    clearInterval(lagTimer);
    lagTimer = null;
  }
  enabled = false;
}
