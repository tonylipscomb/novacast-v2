# NovaCast Performance & Navigation Pass — Validation Report

Date: 2026-07-24  
Scope: Movies, Series, Guide responsiveness on low-end Android TV  
Constraint honored: prior Focus Stabilization Pass behavior preserved (no undo)

---

## 1. Profile First (Before changes)

### Movies / Series — D-pad poster move
| Layer | Before |
|---|---|
| Screen React state on focus | **None** (already ref/memory-only) |
| Cards re-rendered | Focused + blurred only (local `isFocused`) |
| FlatList / parent on pure focus | No |
| Latent cost | Any parent re-render (pagination `loading`, category counts) defeated `memo` via **inline** `onFocus`/`onPress`/`registerRef` |

### Guide — D-pad program move
| Layer | Before |
|---|---|
| `setGuideState` | **Every** focus |
| `setHorizontalOffset` | Every sync / scroll |
| Visible channel rows | Full re-render |
| All programs in those rows | Full re-render + style recompute |
| Details panel | Immediate sync update |
| Category rail | Re-rendered with screen |

### requestTvFocus during browse
| Surface | Finding |
|---|---|
| Movies/Series D-pad | **No** `requestTvFocus` (native Pressable only) |
| Restore paths | Detail/search/playback close only — kept |

### Image pipeline
`TvRemoteImage` = RN `Image`, new `source` object each render, no pending counter.  
**expo-image migration deferred** — no measured decode win yet; Live/Guide already use expo-image elsewhere.

### Detail overlay (Movies/Series)
Already select/OK only — **not** focus-driven. No change required for §5 intent.

---

## 2. Changes shipped

### Eliminate focus-time work / defer secondary UI
- **Guide**: local focus chrome via `GuideLocalFocusPressable`
- **Guide**: details + `guideState` publish debounced **200ms** (`GUIDE_DETAILS_FOCUS_DEBOUNCE_MS`); cancelled on rapid moves
- **Guide**: horizontal sync is imperative (refs + memory) — **no** `setHorizontalOffset` per move
- **Movies/Series**: stable handler refs in grids; screen handlers wrapped in `useCallback`

### Poster grids
- Shared `TV_POSTER_LIST_TUNING` (`windowSize=5`, `maxToRenderPerBatch=8`, `updateCellsBatchingPeriod=50`)
- `getItemLayout` estimate for row jumps
- `removeClippedSubviews=false` retained (measured: clipping caused art/focus glitches on Android TV)
- Memo equality ignores unstable `registerRef`
- Pagination remains **append-only**, stable `item.id` keys

### Image
- `TvRemoteImage` memoized; stable `source` via `useMemo`; pending-image counter for HUD
- **No** expo-image migration (insufficient measured benefit vs risk)

### Navigation
- No redundant browse-time `requestTvFocus` removed (none existed)
- Restore call sites kept; HUD counts programmatic requests

### Perf HUD (dev-only)
- `EXPO_PUBLIC_TV_PERF_HUD=1` + `__DEV__`
- Overlay: UI FPS, screen, focus target/item, visible posters, poster renders/s, focus requests, preview queue, pending images, last render ms
- Mounted from root layout; **never** when flag off / production

---

## 3. After (expected render behavior)

| Action | Movies/Series | Guide |
|---|---|---|
| Move one poster/program | 2 cards / 1 cell local | Local cell only; details after 200ms idle |
| Pagination | Append; memo holds when handlers stable | Unchanged append |
| Open/close detail | Screen state as before | N/A |
| Search open/close | Restore focus only | N/A |

---

## 4. Largest reductions (ranked)

1. **Guide full-tree re-render on every D-pad step** → local chrome + debounced details  
2. **Guide horizontalOffset React updates** → imperative scrolls  
3. **Poster memo defeat on pagination/loading** → stable callbacks + ignore `registerRef` in equality  
4. **FlatList undertuning** → batching + getItemLayout  
5. **TvRemoteImage source churn** → memo + stable source  

---

## 5. Remaining bottlenecks

- Guide programs still **not** virtualized inside each horizontal row (all programs in a visible channel mount)
- Guide focus-graph `findNodeHandle` still runs when rows re-render for other reasons
- Poster `getItemLayout` is an estimate (title wrap variance)
- Category count sync / catalog subscriptions can still re-render Movies/Series screens (now less harmful)

---

## 6. Estimated device impact

| Device | Expected feel |
|---|---|
| ONN HD | Guide focus much closer to Live TV; Movies/Series pagination hitch reduced |
| Chromecast HD | Same; lower JS stalls during Guide scrubbing |
| Fire Stick Lite | Largest relative win on Guide (was worst offender) |
| Fire TV 4K Max | Headroom; smoother rapid D-pad |

---

## 7. Validation results

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm run lint` | **Blocked** by pre-existing ESLint 10 + `.eslintignore` config issue (not introduced by this pass) |
| `npm run test:smoke` | **Pass** (14/14) |

Enable HUD for device measurement:

```bash
EXPO_PUBLIC_TV_PERF_HUD=1
```

---

## 8. Explicit non-goals (honored)

- No UI redesign  
- No business-logic rewrite  
- No playback rewrite  
- No FlashList migration  
- No expo-image blanket migration without measured gain  
