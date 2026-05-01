# ProjectControls Progress Merge Design

## Summary

Invenio ProjectControls becomes the single product codebase and runtime shell. Invenio ProgressTracker is retired as a standalone app after its useful progress-tracking workflows and data concepts are migrated into ProjectControls.

The combined product uses the `projectcontrols` Supabase schema as the canonical backend. Existing public ProgressTracker tables are migration sources only; they should not remain a runtime dependency after the merge.

ProjectControls currently represents the setup and administrative surface for project progress tracking. The merged app keeps those setup/admin pages and adds the stronger ProgressTracker workflows for upload, progress review, snapshots, earned value, discipline progress, and period comparison.

## Goals

- Merge both webapps into `Invenio ProjectControls`.
- Use one Supabase schema, one role model, one router, and one shared app shell.
- Preserve ProgressTracker functionality that is valuable to general users.
- Make current ProjectControls pages the setup/admin controls for the combined progress product.
- Restrict tenant/global decisions to `super_admin`.
- Restrict local project admin decisions to admins assigned through project membership.
- Retire duplicate ProgressTracker runtime paths after migration.

## Non-Goals

- Do not keep two long-lived frontend apps behind one auth system.
- Do not keep public ProgressTracker tables as permanent runtime tables.
- Do not redesign the whole visual system during the merge.
- Do not introduce a second Supabase project.

## Architecture

`Invenio ProjectControls` is the receiving app. It already has the stronger monorepo shape, richer project-controls modules, shared package hooks, app shell, router, auth provider, project store, and active Supabase migrations for `super_admin` and project membership.

The combined app has these surfaces:

- Setup/admin surface: current ProjectControls pages for project setup, COA, rules of credit, budget/baseline, user/project membership, and change management.
- Progress tracking surface: migrated ProgressTracker pages and workflows for dashboard, upload, earned value, discipline progress, period snapshots, snapshot comparison, first-audit baseline behavior, foreman aliasing, and IWP grouping.
- Shared shell/auth: ProjectControls `AppShell`, auth provider, router, project store, and role helpers.
- Shared data API: ProjectControls query/RPC style, expanded for tracker workflows.

The universal tracked work object should be named `progress_records`. The current ProjectControls `audit_records` name can remain as a migration/source concept during implementation, but the product-facing canonical model should be progress-oriented. "Audit" describes one source or import type; "progress record" describes the common object users work with.

## Authorization Model

Canonical roles:

```text
super_admin > admin > pm > pc_reviewer > editor > viewer
```

Rules:

- `super_admin` can make tenant/global governance decisions, grant `admin` and `super_admin`, and access projects across the tenant.
- `admin` is a local project admin when paired with a `projectcontrols.project_members` row for that project.
- `admin` cannot grant `admin` or `super_admin`.
- `admin` cannot modify users whose current role is `admin` or `super_admin`.
- `admin` cannot operate across projects they are not assigned to.
- `pm` handles project execution authority, such as approvals and period close where already modeled.
- `pc_reviewer` handles review actions.
- `editor` can update progress/import data where allowed.
- `viewer` has read-only project access.

Server-side SQL/RPC/RLS is the source of truth. Frontend role gates hide unavailable actions but must not be treated as security boundaries.

## Canonical Data Model

All canonical runtime tables live in the `projectcontrols` schema.

| Canonical table | Source and decision |
| --- | --- |
| `projectcontrols.tenants` | Keep ProjectControls. |
| `projectcontrols.app_users` | Keep ProjectControls and extend `user_role` with `super_admin`. |
| `projectcontrols.projects` | Keep ProjectControls; absorb tracker fields such as `qty_rollup_mode` and progress defaults. |
| `projectcontrols.project_members` | Keep the new ProjectControls migration; this table defines local admin boundaries. |
| `projectcontrols.project_disciplines` | Keep ProjectControls; migrate tracker `disciplines` into it. |
| `projectcontrols.iwps` | Add from ProgressTracker for IWP grouping and filtering. |
| `projectcontrols.progress_records` | Add as the canonical tracked work item, merging ProjectControls `audit_records` and tracker `progress_items`. |
| `projectcontrols.progress_record_milestones` | Add or rename from `audit_record_milestones` and tracker `progress_item_milestones`. |
| `projectcontrols.progress_snapshots` | Add or rename from tracker `period_snapshots`; freezes weekly and first-audit baseline states. |
| `projectcontrols.progress_snapshot_items` | Add from tracker `period_snapshot_items`; required for historical comparison and baseline drift. |
| `projectcontrols.progress_periods` | Keep ProjectControls; this represents reporting/close periods, not frozen item snapshots. |
| `projectcontrols.coa_codes` | Keep ProjectControls. |
| `projectcontrols.roc_templates` | Keep ProjectControls as the rules-of-credit library. |
| `projectcontrols.roc_milestones` | Keep ProjectControls; use to seed and calculate record milestone progress. |
| `projectcontrols.project_discipline_weights` | Add from tracker for quantity rollup modes. |
| `projectcontrols.foreman_aliases` | Add from tracker, tenant-scoped. |
| `projectcontrols.actual_hours` | Keep ProjectControls and link to `progress_records`. |
| `projectcontrols.baselines` | Keep ProjectControls for formal locked baseline snapshots. |
| `projectcontrols.change_orders` | Keep ProjectControls. |
| `projectcontrols.change_order_events` | Keep ProjectControls. |
| `projectcontrols.attachments` | Keep ProjectControls; allow `progress_record` as an attachment entity. |
| `projectcontrols.audit_log` | Keep ProjectControls. |

## Retired Tables

After migration and verification, these public ProgressTracker tables should be retired as runtime tables:

| Retired table | Replacement |
| --- | --- |
| `public.projects` | `projectcontrols.projects` |
| `public.disciplines` | `projectcontrols.project_disciplines` |
| `public.app_users` | `projectcontrols.app_users` |
| `public.project_members` | `projectcontrols.project_members` |
| `public.progress_items` | `projectcontrols.progress_records` |
| `public.period_snapshots` | `projectcontrols.progress_snapshots` |
| `public.period_snapshot_items` | `projectcontrols.progress_snapshot_items` |
| `public.audit_milestone_templates` | `projectcontrols.roc_templates` / `projectcontrols.roc_milestones` |
| `public.progress_item_milestones` | `projectcontrols.progress_record_milestones` |
| `public.foreman_aliases` | `projectcontrols.foreman_aliases` |
| `public.project_discipline_weights` | `projectcontrols.project_discipline_weights` |
| `public.iwps` | `projectcontrols.iwps` |

## Progress Records

`progress_records` should include the useful fields from both current models:

- Identity: `project_id`, `discipline_id`, `iwp_id`, `record_no` or `source_row`, `dwg`, `rev`, `description`.
- Quantity: `uom`, `budget_qty`, `actual_qty`, `earned_qty`.
- Hours: `budget_hrs` or `fld_whrs`, `actual_hrs`, `earned_hrs`.
- Progress: `percent_complete`, `status`, milestone rollup fields.
- Source/filtering: `source_type`, `source_filename`, `foreman_user_id`, `foreman_name`, `attr_type`, `attr_size`, `attr_spec`, `line_area`.
- Auditability: `created_by`, `updated_by`, `created_at`, `updated_at`.

The implementation plan should decide whether to physically rename existing `audit_records` to `progress_records` or create `progress_records` and backfill. The design preference is a canonical `progress_records` table for clarity.

## Snapshots And Periods

Keep snapshots and periods as separate concepts:

- `progress_periods` represent reporting/close periods.
- `progress_snapshots` represent frozen captures of record state, including weekly captures and the first-audit baseline.
- `progress_snapshot_items` store per-record frozen state for comparisons, S-curves, and baseline drift.

This separation preserves ProgressTracker's useful historical comparison behavior while keeping ProjectControls' reporting period model.

## Migration Phases

### Phase 1: Stabilize Auth And Roles

Finish the `super_admin` and project membership migrations already started in ProjectControls. Update frontend role helpers so `super_admin` outranks `admin`. Hide or hard-block tenant/global admin UI for non-super-admins.

### Phase 2: Create Canonical Progress Tables

Add canonical `projectcontrols` tables for:

- `iwps`
- `progress_records`
- `progress_record_milestones`
- `progress_snapshots`
- `progress_snapshot_items`
- `foreman_aliases`
- `project_discipline_weights`

Where practical, preserve source IDs during backfill so relationships migrate cleanly.

### Phase 3: Backfill From ProgressTracker

Move public tracker data into `projectcontrols.*` in dependency order:

1. Tenants and users, if not already represented.
2. Projects.
3. Disciplines.
4. Project members.
5. IWPs.
6. Progress records.
7. Milestone templates and progress milestones.
8. Progress snapshots.
9. Progress snapshot items.
10. Foreman aliases and discipline weights.

Backfill scripts must be idempotent and report row counts for source, inserted, updated, and skipped records.

### Phase 4: Port Tracker Workflows

Bring over these ProgressTracker workflows into ProjectControls:

- Tracker dashboard/overview.
- Upload/import flow.
- Discipline progress.
- Earned value and S-curve views.
- Period/snapshot comparison.
- Project settings pieces not already covered by ProjectControls.

Use ProjectControls app shell, router, auth, project store, UI primitives, query patterns, and Supabase client.

### Phase 5: Retire Duplicate Runtime Paths

Once ProjectControls reads and writes canonical tables, remove runtime references to public ProgressTracker tables and the standalone ProgressTracker frontend. Keep migration scripts and documentation until the migration has been verified and accepted.

## Routing

Target route structure:

```text
/                       Executive/project dashboard
/projects               Project setup and project selection
/projects/:id/settings  Local project admin settings
/projects/:id/progress  General tracker table/workflow
/projects/:id/upload    Progress import
/projects/:id/snapshots Period/snapshot comparison
/projects/:id/ev        Earned value
/coa                    COA library
/roc                    Rules of credit
/budget                 Project baseline/budget controls
/changes                Change management
/reports                Reports and analytics
/admin                  Super-admin tenant/user governance
```

Exact path shape can follow the current ProjectControls router if keeping existing paths reduces churn, but project-scoped routes should consistently derive authorization from the selected project and `project_members`.

## Error Handling

- SQL/RPC functions should raise explicit authorization errors for insufficient role and project membership failures.
- Backfill scripts should fail fast on referential integrity errors and include counts that identify which source concept failed.
- Import workflows should keep whole-file validation before writes where possible.
- Frontend screens should show existing ProjectControls error surfaces rather than introducing a second error UI style.

## Testing And Verification

Required verification areas:

- SQL role gates: admin cannot grant `admin` or `super_admin`; super_admin can; local admin cannot act outside assigned projects.
- Project membership: local admin can manage members/settings for assigned projects only.
- Backfill mapping: tracker projects, records, milestones, snapshots, and snapshot items land in canonical tables with expected counts and key IDs intact.
- Frontend role gates: super_admin sees `/admin`; local admin sees only assigned project settings; general users see tracker workflows for assigned projects.
- Import flow: workbook upload creates or updates progress records, milestones, snapshots, and snapshot items.
- Dashboard and earned value parity: canonical views reproduce ProgressTracker totals for migrated sample data.
- Regression tests for existing ProjectControls setup pages: project setup, COA, ROC, budget, changes, and reports still build and load.

## Open Implementation Decisions

- Whether to physically rename `audit_records` to `progress_records` or create a new table and migrate.
- Whether COA and ROC library pages are super-admin-only or super-admin plus explicitly delegated tenant library admins.
- Whether all legacy ProgressTracker IDs must be preserved, or only IDs required by foreign-key relationships and external references.
- Whether `progress_records.budget_hrs` should replace or alias `fld_whrs` from current ProjectControls records.
