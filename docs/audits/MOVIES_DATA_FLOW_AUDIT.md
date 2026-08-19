# Movies Data Flow Audit

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Investigation only — no production code changes.

Gate: `EXPO_PUBLIC_MOVIES_SQLITE_READS === 'true'` selects the SQLite browse path in `useMoviesScreenModel`.

---

## 1. End-to-end lifecycle

```text
SecureStore credentials
  → providerStore.resolveProviderCredentials / prepareProviderBundle
  → createRepositoryBundle + XtreamClient
  → activateRepositoryBundle → hydrate → syncCatalog
  → scheduleProviderCatalogSync → runMovieCatalogSync
  → VOD filter capability probe / cache (v4 tri-state)
  → strategy: full-dump-stream-category | filtered-per-category
  → streamXtreamCategoryDecode (native)
  → SQLite write (catalog_categories_v2 / catalog_items_v2, sync_generation N)
  → finishCatalogSqliteMediaSync
       → completion barrier
       → validateMoviesCategoryDistribution
       → completeCatalogSync (activate catalog_providers.catalog_generation)
  → notifyMovieCatalogReady(generation)
  → useMoviesScreenModel atomic swap / loadCategories
  → SqliteMovieDataSource.getCategories (pinned readable gen)
  → resolveMoviesInitialCategory
  → getMoviesPage (pinned generation)
  → visibleMovies → MoviePosterGrid
```

---

## 2. Stage inventory

| # | Stage | File / function | Input | Output | Persistent / memory | Generation | Concurrent? | Failure | Retry / cancel | Owner | Events | Subscribers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Credentials | `providerCredentialStore.ts` `getProviderCredentials` | providerId | Xtream user/pass/url | SecureStore | n/a | no | throw / null | manual re-pair | credential store | none | providerStore |
| 2 | Bundle activate | `providerBundle.ts` `activateRepositoryBundle` | ProviderRecord + credentials | active bundle | in-memory singleton | n/a | cancels prior sync | throw | next activate | bundle | invalidate prior | screens via `useActiveProviderBundle` |
| 3 | Sync schedule | `providerCatalogSync.ts` `scheduleProviderCatalogSync` | ProviderCatalogSyncInput | in-flight Promise | checkpoint AsyncStorage | n/a | one in-flight + pending | log error | resume pending | sync coordinator | audit sync-requested | none direct |
| 4 | Movie sync start | `runMovieCatalogSync` | input, runToken | sqliteHandle gen N | `catalog_sync_state` syncing | N begun | with Series (separate key) | failCatalogSync | checkpoint resume | sync | phase syncing | `subscribeCatalogSyncPhase` |
| 5 | Category metadata write | `writeCategoriesFromSourceBudgeted` | movieCategories | rows in `catalog_categories_v2` | SQLite | N (syncing) | yes vs Series | abort | cancelled return | writer | `publishMovieCategoriesUpdated` | model `loadCategories` |
| 6 | VOD capability | `evaluateVodCategoryFilterCapability` + probe loop | probe samples | status reliable/unreliable/inconclusive | AsyncStorage v4, 7d TTL | n/a | before item ingest | inconclusive → full dump | re-probe if not reliable cache | capability module | capability log | sync only |
| 7 | Strategy select | `runMovieCatalogSync` useFullDump gate | capability + force map | strategy string | force map in-memory | n/a | no | throw if no URL | one sparse fallback | sync | Full Dump Sync log | none |
| 8 | Native decode | `streamXtreamCategoryDecode` | requestUrl, mediaType | batches of NativeCatalogRecord | none | filterCategoryId | cancel via isCancelled | cancelled | none | native module | decode stats | sync onBatch |
| 9 | Item write | `writeCatalogItemsFromSourceBudgeted` | records → CatalogItem | `catalog_items_v2` | SQLite | N | budgeted batches | abort | cancelled | writer | decoded counters | finish barrier |
| 10 | Mid-sync sparse abort | `evaluateSparsePerCategoryCoverage` | attempt counters | suspicious → fail gen | capability → unreliable | fail N, start N+1 | one fallback/run | sparse_per_category_ingestion | one full-dump | sync | abort log | none |
| 11 | Completion + validate | `finishCatalogSqliteMediaSync` + `validateMoviesCategoryDistribution` | physical stats | ok / reject | sync state ready/error | N | no | complete-rejected | no activate | writer | barrier log | none until ready |
| 12 | Activation | `completeCatalogSync` | generation N | `catalog_providers.catalog_generation = N` | SQLite | N active | no | false | keep previous readable | repository | — | — |
| 13 | Catalog ready | `notifyMovieCatalogReady` | generation | listener fanout | in-memory listeners | N | yes | n/a | n/a | sync | movie-catalog-ready | model atomic swap |
| 14 | Readiness | `resolveMoviesCatalogReadiness` | providerId | decision + gen fields | previousReadable map | readable vs syncing | concurrent reads | waiting-fresh-sync | none | readiness module | readiness log | SqliteMovieDataSource |
| 15 | Sparse repair | `repairDegradedMoviesCatalogIfNeeded` | providerId | healthy/repairing/skipped | AsyncStorage once/gen | assessed gen | bounded | repairing → empty rail | once per degraded gen | repair module | Sparse Catalog Repair log | getCategories |
| 16 | Category + count read | `getCatalogCategoryCounts` | providerId, generation | metadata + grouped counts | SQLite | pinned readable | yes | [] if gen≤0 | none | repository | Category Counts log | Sqlite DS |
| 17 | Interactive rail | `filterInteractiveMovieCategories` + snapshot | raw categories | nonzero provider rail | lastValid cache | pinned | no | misaligned → previous | none | Sqlite DS | Read Snapshot log | model |
| 18 | Initial selection | `resolveMoviesInitialCategory` | categories + memory | selectedCategoryId | screen memory | n/a | no | All Movies / empty | none | visible categories helper | Initial Category log | model |
| 19 | Page query | `getMoviesPage` → `getCatalogItemsPage` | categoryId, offset, sort | page items | SQLite | pinned readable | cancel via request gen | MoviesCatalogNotReadyError | wait catalog ready | Sqlite DS | first-page log | model page effect |
| 20 | Model state | `useMoviesScreenModel` | DS + events | categories, visibleMovies, loadStatus | React state + refs | from DS | many effects | empty/error/loading | reloadToken | model | perf logs | MoviesScreen |
| 21 | Poster render | `MoviePosterGrid` | movies, focus props | FlatList cells | none | n/a | remount on columns | empty notice | none | MoviesScreen | mount logs | TV focus |

---

## 3. Mutators of interactive state

### `selectedCategoryId`

| Site | File:lines (approx) | Trigger |
|---|---|---|
| useState init | `useMoviesScreenModel.ts` ~218 | memory / route options |
| `setSelectedCategoryId('')` | ~448 | pending / no provider categories |
| `loadCategories` resolver | ~525–558 | category load |
| Atomic catalog-ready | ~711 | generation activation |
| `selectCategory` | ~1183+ | user rail select |

### `visibleMovies`

| Site | Reason |
|---|---|
| Atomic swap | `atomic-generation-swap` |
| First page | `category-first-page-load` / `…-replace` |
| Page error | `category-first-page-error` (clears) |
| Pagination | `pagination-append` |

### `categories` / empty rail

| Site | Effect |
|---|---|
| Pending / repairing | `setCategories([])` → **MoviePosterGrid unmounts** (`MoviesScreen` gate `categories.length > 0`) |
| Merge after load | `mergeCategoriesPreservingCounts` |
| Atomic ready | replace/merge warmed categories |
| Load error | `[]` |

### `loadStatus`

| Value | Typical cause |
|---|---|
| `loading` | pending, repairing, page start, catalog-not-ready, selectCategory |
| `ready` | page with items / atomic swap with items |
| `empty` | completed zero-result category or empty rail after ready |
| `error` | page/category failure / no data source |

### Reload / sync triggers

| Trigger | Effect |
|---|---|
| Bundle activate | hydrate + `syncCatalog` |
| Sparse repair | force full dump + `bundle.syncCatalog()` |
| `subscribeMovieCategoriesUpdated` | `loadCategories()` |
| `subscribeMovieCatalogReady` | atomic rail + page commit |
| `reload()` / `reloadToken` | page effect re-run |
| Hide-smart settings toggle | `loadCategories()` |
| Count / smart / library / sync phase | smart count refresh; possible smart grid reload |

### `MoviePosterGrid` remount / unmount

| Cause | Notes |
|---|---|
| `categories.length === 0` | Full unmount — strongest “movies disappeared” UX |
| FlatList `key={columns}` | Remount on column layout change only |
| New `movies` array identity | Content recycle, not component remount |
| No category/generation `key` on grid | Intentional stability |

---

## 4. Dependency graph

```text
providerCredentialStore
  → providerStore.prepare/activate
  → providerBundle.createRepositoryBundle(XtreamClient)
  → activateRepositoryBundle
       → hydrateProviderLibraryCaches
       → scheduleProviderCatalogSync
            → runMovieCatalogSync
                 → beginCatalogSync (gen N)
                 → writeCategories → publishMovieCategoriesUpdated
                 → VOD capability probe/cache
                 → native decode → writeItems
                 → [sparse?] fail N + full dump N+1
                 → finishCatalogSqliteMediaSync
                      → validateMoviesCategoryDistribution
                      → completeCatalogSync (activate)
                 → notifyMovieCatalogReady(N)

useMoviesScreenModel
  → SqliteMovieDataSource ∘ SmartMovieDataSource
  → getCategories:
       resolveMoviesCatalogReadiness
       repairDegradedMoviesCatalogIfNeeded? → syncCatalog
       getCatalogCategoryCounts(readable gen)
       filterInteractive → lastValid cache
  → resolveMoviesInitialCategory → selectedCategoryId
  → getMoviesPage(pinned gen) → visibleMovies
  → MoviesScreen → MoviePosterGrid iff categories.length > 0
```

---

## 5. Concurrent / ordering hazards

1. **Category metadata for N+1** can publish while items for N remain readable (`publishMovieCategoriesUpdated` during sync). Stage 4.2E pins interactive reads to item-readable gen; readiness diagnostics may still log ahead.
2. **Series and Movies sync** run on separate coordinator keys; category/item writers share SQLite mutex pressure.
3. **Atomic swap vs page effect** race mitigated by `atomicBrowseCommitRef`, but a failed async commit leaves loading.
4. **Repair path** clears last-valid cache and returns `[]` — intentional blanking until next ready event.
5. **Multiple `loadCategories` callers** (categories-updated, settings, mount) can reorder with catalog-ready.

---

## 6. Open questions (need ONN evidence)

1. Exact ordering of `movie-categories-updated` vs first paint after install-over-update.
2. Whether `categories.length === 0` during repair is the dominant user-visible disappear mode vs empty page inside a mounted grid.
3. How often capability cache still forces a mid-session strategy flip after v4.
