-- Fix ambiguous device_id in activate_device_with_invite.
-- RETURNS TABLE(device_id ...) creates a PL/pgSQL variable that collided with
-- UPDATE ... WHERE device_id = ..., aborting every activation before insert.

create or replace function public.activate_device_with_invite(
  p_public_device_code text,
  p_code_hash text,
  p_friendly_name text default null
) returns table(
  device_id uuid,
  activation_status text,
  expires_at timestamptz,
  managed_provider_id uuid,
  content_policy text,
  provider_assigned boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  target public.devices%rowtype;
  invitation public.beta_invites%rowtype;
  activation_expiry timestamptz;
  existing_expiry timestamptz;
  existing_provider uuid;
  existing_policy text;
  has_provider boolean;
begin
  select * into target from public.devices d where d.public_device_code = upper(trim(p_public_device_code)) for update;
  if target.id is null then
    raise exception 'device_not_found';
  end if;
  if target.status in ('revoked', 'blocked') then
    raise exception 'device_blocked';
  end if;

  select * into invitation from public.beta_invites bi where bi.code_hash = p_code_hash for update;
  if invitation.id is null then
    raise exception 'invite_not_found';
  end if;
  if invitation.status <> 'active' then
    raise exception 'invite_inactive';
  end if;
  if invitation.starts_at is not null and invitation.starts_at > now() then
    raise exception 'invite_not_started';
  end if;
  if invitation.expires_at is not null and invitation.expires_at <= now() then
    raise exception 'invite_expired';
  end if;
  if invitation.redeemed_count >= invitation.maximum_devices then
    raise exception 'invite_exhausted';
  end if;

  select da.expires_at, da.managed_provider_id, da.content_policy
    into existing_expiry, existing_provider, existing_policy
  from public.device_activations da
  where da.device_id = target.id and da.status = 'active'
  order by da.created_at desc
  limit 1;

  if existing_expiry is not null and (existing_expiry > now()) then
    select exists(
      select 1 from public.device_provider_assignments dpa
      where dpa.device_id = target.id and dpa.status = 'active'
    ) into has_provider;

    return query select
      target.id,
      'active'::text,
      existing_expiry,
      coalesce(existing_provider, invitation.managed_provider_id),
      coalesce(existing_policy, invitation.content_policy, 'us_only'),
      has_provider;
    return;
  end if;

  if invitation.activation_duration_hours is not null then
    activation_expiry := now() + make_interval(hours => invitation.activation_duration_hours);
  else
    activation_expiry := invitation.expires_at;
  end if;

  update public.device_activations da
    set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced_by_invite', updated_at = now()
  where da.device_id = target.id and da.status = 'active';

  insert into public.device_activations(
    device_id, beta_invite_id, status, expires_at, content_policy, managed_provider_id, activation_source
  ) values (
    target.id,
    invitation.id,
    'active',
    activation_expiry,
    coalesce(invitation.content_policy, 'us_only'),
    invitation.managed_provider_id,
    'invite'
  );

  if invitation.managed_provider_id is not null then
    update public.device_provider_assignments dpa
      set status = 'superseded', revoked_at = now(), updated_at = now()
    where dpa.device_id = target.id and dpa.status = 'active';

    insert into public.device_provider_assignments(
      device_id, managed_provider_id, content_policy, status
    ) values (
      target.id,
      invitation.managed_provider_id,
      coalesce(invitation.content_policy, 'us_only'),
      'active'
    );
  end if;

  update public.beta_invites bi
    set redeemed_count = bi.redeemed_count + 1,
        status = case when bi.redeemed_count + 1 >= bi.maximum_devices then 'exhausted' else bi.status end,
        updated_at = now()
  where bi.id = invitation.id;

  update public.devices d set
    activation_status = 'active',
    status = 'active',
    friendly_name = coalesce(nullif(left(trim(p_friendly_name), 80), ''), d.friendly_name),
    content_policy = coalesce(invitation.content_policy, 'us_only'),
    managed_provider_id = invitation.managed_provider_id,
    assigned_tester_name = invitation.assigned_name,
    assigned_tester_email = invitation.assigned_email,
    updated_at = now()
  where d.id = target.id;

  return query select
    target.id,
    'active'::text,
    activation_expiry,
    invitation.managed_provider_id,
    coalesce(invitation.content_policy, 'us_only'),
    invitation.managed_provider_id is not null;
end;
$$;

create or replace function public.admin_activate_device_with_invite_id(
  p_public_device_code text,
  p_invite_id uuid,
  p_friendly_name text default null
) returns table(
  device_id uuid,
  activation_status text,
  expires_at timestamptz,
  managed_provider_id uuid,
  content_policy text,
  provider_assigned boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  invitation_hash text;
begin
  select bi.code_hash into invitation_hash from public.beta_invites bi where bi.id = p_invite_id;
  if invitation_hash is null then
    raise exception 'invite_not_found';
  end if;

  return query
    select * from public.activate_device_with_invite(
      p_public_device_code,
      invitation_hash,
      p_friendly_name
    );
end;
$$;

revoke execute on function public.activate_device_with_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_device_with_invite(text, text, text) to service_role;

revoke execute on function public.admin_activate_device_with_invite_id(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_activate_device_with_invite_id(text, uuid, text) to service_role;
