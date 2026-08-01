import { CATALOG_SCHEMA_VERSION } from './catalogTypes.ts';

/**
 * Schema version 1 — Stage 1 durable catalog foundation.
 * User-state (favorites/history/progress) stays in AsyncStorage for now.
 */
export const CATALOG_MIGRATION_SQL_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalog_providers (
  provider_id TEXT PRIMARY KEY NOT NULL,
  provider_type TEXT NOT NULL,
  display_name TEXT,
  catalog_generation INTEGER NOT NULL DEFAULT 0,
  last_successful_sync_at INTEGER,
  last_attempted_sync_at INTEGER,
  sync_status TEXT,
  sync_error_code TEXT
);

CREATE TABLE IF NOT EXISTS catalog_categories (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  sort_order INTEGER,
  item_count INTEGER NOT NULL DEFAULT 0,
  sync_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, media_type, category_id)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  category_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  artwork_url TEXT,
  backdrop_url TEXT,
  release_date TEXT,
  release_year INTEGER,
  rating REAL,
  description TEXT,
  stream_extension TEXT,
  provider_sort_order INTEGER,
  series_id TEXT,
  season_number INTEGER,
  episode_number INTEGER,
  sync_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, media_type, content_id)
);

CREATE TABLE IF NOT EXISTS catalog_seasons (
  provider_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  title TEXT,
  artwork_url TEXT,
  episode_count INTEGER NOT NULL DEFAULT 0,
  sync_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, series_id, season_number)
);

CREATE TABLE IF NOT EXISTS catalog_sync_state (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  error_code TEXT,
  PRIMARY KEY (provider_id, media_type)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_media
  ON catalog_items (provider_id, media_type);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_media_category
  ON catalog_items (provider_id, media_type, category_id);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_normalized_title
  ON catalog_items (provider_id, normalized_title);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_series
  ON catalog_items (provider_id, series_id);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_series_season
  ON catalog_items (provider_id, series_id, season_number);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_media_sort
  ON catalog_items (provider_id, media_type, provider_sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_provider_media_sort
  ON catalog_categories (provider_id, media_type, sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_sync_generation
  ON catalog_items (provider_id, sync_generation);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_provider_sync_generation
  ON catalog_categories (provider_id, sync_generation);
`;

/**
 * Schema version 2 — Stage 3C generation-safe Movies tables.
 * Legacy tables are retained for rollback / fragment recovery.
 * Marker: stage3c-generation-safe-catalog-v2
 */
export const CATALOG_MIGRATION_SQL_V2 = `
CREATE TABLE IF NOT EXISTS catalog_categories_v2 (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  sync_generation INTEGER NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  sort_order INTEGER,
  item_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, media_type, sync_generation, category_id)
);

CREATE TABLE IF NOT EXISTS catalog_items_v2 (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  sync_generation INTEGER NOT NULL,
  content_id TEXT NOT NULL,
  category_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  artwork_url TEXT,
  backdrop_url TEXT,
  release_date TEXT,
  release_year INTEGER,
  rating REAL,
  description TEXT,
  stream_extension TEXT,
  provider_sort_order INTEGER,
  series_id TEXT,
  season_number INTEGER,
  episode_number INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, media_type, sync_generation, content_id)
);

CREATE TABLE IF NOT EXISTS catalog_seasons_v2 (
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  sync_generation INTEGER NOT NULL,
  series_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  title TEXT,
  artwork_url TEXT,
  episode_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, media_type, sync_generation, series_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_v2_provider_media_gen
  ON catalog_items_v2 (provider_id, media_type, sync_generation);

CREATE INDEX IF NOT EXISTS idx_catalog_items_v2_provider_media_gen_category
  ON catalog_items_v2 (provider_id, media_type, sync_generation, category_id);

CREATE INDEX IF NOT EXISTS idx_catalog_items_v2_provider_media_gen_title
  ON catalog_items_v2 (provider_id, media_type, sync_generation, normalized_title);

CREATE INDEX IF NOT EXISTS idx_catalog_items_v2_provider_media_gen_sort
  ON catalog_items_v2 (provider_id, media_type, sync_generation, provider_sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_v2_provider_media_gen
  ON catalog_categories_v2 (provider_id, media_type, sync_generation);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_v2_provider_media_gen_sort
  ON catalog_categories_v2 (provider_id, media_type, sync_generation, sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_seasons_v2_provider_media_gen
  ON catalog_seasons_v2 (provider_id, media_type, sync_generation);

CREATE INDEX IF NOT EXISTS idx_catalog_seasons_v2_provider_series
  ON catalog_seasons_v2 (provider_id, series_id, sync_generation);
`;

export const CATALOG_REQUIRED_TABLES = [
  'catalog_providers',
  'catalog_categories',
  'catalog_items',
  'catalog_seasons',
  'catalog_sync_state',
  'catalog_categories_v2',
  'catalog_items_v2',
  'catalog_seasons_v2',
] as const;

export const CATALOG_REQUIRED_INDEXES = [
  'idx_catalog_items_provider_media',
  'idx_catalog_items_provider_media_category',
  'idx_catalog_items_provider_normalized_title',
  'idx_catalog_items_provider_series',
  'idx_catalog_items_provider_series_season',
  'idx_catalog_items_provider_media_sort',
  'idx_catalog_categories_provider_media_sort',
  'idx_catalog_items_provider_sync_generation',
  'idx_catalog_categories_provider_sync_generation',
  'idx_catalog_items_v2_provider_media_gen',
  'idx_catalog_items_v2_provider_media_gen_category',
  'idx_catalog_items_v2_provider_media_gen_title',
  'idx_catalog_items_v2_provider_media_gen_sort',
  'idx_catalog_categories_v2_provider_media_gen',
  'idx_catalog_categories_v2_provider_media_gen_sort',
  'idx_catalog_seasons_v2_provider_media_gen',
  'idx_catalog_seasons_v2_provider_series',
] as const;

export { CATALOG_SCHEMA_VERSION };
