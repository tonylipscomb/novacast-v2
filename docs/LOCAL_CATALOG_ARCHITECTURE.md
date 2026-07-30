# Local Catalog Architecture (Stage 1)

## Status

Stage 1 lands a durable SQLite catalog foundation only.

- Screens still read from existing provider repositories + in-memory indexes / AsyncStorage caches.
- No Movies, Series, Search, Home, Live TV, or playback codepath is wired to SQLite yet.
- Stage 1 is reversible: remove `src/features/catalog/` + `expo-sqlite` dependency and the app behaves as before.

## Storage audit (pre-Stage 1)

| Area | Mechanism | Notes |
| --- | --- | --- |
| SQLite | Not present before Stage 1 | `expo-sqlite` added at `~57.0.1` for Expo SDK 57 |
| Favorites / watchlist / continue watching | AsyncStorage `@novacast/media-library` (+ legacy `@novacast/movie-library`) | Keep separate from catalog tables |
| Recently watched / personalization | AsyncStorage `@novacast/personalization:*` | Keep separate |
| Movie library favorites (legacy overlap) | AsyncStorage `@novacast/movie-library` | Keep separate |
| Search history | AsyncStorage `@novacast/search-history` | Keep separate |
| Provider state | AsyncStorage `@novacast/provider-state` | Keep separate |
| Category count index | AsyncStorage `@novacast/category-counts/*` | Future Stage 2+ can replace reads; do not conflict with new DB file |
| Smart category cache | AsyncStorage `@novacast/smart-category-cache/*` | Keep separate |
| Catalog sync checkpoint | AsyncStorage `@novacast/catalog-sync-checkpoint/*` | Keep for current sync worker until Stage 2 migrates |
| In-memory movie/series indexes | Session memory (AsyncStorage full-catalog blobs intentionally disabled â€” OOM on Fire TV) | Stage 2/3 replace with SQLite pages |
| Parental PIN | SecureStore | Unrelated |

### Migration conflicts

- None for Stage 1: catalog uses a new DB file `novacast-catalog.db` and new `catalog_*` tables.
- User-state tables are **not** moved into SQLite in Stage 1.
- Do not reuse AsyncStorage keys for catalog binary blobs.

## Architecture direction

```
Provider API
  â†’ background catalog sync (Stage 2+)
  â†’ normalized SQLite catalog (Stage 1 schema + repository)
  â†’ small paginated UI queries (Stage 3+ screen wiring)
```

Stage 1 provides only the SQLite module + typed repository API.

## Schema (version 1)

`PRAGMA user_version = 1`

Tables:

- `catalog_providers`
- `catalog_categories`
- `catalog_items`
- `catalog_seasons`
- `catalog_sync_state`

Indexes cover provider/media/category/title/series/sort/generation lookups (see `catalogSchema.ts`).

Default page size for repository queries: **48** (within the 36â€“50 band).

## Sync-generation lifecycle

1. `beginCatalogSync(providerId, mediaType)` allocates `generation = max(existing) + 1` and marks sync state `syncing`.
2. Writers stamp rows with that `sync_generation` via batch upserts inside transactions.
3. `completeCatalogSync(...)` recomputes category `item_count`, marks state `ready`, updates provider success timestamps, then deletes rows where `sync_generation != generation`.
4. `failCatalogSync(...)` records `error` / `error_code` and **does not** delete prior successful generations. Reads continue to serve the previous ready generation.

## Module map

| File | Role |
| --- | --- |
| `src/features/catalog/catalogTypes.ts` | Types + normalize helpers |
| `src/features/catalog/catalogSchema.ts` | Migration SQL + required names |
| `src/features/catalog/catalogDatabaseDriver.ts` | Driver interface; Expo opener; Node opener for tests |
| `src/features/catalog/catalogDatabase.ts` | Single init promise, migrations, transactions |
| `src/features/catalog/catalogRepository.ts` | Typed Stage 1 API |
| `src/features/catalog/index.ts` | Public exports |

No React imports.

## Rollback strategy

1. Do not call `initializeCatalogDatabase()` from app entry (Stage 1 does not).
2. To fully remove Stage 1: delete `src/features/catalog/`, `docs/LOCAL_CATALOG_ARCHITECTURE.md`, `scripts/local-catalog-stage1.test.mjs`, uninstall `expo-sqlite`, remove the `expo-sqlite` plugin from `app.json`.
3. Device may retain an unused `novacast-catalog.db` file; harmless until cleared by uninstall/app data wipe.

## Future Movies migration plan (not Stage 1)

1. Stage 2: provider sync worker writes Xtream movie categories/items into SQLite using this repository.
2. Stage 3: `useMoviesScreenModel` switches category counts + poster pages to `getCatalogCategoryCounts` / `getCatalogItemsPage` behind a feature flag.
3. Keep provider repository `getMoviesPage` as fallback until flag proves stable on ONN/Fire TV.

## Future Series migration plan (not Stage 1)

1. Stage 2b: series categories/items/seasons written with the same generation protocol.
2. Stage 3b: Series screen pagination/search reads SQLite pages.
3. Episode detail/playback URLs continue to resolve through existing provider APIs until a later metadata stage.

## Licensing note

This Stage 1 catalog implementation is original NovaCast code.
**No Fred TV (or other AGPL) source code was copied.** Schema and sync-generation design were specified for NovaCast and implemented from that brief.

## Stage 2 next step (exact)

Implement a background writer that, during the existing `scheduleProviderCatalogSync` flow (or a sibling worker), calls:

1. `upsertCatalogProvider`
2. `beginCatalogSync(providerId, 'movie' | 'series')`
3. batched `writeCatalogCategoriesBatch` / `writeCatalogItemsBatch` (/ seasons for series)
4. `completeCatalogSync` or `failCatalogSync`

Still without switching any UI reads to SQLite.
