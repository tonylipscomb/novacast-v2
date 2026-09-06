import type { CatalogMediaType } from './catalogTypes.ts';

type ActiveWriter = {
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
  runId?: string;
};

const activeWriters = new Map<string, ActiveWriter>();

export function catalogSqliteWriterKey(providerId: string, mediaType: CatalogMediaType) {
  return `${providerId}::${mediaType}`;
}

export function registerActiveCatalogSqliteWriter(writer: ActiveWriter) {
  activeWriters.set(catalogSqliteWriterKey(writer.providerId, writer.mediaType), writer);
}

export function unregisterActiveCatalogSqliteWriter(
  providerId: string,
  mediaType: CatalogMediaType,
  generation?: number,
) {
  const key = catalogSqliteWriterKey(providerId, mediaType);
  const current = activeWriters.get(key);
  if (!current) {
    return;
  }
  if (generation != null && current.generation !== generation) {
    return;
  }
  activeWriters.delete(key);
}

export function hasActiveCatalogSqliteWriter(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
) {
  const current = activeWriters.get(catalogSqliteWriterKey(providerId, mediaType));
  return Boolean(current && current.generation === generation);
}

export function clearActiveCatalogSqliteWritersForTests() {
  activeWriters.clear();
}
