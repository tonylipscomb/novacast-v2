import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@novacast/analytics-queue-v1';
const SESSION_KEY = '@novacast/analytics-session-v1';

type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

let storageOverride: StorageLike | null = null;

function storage() {
  return storageOverride ?? AsyncStorage;
}

export function setAnalyticsStorageForTests(value: StorageLike | null) {
  storageOverride = value;
}

export async function readAnalyticsQueue<T>() {
  try {
    const raw = await storage().getItem(QUEUE_KEY);
    if (!raw) return [] as T[];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [] as T[];
  }
}

export async function writeAnalyticsQueue<T>(value: T[]) {
  try {
    await storage().setItem(QUEUE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function readAnalyticsSession<T>() {
  try {
    const raw = await storage().getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeAnalyticsSession<T>(value: T) {
  try {
    await storage().setItem(SESSION_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function clearAnalyticsStorageForTests() {
  await storage().removeItem(QUEUE_KEY).catch(() => undefined);
  await storage().removeItem(SESSION_KEY).catch(() => undefined);
}

