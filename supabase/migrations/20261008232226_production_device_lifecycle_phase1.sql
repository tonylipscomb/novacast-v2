-- NovaCast production device lifecycle Phase 1.
--
-- This migration is intentionally conservative. It promotes only an existing
-- current activation for a device that is active or registered and has evidence of
-- production use. It does not create devices, alter provider assignments, or
-- delete activation history. Historical expires_at values are retained.
--
-- PREVIEW ONLY (run this SELECT separately before applying this migration):
-- WITH current_activation AS (
--   SELECT DISTINCT ON (device_id)
--     id, device_id, status, expires_at, activation_source
--   FROM public.device_activations
--   WHERE status IN ('active', 'expired')
--   ORDER BY device_id, (status = 'active') DESC, created_at DESC, id DESC
-- ), eligible AS (
--   SELECT d.id AS device_id, d.public_device_code, ca.id AS activation_id,
--          ca.status AS activation_status, ca.expires_at,
--          (d.last_seen_at >= now() - interval '30 days') AS recent_heartbeat,
--          EXISTS (
--            SELECT 1
--            FROM public.device_provider_assignments a
--            WHERE a.device_id = d.id AND a.status = 'active'
--          ) AS active_assignment
--   FROM public.devices d
--   JOIN current_activation ca ON ca.device_id = d.id
--   WHERE d.status IN ('active', 'registered')
--     AND d.activation_status IN ('active', 'expired')
--     AND (d.last_seen_at >= now() - interval '30 days' OR EXISTS (
--       SELECT 1
--       FROM public.device_provider_assignments a
--       WHERE a.device_id = d.id AND a.status = 'active'
--     ))
-- )
-- SELECT * FROM eligible ORDER BY public_device_code;

create table if not exists public.device_production_migration_snapshots (
  migration_name text not null,
  device_id uuid not null references public.devices(id) on delete cascade,
  activation_id uuid not null references public.device_activations(id) on delete cascade,
  previous_device_status text not null,
  previous_device_activation_status text not null,
  previous_activation_status text not null,
  previous_activation_source text,
  previous_device_updated_at timestamptz not null,
  previous_activation_updated_at timestamptz not null,
  captured_at timestamptz not null default now(),
  primary key (migration_name, device_id, activation_id)
);

revoke all on public.device_production_migration_snapshots from anon, authenticated;

-- Initial execution mode: heartbeat-backed candidates only. The preview above
-- intentionally retains the broader heartbeat-or-assignment rule for audit,
-- but the first production rollout must not migrate assignment-only devices.
-- Remove or revise this execution constraint only after a later reviewed
-- rollout. No device secret, provider credential, or provider URL is stored.
WITH current_activation AS (
  SELECT DISTINCT ON (device_id) id, device_id, status
  FROM public.device_activations
  WHERE status IN ('active', 'expired') AND activation_source IS DISTINCT FROM 'production'
  ORDER BY device_id, (status = 'active') DESC, created_at DESC, id DESC
), eligible AS (
  SELECT
    d.id AS device_id,
    ca.id AS activation_id,
    d.status AS previous_device_status,
    d.activation_status AS previous_device_activation_status,
    da.status AS previous_activation_status,
    da.activation_source AS previous_activation_source,
    d.updated_at AS previous_device_updated_at,
    da.updated_at AS previous_activation_updated_at
  FROM public.devices d
  JOIN current_activation ca ON ca.device_id = d.id
  JOIN public.device_activations da ON da.id = ca.id
  WHERE d.status IN ('active', 'registered')
    AND d.activation_status IN ('active', 'expired')
    AND d.last_seen_at >= now() - interval '30 days'
)
INSERT INTO public.device_production_migration_snapshots (
  migration_name,
  device_id,
  activation_id,
  previous_device_status,
  previous_device_activation_status,
  previous_activation_status,
  previous_activation_source,
  previous_device_updated_at,
  previous_activation_updated_at
)
SELECT
  '20261008232226_production_device_lifecycle_phase1',
  device_id,
  activation_id,
  previous_device_status,
  previous_device_activation_status,
  previous_activation_status,
  previous_activation_source,
  previous_device_updated_at,
  previous_activation_updated_at
FROM eligible
ON CONFLICT (migration_name, device_id, activation_id) DO NOTHING;

-- Promote only rows whose pre-migration values still match the captured
-- snapshot. This makes reruns bounded and avoids overwriting later operator
-- changes.
UPDATE public.device_activations da
SET status = 'active',
    activation_source = 'production',
    updated_at = now()
FROM public.device_production_migration_snapshots s
WHERE s.migration_name = '20261008232226_production_device_lifecycle_phase1'
  AND da.id = s.activation_id
  AND da.status = s.previous_activation_status
  AND da.activation_source IS NOT DISTINCT FROM s.previous_activation_source;

UPDATE public.devices d
SET status = 'active', activation_status = 'active', updated_at = now()
FROM public.device_production_migration_snapshots s
JOIN public.device_activations da ON da.id = s.activation_id
WHERE s.migration_name = '20261008232226_production_device_lifecycle_phase1'
  AND d.id = s.device_id
  AND d.status = s.previous_device_status
  AND d.activation_status = s.previous_device_activation_status
  AND da.status = 'active'
  AND da.activation_source = 'production';

-- Manual rollback template (run only after reviewing the snapshot rows):
-- UPDATE public.device_activations da
-- SET status = s.previous_activation_status,
--     activation_source = s.previous_activation_source,
--     updated_at = s.previous_activation_updated_at
-- FROM public.device_production_migration_snapshots s
-- WHERE s.migration_name = '20261008232226_production_device_lifecycle_phase1'
--   AND da.id = s.activation_id
--   AND da.status = 'active'
--   AND da.activation_source = 'production';
-- UPDATE public.devices d
-- SET status = s.previous_device_status,
--     activation_status = s.previous_device_activation_status,
--     updated_at = s.previous_device_updated_at
-- FROM public.device_production_migration_snapshots s
-- WHERE s.migration_name = '20261008232226_production_device_lifecycle_phase1'
--   AND d.id = s.device_id
--   AND d.status = 'active'
--   AND d.activation_status = 'active';
