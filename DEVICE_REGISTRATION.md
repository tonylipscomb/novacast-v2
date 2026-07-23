# NovaCast device registration foundation

This phase adds a stable installation identity underneath the existing provider-pairing system.

## Identity model

```text
Installation identity
├── device_id — stable random UUID (internal; users do not type or see this for pairing)
├── device_secret — proves possession of this TV
├── public device code — NC-XXXX-XXXX for activation/admin only
├── device name / platform / app version
└── last seen

Temporary pairing session
├── pairing code — short user-facing code (for example K7P4MX)
├── device_id — links the code to the installation
├── expiration
├── status
└── used_at

Provider assignment (local in this phase)
├── stored securely on the TV after redeem
├── restart keeps identity + provider
└── managed central provider assignment remains a later phase
```

### Main rule

> The device ID identifies the installation. The pairing code temporarily connects a person on the website to that installation.

Users enter only the temporary pairing code on NovaCast Connect. The website never addresses the TV by device ID. The TV authenticates privileged requests with its device credential so knowing a public identifier alone cannot impersonate the television.

## Identifiers

- Installation / device UUID: private stable ID retained across updates.
- Device credential: random secret stored only in Expo SecureStore. The backend stores an HMAC hash.
- Public device code (`NC-XXXX-XXXX`): used for beta activation and admin support. Not shown on the normal pairing screen.
- Pairing code: temporary provider-pairing code. Separate from the permanent device identity and from beta invitation codes.
- Invitation code: limited-use activation authority. Only its hash is stored by Supabase.

## Pairing flow

1. TV creates or restores `device_id` + `device_secret` and registers with Supabase.
2. TV requests a temporary pairing session. Supabase stores the short code against that device.
3. User enters the pairing code on Connect and submits provider credentials to the Edge Function.
4. Backend validates the provider, completes the session, and marks the code used.
5. TV polls with device credentials, redeems the session, stores the provider locally, and continues into the app.

A normal restart keeps device identity, secret, and provider assignment. It must not force a new pairing code.

## Reset actions

### Reset Pairing

Keeps `device_id` and `device_secret`. Removes local provider assignment, invalidates active pairing sessions, and opens a fresh pairing code. Use this when changing providers or retesting pairing.

Portal path: **Manage Providers → Reset Pairing**.

### Factory Reset NovaCast

Deletes local device identity, secret, providers, and pairing state. The next launch registers as a new device. Clearing Android app data has the same identity effect.

Portal path: **Diagnostics → Factory Reset NovaCast**.

Old remote device rows may remain until admin cleanup or stale-device retention policy is added.

## Rollout behavior

Registration and status checks are enabled by default. `EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED` and the backend `DEVICE_ACTIVATION_REQUIRED` flag default to `false`, so personal-provider pairing continues while the foundation is observed.

When activation is required, the Hub can present an activation screen that uses the public `NC-` code and `/activate`. The private device credential is never displayed or sent to the Connect website.

## Backend

The migration `supabase/migrations/20260723090000_device_registration_activation.sql` adds `devices`, `beta_invites`, `device_activations`, and the nullable `pairing_sessions.device_id` association. RLS denies direct client access; Edge Functions use the service role.

TV authenticated requests send:

- `x-novacast-device-id`: public device code (`NC-…`) for lookup
- `x-novacast-device-secret`: private device credential

Pairing create binds `pairing_sessions.device_id` when the TV is authenticated. Connect QR/links for pairing carry only the temporary code.

## Deployment order

1. Set `DEVICE_SECRET_HASH_SECRET` to a new server-only random value.
2. Apply the migration with `supabase db push`.
3. Deploy the device and pairing functions.
4. Deploy the TV and Connect builds with activation-required disabled.
5. Verify registration, pairing, reset pairing, revoke/restore, and invite limits.
6. Enable activation-required only for the intended beta build.
