import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getDeviceState, getDeviceIdentity } from '@/features/device';
import { deviceFeatureFlags } from '@/features/device/deviceFeatureFlags';
import { getAppLifecycleState } from '@/features/resilience/appLifecycle';
import { getOfflineSnapshot } from '@/features/resilience/offlineStatus';
import { getProviderState } from '@/features/providers/providerStore';
import { getSelectedProvider, isProviderConnectionReady } from '@/features/providers/providerModel';
import { getUnifiedPlayerState } from '@/features/playback/unified/unifiedPlayerStore';
import type { UnifiedPlayerMachineState } from '@/features/playback/unified/types';
import { getStartupTimingAnchor } from '@/features/startup/startupDiagnostics';

export type NovaRouteContext = { route: string; area?: string; overlay?: string; previousRoute?: string; reason?: string };
export type NovaProviderContext = {
  id?: string | null;
  displayName?: string | null;
  type?: string | null;
  state?: string | null;
  syncStage?: string | null;
  catalogSource?: string | null;
  channelCount?: number;
  movieCount?: number;
  seriesCount?: number;
  categoryCount?: number;
  lastSuccessfulSyncAge?: string | null;
  errorClassification?: string | null;
};
export type NovaPlaybackContext = {
  type?: string | null;
  state?: UnifiedPlayerMachineState | string | null;
  errorCode?: string | null;
  playerEngine?: string | null;
  contentId?: string | null;
  channelId?: string | null;
  movieId?: string | null;
  seriesId?: string | null;
  providerId?: string | null;
  startupElapsed?: string | null;
  retryCount?: number;
  fullscreen?: boolean;
  failureClassification?: string | null;
};

type SafeValue = string | number | boolean | null;
type SafeRecord = Record<string, SafeValue>;
type NovaSeverity = 'info' | 'warning' | 'error' | 'fatal';

const MAX_BREADCRUMBS = 20;
const recentBreadcrumbs: { category: string; message: string; level?: NovaSeverity; data?: SafeRecord }[] = [];
let deviceContext: SafeRecord = {};
let routeContext: NovaRouteContext | null = null;
let providerContext: NovaProviderContext | null = null;
let playbackContext: NovaPlaybackContext | null = null;
let startupContext: SafeRecord = {};
let networkContext: SafeRecord = {};
let lifecycleContext: SafeRecord = {};
let initialized = false;

function primitive(value: unknown, max = 160): SafeValue {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
}

export function sanitizeProviderUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/[?#].*$/, '').replace(/\/+$|\s+$/g, '').slice(0, 160);
  }
}

const SECRET_KEY = /(password|passwd|username|authorization|cookie|token|secret|credential|dsn|invite|pairing|apikey|api_key|supabase)/i;
const URL_KEY = /(url|uri|host|endpoint|stream)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function sanitizeText(value: string): string {
  return value.replace(EMAIL, '[redacted-email]').replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]').slice(0, 240);
}

export function sanitizeEvent<T>(event: T): T {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, key = ''): unknown => {
    if (SECRET_KEY.test(key)) return '[redacted]';
    if (typeof value === 'string') return URL_KEY.test(key) ? sanitizeProviderUrl(value) : sanitizeText(value);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => walk(item, key));
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([childKey, childValue]) => {
      output[childKey] = walk(childValue, childKey);
    });
    return output;
  };
  return walk(event) as T;
}

export function beforeSendNovaEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const returnedEvent = sanitizeEvent(event);
  return returnedEvent;
}

function setContext(name: string, value: SafeRecord | null) {
  Sentry.setContext(name, value ? sanitizeEvent(value) : null);
}

function ageBucket(startedAt?: number) {
  if (!startedAt) return null;
  const minutes = Math.floor(Math.max(0, Date.now() - startedAt) / 60_000);
  return minutes < 1 ? '<1m' : minutes < 5 ? '1-5m' : minutes < 15 ? '5-15m' : minutes < 60 ? '15-60m' : '60m+';
}

export async function initializeNovaSentryContext() {
  if (initialized) return;
  initialized = true;
  const identity = await getDeviceIdentity().catch(() => null);
  const current = getDeviceState();
  const publicDeviceId = current.status?.publicDeviceCode ?? identity?.publicDeviceCode ?? null;
  deviceContext = {
    manufacturer: primitive(Device.manufacturer),
    model: primitive(Device.modelName),
    deviceName: primitive(Device.deviceName),
    platformApiLevel: primitive(Device.platformApiLevel),
    osVersion: primitive(Device.osVersion),
    supportedCpuArchitectures: primitive(Device.supportedCpuArchitectures?.join(',')),
    totalMemory: primitive(Device.totalMemory),
    isDevice: Device.isDevice,
    nativeApplicationVersion: primitive(Constants.expoConfig?.version),
    nativeBuildVersion: primitive(Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber),
    applicationId: primitive(Constants.expoConfig?.android?.package ?? Constants.expoConfig?.ios?.bundleIdentifier),
  };
  Sentry.setUser(publicDeviceId ? { id: publicDeviceId } : null);
  Object.entries({
    'app.platform': Platform.OS === 'android' ? 'android-tv' : Platform.OS,
    'app.environment': __DEV__ ? 'development' : 'beta',
    'app.version': deviceContext.nativeApplicationVersion,
    'app.build': deviceContext.nativeBuildVersion,
    'device.manufacturer': deviceContext.manufacturer,
    'device.model': deviceContext.model,
    'device.os': deviceContext.osVersion,
    'device.api_level': deviceContext.platformApiLevel,
    'device.is_physical': deviceContext.isDevice,
    'novacast.device_id': publicDeviceId,
    'novacast.beta_mode': deviceFeatureFlags.closedBetaMode,
    'novacast.activation_required': deviceFeatureFlags.activationRequired,
    'novacast.managed_provider_enabled': deviceFeatureFlags.managedBetaProviderEnabled,
  }).forEach(([key, value]) => Sentry.setTag(key, value == null ? 'unknown' : String(value)));
  setContext('device', deviceContext);
  setContext('app', { version: deviceContext.nativeApplicationVersion, build: deviceContext.nativeBuildVersion, applicationId: deviceContext.applicationId });
  setNovaNetworkContext({ status: getOfflineSnapshot().status, internetReachable: getOfflineSnapshot().status === 'online' });
  setNovaLifecycleContext({ state: getAppLifecycleState() });
}

export function setNovaDeviceContext(value: SafeRecord) { deviceContext = { ...deviceContext, ...value }; setContext('device', deviceContext); }
export function setNovaRouteContext(value: NovaRouteContext) {
  const changed = routeContext?.route !== value.route || routeContext?.overlay !== value.overlay;
  const previousRoute = routeContext?.route;
  routeContext = { ...value, previousRoute: value.previousRoute ?? previousRoute };
  Sentry.setTag('nav.route', value.route);
  if (value.area) Sentry.setTag('nav.area', value.area);
  setContext('navigation', routeContext as SafeRecord);
  if (changed && previousRoute) addNovaBreadcrumb({ category: 'navigation', message: `${previousRoute} -> ${value.route}`, data: value.reason ? { reason: value.reason } : undefined });
}
export function setNovaProviderContext(value: NovaProviderContext | null) { providerContext = value; Sentry.setTag('provider.id', value?.id ?? 'none'); Sentry.setTag('provider.state', value?.state ?? 'unknown'); setContext('provider', value as SafeRecord | null); }
export function clearNovaProviderContext() { setNovaProviderContext(null); }
export function setNovaPlaybackContext(value: NovaPlaybackContext | null) { playbackContext = value; if (value) { Sentry.setTag('playback.type', value.type ?? 'unknown'); Sentry.setTag('playback.state', value.state ?? 'unknown'); } setContext('playback', value as SafeRecord | null); }
export function clearNovaPlaybackContext() { setNovaPlaybackContext(null); }
export function setNovaStartupContext(value: SafeRecord) { startupContext = { ...startupContext, ...value }; setContext('startup', startupContext); }
export function setNovaNetworkContext(value: SafeRecord) {
  const previousStatus = networkContext.status;
  networkContext = { ...networkContext, ...value };
  setContext('network', networkContext);
  if (value.status && value.status !== previousStatus) addNovaBreadcrumb({ category: 'network', message: `network_${value.status}`, data: { status: value.status } });
}
export function setNovaLifecycleContext(value: SafeRecord) { lifecycleContext = { ...lifecycleContext, ...value }; setContext('lifecycle', lifecycleContext); }

export function addNovaBreadcrumb(input: { category: string; message: string; level?: NovaSeverity; data?: SafeRecord }) {
  const breadcrumb = { category: input.category.slice(0, 40), message: sanitizeText(input.message), level: input.level, data: input.data ? sanitizeEvent(input.data) : undefined };
  recentBreadcrumbs.push(breadcrumb);
  if (recentBreadcrumbs.length > MAX_BREADCRUMBS) recentBreadcrumbs.splice(0, recentBreadcrumbs.length - MAX_BREADCRUMBS);
  Sentry.addBreadcrumb({ ...breadcrumb, timestamp: Date.now() / 1000 });
}

function scopeContext(scope: Sentry.Scope) {
  scope.setContext('nova_diagnostics', sanitizeEvent({ device: deviceContext, navigation: routeContext, provider: providerContext, playback: playbackContext, startup: startupContext, network: networkContext, lifecycle: lifecycleContext, recentBreadcrumbs }));
}

export function captureNovaError(error: unknown, options: { classification?: string; severity?: NovaSeverity; fingerprint?: string[]; context?: SafeRecord } = {}) {
  Sentry.withScope((scope) => { scopeContext(scope); if (options.context) scope.setContext('error_details', sanitizeEvent(options.context)); if (options.fingerprint) scope.setFingerprint(options.fingerprint); scope.setLevel(options.severity ?? 'error'); Sentry.captureException(error); });
}

export function captureNovaMessage(message: string, options: { classification?: string; severity?: NovaSeverity; fingerprint?: string[]; context?: SafeRecord } = {}) {
  Sentry.withScope((scope) => { scopeContext(scope); if (options.context) scope.setContext('message_details', sanitizeEvent(options.context)); if (options.fingerprint) scope.setFingerprint(options.fingerprint); scope.setLevel(options.severity ?? 'info'); Sentry.captureMessage(sanitizeText(message), options.severity ?? 'info'); });
}

export async function createNovaDiagnosticSnapshot() {
  const device = getDeviceState();
  const providerState = await getProviderState();
  const provider = getSelectedProvider(providerState);
  const playback = getUnifiedPlayerState();
  return sanitizeEvent({
    publicDeviceId: device.status?.publicDeviceCode ?? device.identity?.publicDeviceCode ?? null,
    app: { version: deviceContext.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null, build: deviceContext.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? null },
    device: deviceContext,
    route: routeContext,
    provider: provider ? { id: provider.id, displayName: provider.name, type: provider.connection?.type, state: isProviderConnectionReady(provider) ? 'ready' : 'disconnected' } : null,
    startup: { ...startupContext, age: ageBucket(getStartupTimingAnchor()?.startedAt) },
    playback: playback.item ? { type: playback.item.mediaType, state: playback.machineState, contentId: playback.item.id, providerId: playback.item.providerId ?? null, error: playback.errorMessage ? sanitizeText(playback.errorMessage) : null } : { state: playback.machineState },
    network: { ...networkContext, status: getOfflineSnapshot().status },
    lifecycle: { ...lifecycleContext, state: getAppLifecycleState() },
    featureFlags: { closedBetaMode: deviceFeatureFlags.closedBetaMode, activationRequired: deviceFeatureFlags.activationRequired, managedProviderEnabled: deviceFeatureFlags.managedBetaProviderEnabled, betaInvitesEnabled: deviceFeatureFlags.betaInvitesEnabled },
    breadcrumbs: recentBreadcrumbs.slice(-10),
    timestamp: new Date().toISOString(),
  });
}

export function getNovaRecentBreadcrumbs() { return recentBreadcrumbs.slice(-10).map((entry) => ({ ...entry })); }
