# Movies State Ownership Audit

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Investigation only.

---

## 1. Source inventory

| Source | Location | Durability | Role |
|---|---|---|---|
| Provider category metadata (Xtream) | `getVodCategories` / sync setup | ephemeral fetch | Seed for `catalog_categories_v2` |
| Provider count hints | sync `movieHintCounts` | ephemeral | Probe selection only |
| `catalog_categories_v2` | SQLite | durable, generation-scoped | Names, sort_order, metadata presence |
| `catalog_items_v2` | SQLite | durable, generation-scoped | Authoritative movie rows + category_id |
| `catalog_sync_state` | SQLite | durable | Current attempt status/generation/phase |
| `catalog_providers.catalog_generation` | SQLite | durable | Last **activated** generation pointer |
| Category count index | `categoryCountIndexStore` | AsyncStorage + memory | Progressive / non-SQLite hint |
| Smart category cache | `smartCategoryCacheStore` | AsyncStorage | Discover smart rails |
| Movie catalog index | `MovieCatalogIndex` | in-memory | Smart build when enabled |
| VOD filter capability | AsyncStorage v4 | durable, 7d TTL | Sync strategy |
| Sync checkpoint | AsyncStorage v15 | durable | Resume / skip complete |
| Force full-dump map | `forceMoviesFullDumpByProvider` | in-memory | One-shot repair |
| Last-valid SQLite rail | `lastValidSqliteCategoriesByProvider` | in-memory | Preserve during refresh |
| Screen memory | `moviesScreenMemory` | memory (session) | selectedCategoryId / focus / selection |
| Repair bound | `@novacast/movies-sparse-repair/v1/` | AsyncStorage | Once per provider+generation |
| Repair UI flags | `repairScheduled` / `repairingUiByProvider` | in-memory | Hide rail while repairing |
| Hook React state | `useMoviesScreenModel` | render lifetime | Live UI |
| Hook refs | selectedCategoryIdRef, visibleMoviesRef, atomicBrowseCommitRef, requestGenerationRef, … | render lifetime | Stale-request / atomic skip |
| Sync events | catalog-ready, categories-updated, sync-phase | in-memory pub/sub | UI refresh |

---

## 2. Authoritative owner per value

| Value | Authoritative source | Competitors | Conflict mode |
|---|---|---|---|
| Which movies exist | Activated `catalog_items_v2` rows for readable gen | In-memory MovieCatalogIndex; live Xtream | Index is smart-only when enabled |
| Category names / order | `catalog_categories_v2` for **same** readable gen | Syncing N+1 category stream | UI must ignore syncing metadata (4.2E pin) |
| Interactive rail membership | Grouped item counts > 0 on readable gen + `filterInteractiveMovieCategories` | Metadata existence; count index; smart wrap | Zeros hidden; metadata alone must not imply content |
| `category.itemCount` | GROUP BY on `catalog_items_v2` | count index; page totalCount; smart cache | Model `mergeCategoriesPreservingCounts` can prefer previous |
| `totalMovieCount` | COUNT(*) items for readable gen | All Movies synthetic count; index sums | SQLite total wins for SQLite path |
| `readableGeneration` / `itemsGeneration` | `resolveReadableCatalogGeneration` | `catalog_providers.catalog_generation` if ghost-empty | Prefer ready+rows; ignore empty ghosts |
| `categoriesGeneration` (diagnostic) | `resolveReadableCategoryGeneration` | Can be syncing N+1 | **Must not drive interactive rail** |
| Interactive pinned gens | Sqlite DS forces categories=items=readable | Readiness still reports raw category gen | Logs may show syncingCategoryGeneration separately |
| `activeProviderGeneration` | `catalog_providers.catalog_generation` | Readable may lag until activate | Preserve previous until complete |
| `syncingGeneration` | `catalog_sync_state.generation` while syncing | Readable N | Readiness → preserving-completed-generation |
| `selectedCategoryId` | User + `resolveMoviesInitialCategory` + memory | Atomic ready re-resolve; pending clears to `''` | Can jump on gen swap / zero filter |
| `visibleMovies` | Last successful page / atomic commit | Cleared on error; replaced on category change | Array identity changes often |
| `firstPageLoadGate` | Model local state | Atomic commit sets resolved token | Loader chrome only |
| `loadStatus` | Model local state | Many writers | Competing loading/empty/error transitions |

---

## 3. Competing authorities (flagged)

### Critical multi-authority

1. **Category rail membership** — metadata rows vs grouped item rows vs interactive filter vs smart wrapper.  
2. **Category counts** — SQLite GROUP BY vs count index vs merge-preserving logic.  
3. **Generation identity** — syncing category gen vs readable item gen vs active provider gen (three numbers in readiness).  
4. **Browse readiness** — `completeCatalogSync` / catalog-ready vs `movie-categories-updated` (metadata-only signal that still triggers `loadCategories`).  
5. **Selected category** — screen memory, previous React state, resolver, atomic swap, empty-pending clear.

### Generation mix surfaces

| Pair | Risk | Current mitigation | Residual |
|---|---|---|---|
| categoriesGen vs itemsGen | Rail from N+1, pages from N | Pin reads to item readable | Diagnostics / event ordering |
| syncing vs readable | Empty/incomplete N+1 flash | preserving + lastValid cache | Repair clears lastValid |
| capability strategy vs active catalog | Sparse ingest then repair blank | v4 inconclusive → full dump; once/gen repair | Repair empties rail by design |
| Snapshot vs live readable | Pin mismatch after activate | rebuild snapshot on apply | Misaligned → fall back to previous |

---

## 4. Why fixes cause disappearances (coupling matrix)

| Fix / system | Intended change | Indirect effects | Reload? | Checkpoint? | Selection? | Generation? | Clear page? | Effect deps? | Remount grid? | Event order? |
|---|---|---|---|---|---|---|---|---|---|---|
| Generation-safe reads | Query by sync_generation | Needs activate pointer | no | no | no | yes | no | no | no | no |
| Readiness barrier (4.2A/C) | Block gen-0 queries | `categories=[]`, loading | yes | no | clears | gates | yes (no page) | yes | **unmount** | waits ready |
| Sparse repair (4.2D) | Rebuild bad active gen | delete lastValid, repairing UI, force sync | **yes** | invalidate | clears | replace after | yes | yes | **unmount** | ready later |
| Capability / full-dump | Correct ingest | long sync; mid-abort | sync | may | no | new gen | during repair | no | via repair | categories-updated spam |
| Distribution validation | Reject sparse activate | complete-rejected keeps old | no | no | no | blocks new | no | no | no | no ready |
| Zero-category filter (4.2E) | Hide count=0 | rail shrink; selection fallback | no | no | **yes** | no | possible empty page | yes | no | no |
| Atomic swap (4.2E) | Commit rail+page together | loading then replace | soft | no | **yes** | yes | replace | skips page effect | no | ready-driven |
| Category-count apply | Show GROUP BY counts | merge/preserve races | loadCategories | no | maybe | no | no | yes | no | categories-updated |
| Smart categories | Discover rails | wrap/filter provider list | refresh | no | maybe | no | smart grid | yes | no | cache events |
| First populated selection | Avoid zero start | differs from “first metadata” | no | no | **yes** | no | avoids empty | no | no | no |
| Screen memory | Restore selection | can restore stale id | no | no | **yes** | no | if missing → re-pick | no | no | no |
| Detail overlay | Overlay browse | focus/phase machine | no* | no | no* | no | no* | many screen effects | no (intended) | Back order |
| Playback return | Close player | may start Stage 3D restore | no | no | no | no | no | yes | no | didJustClose |
| Search return | Close search | focus restore path | no | no | may | no | no | yes | no | Back order |

\*Unless a concurrent catalog-ready / repair fires while detail is open.

### Highest-risk disappear sequence

1. Active gen assessed sparse → repair returns `[]`, deletes lastValid.  
2. Model sets `categories=[]`, `selectedCategoryId=''`, `loadStatus='loading'`.  
3. `MoviePosterGrid` **unmounts** (`categories.length > 0` false).  
4. Posters return only after next successful `notifyMovieCatalogReady` atomic commit.

Secondary disappear modes:

- Readiness waiting-fresh-sync (gen 0) with empty categories.  
- Selection lands on empty category before 4.2E filter (historical).  
- Gen mix: categories from N+1 with zeros against item gen N (historical; pinned in 4.2E).

---

## 5. Event ownership

| Event | Publisher | Meaning (intended) | Dangerous if treated as |
|---|---|---|---|
| `movie-categories-updated` | writer after category upsert | Metadata preparing | Browse-ready / switch to syncing gen |
| `movie-catalog-ready` | sync after successful complete | Generation activated | Ignored / duplicate-filtered incorrectly |
| `catalog-sync-phase` | sync | UI chrome / smart refresh | Full rail rebuild from incomplete data |

---

## 6. Recommendations (design only)

1. Single **active catalog snapshot** object as the only UI authority for gens + categories + counts.  
2. `movie-categories-updated` must not call full interactive `loadCategories` during preserving; at most update a “syncing progress” channel.  
3. Never unmount the poster grid solely because repair started — keep last healthy snapshot until replacement activates (unless none exists).  
4. Collapse count index vs SQLite merge rules into one resolver.
