-- Instant device assignment invalidation.
-- Reuses device_provider_assignments.id + assigned_at as the version.
-- Does not add assignment tables or credential columns.
-- Clients still cannot SELECT this table; TVs listen on a device-scoped broadcast topic.

create or replace function public.notify_device_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
    begin
      perform realtime.send(
        jsonb_build_object(
          'assignmentId', new.id,
          'managedProviderId', new.managed_provider_id,
          'assignedAt', new.assigned_at
        ),
        'assignment-changed',
        'device-assignment:' || new.device_id::text,
        false
      );
    exception
      when others then
        null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists device_provider_assignments_realtime_notify on public.device_provider_assignments;
create trigger device_provider_assignments_realtime_notify
after insert or update of managed_provider_id, status, assigned_at, updated_at
on public.device_provider_assignments
for each row
execute procedure public.notify_device_assignment_change();
