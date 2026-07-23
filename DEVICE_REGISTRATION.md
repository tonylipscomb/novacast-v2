# NovaCast device registration foundation

This phase adds a stable installation identity and optional activation layer underneath the existing provider-pairing system.

## Identifiers

- Installation ID: private UUID retained across updates. Existing `novacast.installation.id` values migrate into the device identity store.
- Device credential: 32-byte random secret stored only in Expo SecureStore. The backend stores an HMAC hash.
- Device ID: public `NC-XXXX-XXXX` code returned by `device-register`; safe to show on the TV.
- Pairing code: temporary eight-character provider-pairing code. It is separate from both the Device ID and beta invitation code.
- Invitation code: one-time/limited-use beta activation authority. Only its hash is stored by Supabase.

## Rollout behavior

Registration and status checks are enabled by default. `EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED` and the backend `DEVICE_ACTIVATION_REQUIRED` flag default to `false`, so existing personal-provider pairing continues to work while the foundation is observed.

When activation is required on both sides, the Hub presents an activation screen with the public Device ID and QR link to `/activate`. The private device credential is never displayed or sent to the Connect website.

Previously active devices may use the cached activation response during a short, 24-hour offline grace period. A server-reported revoked/blocked status overrides the cache. Never-activated devices do not self-activate offline.

## Backend

The migration `supabase/migrations/20260723090000_device_registration_activation.sql` adds `devices`, `beta_invites`, `device_activations`, and the nullable `pairing_sessions.device_id` association. RLS denies direct client access; Edge Functions use the service role and expose sanitized responses.

TV functions: `device-register`, `device-status`, `device-heartbeat`, `device-activate`.

Admin functions require a Supabase access token for a user whose `app_metadata.role` is `admin`: `admin-devices`, `admin-device-action`, and `admin-invites`. The Connect site provides a mobile-safe `/admin` dashboard using Supabase Auth and does not persist the access token.

## Deployment order

1. Set `DEVICE_SECRET_HASH_SECRET` to a new server-only random value.
2. Apply the migration with `supabase db push`.
3. Deploy the device and admin functions.
4. Deploy the TV and Connect builds with activation-required disabled.
5. Register and activate test devices, then verify status, heartbeat, invite limits, revoke, and restore.
6. Enable activation-required on the backend and TV only for the intended beta build.

Provider credentials, provider URLs, installation UUIDs, and device secrets are not part of the device-management API responses.
