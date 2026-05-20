-- A3 follow-up — per-CO assignment columns.
--
-- Sandra's UAT (in-session feedback after CO email wiring): "the CO
-- creator should be able to decide who the PC reviewer is from a list
-- of those eligible. Certain people will approve certain parts of a
-- project."
--
-- Right now co-notify broadcasts to every pc_reviewer in the tenant and
-- any of them can pick a CO off the queue. Adding named assignment
-- routes each CO to a specific reviewer + PM, scoping the inbox so a
-- civil reviewer never sees a pipe CO they don't own.
--
-- Both columns are NULLable so legacy CO rows continue to work — a null
-- assignment falls back to "any reviewer with the role" via the existing
-- assert_role gate inside co_pc_review / co_approve.

alter table projectcontrols.change_orders
  add column if not exists assigned_pc_reviewer_id uuid
    references projectcontrols.app_users(id) on delete set null,
  add column if not exists assigned_pm_id uuid
    references projectcontrols.app_users(id) on delete set null;

-- Indexes power the "Mine" filter on /changes: each reviewer wants a
-- quick listing of COs assigned to them, scoped to their tenant.
create index if not exists change_orders_assigned_pc_reviewer_idx
  on projectcontrols.change_orders(assigned_pc_reviewer_id)
  where assigned_pc_reviewer_id is not null;
create index if not exists change_orders_assigned_pm_idx
  on projectcontrols.change_orders(assigned_pm_id)
  where assigned_pm_id is not null;

comment on column projectcontrols.change_orders.assigned_pc_reviewer_id is
  'PC reviewer the submitter (or a default from project_co_reviewers) routed this CO to. NULL = any pc_reviewer in tenant. Gates the co_pc_review RPC.';
comment on column projectcontrols.change_orders.assigned_pm_id is
  'PM the submitter (or the PC reviewer on forward) routed this CO to. NULL = any pm in tenant. Gates the co_approve RPC.';
