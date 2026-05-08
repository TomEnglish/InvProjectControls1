-- Sandra UAT: New Change Order modal needs drawing + date fields.
-- date column already exists with default current_date; just expose it.
-- drawing column does not exist; add it nullable and let the RPC accept it.

alter table projectcontrols.change_orders
  add column if not exists drawing text;

create or replace function projectcontrols.co_submit(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  pid uuid := (p_payload->>'project_id')::uuid;
  did uuid := (p_payload->>'discipline_id')::uuid;
  next_num int;
  co_num text;
  new_id uuid;
  hrs_impact numeric;
  v_date date;
begin
  perform projectcontrols.assert_role('editor');

  if not exists (select 1 from projectcontrols.projects where id = pid and tenant_id = tid) then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  select coalesce(max((regexp_replace(co_number, '\D', '', 'g'))::int), 0) + 1
    into next_num
  from projectcontrols.change_orders where project_id = pid;
  co_num := 'CO-' || lpad(next_num::text, 3, '0');

  hrs_impact := coalesce((p_payload->>'hrs_impact')::numeric, (p_payload->>'qty_change')::numeric * 2.5);
  v_date := coalesce(nullif(p_payload->>'date', '')::date, current_date);

  insert into projectcontrols.change_orders (
    tenant_id, project_id, co_number, date, drawing, discipline_id,
    type, description, qty_change, uom, hrs_impact, status,
    requested_by, created_by
  ) values (
    tid, pid, co_num, v_date,
    nullif(p_payload->>'drawing', ''),
    did,
    (p_payload->>'type')::projectcontrols.co_type,
    p_payload->>'description',
    (p_payload->>'qty_change')::numeric,
    (p_payload->>'uom')::projectcontrols.uom_code,
    hrs_impact,
    'pending',
    p_payload->>'requested_by',
    auth.uid()
  )
  returning id into new_id;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, new_id, 'submitted', auth.uid(), p_payload->>'notes');

  perform projectcontrols.write_audit_log(
    'change_orders', new_id, 'submit',
    null,
    to_jsonb((select co from projectcontrols.change_orders co where co.id = new_id))
  );

  return new_id;
end
$$;

grant execute on function projectcontrols.co_submit(jsonb) to authenticated;
