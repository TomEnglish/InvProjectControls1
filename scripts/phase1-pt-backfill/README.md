# Phase 1 PT Backfill

The five `20260501*` migrations land the schema for Phase 1 (super_admin enum, role helpers, project_members table, hardened policies and admin_set_user_role). They contain **no data writes against ProgressTracker tables**.

This folder contains the data-migration steps that copy PT users + project memberships into the `projectcontrols` schema.

## Order

1. `01-discovery.sql` — read-only. Run it via `supabase db remote query < 01-discovery.sql` (or psql), paste the output back to the assistant.
2. `02-dry-run.sql` — *not yet written*. Will be generated once 01-discovery confirms PT's actual schema (`role` vs `project_role` column, etc.) and you've confirmed the email/uid of whoever should become the first `super_admin`.
3. `03-apply.sql` — *not yet written*. Performs the actual backfill in a single transaction with `ROLLBACK` at the end during dry-runs and `COMMIT` only after explicit go-ahead.

## Prerequisites for 02 / 03

You owe me two answers:

1. **First super_admin** — email or auth.users.id of the user who should hold the top of the hierarchy. Defaults to the oldest `public.app_users.role = 'tenant_admin'` row if you don't specify (01-discovery prints that candidate).
2. **Default tenant role for PT `member` users** — should they all become `viewer` at the tenant level (with effective access via `project_members`), or should we infer a tenant-level role from their highest project role? Pick one.
