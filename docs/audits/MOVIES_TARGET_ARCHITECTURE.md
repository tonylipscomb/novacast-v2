# Movies Target Architecture (Recommended)

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Design only — do not implement in this audit.

Goal: behave like a normal SQLite-backed IPTV VOD app — background sync, immutable generations, atomic activation, network-independent reopen, Back that closes overlays without rebuilding browse.

---

## 1. Target principles

1. **Background provider synchronization** — sync never blocks first paint of a healthy snapshot.  
2. **Immutable catalog generations** — writes only to non-active gen N+1.  
3. **One atomic active catalog snapshot** — UI reads only `{generation, categories, counts, total}`.  
4. **SQLite-first browsing** — categories and posters from SQLite; network only for sync/enrichment.  
5. **Previous-generation preservation during refresh** — N stays interactive until N+1 activates.  
6. **Transactional activation** — categories + counts + item readability flip together.  
7. **Nonzero rail from active item rows only** — metadata existence ≠ interactive category.  
8. **Page queries pinned to active snapshot generation**.  
9. **Network-independent screen reopen** — reopen uses snapshot/SQLite only.  
10. **Bounded repair/migration** — once per degraded generation; never blank a healthy snapshot without a replacement ready (except first install).

---

## 2. Recommended components

```text
MoviesCatalogSyncService      (providers + catalog writer; already mostly providerCatalogSync)
MoviesCatalogRepository       (SQLite reads: snapshot, page, detail local row)
MoviesCatalogSnapshotStore    (active snapshot + preserving previous)
MoviesBrowseController        (selection, page window, loadStatus) — thin
MoviesScreen                  (layout + TV chrome only)
MovieDetailLayer              (overlay + focus return policy)
TvBackDispatcher              (shared Back layers)
```

---

## 3. What can remain

| Keep | Why |
|---|---|
| `catalog_*_v2` schema + generation columns | Solid durable model |
| `beginCatalogSync` / `completeCatalogSync` / `failCatalogSync` | Generation lifecycle |
| Native `streamXtreamCategoryDecode` | Performance |
| VOD capability tri-state (v4) + full-dump strategy | Correct Xtream ingest |
| Distribution validation at activation | Prevent sparse activate |
| `MoviePosterGrid` / `MoviePosterCard` UI | Presentation OK |
| Compact `MovieDetailOverlay` visual design | Out of scope to redesign |
| Unified player | Playback boundary |

---

## 4. What should be consolidated

| Consolidate into | From |
|---|---|
| `MoviesCatalogSnapshotStore` | readiness decision, lastValid cache, read snapshot builder, interactive filter, repair UI flags |
| `MoviesCatalogRepository` | SqliteMovieDataSource read methods; getCatalogCategoryCounts usage; page pin |
| `MoviesBrowseController` | most of `useMoviesScreenModel` category/page/selection logic |
| Sync service façade | capability probe, strategy, sparse abort, checkpoint, force full-dump |

---

## 5. What should be removed or demoted

| Remove / demote | Reason |
|---|---|
| Treating `movie-categories-updated` as browse reload | Metadata ≠ ready |
| Clearing interactive categories to `[]` while a healthy snapshot exists | Causes grid unmount / “movies disappeared” |
| Competing count authorities without a single resolver | Index vs SQLite merge races |
| Stage 3D scroll machine on **normal** detail close | Overlay should not re-scroll when card mounted |
| Per-screen BackHandler priority snowflakes | Replace with TvBackDispatcher |
| Duplicate generation fields driving UI (`categoriesGeneration` from syncing stream) | Snapshot has one generation |

---

## 6. What should leave `useMoviesScreenModel`

Move out:

- Catalog readiness / repair scheduling  
- Atomic generation activation orchestration  
- Category count merge / smart refresh orchestration (keep only UI binding)  
- Deep knowledge of sync events  

Keep:

- Thin binding: selectedCategoryId, visibleMovies window, search query mode, sort option  
- Calls into BrowseController / SnapshotStore  

---

## 7. What should leave `MoviesScreen`

Move out:

- Stage 3D multi-phase close state machine → `MovieDetailLayer` / focus policy module  
- BackHandler registration → `useTvBackLayer`  
- Catalog-ready side effects → controller  

Keep:

- Composition of rail, grid, overlay, loaders  
- Wiring focus refs to grid  
- Presentational layout  

---

## 8. Snapshot contract

```ts
type MoviesActiveCatalogSnapshot = {
  providerId: string;
  generation: number; // categories === items === readable
  categories: MovieCategory[]; // interactive only
  totalMovieCount: number;
  activatedAt: number;
  status: 'active' | 'preserving' | 'repairing-wait';
};
```

Rules:

- Reject / ignore snapshots where generation fields disagree.  
- Preserving: UI continues to expose previous `active` snapshot while N+1 syncs.  
- Activate: swap snapshot pointer atomically; then optionally prefetch first page for current selection.  
- Repair: if no healthy snapshot, show “Repairing…”; if healthy exists, keep showing it unless integrity forbids.

---

## 9. Ordered remediation phases (design)

| Phase | Work | Risk |
|---|---|---|
| P0 | Snapshot store + stop blanking healthy rail during repair/sync | Medium — touches disappear path |
| P1 | Categories-updated does not reload interactive rail | Low–medium |
| P2 | Simplify detail close to snapshot-return (no scroll if mounted) | Medium — TV focus fragile |
| P3 | TvBackDispatcher shared layers | Medium — cross-app |
| P4 | Thin model/screen; move sync/UI orchestration to services | Higher — large refactor |
| P5 | Remove obsolete recovery branches once P0–P2 prove stable | Low after soak |

---

## 10. Tests required before implementation

- Snapshot pin: preserving N while syncing N+1 never exposes N+1 categories.  
- Activation atomicity: no mixed-generation render.  
- Repair with healthy previous: rail stays populated.  
- Repair without previous: repairing UI, not false empty.  
- Detail close: no scrollToOffset when target mounted; focus returns.  
- Detail close fallback: virtualized-away card uses one restore.  
- Back dispatcher: single consumer; playback > detail > search > route.  
- Series/Live unchanged contracts (golden Back order tests).  
- Existing stage4e / stage3d1 / readiness suites as regression baseline.
