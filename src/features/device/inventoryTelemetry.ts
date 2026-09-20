export type InventoryMediaType = 'live' | 'movie' | 'series';

export type InventoryReport = {
  mediaType: InventoryMediaType;
  count: number;
  catalogGeneration: number;
  completedAt: string;
};

const pending = new Map<InventoryMediaType, InventoryReport>();
const STORAGE_KEY = '@novacast/inventory-telemetry-pending-v1';
let loadPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();

export async function loadPendingInventoryReports() {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        for (const value of parsed) {
          if (value && typeof value === 'object') {
            const report = value as InventoryReport;
            if (report.mediaType === 'live' || report.mediaType === 'movie' || report.mediaType === 'series') {
              queueInventoryReport(report);
            }
          }
        }
      } catch {
        // Corrupt telemetry state is disposable and must not affect startup.
      }
    }).catch(() => undefined);
  }
  await loadPromise;
}

function persist() {
  const snapshot = JSON.stringify([...pending.values()]);
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
    .catch(() => undefined);
}

export function queueInventoryReport(report: InventoryReport) {
  if (!Number.isInteger(report.count) || report.count < 0) return;
  if (!Number.isInteger(report.catalogGeneration) || report.catalogGeneration < 1) return;
  if (!Number.isFinite(Date.parse(report.completedAt))) return;
  pending.set(report.mediaType, report);
  persist();
}

export function getPendingInventoryReports() {
  return [...pending.values()];
}

export function acknowledgeInventoryReports(reports: InventoryReport[]) {
  for (const report of reports) {
    const current = pending.get(report.mediaType);
    if (current?.catalogGeneration === report.catalogGeneration && current.completedAt === report.completedAt) {
      pending.delete(report.mediaType);
    }
  }
  persist();
}

export function clearInventoryReportsForTests() {
  pending.clear();
}
import AsyncStorage from '@react-native-async-storage/async-storage';
