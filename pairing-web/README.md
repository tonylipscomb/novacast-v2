# NovaCast pairing website

This is the standalone `/pair` website. It sends only the pairing code and provider form to the `pairing-submit` Edge Function. It does not use Supabase table access, browser local storage, or URL parameters for provider credentials.

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `VITE_PAIRING_API_URL` to the deployed Supabase functions base URL and `VITE_SUPABASE_ANON_KEY` to the public anon key. Configure the TV with the same values plus `EXPO_PUBLIC_NOVACAST_PAIRING_WEBSITE_URL`.

## Netlify

Build command: `npm run build`

Publish directory: `dist`

Environment variables: `VITE_PAIRING_API_URL`, `VITE_SUPABASE_ANON_KEY`

The `public/_redirects` file keeps `/pair?code=...` on the SPA route.
