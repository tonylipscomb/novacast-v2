# NovaCast Connect website

Standalone Vite/React site for NovaCast Connect. Deployed at
`https://novacast-connect.netlify.app/` (future custom domain:
`https://connect.novacastapp.com/`).

Routes:

| Path | Purpose |
| --- | --- |
| `/` | Connect homepage |
| `/download` | APK download + Downloader instructions |
| `/pair` | Provider pairing form |
| `/activate` | Device activation |
| `/admin` | Cloud administration |

Legacy TV QR codes that open `/?code=ABCDEFGH` redirect to `/pair?code=ABCDEFGH`.

The pairing form sends only the pairing code and provider fields to the
`pairing-submit` Edge Function. It does not use Supabase table access, browser
local storage, or URL parameters for provider credentials.

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Required env:

- `VITE_PAIRING_API_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL` (admin)

Optional:

- `VITE_PUBLIC_DOWNLOAD_URL` — visible direct-download text on `/download`
  (button always uses relative `/downloads/novacast.apk`)

## Netlify

Keep the existing site settings:

- Base directory: `pairing-web`
- Build command: `npm run build`
- Publish directory: `dist`

Environment variables: `VITE_PAIRING_API_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_SUPABASE_URL`, optional `VITE_PUBLIC_DOWNLOAD_URL`.

## Permanent APK URL

`public/_redirects` (and root `netlify.toml`) map:

```text
/downloads/novacast.apk → GitHub releases/latest/download/novacast.apk
```

Do not commit APK binaries into this folder. Downloader code `6275368` stays
stable because the asset is always named `novacast.apk` on the latest
non-prerelease GitHub Release.
