-- Keep project_disciplines.budget_hrs in sync with the baseline records.
--
-- budget_rollup (0007_rpcs.sql) computes original_budget = sum of
-- project_disciplines.budget_hrs, and ev_over_budget_policy / the lock
-- snapshot read the same field. But loading a baseline only inserts
-- progress_records — the discipline's budget_hrs stayed 0, so the Active
-- Disciplines card showed 0 hours and the whole budget/EV rollup read 0 for
-- loaded projects.
--
-- A statement-level trigger recomputes budget_hrs = sum(baseline record
-- budget_hrs) for every discipline touched by a write to progress_records.
-- Statement-level (not per-row) so a 2,500-row baseline insert recomputes
-- once, not 2,500 times. Covers every path automatically: baseline import,
-- project clear, per-discipline clear, and manual record edits — no edge-fn
-- or RPC changes needed.

create or replace function projectcontrols.sync_discipline_budget()
returns trigger
language plpgsql
security definer
set search_path = projectcontrols
as $$
begin
  update projectcontrols.project_disciplines pd
  set budget_hrs = coalesce((
        select sum(r.budget_hrs)
        from projectcontrols.progress_records r
        where r.discipline_id = pd.id and r.source_type = 'baseline'
      ), 0),
      updated_at = now()
  where pd.id in (select distinct discipline_id from changed where discipline_id is not null);
  return null;
end
$$;

revoke all on function projectcontrols.sync_discipline_budget() from public;

-- A transition table can only be attached to a single-event trigger, so one
-- per event. Each exposes its transition table as `changed` so they share the
-- one function. UPDATE has two (NEW + OLD) so that a record moved between
-- disciplines recomputes both the old and new discipline.
drop trigger if exists sync_disc_budget_ins on projectcontrols.progress_records;
create trigger sync_disc_budget_ins
  after insert on projectcontrols.progress_records
  referencing new table as changed
  for each statement execute function projectcontrols.sync_discipline_budget();

drop trigger if exists sync_disc_budget_del on projectcontrols.progress_records;
create trigger sync_disc_budget_del
  after delete on projectcontrols.progress_records
  referencing old table as changed
  for each statement execute function projectcontrols.sync_discipline_budget();

drop trigger if exists sync_disc_budget_upd_new on projectcontrols.progress_records;
create trigger sync_disc_budget_upd_new
  after update on projectcontrols.progress_records
  referencing new table as changed
  for each statement execute function projectcontrols.sync_discipline_budget();

drop trigger if exists sync_disc_budget_upd_old on projectcontrols.progress_records;
create trigger sync_disc_budget_upd_old
  after update on projectcontrols.progress_records
  referencing old table as changed
  for each statement execute function projectcontrols.sync_discipline_budget();

-- One-time backfill for baselines already loaded.
update projectcontrols.project_disciplines pd
set budget_hrs = coalesce((
      select sum(r.budget_hrs)
      from projectcontrols.progress_records r
      where r.discipline_id = pd.id and r.source_type = 'baseline'
    ), 0),
    updated_at = now();
