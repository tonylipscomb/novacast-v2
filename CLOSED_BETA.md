# NovaCast Closed Beta (Managed Device Platform)

This document describes the closed-beta evolution layered on top of the existing
device registration, pairing, and provider architecture. Pairing is **not**
removed — it is bypassed while `EXPO_PUBLIC_CLOSED_BETA_MODE=true`.

## Tester experience

```
Install → Launch → Enter invitation code → Backend assigns provider
→ TV downloads provider securely → Library sync → Home → Watch
```

No QR pairing, no Connect provider form, no Xtream credentials on the TV.

## Feature flags

| Flag | Closed beta value | Purpose |
|------|-------------------|---------|
| `EXPO_PUBLIC_CLOSED_BETA_MODE` | `true` | Enables StartupGate invite flow |
| `EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED` | implied true | Blocks until activated |
| `EXPO_PUBLIC_MANAGED_BETA_PROVIDER_ENABLED` | implied true | Downloads assigned provider |
| `EXPO_PUBLIC_PERSONAL_PROVIDER_PAIRING_ENABLED` | implied false | Hides personal pairing |

Backend should also set `DEVICE_ACTIVATION_REQUIRED=true` on Edge Functions.

## Deploy order

1. Apply migration `20260723120000_closed_beta_managed_platform.sql`
2. Deploy Edge Functions:
   - `device-activate`, `device-status`, `device-heartbeat`
   - `device-provider-assignment` (new)
   - `admin-invites`, `admin-devices`, `admin-device-action`
   - `admin-providers`, `admin-commands`, `admin-dashboard` (new)
3. In Admin (`/admin`):
   - Create a managed provider package (encrypted credentials)
   - Create invitations bound to that provider (`us_only`, duration hours)
4. Ship TV build with `EXPO_PUBLIC_CLOSED_BETA_MODE=true`
5. Give each tester an invitation code only

## Architecture preserved

- Device identity / secret / heartbeat
- Pairing create / submit / redeem / cancel (inactive during beta)
- Provider store + catalog sync + regional pipeline
- Reset Pairing keeps identity; Factory Reset wipes identity

## Content policy

`ContentPolicyService` is the single gate. Category sorting facades in
`usAmericanSort` apply `filterContentByPolicy` before display. Default closed
beta policy: **US-only** (blocks named foreign regions + adult; does not treat
“English” as US).

## Admin portal

`/admin` evolves toward NovaCast Cloud:

- Dashboard (online/offline/activated/expired/queue)
- Devices (extend +24h/+72h/+7d, refresh, diagnostics, revoke)
- Invitations (provider + duration + policy)
- Providers (encrypted managed packages)

Remote commands are queued in `device_commands` and executed on heartbeat.

## Expiration

Expired devices keep identity, provider, library, and preferences. Access is
disabled and `BetaExpiredScreen` is shown until an admin extends activation.
