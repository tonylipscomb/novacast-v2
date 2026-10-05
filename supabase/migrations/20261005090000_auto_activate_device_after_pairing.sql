-- Activate a registered device only after its own pairing session has been
-- validated and completed. The operation is idempotent and transactional.
create or replace function public.auto_activate_device_after_pairing(
  p_session_id uuid,
  p_device_id uuid
) returns table(device_id uuid, activation_status text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.pairing_sessions%rowtype;
  target public.devices%rowtype;
  existing public.device_activations%rowtype;
begin
  select * into pairing
  from public.pairing_sessions
  where id = p_session_id
  for share;

  if pairing.id is null
     or pairing.device_id is distinct from p_device_id
     or pairing.state <> 'completed'
     or pairing.provider_record_id is null
     or pairing.expires_at <= now()
  then
    raise exception 'pairing_activation_not_eligible';
  end if;

  select * into target
  from public.devices
  where id = p_device_id
  for update;

  if target.id is null then
    raise exception 'device_activation_not_eligible';
  end if;
  if target.status in ('blocked', 'revoked') then
    raise exception 'device_activation_blocked';
  end if;
  if target.activation_status in ('expired', 'revoked', 'suspended') then
    raise exception 'device_activation_not_eligible';
  end if;

  select * into existing
  from public.device_activations
  where device_activations.device_id = p_device_id
    and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if existing.id is not null then
    return query select p_device_id, 'active'::text, existing.expires_at;
    return;
  end if;

  if target.status <> 'registered' or target.activation_status <> 'inactive' then
    raise exception 'device_activation_not_eligible';
  end if;

  insert into public.device_activations(device_id, status, expires_at)
  values (p_device_id, 'active', null);

  update public.devices
  set activation_status = 'active',
      status = 'active',
      updated_at = now()
  where id = p_device_id;

  return query select p_device_id, 'active'::text, null::timestamptz;
end;
$$;

revoke execute on function public.auto_activate_device_after_pairing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.auto_activate_device_after_pairing(uuid, uuid) to service_role;
