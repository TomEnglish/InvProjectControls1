-- coa_code_upsert: admin-only, audit-logged upsert for the cost-of-account library.
-- Validates pf_rate ≈ base_rate × pf_adj within 0.01 tolerance (the table also enforces
-- pf_rate as a generated column, but the explicit check keeps client payloads honest).

create or replace function projectcontrols.coa_code_upsert(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  v_id uuid;
  v_prime text;
  v_code text;
  v_description text;
  v_parent text;
  v_level smallint;
  v_uom projectcontrols.uom_code;
  v_base_rate numeric(10, 4);
  v_pf_adj numeric(6, 4);
  v_expected_rate numeric;
  v_supplied_rate numeric;
  before jsonb;
begin
  perform projectcontrols.assert_role('admin');

  v_prime := p_payload->>'prime';
  v_code := p_payload->>'code';
  v_description := p_payload->>'description';
  v_parent := nullif(p_payload->>'parent', '');
  v_level := (p_payload->>'level')::smallint;
  v_uom := (p_payload->>'uom')::projectcontrols.uom_code;
  v_base_rate := (p_payload->>'base_rate')::numeric(10, 4);
  v_pf_adj := (p_payload->>'pf_adj')::numeric(6, 4);

  if v_prime is null or v_code is null or v_description is null then
    raise exception 'prime, code, and description are required' using errcode = '22023';
  end if;

  -- If client supplied a pf_rate, sanity-check it.
  if (p_payload ? 'pf_rate') and p_payload->>'pf_rate' is not null then
    v_supplied_rate := (p_payload->>'pf_rate')::numeric;
    v_expected_rate := round((v_base_rate * v_pf_adj)::numeric, 4);
    if abs(v_supplied_rate - v_expected_rate) > 0.01 then
      raise exception 'pf_rate (%) does not match base_rate × pf_adj (%)', v_supplied_rate, v_expected_rate
        using errcode = '22023';
    end if;
  end if;

  -- Snapshot before-state for audit.
  select to_jsonb(c) into before
  from projectcontrols.coa_codes c
  where c.tenant_id = tid and c.code = v_code;

  insert into projectcontrols.coa_codes (
    tenant_id, prime, code, description, parent, level, uom, base_rate, pf_adj
  )
  values (
    tid, v_prime, v_code, v_description, v_parent, v_level, v_uom, v_base_rate, v_pf_adj
  )
  on conflict (tenant_id, code) do update set
    prime = excluded.prime,
    description = excluded.description,
    parent = excluded.parent,
    level = excluded.level,
    uom = excluded.uom,
    base_rate = excluded.base_rate,
    pf_adj = excluded.pf_adj,
    updated_at = now()
  returning id into v_id;

  perform projectcontrols.write_audit_log(
    'coa_codes', v_id,
    case when before is null then 'create' else 'update' end,
    before, p_payload
  );

  return v_id;
end
$$;

revoke all on function projectcontrols.coa_code_upsert(jsonb) from public;
grant execute on function projectcontrols.coa_code_upsert(jsonb) to authenticated;
