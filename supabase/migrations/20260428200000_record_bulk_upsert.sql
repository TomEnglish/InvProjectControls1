-- record_bulk_upsert: bulk upsert of audit_records rows from the import-audit-records
-- Edge Function. Resolves coa_code text → coa_codes.id and discipline_code text →
-- project_disciplines.id inside the transaction so referential integrity holds even
-- if the COA library shifts mid-import.
--
-- Each new record gets 8 milestone rows seeded at value=0. Existing records are
-- updated in place (project_disciplines.id can't change once a record is created —
-- discipline drift is a CO concern, not an import concern).
--
-- Role gate: editor+. Tenant gate: rows with mismatched tenant are rejected.

create or replace function projectcontrols.record_bulk_upsert(
  p_project_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  proj record;
  row jsonb;
  v_record_id uuid;
  v_discipline_id uuid;
  v_coa_id uuid;
  v_rec_no int;
  v_existed boolean;
  inserted_count int := 0;
  updated_count int := 0;
  error_rows jsonb := '[]'::jsonb;
begin
  perform projectcontrols.assert_role('editor');

  select id, status, tenant_id into proj
  from projectcontrols.projects
  where id = p_project_id and tenant_id = tid;

  if proj.id is null then
    raise exception 'project not found in this tenant' using errcode = 'P0001';
  end if;
  if proj.status not in ('draft', 'active') then
    raise exception 'project must be in draft or active state to import (status=%)', proj.status
      using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    -- Resolve discipline_code → project_disciplines.id.
    select id into v_discipline_id
    from projectcontrols.project_disciplines
    where project_id = p_project_id
      and discipline_code = (row->>'discipline_code')::projectcontrols.discipline_code
      and is_active = true;

    if v_discipline_id is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', row->>'rec_no',
        'error', format('discipline %s not configured for this project', row->>'discipline_code')
      );
      continue;
    end if;

    -- Resolve coa_code text → coa_codes.id within the tenant.
    select id into v_coa_id
    from projectcontrols.coa_codes
    where tenant_id = tid and code = row->>'coa_code';

    if v_coa_id is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', row->>'rec_no',
        'error', format('coa_code %s not in library', row->>'coa_code')
      );
      continue;
    end if;

    -- rec_no is required (the importer is responsible for assigning when blank).
    v_rec_no := (row->>'rec_no')::int;
    if v_rec_no is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', null,
        'error', 'rec_no is required'
      );
      continue;
    end if;

    -- Existing record? Capture before upsert for branch.
    select id, true into v_record_id, v_existed
    from projectcontrols.audit_records
    where project_id = p_project_id and rec_no = v_rec_no;

    if v_record_id is null then
      v_existed := false;
    end if;

    insert into projectcontrols.audit_records (
      tenant_id, project_id, discipline_id, coa_code_id, rec_no,
      dwg, rev, description, uom, fld_qty, fld_whrs, status
    ) values (
      tid, p_project_id, v_discipline_id, v_coa_id, v_rec_no,
      row->>'dwg',
      row->>'rev',
      row->>'description',
      (row->>'uom')::projectcontrols.uom_code,
      (row->>'fld_qty')::numeric,
      coalesce((row->>'fld_whrs')::numeric,
               (row->>'fld_qty')::numeric * (select pf_rate from projectcontrols.coa_codes where id = v_coa_id)),
      coalesce((row->>'record_status')::projectcontrols.record_status, 'active')
    )
    on conflict (project_id, rec_no) do update set
      discipline_id = excluded.discipline_id,
      coa_code_id = excluded.coa_code_id,
      dwg = excluded.dwg,
      rev = excluded.rev,
      description = excluded.description,
      uom = excluded.uom,
      fld_qty = excluded.fld_qty,
      fld_whrs = excluded.fld_whrs,
      status = excluded.status,
      updated_at = now()
    returning id into v_record_id;

    -- Seed milestone rows at 0 for new records (8 per record).
    if not v_existed then
      insert into projectcontrols.audit_record_milestones (tenant_id, record_id, seq, value, updated_by, updated_at)
      select tid, v_record_id, gs, 0, auth.uid(), now()
      from generate_series(1, 8) gs
      on conflict (record_id, seq) do nothing;

      -- Seed audit_record_ev row at zeros.
      insert into projectcontrols.audit_record_ev (record_id, earn_pct, ern_qty, earn_whrs)
      values (v_record_id, 0, 0, 0)
      on conflict (record_id) do nothing;

      inserted_count := inserted_count + 1;
    else
      updated_count := updated_count + 1;
    end if;
  end loop;

  if jsonb_array_length(error_rows) > 0 then
    -- Whole-file atomicity per spec — abort if any row failed FK resolution.
    raise exception 'import failed: %', error_rows::text using errcode = '22023';
  end if;

  perform projectcontrols.write_audit_log(
    'audit_records',
    p_project_id,
    'bulk_upsert',
    null,
    jsonb_build_object(
      'inserted', inserted_count,
      'updated', updated_count,
      'total', inserted_count + updated_count
    )
  );

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'errors', error_rows
  );
end
$$;

revoke all on function projectcontrols.record_bulk_upsert(uuid, jsonb) from public;
grant execute on function projectcontrols.record_bulk_upsert(uuid, jsonb) to authenticated;
