begin;

select plan(45);

select has_table('projectcontrols', 'iwps', 'iwps table exists');
select has_table('projectcontrols', 'progress_records', 'progress_records table exists');
select has_table('projectcontrols', 'progress_record_milestones', 'progress_record_milestones table exists');
select has_table('projectcontrols', 'progress_snapshots', 'progress_snapshots table exists');
select has_table('projectcontrols', 'progress_snapshot_items', 'progress_snapshot_items table exists');
select has_table('projectcontrols', 'foreman_aliases', 'foreman_aliases table exists');
select has_table('projectcontrols', 'project_discipline_weights', 'project_discipline_weights table exists');

select has_column('projectcontrols', 'progress_records', 'project_id', 'progress_records has project_id');
select has_column('projectcontrols', 'progress_records', 'discipline_id', 'progress_records has discipline_id');
select has_column('projectcontrols', 'progress_records', 'iwp_id', 'progress_records has iwp_id');
select has_column('projectcontrols', 'progress_records', 'dwg', 'progress_records has dwg');
select has_column('projectcontrols', 'progress_records', 'rev', 'progress_records has rev');
select has_column('projectcontrols', 'progress_records', 'description', 'progress_records has description');
select has_column('projectcontrols', 'progress_records', 'uom', 'progress_records has uom');
select has_column('projectcontrols', 'progress_records', 'budget_qty', 'progress_records has budget_qty');
select has_column('projectcontrols', 'progress_records', 'actual_qty', 'progress_records has actual_qty');
select has_column('projectcontrols', 'progress_records', 'earned_qty', 'progress_records has earned_qty');
select has_column('projectcontrols', 'progress_records', 'budget_hrs', 'progress_records has budget_hrs');
select has_column('projectcontrols', 'progress_records', 'actual_hrs', 'progress_records has actual_hrs');
select has_column('projectcontrols', 'progress_records', 'earned_hrs', 'progress_records has earned_hrs');
select has_column('projectcontrols', 'progress_records', 'percent_complete', 'progress_records has percent_complete');
select has_column('projectcontrols', 'progress_records', 'foreman_user_id', 'progress_records has foreman_user_id');
select has_column('projectcontrols', 'progress_records', 'foreman_name', 'progress_records has foreman_name');
select has_column('projectcontrols', 'progress_records', 'line_area', 'progress_records has line_area');

select has_column('projectcontrols', 'progress_snapshots', 'kind', 'progress_snapshots has kind');
select has_column('projectcontrols', 'progress_snapshots', 'week_ending', 'progress_snapshots has week_ending');
select has_column('projectcontrols', 'progress_snapshot_items', 'snapshot_id', 'progress_snapshot_items has snapshot_id');
select has_column('projectcontrols', 'progress_snapshot_items', 'progress_record_id', 'progress_snapshot_items has progress_record_id');
select has_column('projectcontrols', 'project_discipline_weights', 'weight', 'project_discipline_weights has weight');
select has_column('projectcontrols', 'foreman_aliases', 'tenant_id', 'foreman_aliases has tenant_id');

-- Phase 4 Task 1 — RPCs + view that drive the merged progress workflows.
select has_function('projectcontrols', 'project_metrics', array['uuid'],
  'project_metrics RPC exists');
select has_function('projectcontrols', 'discipline_metrics', array['uuid'],
  'discipline_metrics RPC exists');
select has_function('projectcontrols', 'project_qty_rollup', array['uuid'],
  'project_qty_rollup RPC exists');
select has_function('projectcontrols', 'period_comparison', array['uuid', 'uuid', 'uuid'],
  'period_comparison RPC exists');
select has_function('projectcontrols', 'list_snapshots', array['uuid'],
  'list_snapshots RPC exists');
select has_view('projectcontrols', 'v_progress_record_ev',
  'v_progress_record_ev view exists');

-- Phase 5 — audit_records family is dropped; period_close + project_lock_baseline
-- still exist but live on canonical tables now.
select hasnt_table('projectcontrols', 'audit_records', 'audit_records table is dropped');
select hasnt_table('projectcontrols', 'audit_record_milestones', 'audit_record_milestones table is dropped');
select hasnt_view('projectcontrols', 'v_audit_record_ev', 'v_audit_record_ev view is dropped');
select hasnt_function('projectcontrols', 'project_summary', array['uuid'],
  'project_summary RPC is dropped');
select hasnt_function('projectcontrols', 'record_update_milestones', array['uuid', 'jsonb'],
  'record_update_milestones RPC is dropped');
select hasnt_function('projectcontrols', 'record_bulk_upsert', array['uuid', 'jsonb'],
  'record_bulk_upsert RPC is dropped');
select hasnt_function('projectcontrols', 'seed_audit_record_milestones', array[]::text[],
  'seed_audit_record_milestones trigger function is dropped');
select has_function('projectcontrols', 'period_close', array['uuid', 'uuid'],
  'period_close RPC still exists post-rewrite');
select has_function('projectcontrols', 'project_lock_baseline', array['uuid', 'timestamptz'],
  'project_lock_baseline RPC still exists post-rewrite');

select * from finish();

rollback;
