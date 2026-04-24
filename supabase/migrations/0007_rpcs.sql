-- 0007_rpcs.sql
-- Phase 0 RPC surface. All SECURITY DEFINER; all call assert_role + write_audit_log
-- where mutating. Schema-qualified so PostgREST can expose them via .rpc('name').

-- ============================================================================
-- project_summary
-- ============================================================================
create or replace function projectcontrols.project_summary(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  result jsonb;
begin
  if not exists (select 1 from projectcontrols.projects where id = p_project_id and tenant_id = tid) then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'project_id', p_project_id,
    'total_budget_hrs', coalesce(sum(pd.budget_hrs), 0),
    'total_earned_hrs', coalesce(sum(ev.earn_whrs), 0),
    'total_actual_hrs', coalesce(sum(ah.hours), 0),
    'disciplines', coalesce(jsonb_agg(
      jsonb_build_object(
        'discipline_id', pd.id,
        'discipline_code', pd.discipline_code,
        'display_name', pd.display_name,
        'records', pd.records,
        'budget_hrs', pd.budget_hrs,
        'earned_hrs', coalesce(ev.earn_whrs, 0),
        'actual_hrs', coalesce(ah.hours, 0),
        'earned_pct', case when pd.budget_hrs > 0 then coalesce(ev.earn_whrs, 0) / pd.budget_hrs else 0 end,
        'cpi', case when coalesce(ah.hours, 0) > 0 then coalesce(ev.earn_whrs, 0) / ah.hours else null end
      ) order by pd.discipline_code
    ), '[]'::jsonb)
  )
  into result
  from (
    select pd.*, (select count(*) from projectcontrols.audit_records r where r.discipline_id = pd.id) as records
    from projectcontrols.project_disciplines pd
    where pd.project_id = p_project_id and pd.tenant_id = tid and pd.is_active
  ) pd
  left join lateral (
    select sum(v.earn_whrs) as earn_whrs
    from projectcontrols.v_audit_record_ev v
    where v.discipline_id = pd.id
  ) ev on true
  left join lateral (
    select sum(a.hours) as hours
    from projectcontrols.actual_hours a
    where a.project_id = p_project_id and a.discipline_id = pd.id
  ) ah on true;

  select result
    || jsonb_build_object(
      'overall_pct', case when (result->>'total_budget_hrs')::numeric > 0
                          then (result->>'total_earned_hrs')::numeric / (result->>'total_budget_hrs')::numeric
                          else 0 end,
      'cpi', case when (result->>'total_actual_hrs')::numeric > 0
                  then (result->>'total_earned_hrs')::numeric / (result->>'total_actual_hrs')::numeric
                  else null end,
      'spi', case when (result->>'total_budget_hrs')::numeric > 0
                  then (result->>'total_earned_hrs')::numeric / ((result->>'total_budget_hrs')::numeric * 0.42)
                  else null end
    )
  into result;

  return result;
end
$$;

grant execute on function projectcontrols.project_summary(uuid) to authenticated;

-- ============================================================================
-- budget_rollup
-- ============================================================================
create or replace function projectcontrols.budget_rollup(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  ob numeric := 0;
  approved numeric := 0;
  pending numeric := 0;
begin
  if not exists (select 1 from projectcontrols.projects where id = p_project_id and tenant_id = tid) then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  select coalesce(sum(budget_hrs), 0) into ob
  from projectcontrols.project_disciplines
  where project_id = p_project_id and tenant_id = tid;

  select coalesce(sum(hrs_impact), 0) into approved
  from projectcontrols.change_orders
  where project_id = p_project_id and tenant_id = tid and status = 'approved';

  select coalesce(sum(hrs_impact), 0) into pending
  from projectcontrols.change_orders
  where project_id = p_project_id and tenant_id = tid and status in ('pending', 'pc_reviewed');

  return jsonb_build_object(
    'original_budget', ob,
    'current_budget', ob + approved,
    'forecast_budget', ob + approved + pending,
    'approved_changes_hrs', approved,
    'pending_changes_hrs', pending
  );
end
$$;

grant execute on function projectcontrols.budget_rollup(uuid) to authenticated;

-- ============================================================================
-- record_update_milestones
-- ============================================================================
create or replace function projectcontrols.record_update_milestones(
  p_record_id uuid,
  p_milestones jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  after jsonb;
  m jsonb;
begin
  perform projectcontrols.assert_role('editor');

  if not exists (select 1 from projectcontrols.audit_records where id = p_record_id and tenant_id = tid) then
    raise exception 'record not found' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('seq', seq, 'value', value) order by seq)
    into before
  from projectcontrols.audit_record_milestones where record_id = p_record_id;

  for m in select * from jsonb_array_elements(p_milestones) loop
    if (m->>'value')::numeric < 0 or (m->>'value')::numeric > 1 then
      raise exception 'milestone value out of range [0,1]' using errcode = '22003';
    end if;
    update projectcontrols.audit_record_milestones
       set value = (m->>'value')::numeric,
           updated_at = now(),
           updated_by = auth.uid()
     where record_id = p_record_id and seq = (m->>'seq')::int and tenant_id = tid;
  end loop;

  update projectcontrols.audit_records set updated_at = now(), updated_by = auth.uid() where id = p_record_id;

  select jsonb_agg(jsonb_build_object('seq', seq, 'value', value) order by seq)
    into after
  from projectcontrols.audit_record_milestones where record_id = p_record_id;

  perform projectcontrols.write_audit_log('audit_records', p_record_id, 'update_milestones', before, after);

  return (select to_jsonb(v) from projectcontrols.v_audit_record_ev v where v.record_id = p_record_id);
end
$$;

grant execute on function projectcontrols.record_update_milestones(uuid, jsonb) to authenticated;

-- ============================================================================
-- Change Order workflow
-- ============================================================================
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

  insert into projectcontrols.change_orders (
    tenant_id, project_id, co_number, discipline_id, type, description,
    qty_change, uom, hrs_impact, status, requested_by, created_by
  ) values (
    tid, pid, co_num, did,
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

  perform projectcontrols.write_audit_log('change_orders', new_id, 'submit', null, to_jsonb((select co from projectcontrols.change_orders co where co.id = new_id)));

  return new_id;
end
$$;

grant execute on function projectcontrols.co_submit(jsonb) to authenticated;

create or replace function projectcontrols.co_pc_review(p_co_id uuid, p_decision text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  new_status projectcontrols.co_status;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  select to_jsonb(co) into before from projectcontrols.change_orders co where id = p_co_id and tenant_id = tid;
  if before is null then
    raise exception 'CO not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'pending' then
    raise exception 'CO not in pending state' using errcode = '22023';
  end if;

  new_status := case p_decision when 'forward' then 'pc_reviewed' when 'reject' then 'rejected'
                 else null end;
  if new_status is null then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  update projectcontrols.change_orders
     set status = new_status,
         pc_reviewed_by = auth.uid(),
         pc_reviewed_at = now(),
         rejection_reason = case when p_decision = 'reject' then p_notes else null end,
         updated_at = now()
   where id = p_co_id and tenant_id = tid;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, p_co_id, case p_decision when 'forward' then 'pc_reviewed' else 'rejected' end, auth.uid(), p_notes);

  perform projectcontrols.write_audit_log('change_orders', p_co_id, 'pc_review_' || p_decision, before, to_jsonb((select co from projectcontrols.change_orders co where co.id = p_co_id)));
end
$$;

grant execute on function projectcontrols.co_pc_review(uuid, text, text) to authenticated;

create or replace function projectcontrols.co_approve(p_co_id uuid, p_decision text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  new_status projectcontrols.co_status;
begin
  perform projectcontrols.assert_role('pm');

  select to_jsonb(co) into before from projectcontrols.change_orders co where id = p_co_id and tenant_id = tid;
  if before is null then
    raise exception 'CO not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'pc_reviewed' then
    raise exception 'CO must be pc_reviewed before approval' using errcode = '22023';
  end if;

  new_status := case p_decision when 'forward' then 'approved' when 'reject' then 'rejected'
                 else null end;
  if new_status is null then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  update projectcontrols.change_orders
     set status = new_status,
         approved_by = auth.uid(),
         approved_at = now(),
         rejection_reason = case when p_decision = 'reject' then p_notes else null end,
         updated_at = now()
   where id = p_co_id and tenant_id = tid;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, p_co_id, case p_decision when 'forward' then 'approved' else 'rejected' end, auth.uid(), p_notes);

  perform projectcontrols.write_audit_log('change_orders', p_co_id, 'approve_' || p_decision, before, to_jsonb((select co from projectcontrols.change_orders co where co.id = p_co_id)));
end
$$;

grant execute on function projectcontrols.co_approve(uuid, text, text) to authenticated;

-- ============================================================================
-- project_lock_baseline
-- ============================================================================
create or replace function projectcontrols.project_lock_baseline(p_project_id uuid, p_lock_date timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  snapshot jsonb;
  baseline_id uuid;
begin
  perform projectcontrols.assert_role('admin');

  select to_jsonb(p) into before from projectcontrols.projects p where id = p_project_id and tenant_id = tid;
  if before is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'draft' then
    raise exception 'project must be in draft state to lock baseline' using errcode = '22023';
  end if;

  snapshot := jsonb_build_object(
    'project', before,
    'disciplines', (select jsonb_agg(to_jsonb(pd)) from projectcontrols.project_disciplines pd where project_id = p_project_id),
    'coa_codes', (select jsonb_agg(to_jsonb(c)) from projectcontrols.coa_codes c where tenant_id = tid),
    'roc_templates', (select jsonb_agg(jsonb_build_object(
      'template', to_jsonb(t),
      'milestones', (select jsonb_agg(to_jsonb(m) order by m.seq) from projectcontrols.roc_milestones m where template_id = t.id)
    )) from projectcontrols.roc_templates t where tenant_id = tid),
    'audit_records', (select jsonb_agg(to_jsonb(r)) from projectcontrols.audit_records r where project_id = p_project_id)
  );

  insert into projectcontrols.baselines (tenant_id, project_id, locked_at, locked_by, snapshot)
  values (tid, p_project_id, p_lock_date, auth.uid(), snapshot)
  returning id into baseline_id;

  update projectcontrols.projects
     set status = 'active',
         baseline_locked_at = p_lock_date,
         baseline_locked_by = auth.uid(),
         updated_at = now()
   where id = p_project_id;

  perform projectcontrols.write_audit_log('projects', p_project_id, 'lock_baseline', before, to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id)));

  return baseline_id;
end
$$;

grant execute on function projectcontrols.project_lock_baseline(uuid, timestamptz) to authenticated;

-- ============================================================================
-- roc_template_set
-- ============================================================================
create or replace function projectcontrols.roc_template_set(p_template_id uuid, p_milestones jsonb)
returns void
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  sum_weight numeric;
begin
  perform projectcontrols.assert_role('admin');

  if jsonb_array_length(p_milestones) <> 8 then
    raise exception 'must supply exactly 8 milestones' using errcode = '22023';
  end if;

  select sum((m->>'weight')::numeric) into sum_weight
  from jsonb_array_elements(p_milestones) m;

  if abs(sum_weight - 1) > 0.0001 then
    raise exception 'milestone weights must sum to 1.0 (got %)', sum_weight using errcode = '22023';
  end if;

  select jsonb_agg(to_jsonb(m) order by m.seq) into before
  from projectcontrols.roc_milestones m where template_id = p_template_id and tenant_id = tid;

  delete from projectcontrols.roc_milestones where template_id = p_template_id and tenant_id = tid;
  insert into projectcontrols.roc_milestones (tenant_id, template_id, seq, label, weight)
  select tid, p_template_id,
         (m->>'seq')::smallint,
         m->>'label',
         (m->>'weight')::numeric
  from jsonb_array_elements(p_milestones) m;

  perform projectcontrols.write_audit_log('roc_templates', p_template_id, 'set_milestones', before, p_milestones);
end
$$;

grant execute on function projectcontrols.roc_template_set(uuid, jsonb) to authenticated;
