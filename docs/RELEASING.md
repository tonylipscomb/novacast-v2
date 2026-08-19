# NovaCast Android releasing

This repository builds installable Android release APKs in GitHub Actions
(`.github/workflows/android-beta.yml`).

Permanent public download (via NovaCast Connect redirects):

```text
https://novacast-connect.netlify.app/downloads/novacast.apk
â†’ https://github.com/tonylipscomb/novacast-v2/releases/download/beta-latest/novacast.apk
```

Downloader code: `6275368` (points at that permanent URL).

## Verified build facts

| Item | Value |
| --- | --- |
| Package manager | `package-lock.json` â†’ `npm ci` |
| Native project | `android/` is generated (gitignored); CI runs `npx expo prebuild --platform android` |
| Gradle wrapper | `android/gradlew` (after prebuild) |
| Release APK path | `android/app/build/outputs/apk/release/app-release.apk` |
| Published asset name | **`novacast.apk`** (+ `novacast.apk.sha256`) |
| Java | Temurin **17** (Gradle 9.x / Expo Android toolchain) |
| Default signing | Expo `assembleRelease` signs with the generated **debug** keystore unless production keystore secrets are set |

Required GitHub secret for Expo CLI auth:

- `EXPO_TOKEN`

Optional production signing secrets (never commit these):

- `NOVACAST_KEYSTORE_BASE64`
- `NOVACAST_KEYSTORE_PASSWORD`
- `NOVACAST_KEY_ALIAS`
- `NOVACAST_KEY_PASSWORD`

When `NOVACAST_KEYSTORE_BASE64` is set, the workflow decodes
`android/app/novacast-release.jks`, runs
`scripts/ci-configure-android-release-signing.mjs` to wire release signing on
the generated Gradle project, and always deletes the temporary keystore
afterward. Secret values are never printed.

## Closed-beta activation secrets

Required repository secrets:

- `EXPO_PUBLIC_NOVACAST_PAIRING_API_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_NOVACAST_PAIRING_WEBSITE_URL`

## Main rolling beta (updates `beta-latest`)

Every push to `main` (and manual `workflow_dispatch` from `main`) builds a
release APK, uploads the workflow artifact, and publishes/replaces the
prerelease GitHub Release `beta-latest`.

That moves:

```text
https://github.com/tonylipscomb/novacast-v2/releases/download/beta-latest/novacast.apk
```

and therefore the Netlify permanent URL used by Downloader.

Artifact / rolling-release contents:

```text
novacast.apk
novacast.apk.sha256
```

The versioned copy `NovaCast-beta-main-<run_number>.apk` stays on the workflow
artifact only. It is not attached to `beta-latest`, so the public download
name stays `novacast.apk`.

## Public versioned release (tags `v*`)

Push an annotated version tag that does **not** contain `beta`, `alpha`, or `rc`:

```bash
git tag -a v1.0.0 -m "NovaCast stable release"
git push origin v1.0.0
```

The workflow will:

1. Authenticate Expo with `EXPO_TOKEN`
2. Build a signed Android release APK
3. Rename/copy it to exactly `novacast.apk`
4. Generate `novacast.apk.sha256`
5. Create/update the GitHub Release for that tag
6. Attach `novacast.apk`, `novacast.apk.sha256`, and a versioned copy
7. Leave a non-prerelease tag as a **full release** so GitHub `/releases/latest` still points at the newest stable version tag

Versioned tags do **not** change the Connect/Downloader URL. That URL always
follows `beta-latest`.

## Public prerelease / beta tag

Tags containing `beta`, `alpha`, or `rc` are published as GitHub **prereleases**.
They attach the same asset names for that tag, but they do **not** move
`/releases/latest`, and they do **not** replace `beta-latest`.

```bash
git tag -a v1.1.0-beta.1 -m "NovaCast beta"
git push origin v1.1.0-beta.1
```

## First rolling-beta publish checklist

1. Confirm GitHub secrets: `EXPO_TOKEN`, pairing env secrets, optional keystore secrets.
2. Confirm Netlify site still uses base `pairing-web`, build `npm run build`, publish `dist`.
3. Merge Connect website changes so `/downloads/novacast.apk` redirects to `beta-latest`.
4. Merge this workflow change to `main` and wait for **Android Beta APK** success.
5. Verify GitHub Release `beta-latest` includes `novacast.apk` and `novacast.apk.sha256`.
6. Verify `https://novacast-connect.netlify.app/downloads/novacast.apk` downloads the APK.
7. On a TV, open Downloader â†’ enter `6275368` â†’ install.

Do not commit APK binaries, keystores, Expo tokens, or signing passwords.

