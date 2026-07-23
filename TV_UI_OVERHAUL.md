# NovaCast V2 TV UI Overhaul

## Implemented

- Reliable two-stage splash flow:
  - native NovaCast planet mark
  - full-screen `splash.png` brand splash
  - timed fade with a hard fallback so startup cannot remain stuck
- Fixed TV safe-area spacing and overscan margins.
- Added a permanent navigation rail with one-line labels and predictable focus states.
- Rebuilt Home with local mock content and no network image dependencies.
- Rebuilt Live TV with:
  - fixed navigation rail
  - category list
  - channel list
  - fake live preview artwork
  - current/next/following mini guide
- Added consistent mock screens for Movies, Series, Search, Guide, and Settings.
- Reworked pairing with a bundled local QR image and a development-only `Preview TV UI` action.
- Removed layout-changing focus scale from shared buttons/cards.

## Validation

- `npm run typecheck` passes.
- `npm run lint` passes.
- Android Expo export passes.
- Android native project regenerated from `app.json` so the splash configuration is applied.

## Content Hub Architecture (Smarters-style)

The Home/Content Hub must never initialize the Movies or Series repositories simply to display title totals.

Instead, maintain a lightweight cached summary generated during provider sync.

Immediately after startup, the Home screen should display:

```
MOVIES
──────────────
32,482 Titles
Press OK

SERIES
──────────────
8,941 Titles
Press OK

LIVE TV
──────────────
18,233 Channels
Press OK
```

These counts must appear before the user enters any section. Counts come from a cached `ProviderLibrarySummary` and are available instantly on every launch. If a provider refresh is occurring, continue displaying the cached totals until the new summary is ready. Do not temporarily display zero while refreshing.

### Category Counts

Provider category counts and Smart Category counts are precomputed during provider synchronization.

When entering Movies or Series, the category sidebar should immediately display:

```
Discover (24)
Action (3,218)
Comedy (1,107)
Drama (2,934)
Recently Added (287)
Trending (150)
```

without scanning the full catalog. Category counts come from a persisted `CategoryCountIndex`. Never calculate category totals during screen rendering — the UI reads cached counts and renders immediately.

### Instant Boot Flow

```
Provider Sync
        │
        ▼
Build Library Summary
        │
        ▼
Build Category Counts
        │
        ▼
Save Persisted Index (AsyncStorage)
        │
        ▼
READY
```

Every time the user enters Movies or Series:

```
Read cache
↓
Show Categories
↓
Show Counts
↓
Show First 20 Posters
↓
Background refresh if needed
```

No filtering 30,000 movies on entry. No rebuilding smart categories on screen entry. Treat Movies and Series like apps that boot instantly.

## Test on Fire TV

```powershell
cd C:\Users\tonyl\Desktop\novacast-v2
npm install
npx expo prebuild --platform android
cd android
.\gradlew assembleDebug

C:\platform-tools\adb.exe -s 10.0.0.179:5555 install -r ".\app\build\outputs\apk\debug\app-debug.apk"
```

For the debug client, keep Metro running:

```powershell
cd C:\Users\tonyl\Desktop\novacast-v2
npx expo start --dev-client
C:\platform-tools\adb.exe -s 10.0.0.179:5555 reverse tcp:8081 tcp:8081
```
