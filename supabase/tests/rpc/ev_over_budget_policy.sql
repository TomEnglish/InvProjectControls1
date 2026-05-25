-- ELL-46 / ELL-59 — EV over-budget policy shape checks + cap semantics.

begin;

select plan(12);

select has_function('projectcontrols', 'discipline_current_budget_hrs', array['uuid'],
  'discipline_current_budget_hrs exists');
select has_function('projectcontrols', 'record_current_budget_hrs', array['uuid'],
  'record_current_budget_hrs exists');

select has_column('projectcontrols', 'v_progress_record_ev', 'current_budget_hrs',
  'v_progress_record_ev exposes current_budget_hrs');
select has_column('projectcontrols', 'v_progress_record_ev', 'remaining_hrs',
  'v_progress_record_ev exposes remaining_hrs');
select has_column('projectcontrols', 'v_progress_record_ev', 'raw_earn_whrs',
  'v_progress_record_ev exposes raw_earn_whrs');

select has_column('projectcontrols', 'project_metrics', 'total_remaining_hrs',
  'project_metrics returns total_remaining_hrs');
select has_column('projectcontrols', 'project_metrics', 'buffer_remaining',
  'project_metrics returns buffer_remaining');
select has_column('projectcontrols', 'project_metrics', 'unbudgeted_actuals',
  'project_metrics returns unbudgeted_actuals');

select has_column('projectcontrols', 'discipline_metrics', 'current_budget_hrs',
  'discipline_metrics returns current_budget_hrs');
select has_column('projectcontrols', 'discipline_metrics', 'remaining_hrs',
  'discipline_metrics returns remaining_hrs');

-- Remaining is never negative anywhere in the view.
select ok(
  not exists (
    select 1 from projectcontrols.v_progress_record_ev v where v.remaining_hrs < 0
  ),
  'v_progress_record_ev.remaining_hrs is never negative'
);

-- Capped earned never exceeds current budget.
select ok(
  not exists (
    select 1
    from projectcontrols.v_progress_record_ev v
    where v.earn_whrs > v.current_budget_hrs + 0.001
  ),
  'v_progress_record_ev.earn_whrs is capped at current_budget_hrs'
);

select * from finish();

rollback;
