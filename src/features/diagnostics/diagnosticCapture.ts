import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@novacast/diagnostic-capture-v1';
const CAPTURE_DURATION_MS = 15 * 60 * 1000;

export type DiagnosticCapture = { captureId: string; expiresAt: string };
let current: DiagnosticCapture | null = null;

function active(value: DiagnosticCapture | null) {
  return value && Date.parse(value.expiresAt) > Date.now() ? value : null;
}

export function getDiagnosticCapture() {
  current = active(current);
  return current;
}

export function isEnhancedCaptureActive() { return Boolean(getDiagnosticCapture()); }

export async function hydrateDiagnosticCapture() {
  try { current = active(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null')); } catch { current = null; }
  return current;
}

export async function applyDiagnosticCaptureCommand(payload: Record<string, unknown>) {
  const enabled = payload.enabled === true;
  current = enabled
    ? { captureId: String(payload.captureId ?? ''), expiresAt: String(payload.expiresAt ?? new Date(Date.now() + CAPTURE_DURATION_MS).toISOString()) }
    : null;
  if (!current?.captureId || !active(current)) current = null;
  if (current) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current)).catch(() => undefined);
  else await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  return current;
}

export const diagnosticCaptureDurationMs = CAPTURE_DURATION_MS;
