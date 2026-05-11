-- Replacement for the dropped roc_template_set RPC. Admins call this to
-- rewrite a work_type's milestone set in one shot (e.g. from the Upload
-- page's "Update template from this file" one-click action). Validates
-- that weights sum to 1.0 and that there are 1-8 milestones per work type
-- (matching the SME's Milestone Reference layout).

create or replace function projectcontrols.work_type_milestones_set(
  p_work_type_id uuid,
  p_milestones jsonb
)
returns void
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  sum_weight numeric;
  ms_count int;
begin
  perform projectcontrols.assert_role('admin');

  ms_count := jsonb_array_length(p_milestones);
  if ms_count < 1 or ms_count > 8 then
    raise exception 'must supply 1..8 milestones (got %)', ms_count
      using errcode = '22023';
  end if;

  select sum((m->>'weight')::numeric) into sum_weight
  from jsonb_array_elements(p_milestones) m;

  if abs(sum_weight - 1) > 0.0001 then
    raise exception 'milestone weights must sum to 1.0 (got %)', sum_weight
      using errcode = '22023';
  end if;

  select jsonb_agg(to_jsonb(m) order by m.seq) into before
  from projectcontrols.work_type_milestones m
  where work_type_id = p_work_type_id and tenant_id = tid;

  delete from projectcontrols.work_type_milestones
  where work_type_id = p_work_type_id and tenant_id = tid;

  insert into projectcontrols.work_type_milestones (
    tenant_id, work_type_id, seq, label, weight
  )
  select tid, p_work_type_id,
         (m->>'seq')::smallint,
         m->>'label',
         (m->>'weight')::numeric
  from jsonb_array_elements(p_milestones) m;

  perform projectcontrols.write_audit_log(
    'work_types', p_work_type_id, 'set_milestones', before, p_milestones
  );
end
$$;

grant execute on function projectcontrols.work_type_milestones_set(uuid, jsonb) to authenticated;
