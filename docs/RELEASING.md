# NovaCast Android releasing

This repository builds installable Android release APKs in GitHub Actions
(`.github/workflows/android-beta.yml`).

## Verified build facts

| Item | Value |
| --- | --- |
| Package manager | `package-lock.json` → `npm ci` |
| Native project | `android/` is generated (gitignored); CI runs `npx expo prebuild --platform android` |
| Gradle wrapper | `android/gradlew` (after prebuild) |
| Release APK path | `android/app/build/outputs/apk/release/app-release.apk` |
| Java | Temurin **17** (Gradle 9.x / Expo Android toolchain) |
| Default signing | Expo `assembleRelease` signs with the generated **debug** keystore, so CI produces an installable APK without committing private keys |

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

Build flag baked into CI:

```text
EXPO_PUBLIC_MOVIES_SQLITE_READS=true
```

## Main test build (artifact only)

Every push to `main` (and manual `workflow_dispatch`) builds a release APK and
uploads it as a workflow artifact. It does **not** create a public GitHub Release.

```bash
git add -A
git commit -m "Description"
git push origin main
```

Artifact naming:

```text
NovaCast-beta-main-<run_number>.apk
```

### Where to find Actions artifacts

1. Open the repository on GitHub
2. Go to **Actions** → **Android Beta APK**
3. Open the run for your commit
4. Download the artifact named `NovaCast-beta-main-<run_number>`

Artifacts are retained for **30 days**.

## Public beta / version release (GitHub Release)

Push an annotated version tag matching `v*`:

```bash
git tag -a v0.9.0-beta.4 -m "NovaCast beta release"
git push origin v0.9.0-beta.4
```

The workflow will:

1. Build the same release APK
2. Rename it to `NovaCast-v0.9.0-beta.4.apk`
3. Upload the Actions artifact
4. Create or update the GitHub Release for that tag
5. Attach the APK and generate release notes
6. Mark the release as a **prerelease** when the tag contains `beta`, `alpha`, or `rc` (case-insensitive)

If the release already exists, the APK is uploaded with `--clobber` instead of
failing.

### Where to find GitHub Releases

1. Open the repository on GitHub
2. Go to **Releases**
3. Open the tag (for example `v0.9.0-beta.4`)
4. Download `NovaCast-<tag>.apk`

### Permanent / latest APK URLs

Tagged asset URL (always valid for that tag):

```text
https://github.com/<owner>/<repo>/releases/download/<tag>/NovaCast-<tag>.apk
```

Example:

```text
https://github.com/<owner>/<repo>/releases/download/v0.9.0-beta.4/NovaCast-v0.9.0-beta.4.apk
```

GitHub’s “latest” alias (latest **non-prerelease** release only):

```text
https://github.com/<owner>/<repo>/releases/latest
```

Notes:

- Tags containing `beta` / `alpha` / `rc` are published as prereleases, so they
  do **not** move `/releases/latest`.
- Prefer the explicit `/releases/download/<tag>/...` URL for beta installs.
- Main-branch APKs live only under **Actions → Artifacts**, not Releases.

## Manual workflow run

In GitHub: **Actions** → **Android Beta APK** → **Run workflow**.

Manual runs on `main` behave like a main push (artifact only, no Release).

## Local parity (optional)

```bash
npm ci
npx expo prebuild --platform android --non-interactive
cd android
./gradlew app:assembleRelease --no-daemon
```

APK output:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Do not commit `android/`, `.env*.local`, keystores, passwords, or provider credentials.
