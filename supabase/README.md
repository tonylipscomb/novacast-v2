# NovaCast pairing backend

The TV and pairing website call the Edge Functions in `functions/`. No client has direct access to pairing or provider tables.

## Required Supabase secrets

Set these with `supabase secrets set` or the Supabase dashboard. Never place them in Expo or Vite public variables.

```text
PAIRING_CODE_SECRET=<long random secret>
INSTALLATION_HASH_SECRET=<long random secret>
PROVIDER_ENCRYPTION_KEY=<32-byte base64 or 64-character hex key>
PAIRING_WEB_URL=https://pair.example.com
PAIRING_WEB_ORIGIN=https://pair.example.com
ALLOW_HTTP_PROVIDER=true
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The service-role key must remain server-only.

## Deploy

```powershell
supabase db push
supabase functions deploy pairing-create
supabase functions deploy pairing-status
supabase functions deploy pairing-submit
supabase functions deploy pairing-redeem
supabase functions deploy pairing-cancel
supabase functions deploy device-register
supabase functions deploy device-status
supabase functions deploy device-heartbeat
supabase functions deploy device-activate
supabase functions deploy admin-devices
supabase functions deploy admin-device-action
supabase functions deploy admin-invites
supabase secrets set PAIRING_CODE_SECRET=... INSTALLATION_HASH_SECRET=... PROVIDER_ENCRYPTION_KEY=... PAIRING_WEB_URL=... PAIRING_WEB_ORIGIN=...

Device foundation secrets/configuration:

```text
DEVICE_SECRET_HASH_SECRET=<separate random secret>
DEVICE_ACTIVATION_REQUIRED=false
```

Keep `DEVICE_ACTIVATION_REQUIRED=false` during the compatibility rollout. Set it to `true` only after device registration and the Connect activation flow have been verified.
```

Schedule `select public.cleanup_pairing_sessions();` daily using Supabase scheduled jobs or an external scheduler. The cleanup function is service-role-only.

The provider validator rejects credentials in URLs, private/loopback targets, unsafe redirects, oversized responses, invalid Xtream responses, and requests that exceed its timeout. HTTP providers are allowed by default; set `ALLOW_HTTP_PROVIDER=false` to disable them.
