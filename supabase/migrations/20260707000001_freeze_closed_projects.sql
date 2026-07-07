-- Truly freeze a closed project's data.
--
-- Closing a project (project_close, 20260707000000) flips status to 'closed'
-- and the UI treats it as read-only — but that's cosmetic. Writes reach the
-- data tables two ways: direct PostgREST table writes (progress records,
-- attachments, sign-offs) and SECURITY DEFINER RPCs (upload approval → snapshot
-- import, change orders, actual hours). Only a table-level trigger catches
-- both, so a BEFORE INSERT/UPDATE/DELETE guard on every project-scoped data
-- table is the real freeze: once the parent project is 'closed', the write is
-- rejected until the project is reopened.
--
-- Scope: the operational/ledger data — progress, milestones, snapshots,
-- uploads, change orders, actual hours, attachments, sign-offs, manifests,
-- IWPs, periods. NOT the projects row itself (project_reopen must still flip
-- it back) and NOT membership/config tables (already UI-locked post-draft,
-- and freezing them would block legitimate admin recovery).
--
-- Child tables (milestones, snapshot items, CO events) carry no project_id;
-- their parent is resolved by FK so a single existing child row can't be
-- edited around the freeze.

create or replace function projectcontrols.assert_project_writable()
returns trigger
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  v jsonb := to_jsonb(coalesce(new, old));
  pid uuid;
  st text;
begin
  pid := case tg_table_name
    when 'progress_record_milestones' then
      (select project_id from projectcontrols.progress_records
        where id = (v->>'progress_record_id')::uuid)
    when 'progress_snapshot_items' then
      (select project_id from projectcontrols.progress_snapshots
        where id = (v->>'snapshot_id')::uuid)
    when 'change_order_events' then
      (select project_id from projectcontrols.change_orders
        where id = (v->>'change_order_id')::uuid)
    else (v->>'project_id')::uuid
  end;

  if pid is not null then
    select status::text into st from projectcontrols.projects where id = pid;
    if st = 'closed' then
      raise exception
        'project is closed — its data is frozen. Reopen the project on Project Setup to make changes.'
        using errcode = '55006';
    end if;
  end if;

  return coalesce(new, old);
end
$$;

revoke all on function projectcontrols.assert_project_writable() from public;

-- Attach the guard. BEFORE so the write never lands; row-level so both single
-- and bulk writes are covered. INSERT OR UPDATE OR DELETE — a closed project
-- can't gain, change, or lose data.
do $$
declare
  t text;
  data_tables text[] := array[
    'progress_records',
    'progress_record_milestones',
    'progress_snapshots',
    'progress_snapshot_items',
    'project_progress_streams',    -- per-stream percent_complete feeds Field/Overall KPIs
    'actual_hours',
    'change_orders',
    'change_order_events',
    'upload_queue',
    'attachments',
    'data_check_signoffs',
    'import_manifests',
    'iwps',
    'progress_periods'
  ];
begin
  foreach t in array data_tables loop
    -- Skip any table not present in this schema, so the list can carry
    -- defensively-named tables without failing the migration.
    if to_regclass('projectcontrols.' || quote_ident(t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists freeze_closed on projectcontrols.%I', t);
    execute format(
      'create trigger freeze_closed before insert or update or delete on projectcontrols.%I '
      || 'for each row execute function projectcontrols.assert_project_writable()', t);
  end loop;
end $$;
