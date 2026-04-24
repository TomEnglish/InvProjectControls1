# Invenio ProjectControls — Fullstack Architecture & Spec

This document is the authoritative build contract for **Invenio ProjectControls**, a multi-tenant construction project-controls platform modelled on the Invenio ProgressTracker stack. Chapters I–V mirror the stack decisions already proven in ProgressTracker; chapters VI–IX bind those decisions to the ProjectControls domain (earned value, Rules of Credit, three-budget model, change order workflow).

Sample tenant for seeding: **Kindred Industrial Services**, with two seed projects (`KIS-2026-001` Turnaround Alpha, `KIS-2026-002` Unit 12 Expansion).

---

## I. Frontend Structure (Vite + React)
* **Framework**: React 19 + TypeScript bundled via Vite. No Next.js — ProjectControls is a single-page admin console, not a marketing surface.
* **Routing**: `react-router-dom` with `BrowserRouter`. Protected routes wrap in `<AuthGuard>`; an additional `<ProjectScopeGuard>` asserts a selected `project_id` before rendering execution pages (Budget, Progress, Change Mgmt, Reports).
* **State Management**: `@tanstack/react-query` for all reads and mutations. The top-bar project selector writes `currentProjectId` to a Zustand store; query keys include `[scope, projectId, …]` so switching projects invalidates cleanly.
* **Charting**: `chart.js` + `react-chartjs-2` for the Executive S-Curve, Budget-vs-Earned-vs-Actual bars, CPI/SPI trend, and discipline doughnuts.
* **Iconography**: `lucide-react`. Sidebar icons replace the ASCII glyphs in the prototype (■ ⚛ ☰ ⚙ ★ ▶ ⇄ ▤).
* **Forms**: `react-hook-form` + `zod` for Project Setup, ROC editor, COA editor, Change Order submission, and the Add-Record modal. Zod schemas are the single source of truth for payload shapes — reused by the Edge Functions.
* **Tables**: `@tanstack/react-table` for the Progress audit grid (20-column row × ~1,000 records typical) with column virtualization; simpler tables (COA, CO log) render directly.
* **Field Resilience & Optimistic Updates**: All milestone mutations use React Query's `onMutate` / `onError` / `onSettled` optimistic-update pattern. On `onMutate`, the local cache is patched immediately and the previous value is stored for rollback. On network failure, `onError` restores the pre-mutation cache and surfaces a toast ("Update failed — restored previous value"). On `onSettled`, the query is invalidated to reconcile with the server. The 400 ms debounce on milestone edits (Flow 2) accumulates changes into a single RPC call; if the user navigates away before the debounce fires, a `beforeunload` listener flushes pending mutations synchronously. This matters because the platform is used in field conditions (turnaround sites, industrial environments) where connectivity is unreliable.

## II. Styling Foundation (Tailwind CSS v4)
* **Engine**: `@tailwindcss/postcss`. Single `index.css` import directive, no `tailwind.config.js`.
* **Design System (InvenioStyle)**:
    * CSS variables mathematically matched to `tokens.ts`.
    * **Semantic Tokens**: Surfaces use `bg-canvas`, `bg-surface`, `bg-raised`, `text-text`, `border-line` — never raw palette classes.
    * **Status tokens**: `status-active`, `status-draft`, `status-locked`, `status-closed`, `status-pending`, `status-approved` map to the same green/yellow/blue/grey/red chips the prototype uses.
    * **Variance tokens**: `variance-favourable` (green), `variance-unfavourable` (red), `variance-neutral`. All CPI/SPI/SV/CV cells consume these, so a theme swap reskins the whole report.
    * **Dynamic Dark Mode**: Triggered via the HTML `data-theme="dark"` attribute (Lucide toggle in the top bar). Shadow and boundary variables respected natively.
* **Demo palette mapping**: the prototype's `--primary: #1a365d`, `--accent: #dd6b20`, and status chip palette become the default `InvenioStyle` overrides for this app.

## III. Backend Architecture (Supabase / Postgres)
* **Database**: Managed remote PostgreSQL accessed via `@supabase/supabase-js`.
* **Multi-Tenancy Matrix**:
    * New signups intercepted by a `handle_new_user()` PostgreSQL **Trigger Function** firing on `auth.users` row inserts.
    * Users are bridged into `app_users` bound to a `tenant_id`.
    * Every domain table carries `tenant_id` (denormalized from `project_id` where applicable) for RLS.
* **Row-Level Security**:
    * Baseline policy: `tenant_id = current_setting('app.tenant_id')::uuid` on every table.
    * Role gates: `viewer` reads; `editor` mutates `audit_records`, `audit_record_milestones`, `change_orders` (draft/pending only); `pc_reviewer` moves COs to `pc_reviewed`; `pm` approves; `admin` locks baselines and edits COA/ROC.
* **Database RPCs over Edge Functions**:
    * Admin and project-controls mutations are **`SECURITY DEFINER`** Postgres RPCs (enumerated in VII).
    * This keeps variance math, baseline locks, and CO approval transactional and shielded from `role = 'viewer'` clients. Edge Functions are reserved for heavy I/O (IV).
* **Auditability**: Every mutating RPC writes to `audit_log` (entity, entity_id, action, actor_id, before_json, after_json, created_at). The Progress module's "audit trail entry created" toast is backed by a real row.

## IV. Edge Data Pipelines

**Decision rule — RPC vs Edge Function** (apply per operation, not per module):

| Pick an **RPC** when… | Pick an **Edge Function** when… |
|---|---|
| The operation is a pure Postgres transaction over tenant data | The operation parses a file format Postgres can't (xlsx, csv, pdf, docx) |
| Atomicity and RLS enforcement matter | The operation calls an external service (SMTP, Slack, S3, ERP, timekeeping) |
| Latency must be single-digit ms (dashboard KPIs, grid rendering) | The operation produces a binary artefact (report rendering, PDF export) |
| The logic is reusable from SQL (triggers, views, other RPCs) | The operation runs on a schedule or webhook (cron, Supabase triggers from Storage) |
| | The operation streams or mutates Supabase Storage |

State always lives in Postgres. Edge Functions never hold business logic that could be a view or RPC — they are thin adapters between the outside world and the RPC surface.

### Ingest (file → RPC)
* **`import-audit-records`** — Accepts the **61-column unified audit workbook** referenced in the prototype's Project Setup page. Parses `.xlsx` via `xlsx`, validates each row against the shared Zod schema, resolves `coa_code` + `discipline` FKs, then calls `record_bulk_upsert` RPC. Rejects the whole file on any row failure; returns a structured error report.
* **`import-coa-codes`** — Pulls an existing COA workbook into the `coa_codes` table via `coa_code_upsert`; validates `pf_rate = base_rate × pf_adj` to within 0.01.
* **`import-timecards`** — Ingests the weekly timecard export (CSV or `.xlsx`) into `actual_hours`. Resolves `(project_id, period_id, discipline_id, record_id?)` FKs. Delegates to `actuals_bulk_upsert` RPC. Triggers `period-close` eligibility check.
* **`import-ifc-quantities`** — Accepts updated Issued-For-Construction drawing takeoff deltas and converts them to draft Change Orders via `co_submit` (batched). Used by the "Import IFC Qty" button on the Progress page.

### Egress (RPC → file / external)
* **`export-report`** — Renders Quarterly Management Report, Earned Value Summary, Discipline Detail, Change Order Log, and Variance Analysis into `.xlsx` (via `exceljs`), `.pdf` (server-rendered React-PDF), or `.docx` (via `docx`). Writes the artefact to Supabase Storage under `reports/{tenant_id}/{project_id}/{report_id}.{ext}` and returns a **signed URL** (TTL from `REPORT_SIGNED_URL_TTL_SECONDS`, default 15 min). Report generation is async for large periods — the function returns `{ report_id, status: 'queued' }` and the frontend polls `report_status` RPC.
* **`export-baseline-snapshot`** — Serialises a `baselines.snapshot` row into a downloadable `.xlsx` + `.json` bundle for client deliverables. Signed URL, same storage bucket.

### Workflow side-effects (webhook-style)
* **`co-notify`** — Invoked by a Postgres trigger on `change_order_events` insert (Supabase `pg_net` or Database Webhook). Fans out notifications based on the new stage: *submitted* → PC reviewers; *pc_reviewed* → PM; *approved* / *rejected* → originator. Transport is pluggable — default SMTP (Resend), optional Slack webhook per tenant. Failure here must **never** block the RPC that fired it; retries live inside the function.
* **`audit-log-stream`** — Optional per-tenant webhook that forwards `audit_log` rows to a customer SIEM/data warehouse. Debounced and batched.

### Storage adapters
* **`attachments-upload`** — Signed POST for drawing files, CO supporting docs, and report artefacts. Validates MIME, virus-scans via Supabase Storage's native scanning (default for initial deployment; ClamAV sidecar is the self-hosted alternative for tenants requiring on-prem scanning). Writes an `attachments` row (`entity`, `entity_id`, `path`, `uploaded_by`). Returns the final URL.
* **`attachments-signed-url`** — Issues short-TTL signed URLs for downloading drawing files and report artefacts. RLS-equivalent check happens here since Storage doesn't share Postgres RLS.

### Scheduled / analytics
* **`period-close`** — Scheduled (Supabase cron, first business day of the month) or manually triggered. Calls `period_close` RPC to snapshot BCWS/BCWP/ACWP into `progress_periods`, locks the period, seeds the next.
* **`forecast-recompute`** — Weekly cron (Sunday 23:00 UTC, or chained after `period-close`). Runs heavier forecast math (ETS smoothing on CPI/SPI trend, EAC sensitivity bands) that would tie up a DB connection if done as an RPC. Writes results to a `forecasts` table with a `generated_at timestamptz` column; the Reports module reads them directly. **Staleness policy**: the frontend reads `forecasts.generated_at` and displays a "Forecast data as of {date}" label on all EAC/trend charts. If `generated_at` is older than 8 days, a warning badge ("Forecast may be stale — last computed {n} days ago") appears on the Reports and Dashboard modules. Admins can trigger a manual recompute via a **Refresh Forecasts** button that calls the Edge Function directly (rate-limited to 1 invocation per project per hour).
* **`variance-alerts`** — Nightly cron. Flags records/disciplines crossing CPI < 0.95 or SPI < 0.9 thresholds; writes to an `alerts` table surfaced in the Dashboard's alert bar.

## V. Netlify Production Deployment
* **Monorepo Hooks**: Split monorepo (frontend + backend). Root `netlify.toml`:
    ```toml
    [build]
      base = "frontend"
      command = "npm run build"
      publish = "dist"
    ```
* **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` injected via Netlify Security UI. Edge Function secrets (`SUPABASE_SERVICE_ROLE_KEY`, etc.) live in the Supabase dashboard, never Netlify.
* **SPA Redirection**: `[[redirects]] from="/*" to="/index.html" status=200` to survive dynamic React routing.
* **Branch deploys**: `main` → prod; PR previews get a throwaway Supabase branch via the Supabase/Netlify integration.

---

## VI. Data Model

All tables carry `tenant_id uuid not null` (RLS anchor), `created_at timestamptz default now()`, `updated_at timestamptz`. Foreign keys are `on delete restrict` unless noted.

### Identity
* **`tenants`** — `id`, `name`, `created_at`. One row per customer org. Kindred Industrial Services is the seed tenant.
* **`app_users`** — `id` (= `auth.users.id`), `tenant_id`, `email`, `display_name`, `role` enum(`admin`,`pm`,`pc_reviewer`,`editor`,`viewer`). Populated by `handle_new_user()` trigger.
* **`pending_invites`** — `id`, `tenant_id`, `email`, `role`, `invited_by`, `token` uuid (unique), `expires_at`, `accepted_at`. Tenant assignment is **invite-only**: an admin creates an invite row; the sign-up link includes the `token` as a query param. `handle_new_user()` looks up `pending_invites` by the new user's email + unexpired token, copies `tenant_id` and `role` into `app_users`, and marks the invite `accepted_at = now()`. If no matching invite exists, the trigger inserts `app_users` with `tenant_id = NULL` and `role = 'viewer'`; the user sees a "Pending Organisation Assignment" screen until an admin claims them. This prevents open-registration tenant leakage and keeps the multi-tenancy boundary explicit.

### Project Scope
* **`projects`** — `id`, `tenant_id`, `project_code` (`KIS-2026-001`), `name`, `client`, `status` enum(`draft`,`active`,`locked`,`closed`), `start_date`, `end_date`, `manager_id` → `app_users`, `baseline_locked_at`, `baseline_locked_by`.
* **`project_disciplines`** — `id`, `tenant_id`, `project_id`, `discipline_code` (`CIVIL`,`PIPE`,`STEEL`,`ELEC`,`MECH`,`INST`,`SITE`), `display_name`, `roc_template_id` → `roc_templates`, `budget_hrs`, `is_active`. `(project_id, discipline_code)` unique.

### Libraries (tenant-scoped)
* **`coa_codes`** — `id`, `tenant_id`, `prime` (`100`), `code` (`101`), `description`, `parent` (nullable → self-ref-by-code), `level` smallint, `uom`, `base_rate` numeric(10,4), `pf_adj` numeric(6,4), `pf_rate` numeric(10,4) **generated always as** (`base_rate * pf_adj`) stored. `(tenant_id, code)` unique.
* **`roc_templates`** — `id`, `tenant_id`, `discipline_code`, `name`, `version` smallint, `is_default` bool. `(tenant_id, discipline_code, version)` unique.
* **`roc_milestones`** — `id`, `tenant_id`, `template_id`, `seq` smallint (1..8), `label`, `weight` numeric(5,4). Constraint: `(template_id)` rows must have `seq` 1..8 and `sum(weight) = 1.0000` — enforced by the `roc_template_set` RPC and a **deferred constraint trigger**. Implementation detail: a `CONSTRAINT TRIGGER` with `INITIALLY DEFERRED` fires at `COMMIT` time, queries `SELECT count(*), sum(weight) FROM roc_milestones WHERE template_id = NEW.template_id`, and raises an exception if `count ≠ 8` or `abs(sum - 1.0000) > 0.0001`. This allows the `roc_template_set` RPC to `DELETE` + re-`INSERT` all 8 rows in a single transaction without mid-transaction constraint violations. A plain `CHECK` constraint cannot enforce cross-row sums in Postgres — this trigger approach is the standard workaround.

### Execution Data
* **`audit_records`** — the prototype's 20-column row. `id`, `tenant_id`, `project_id`, `discipline_id` → `project_disciplines`, `coa_code_id` → `coa_codes`, `rec_no` int (per-project sequence), `dwg`, `rev`, `description`, `uom`, `fld_qty` numeric(14,3), `fld_whrs` numeric(14,3), `status` enum(`draft`,`active`,`complete`,`void`). `(project_id, rec_no)` unique. `fld_whrs` defaults to `fld_qty * coa_codes.pf_rate` on insert; overridable.
* **`audit_record_milestones`** — `id`, `tenant_id`, `record_id`, `seq` smallint (1..8), `value` numeric(4,3) check (`value between 0 and 1`), `updated_by`, `updated_at`. Unique `(record_id, seq)`. Eight rows per record, seeded at 0 on create.
* **`audit_record_ev`** — **Implemented as a regular table, not a true Postgres `MATERIALIZED VIEW`**, to avoid full-view lock contention at scale. Columns: `record_id` (PK, FK → `audit_records`), `earn_pct`, `ern_qty`, `earn_whrs`. Formula: `earn_pct = Σ(milestone.value × roc_milestones.weight)`, `ern_qty = fld_qty × earn_pct`, `earn_whrs = fld_whrs × earn_pct`. Indexed on `record_id` for the Progress grid. **Refresh strategy**: the `record_update_milestones` RPC recalculates and `UPSERT`s only the affected `record_id` row in `audit_record_ev` at the end of its transaction — single-row write, no table-level lock. The `roc_template_set` RPC triggers a batch recalculation for all `record_id`s using the modified template (via `UPDATE … FROM` join). A nightly `VACUUM ANALYZE audit_record_ev` cron keeps index statistics current. This approach trades ~100 bytes of redundant storage per record for O(1) refresh cost instead of O(n) `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

### Budget, Actuals, Periods
* **`baselines`** — `id`, `tenant_id`, `project_id`, `locked_at`, `locked_by`, `snapshot` jsonb (full disciplines + records + milestones snapshot at lock time). Immutable once written.
* **`progress_periods`** — `id`, `tenant_id`, `project_id`, `period_number` int, `start_date`, `end_date`, `locked_at`, `bcws_hrs`, `bcwp_hrs`, `acwp_hrs`. Drives S-curve and CPI/SPI trend.
* **`actual_hours`** — `id`, `tenant_id`, `project_id`, `period_id`, `discipline_id`, `record_id` (nullable; null = discipline-level booking), `hours` numeric(14,3), `source` enum(`timecard`,`manual`,`import`). Aggregated into `progress_periods.acwp_hrs`.

### Change Management
* **`change_orders`** — `id`, `tenant_id`, `project_id`, `co_number` (`CO-001`, per-project sequence), `date`, `discipline_id`, `type` enum(`scope_add`,`scope_reduction`,`ifc_update`,`design_change`,`client_directive`), `description`, `qty_change` numeric(14,3), `uom`, `hrs_impact` numeric(14,3), `status` enum(`draft`,`pending`,`pc_reviewed`,`approved`,`rejected`), `requested_by`, `created_by`, `pc_reviewed_by`, `pc_reviewed_at`, `approved_by`, `approved_at`, `rejection_reason`. **Sequence generation**: `co_number` is assigned by the `co_submit` RPC using a Postgres `SEQUENCE` per project — specifically `nextval('co_seq_' || project_id::text)`. Sequences are created lazily by `co_submit` on first use (`CREATE SEQUENCE IF NOT EXISTS`). This is concurrency-safe; two simultaneous submissions to the same project will never collide on `co_number`.
* **`change_order_events`** — `id`, `tenant_id`, `co_id`, `event` (`submitted`,`pc_reviewed`,`approved`,`rejected`,`reopened`), `actor_id`, `notes`, `created_at`. One row per stage transition — renders the 4-step approval timeline.

### Observability
* **`audit_log`** — `id`, `tenant_id`, `entity` text, `entity_id` uuid, `action` text, `actor_id` uuid, `before_json` jsonb, `after_json` jsonb, `created_at`. Written by every mutating RPC.

---

## VII. Core Business Logic & RPCs

All RPCs are **`SECURITY DEFINER`**, take `tenant_id` / `project_id` explicitly (never trust client-set GUCs for writes), validate role via a helper `assert_role(min_role)`, and write `audit_log` before returning.

### Project & Baseline
* **`project_list()`** → projects for current tenant, role-filtered.
* **`project_summary(project_id)`** → overall %, total budget/earned/actual hrs, CPI, SPI, per-discipline rollup. Backs the Executive Dashboard.
* **`project_lock_baseline(project_id, lock_date)`** → `admin` only. Asserts `status = 'draft'`, writes `baselines` snapshot, flips `projects.status` to `active`, writes audit log. Once locked, direct edits to `project_disciplines.budget_hrs` are rejected — all adjustments flow through Change Orders.
* **`project_close(project_id)`** → `pm` only. Flips to `closed`, prevents further mutations.

### COA & ROC
* **`coa_code_upsert(payload)`** → validates `|pf_rate − base_rate × pf_adj| < 0.01`, upserts, audits.
* **`roc_template_set(template_id, milestones[])`** → replaces all 8 milestones atomically. Rejects if `count ≠ 8` or `sum(weight) ≠ 1.0000` (tolerance 0.0001). On success, triggers a refresh of `audit_record_ev` for every record using this template.

### Progress & Earned Value
* **`record_bulk_upsert(project_id, rows[])`** → called by `import-audit-records` Edge Function. Resolves FKs, upserts records, seeds 8 milestone rows at 0 per new record. Transactional.
* **`record_update_milestones(record_id, milestones[])`** → validates `0 ≤ value ≤ 1` for each seq, writes `audit_record_milestones`, refreshes `audit_record_ev` for the row, logs before/after.
* **`record_void(record_id, reason)`** → soft-delete (status = `void`), zeros earned value, logs.
* **`discipline_earned_value(project_id, discipline_id?, period_id?)`** → returns `{ bcws, bcwp, acwp, sv, cv, cpi, spi, eac }`. `bcws` = `budget_hrs × planned_pct(period)`; `bcwp` = Σ `earn_whrs`; `acwp` = Σ `actual_hours.hours`; `eac = budget_hrs / cpi`. Backs the Variance Analysis table and the Reports module.

### Three-Budget Rollup
* **`budget_rollup(project_id)`** → returns `{ original_budget, current_budget, forecast_budget, approved_changes_hrs, pending_changes_hrs }`.
    * `original_budget` = sum of `project_disciplines.budget_hrs` at `baselines.locked_at` (read from snapshot).
    * `current_budget` = `original_budget + Σ hrs_impact WHERE status = 'approved'`.
    * `forecast_budget` = `current_budget + Σ hrs_impact WHERE status IN ('pending','pc_reviewed')`.
* **`period_close(project_id, period_id)`** → freezes BCWS/BCWP/ACWP onto the period row; opens the next.

### Change Order Workflow (4-stage)
Each transition writes a `change_order_events` row *and* an `audit_log` row.

* **`co_submit(project_id, payload)`** → `editor+`. Creates CO in `pending`. Computes `hrs_impact` server-side: `qty_change × coa_codes.pf_rate` for the discipline's primary code, overridable.
* **`co_pc_review(co_id, decision, notes)`** → `pc_reviewer+`. Moves `pending` → `pc_reviewed` (forward) or `pending` → `rejected`.
* **`co_approve(co_id, decision, notes)`** → `pm+`. Moves `pc_reviewed` → `approved` (forward) or `pc_reviewed` → `rejected`. On approve, **no direct budget mutation**; the `budget_rollup` RPC aggregates approved COs on read. This keeps the Original Budget immutable after baseline lock and guarantees the three-budget view stays mathematically coherent.
* **`co_reopen(co_id, reason)`** → `admin`. Flips `rejected` → `pending`.

---

## VIII. Key Flows

### Flow 1: 61-Column Audit Import
1. User uploads `.xlsx` on Project Setup → Quantity Takeoff Import.
2. Frontend calls `import-audit-records` Edge Function with the file.
3. Edge Function parses, validates row-by-row against the shared Zod schema (61 fields), resolves `coa_codes.code` → `id` and `discipline_code` → `project_disciplines.id`.
4. On any row failure: no writes, returns `{ errors: [{ row, field, message }] }`.
5. On success: calls `record_bulk_upsert` RPC; returns `{ inserted, updated, skipped }`.
6. Frontend invalidates `['progress', projectId]` query; grid re-renders.

### Flow 2: Milestone Update with Audit Trail
1. User opens Progress → clicks a record → record detail panel renders 8 milestone inputs.
2. User edits M4 from 0 → 0.5.
3. `onChange` fires a debounced (400ms) mutation: `record_update_milestones(recordId, [{ seq: 4, value: 0.5 }])`.
4. RPC validates, writes `audit_record_milestones`, refreshes `audit_record_ev` row, writes `audit_log` with before/after.
5. React Query invalidates `['record', recordId]` and `['project-summary', projectId]`; the panel's Earned%/ERN QTY/EARN WHRS and the dashboard KPIs re-fetch.

### Flow 3: Change Order Lifecycle
1. Field Engineering submits CO via modal → `co_submit` → status `pending`, `change_order_events` row inserted → Postgres webhook fires **`co-notify`** Edge Function → PC reviewers receive email/Slack.
2. Project Controls reviews, calls `co_pc_review(id, 'forward', notes)` → status `pc_reviewed` → **`co-notify`** → PM notified.
3. Project Manager approves → `co_approve(id, 'forward', notes)` → status `approved` → **`co-notify`** → originator notified.
4. `budget_rollup` now picks up this CO's `hrs_impact` into `current_budget`. Dashboard's Current Budget KPI moves; Original Budget does not.
5. Rejection at any stage writes `rejection_reason` and a `change_order_events` row (also triggers **`co-notify`**); admins can `co_reopen`.

### Flow 4: Baseline Lock
1. Admin completes Project Setup + Active Disciplines + Quantity Takeoff import (seeds `audit_records`).
2. Admin picks a lock date on Budget & Baseline → clicks **Lock Baseline**.
3. `project_lock_baseline` RPC asserts `status = 'draft'`, serializes full project state into `baselines.snapshot`, flips status to `active`.
4. Post-lock, `project_disciplines.budget_hrs` becomes read-only; all scope changes require Change Orders. UI hides direct edits, shows CO entry points instead.

### Flow 5: Period Close & S-Curve Update
1. Monthly (manual by PC or Supabase cron-triggered **`period-close`** Edge Function).
2. Snapshots current BCWS/BCWP/ACWP into `progress_periods.{bcws_hrs, bcwp_hrs, acwp_hrs}`.
3. Seeds next period row with `start_date = prev.end_date + 1`.
4. Triggers **`forecast-recompute`** Edge Function to refresh EAC sensitivity bands and CPI/SPI smoothed trend into `forecasts`.
5. Reports module's CPI/SPI trend chart reads from `progress_periods` + `forecasts`.

### Flow 6: Actual Hours Import (Timecards)
1. Accounting exports the weekly timecard file (CSV/`.xlsx`) from the upstream timekeeping system.
2. PC uploads it on Progress → Import (or it's dropped into a watched Supabase Storage bucket).
3. **`import-timecards`** Edge Function parses, validates, resolves `(project, period, discipline, record?)` FKs, calls `actuals_bulk_upsert` RPC.
4. Per-period ACWP aggregates refresh automatically (materialized view); Dashboard CPI recalculates.
5. If the load lands after a period's `locked_at`, the function rejects and surfaces a Reports → Variance reconciliation entry rather than silently mutating history.

**Race condition mitigation (import vs. period-close)**: The `actuals_bulk_upsert` RPC acquires a `SELECT … FOR UPDATE` lock on the target `progress_periods` row at the start of its transaction and rechecks `locked_at IS NULL` inside the lock. If `period-close` has already locked the period between the Edge Function's initial check and the RPC call, the RPC raises `period_already_locked` and the entire transaction rolls back. This prevents a narrow window where the Edge Function validates against an unlocked period but the RPC executes after `period_close` has run. The Edge Function surfaces the rejection as a structured error: `{ error: 'period_locked', period_id, locked_at }`.

### Flow 7: Report Generation & Download
1. User picks report type + format on Reports → Export → clicks **Generate Report**.
2. Frontend calls **`export-report`** Edge Function → returns `{ report_id, status: 'queued' }` immediately.
3. Function renders asynchronously, writes artefact to Supabase Storage (`reports/{tenant_id}/{project_id}/…`), updates `reports` row to `ready`.
4. Frontend polls `report_status(report_id)` RPC (React Query auto-refetch on interval) until `ready`, then calls **`attachments-signed-url`** Edge Function for the download link.
5. Browser downloads via signed URL (TTL 15 min). Link expires; regenerate as needed.

---

## IX. Module → Data & API Map

| Module (sidebar) | Reads (RPC / view) | Writes (RPC) | Edge Functions |
|---|---|---|---|
| **Dashboard** | `project_summary`, `v_progress_grid` agg, `progress_periods` (S-curve), `alerts` | — | — |
| **Project Setup** | `projects`, `project_disciplines`, `roc_templates` | `projects` update, `project_disciplines` CRUD pre-lock | `import-audit-records` |
| **COA & Unit Rates** | `coa_codes` | `coa_code_upsert` | `import-coa-codes` |
| **Rules of Credit** | `roc_templates` + `roc_milestones` | `roc_template_set` | — |
| **Budget & Baseline** | `budget_rollup`, `project_summary` | `project_lock_baseline` | `export-baseline-snapshot` |
| **Progress & EV** | `v_progress_grid` (`audit_records` × milestones × EV × coa) | `record_update_milestones`, `record_void`, `actuals_bulk_upsert` | `import-audit-records`, `import-timecards`, `import-ifc-quantities`, `attachments-upload`, `attachments-signed-url` |
| **Change Mgmt** | `change_orders`, `change_order_events` | `co_submit`, `co_pc_review`, `co_approve`, `co_reopen` | `co-notify` (trigger-fired), `attachments-upload` (supporting docs) |
| **Reports** | `discipline_earned_value`, `progress_periods`, `forecasts`, `change_orders`, `reports` (status table) | `report_status` | `export-report`, `attachments-signed-url` |

### Cron-scheduled Edge Functions (no module owner)
* **`period-close`** — monthly, first business day.
* **`forecast-recompute`** — weekly, Sunday night (or after `period-close`).
* **`variance-alerts`** — nightly.

### Recommended Postgres views
* **`v_progress_grid`** — one row per audit record with 8 milestone values pivoted into columns plus the EV triple. Backs the Progress table without N+1s.
* **`v_discipline_rollup`** — per-project-discipline totals of budget/earned/actual + CPI. Backs the Dashboard discipline summary.
* **`v_project_kpis`** — a regular Postgres `VIEW` (not materialized) that returns one row per `(tenant_id, project_id)` with live-computed KPIs: `total_budget_hrs`, `total_earned_hrs`, `total_actual_hrs`, `overall_earn_pct`, `cpi`, `spi`, `eac_hrs`, `sv_hrs`, `cv_hrs`, `active_co_count`, `pending_co_hrs`. Because this is a standard view (not a MATVIEW), it always reflects current data with no refresh needed. Performance is acceptable for single-project dashboard loads (~5–15 ms) since it aggregates over `audit_record_ev` (indexed on `record_id`) and `actual_hours` (indexed on `project_id, period_id`). If query time degrades beyond 50 ms at scale, convert to a materialized table with the same trigger-based refresh pattern used by `audit_record_ev`.

### Environment contract
```
# Frontend (Netlify UI)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Edge functions (Supabase dashboard secrets only)
SUPABASE_SERVICE_ROLE_KEY=
IMPORT_MAX_ROWS=50000              # ⚠ Memory budget: 50k × 61 cols ≈ 200–400 MB parsed in-process.
                                    #   Supabase Edge Functions have a 150 MB memory limit.
                                    #   For files exceeding ~5,000 rows, the import Edge Functions
                                    #   chunk the workbook into 5,000-row batches, calling the
                                    #   bulk upsert RPC per batch within a single request.
                                    #   Files exceeding IMPORT_MAX_ROWS are rejected pre-parse.
REPORT_SIGNED_URL_TTL_SECONDS=900

# Notifications (co-notify)
RESEND_API_KEY=
NOTIFY_FROM_EMAIL=controls@invenio.app
                                    #   Requires DNS: DKIM, SPF, and DMARC records for invenio.app
                                    #   must be configured in the domain registrar and verified in
                                    #   Resend's dashboard before emails will deliver. Without this,
                                    #   Resend will reject sends from this address.
SLACK_WEBHOOK_URL=        # optional, per-tenant override in tenants.settings

# Storage / attachments
ATTACHMENTS_BUCKET=attachments
REPORTS_BUCKET=reports
ATTACHMENTS_MAX_MB=50
ATTACHMENTS_ALLOWED_MIME=application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

# Cron-triggered functions
FORECAST_HORIZON_PERIODS=6
VARIANCE_CPI_THRESHOLD=0.95
VARIANCE_SPI_THRESHOLD=0.90
```

### Seed data (for `npm run seed`)
**Target**: Remote Supabase project (uses `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`). The seed script is idempotent — safe to re-run without duplicating data (upserts on natural keys). For local development with Supabase CLI (`supabase start`), the same script targets the local Docker Postgres via `SUPABASE_URL=http://localhost:54321`.

* 1 tenant (Kindred Industrial Services), 1 admin user, 1 PM user, 1 pending invite (editor role).
* 2 projects (`KIS-2026-001` active + locked baseline, `KIS-2026-002` draft).
* 7 disciplines, 12 COA codes, 7 ROC templates (all eight-milestone), 10 audit records with sample milestones, 3 change orders covering all three statuses shown in the prototype.
* 2 `progress_periods` for `KIS-2026-001` (one locked, one open) with sample BCWS/BCWP/ACWP data to populate the S-curve on first load.

---

## X. Testing Strategy

Four test layers, each running in CI on every PR. Coverage gates: ≥80% on RPCs, ≥70% on frontend components, 100% of flows in VIII exercised by at least one E2E scenario.

### Unit — Vitest (frontend)
* **Scope**: pure functions (earned-value math mirrors, formatters, Zod schema tests), React components rendered with `@testing-library/react`, hook behaviour (React Query caches, optimistic updates).
* **Shared schemas**: the Zod payload schemas in `packages/schemas/` are tested in isolation — the *same* schemas are imported by frontend forms, Edge Functions, and the RPC test harness, so a single test asserts contract correctness everywhere.
* **Mocks**: Supabase client mocked via `msw` at the network layer (not the SDK layer) so we test real JSON contracts.

### RPC contract — pgTAP + TypeScript integration
* **pgTAP** (`supabase/tests/`): one `.sql` test file per RPC. Asserts: role gating (`assert_role`), input validation, tenant isolation (queries from tenant A cannot touch tenant B), audit-log row shape, transactional rollback on mid-RPC failure.
* **TypeScript integration** (`tests/rpc/`): spins up a dedicated ephemeral Supabase project (see XI — PR preview DBs), runs RPC calls as each role via the client SDK, asserts return shapes against the shared Zod schemas. Catches "works in isolation, breaks through the cable" regressions.
* **Gold tests**: `record_update_milestones` and `co_approve` have scripted sequences comparing before/after state against `fixtures/gold/*.json` — the math MUST stay stable.

### Edge Functions — Deno test
* **Scope**: file parsing (Excel / CSV fixtures under `supabase/functions/_fixtures/`), Zod validation, FK resolution, error-report formatting.
* Network calls (Supabase RPC, Resend, Slack) stubbed via Deno's `--allow-net=localhost` and a local fake. Each function has a "happy path", "partial failure", and "external-service-down" scenario.
* **Contract test**: for each Edge Function that calls an RPC, a shared fixture round-trips through the real RPC in the PR preview DB — guards against the function and RPC drifting.

### E2E — Playwright
* **Browsers**: Chromium (primary), Firefox, WebKit (smoke only). Mobile viewport covered for the field-resilience path.
* **Scenarios** (one-to-one with flows in VIII):
    1. Admin imports 61-col workbook → grid populates → baseline locks.
    2. Editor updates milestones, navigates away mid-debounce → `beforeunload` flush → server reflects the edit on return.
    3. CO submitted → PC review → PM approve → Current Budget KPI updates.
    4. PM locks baseline → direct budget edits become read-only; CO entry points replace them.
    5. Scheduled `period-close` fires → S-curve updates; prior period rows become immutable.
    6. Timecard `.xlsx` upload → ACWP refreshes → CPI recalculates.
    7. Report generated → async polling → signed URL download works → URL expires on TTL.
* **Auth fixture**: each test gets a freshly-seeded tenant via an RPC `test_bootstrap_tenant(preset)` (only available when `NODE_ENV=test`) — fully parallel-safe.
* **Flaky-test guard**: tests retry once in CI, but any test flaking twice in a week auto-opens an issue via a GitHub Action.

### CI pipeline (GitHub Actions)
```
lint          → eslint + prettier + sqlfluff
typecheck     → tsc --noEmit across frontend + edge
test:unit     → vitest
test:rpc      → pgTAP against PR preview DB
test:edge     → deno test (per function)
test:e2e      → playwright (against Netlify deploy preview + PR preview DB)
build         → vite build + edge function bundle
```
All steps run in parallel where possible. `test:e2e` depends on `build` + preview deploy completing. A merged PR cannot land without green on all.

---

## XI. Migrations & Seeding

### Migration workflow — Supabase CLI
* **Source of truth**: `supabase/migrations/NNNN_snake_case.sql` — numbered sequentially (timestamped), checked in, reviewed like any code. Never edit a merged migration; always append a new one.
* **Developer loop**:
    1. `supabase start` (local Docker Postgres).
    2. Write SQL against the running DB, or apply changes in Supabase Studio.
    3. `supabase db diff -f descriptive_name` generates the migration from the delta.
    4. Review the diff, hand-edit if needed (formatting, constraint names, comments), commit.
    5. `supabase db reset` replays from zero to verify the migration applies cleanly on top of a fresh schema.
* **Production apply**: CI runs `supabase db push` on merge to `main`. A required approval + a 5-minute delay gate between PR merge and apply, to allow abort.
* **Rollback policy**: migrations are forward-only. "Undo" ships as a new migration. Production schema state is reproducible from `migrations/` alone — no drift allowed.

### Migration conventions
* Every new table: RLS enabled in the *same* migration that creates it. Never create a table without an RLS policy.
* Every new RPC: `security definer`, `set search_path = public, extensions` (shield against search-path attacks), `revoke all on function … from public`, `grant execute` only to the roles that need it.
* Destructive ops (`drop column`, `drop table`): two-phase — mark deprecated in migration N, remove in N+1 at least one release later. Pre-deprecation migration must include a "no readers left" verification query committed alongside.
* Index creation on large tables: `create index concurrently` — blocking index builds are banned.

### PR preview databases
* Supabase + Netlify integration spins a branch database per PR. CI runs migrations against it before E2E. Preview DBs are seeded with a shrunken fixture (~100 audit records, not 10k) so tests stay fast.
* Branch DBs auto-teardown 72h after PR close.

### Seeding script (`npm run seed`)
* Lives in `scripts/seed/` as TypeScript, calls the Supabase JS client with the service-role key.
* Idempotent via `upsert` on natural keys (`tenants.name`, `projects.project_code`, `coa_codes.(tenant_id, code)`, etc.).
* Modes:
    * `seed:minimal` — 1 tenant, 1 project, just enough to boot the UI.
    * `seed:demo` — the full seed enumerated at the end of X.
    * `seed:stress` — demo + 10k synthetic audit records for perf testing.
* `test_bootstrap_tenant(preset)` RPC (test-only) wraps `seed:minimal` for E2E isolation.

### Destructive ops runbook
* Dropping a tenant: `admin_purge_tenant(tenant_id, confirmation_phrase)` RPC — service-role only, never exposed to the SDK. Soft-deletes first (flags all rows), waits a configurable grace period, then hard-deletes. Logs to an off-DB audit stream before running so the action survives the tenant row it just deleted.
* Resetting a project's milestones: `project_reset_progress(project_id, confirmation_phrase)` — zeros `audit_record_milestones` and refreshes `audit_record_ev`. Writes a single audit-log row summarising count.

---

## XII. Observability & Metrics

Three planes — application, infrastructure, domain — each with its own dashboard and alert rules.

### Application (frontend)
* **Error tracking**: Sentry. Source maps uploaded at build time. User identifiers (`app_users.id`) attached post-auth; email scrubbed.
* **Performance**: Sentry Web Vitals + a custom `chart.render.duration` span around each `Chart.js` init, `grid.render.duration` around `@tanstack/react-table` mounts. Alerts fire if p95 breaches the budgets in XVI.
* **RPC client metrics**: a thin wrapper around the Supabase client emits `rpc.duration`, `rpc.error_rate`, and `rpc.payload_bytes` to Sentry as custom metrics, keyed by RPC name.
* **Session replay**: enabled only on error (not sampled globally) — keeps payload cost predictable and PII exposure limited.

### Infrastructure (Postgres + Edge + Storage)
* **Postgres**: Supabase's built-in query-performance view + `pg_stat_statements`. Weekly review; any query above 100ms at p95 is triaged. Long-running transactions alerted at 30s.
* **Edge Functions**: Supabase Function Logs streamed to the chosen log sink (Datadog / Logtail / Axiom — pick one per deployment). Custom log lines include `{ function, tenant_id, project_id, duration_ms, status }`.
* **Storage**: per-bucket size + object count dashboard; alert at 80% of the configured quota.
* **Supabase health**: `/_health` + `status.supabase.com` subscription; PagerDuty route for the infra-oncall rotation.

### Domain (project-controls signals)
Domain metrics are themselves data in Postgres — they aren't just ops telemetry.

* **`metrics_project_daily`** (materialized view, refreshed nightly): per-project, per-day snapshot of CPI, SPI, earned %, open CO count, records updated. Backs trend charts and the `variance-alerts` Edge Function.
* **`metrics_rpc_activity`** (table): each mutating RPC increments a counter keyed by `(tenant_id, rpc_name, day)`. Used for usage-based billing later and for anomaly detection (a tenant suddenly emitting 100× the usual volume → investigate).
* **`audit_log` introspection**: a read-only view `v_audit_log_recent` exposed to admin users of a tenant — their own activity feed without giving write access.

### Alerts — operational
| Signal | Threshold | Route |
|---|---|---|
| Edge Function error rate | >2% over 5 min | infra-oncall |
| RPC p95 latency | >500ms over 10 min | infra-oncall |
| Postgres connection saturation | >80% | infra-oncall |
| Storage bucket size | >80% quota | infra-oncall |
| Sentry new-issue spike | >10 new issues / hour | frontend-oncall |
| `co-notify` failure | any failure → retry; after 3 retries | product-oncall |

### Alerts — domain (per-tenant, opt-in)
| Signal | Threshold | Route |
|---|---|---|
| CPI crosses below 0.95 | sustained 2 periods | tenant PM (email) |
| SPI crosses below 0.90 | sustained 2 periods | tenant PM (email) |
| CO pending >14 days | age threshold | tenant PC reviewer |
| Record un-touched for >30 days post-kickoff | staleness | tenant PM |

All tenant alerts are configurable in Project Setup → Notifications (new subsection) — no surprise emails.

### Log retention
* Edge function logs: 30 days hot, 1 year cold (archived to Supabase Storage / S3).
* Postgres logs: 90 days.
* `audit_log`: 7 years (regulatory — construction contract disputes run long).
* Sentry: 90 days.

---

## XIII. Authentication Flows

Supabase Auth as the primary identity provider, with pluggable SSO per tenant.

### Primary flow — email/password
1. Admin invites user via Project Setup → Users → **+ Invite** (opens modal: email, role).
2. Frontend calls `admin_create_user_invite(email, role, tenant_id)` RPC → writes `auth.users` with `email_confirm = false` and `app_users` row with `status = 'invited'`.
3. Supabase sends the invite email (template overridden in Supabase Dashboard to match InvenioStyle).
4. User clicks link → lands on `/auth/accept-invite?token=…` → sets password → Supabase marks email confirmed.
5. `handle_new_user()` trigger fires on the `auth.users` row flip from unconfirmed → confirmed (not on insert, since we insert pre-confirmed), promotes `app_users.status` from `invited` → `active`.
6. User redirects to `/` → `<AuthGuard>` passes → `<TenantProvider>` sets `app.tenant_id` GUC on the session.

### Password reset
Standard Supabase magic-link reset. Email template branded. Rate-limited to 3 requests per 15 min per email at the edge (pre-Supabase) to prevent enumeration/abuse.

### Magic link (optional fallback)
Supabase Auth magic-link, enabled per tenant (`tenants.settings.allow_magic_link`). Off by default — many construction clients require passwords for SOX/compliance.

### SSO — SAML / OIDC (enterprise tenants)
* Configured per tenant via Supabase Auth's SAML 2.0 or OIDC support (Pro tier).
* Identity mapping: IdP email → `app_users.email` (case-insensitive match). If no row exists, `handle_new_user_sso()` creates one bound to the tenant *claimed* in the SAML assertion's `tenant_id` attribute — not trusted alone; a tenant admin must pre-approve the domain (`tenants.allowed_sso_domains`).
* Role claim: `role` SAML attribute maps to `app_users.role`; missing → `viewer`. Admin role can only be elevated via the tenant admin, never via SSO claim (prevents IdP compromise from auto-granting admin).

### MFA (TOTP, optional)
* Enabled per user. Admin can enforce per tenant via `tenants.settings.require_mfa`.
* Enrollment: user scans QR in Profile → verifies one code → MFA required on every subsequent login.
* Recovery codes: 10 single-use codes issued at enrolment, stored hashed.

### Session management
* JWT access token: 60 min.
* Refresh token: 7 days, sliding (every successful API call resets the window).
* Idle timeout: 30 min of no network activity → refresh token revoked, forced re-login. Implemented client-side with a watchdog; server enforces by rejecting refresh tokens older than `last_seen + 30 min` via a custom Supabase hook.
* "Log out everywhere" on Profile → revokes all refresh tokens for the user (`auth.admin.signOut(scope='global')` via a `user_sign_out_all` RPC).

### Role transitions
* `app_users.role` changes are RPC-only (`admin_set_user_role(user_id, new_role, reason)`), audit-logged, and emit a forced re-login for the affected user (invalidate refresh tokens) so stale JWTs can't keep elevated permissions.

### Tenant boundary
* Cross-tenant access is never permitted, including by Supabase service-role (outside of `admin_purge_tenant` and schema migrations). The convention: all RPCs take `tenant_id` as a first argument and assert `tenant_id = app.tenant_id` before touching rows — defence in depth on top of RLS.

---

## XIV. 61-Column Unified Audit Schema

This is the contract the `import-audit-records` Edge Function validates against — the canonical "Kindred-format" workbook accepted by every customer in the sample tenant's format. Columns are grouped for readability; workbook order is the numbered sequence.

### Identity & Origin (1–8)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 1 | `rec_no` | int | yes | per-project sequence; import generates if blank |
| 2 | `project_code` | string | yes | must match `projects.project_code` |
| 3 | `source_file` | string | yes | original workbook filename, for audit |
| 4 | `source_sheet` | string | yes | tab name within workbook |
| 5 | `source_row` | int | yes | row in the tab (for error reporting) |
| 6 | `row_hash` | string | yes | sha256 of normalized row — used for idempotent upsert |
| 7 | `imported_by` | string | auto | populated by Edge Function |
| 8 | `imported_at` | timestamp | auto | populated by Edge Function |

### Drawing / Design (9–13)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 9 | `dwg` | string | yes | drawing number |
| 10 | `rev` | string | yes | revision (alphanumeric allowed) |
| 11 | `sheet` | string | no | sheet within DWG |
| 12 | `dwg_title` | string | no | free text |
| 13 | `ifc_date` | date | no | issued-for-construction date |

### Location / Physical (14–20)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 14 | `area` | string | yes | plant area |
| 15 | `sub_area` | string | no | |
| 16 | `unit` | string | no | process unit |
| 17 | `system` | string | no | system tag |
| 18 | `line_tag` | string | no | pipe line or equipment tag |
| 19 | `iso` | string | no | isometric # |
| 20 | `spool_or_joint` | string | no | weld/joint spool ref |

### Commercial / COA (21–26)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 21 | `discipline_code` | enum | yes | CIVIL / PIPE / STEEL / ELEC / MECH / INST / SITE |
| 22 | `coa_prime` | string | yes | must match `coa_codes.prime` |
| 23 | `coa_code` | string | yes | must match `coa_codes.code` |
| 24 | `coa_parent` | string | derived | cross-checked against `coa_codes.parent` |
| 25 | `coa_level` | int | derived | cross-checked against `coa_codes.level` |
| 26 | `description` | string | yes | line item description |

### Quantity (27–32)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 27 | `uom` | enum | yes | LF / CY / EA / TONS / SF / HR / LS |
| 28 | `ifc_qty` | decimal | yes | qty per IFC drawing |
| 29 | `contract_qty` | decimal | no | contracted qty if different from IFC |
| 30 | `fld_qty` | decimal | yes | field-installed qty (current) |
| 31 | `prev_fld_qty` | decimal | no | prior-period FLD QTY (for delta) |
| 32 | `qty_source` | enum | no | `takeoff` / `ifc` / `field_measured` / `co` |

### Budget / Hours (33–37)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 33 | `base_rate` | decimal | derived | from `coa_codes.base_rate` at import |
| 34 | `pf_adj` | decimal | derived | from `coa_codes.pf_adj` at import |
| 35 | `pf_rate` | decimal | derived | `base_rate × pf_adj` |
| 36 | `fld_whrs` | decimal | yes | field work hours; if blank, computed as `fld_qty × pf_rate` |
| 37 | `budget_whrs` | decimal | no | if different from `fld_whrs` (rare; for anomaly flag) |

### Milestones M1–M8 (38–45)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 38–45 | `m1` … `m8` | decimal | yes | range `[0, 1]`, default `0`; ROC-specific labels |

### Earned Value (46–50)
Derived; the importer writes zeros/placeholders and `audit_record_ev` materializes the real values post-commit. Carried in the workbook so exports round-trip cleanly.
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 46 | `earn_pct` | decimal | derived | `Σ(m_i × weight_i)` |
| 47 | `ern_qty` | decimal | derived | `fld_qty × earn_pct` |
| 48 | `earn_whrs` | decimal | derived | `fld_whrs × earn_pct` |
| 49 | `prev_earn_whrs` | decimal | no | for period-delta math |
| 50 | `period_earn_whrs` | decimal | no | `earn_whrs − prev_earn_whrs` |

### Schedule (51–55)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 51 | `planned_start` | date | no | |
| 52 | `planned_end` | date | no | |
| 53 | `actual_start` | date | no | |
| 54 | `forecast_end` | date | no | |
| 55 | `total_float_days` | int | no | for late-runner detection |

### Quality / Inspection (56–58)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 56 | `hold_point` | bool | no | |
| 57 | `nde_status` | enum | no | `pending` / `complete` / `failed` / `n/a` |
| 58 | `punch_list_open` | int | no | count of open items |

### Status / Audit (59–61)
| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 59 | `record_status` | enum | yes | `draft` / `active` / `complete` / `void` |
| 60 | `notes` | string | no | free-text |
| 61 | `last_updated_by` | string | auto | populated by Edge Function |

### Validation rules enforced by `import-audit-records`
1. Required columns non-null, enums in allowed set, decimals ≥ 0.
2. `project_code` resolves to a project in the caller's tenant and `status ∈ ('draft','active')` (no imports into locked/closed projects outside a CO flow).
3. `discipline_code` × `coa_code.prime` consistency (Pipe records can't carry Civil COA codes).
4. `Σ milestones × weights ≤ 1.0001` (floating-point tolerance).
5. `pf_rate ≈ base_rate × pf_adj` within 0.01.
6. `row_hash` uniqueness across the import — duplicate rows in the same file are an error, not silently deduped.
7. Whole-file atomicity: any row failure rejects the entire workbook with a structured error report. Partial imports are never allowed — they make reconciliation intractable.

A downloadable `template.xlsx` (served from `reports/public/unified-audit-template.xlsx`) ships with column headers, data validation dropdowns, and a sample row.

---

## XV. Module UI Wireframes

Each module is a single route under `<AuthGuard>`. Layout is consistent: sidebar (fixed 240px) + topbar (sticky 56px) + content (max 1400px). Modules below describe content-area layout only.

### 1. Dashboard (`/`)
* **Row 1** — four KPI cards: Overall Earned %, Earned Hours, CPI, SPI. Each shows current value, prior-period delta (coloured up/down), and a sparkline from the last six `progress_periods`.
* **Row 2** — two charts side-by-side: Earned Value by Discipline (grouped bar) + S-Curve (line, planned/earned/actual).
* **Row 3** — Discipline Summary table (records, budget hrs, earned hrs, actual hrs, % complete, CPI, progress bar).
* **Row 4** — Alerts strip (from `alerts` table): up to 3 most recent `variance-alert` or stale-record entries, dismissible.
* **States**: loading skeletons for KPIs + charts; empty state "No active projects — create one in Project Setup."
* **Interactions**: clicking a discipline row → Progress module pre-filtered; clicking an alert → the relevant record detail.

### 2. Project Setup (`/projects`)
* **Card 1** — Project Information form (6 fields, editable pre-lock, read-only post-lock except Name/Client/PM).
* **Card 2** — Active Disciplines table with "+ Add Discipline" + per-row Configure (opens ROC template picker).
* **Card 3** — Quantity Takeoff Import: source picker (Excel / CSV / Manual), target discipline, Upload & Validate + Download Template buttons.
* **Card 4** — Users & Invites: list of `app_users` for tenant + pending invites + "+ Invite" button.
* **Card 5** — Notifications: per-user, per-alert-type opt-in checkboxes (drives XII alerts).
* **States**: disabled submits when baseline locked (with tooltip "Baseline locked — use Change Mgmt").

### 3. COA & Unit Rates (`/coa`)
* **Tabs**: Cost Codes / Unit Rates.
* **Cost Codes tab** — flat table (prime, code, desc, parent, level, UOM, base U/R, PF adjust, PF U/R, Edit). "+ Add Code" and "Import from COA Report" buttons.
* **Unit Rates tab** — rate editor form (code picker, base rate, PF adj, computed PF rate), "+ New Rate", save.
* **States**: edit-in-place with inline validation; bulk import previews before commit.

### 4. Rules of Credit (`/roc`)
* One card per discipline, showing an 8-cell milestone grid (label + weight %). Weight total chip — green if 100.0%, red otherwise.
* Edit mode: opens a modal with the 8 milestones as editable (label, weight) rows and a running total. Save disabled until sum = 100.00%.
* **+ New Template** button allows discipline-level override per project (e.g., "Pipe — Small Bore" variant).

### 5. Budget & Baseline (`/budget`)
* **Row 1** — three KPI cards with coloured left borders: Original Budget (navy), Current Budget (orange), Forecast Budget (yellow). Each shows hrs + narrative (e.g., "OB + Approved Changes (+145)").
* **Row 2** — Budget by Discipline (grouped bar: OB / CB / FB) + Baseline Controls card (lock date, Lock Baseline button when draft, Baseline Snapshot + Export when active).
* **Inline explainer** — three-budget model primer box.
* **Interactions**: Lock Baseline opens a confirmation modal summarising what will be frozen.

### 6. Progress & EV (`/progress`)
* **Header bar** — discipline filter, DWG/Desc search, "+ New Record" / "Import IFC Qty" / "Export" buttons.
* **Main table** — the 20-column grid from the prototype, virtualized. Clicking a row opens the Record Detail panel *inline below the row* (not a modal — keeps context for comparisons).
* **Record Detail panel** — discipline, desc, FLD QTY, FLD WHRS; 8 milestone inputs with labels + weights; Earned %/ERN QTY/EARN WHRS summary; Save Progress button (RPC-backed, optimistic).
* **Attachments sub-tab** in detail panel: drawing files + supporting docs (signed URL downloads).
* **States**: optimistic milestone updates with toast on rollback (per I. Field Resilience).

### 7. Change Management (`/changes`)
* **Header bar** — status filter, "+ New Change Order" button.
* **Main table** — CO log (CO #, Date, Discipline, Type, Description, Qty, UOM, Hrs Impact, Status chip, Requested By).
* **Right column** — Impact Summary (qty, hrs, budget impact) + Approval Workflow stepper showing each CO's current stage.
* **+ New CO modal** — form per the prototype + attachments upload.
* **Per-CO expansion** — timeline of `change_order_events` and per-stage action buttons gated by role.

### 8. Reports (`/reports`)
* **Tabs**: Earned Value / By Discipline / Export.
* **EV tab** — Budget vs Earned vs Actual bar chart + CPI/SPI trend line + Variance Analysis table (BCWS/BCWP/ACWP/SV/CV/CPI/SPI/EAC per discipline).
* **By Discipline tab** — doughnut of discipline budget distribution + drill-down.
* **Export tab** — report type + format + period + disciplines → Generate Report. Generated reports list with status chips + download (signed URL).
* **States**: report-generation progress bar with ETA; expired URL state offers "Regenerate Link."

### Shared components
* **TopbarProjectSelector** — sticky; single source of `STATE.currentProject`.
* **StatusChip** — consumes `status-*` tokens from II.
* **VarianceCell** — renders CPI/SPI/SV/CV with the right `variance-*` token.
* **AuditTrailTooltip** — hover on any mutable field shows last-updated-by + timestamp pulled from `audit_log`.

---

## XVI. Non-Functional Requirements

### Performance budgets
| Metric | Budget | Measurement |
|---|---|---|
| Initial JS bundle (gzipped) | ≤ 250 KB | Vite build report, enforced in CI |
| First Contentful Paint (desktop, 4G) | ≤ 1.5 s p95 | Sentry Web Vitals |
| Dashboard KPI cards render | ≤ 500 ms from route mount | `grid.render.duration` metric |
| Progress grid (1000 rows, cold) | ≤ 1.0 s p95 | `grid.render.duration` metric |
| Progress grid scroll | ≥ 55 fps sustained | Playwright perf trace |
| Milestone update RPC round-trip | ≤ 300 ms p95 | `rpc.duration` metric |
| `project_summary` RPC | ≤ 150 ms p95 | `rpc.duration` metric |
| Chart initial render (any chart) | ≤ 400 ms p95 | `chart.render.duration` metric |

Budgets enforced in CI: bundle size via `size-limit`; p95 budgets asserted against a rolling 7-day Sentry window, with CI failing a PR if any budget is already breached on main (prevents piling on).

### Scale limits (v1 target)
| Entity | Target | Hard limit (enforced) |
|---|---|---|
| Tenants | 50 | — |
| Projects per tenant | 25 | 100 |
| Audit records per project | 10,000 | 50,000 |
| Active users per tenant | 100 concurrent | 500 total |
| CO log per project | 500 | 5,000 |
| Attachments per record | 10 | 50 |
| Attachment size | 25 MB | 50 MB (`ATTACHMENTS_MAX_MB`) |
| Report period window | 36 months | 60 months |

Beyond hard limits the API returns 413/422 with a specific error; the product team decides to raise limits per-tenant on request.

### Report SLAs
| Report type | Async? | Target p95 | Timeout |
|---|---|---|---|
| Earned Value Summary (current period) | sync | 5 s | 15 s |
| Discipline Detail | sync | 10 s | 30 s |
| Quarterly Management Report | async | 60 s | 5 min |
| Variance Analysis (project-to-date) | async | 30 s | 3 min |
| Change Order Log | sync | 5 s | 15 s |
| Baseline Snapshot export | async | 90 s | 5 min |

Async reports emit a `reports` row with `status` progression `queued → rendering → ready|failed`. Frontend polls every 2 s for the first 30 s, then backs off to 5 s.

### Availability
* **Target**: 99.5% monthly (~3.6 h allowed downtime).
* **Ceiling**: inherits from Supabase (99.9% Pro) and Netlify (99.99%); the lower of the two is the practical ceiling.
* **Graceful degradation**: if Supabase is down, the frontend serves a read-only cached Dashboard (last-successful `project_summary` response cached in IndexedDB, marked stale) + a banner. No writes attempted.

### Data retention & deletion
| Data class | Retention | Deletion mode |
|---|---|---|
| `audit_log` | 7 years | append-only; no deletion below that window |
| `baselines` snapshots | forever while project exists | immutable |
| Closed projects | 10 years post-close | soft-delete → archive bucket → hard-delete |
| `progress_periods` | forever while project exists | immutable once `locked_at` set |
| Attachments | tied to parent entity | orphan sweep nightly |
| User personal data | deleted on tenant off-boarding | `admin_purge_tenant` runbook |
| Sentry / edge logs | 30 / 90 / 365 days | per XII |

Per-tenant export of all data (JSON bundle + attachments) available via `admin_export_tenant(tenant_id)` — GDPR/CCPA data-portability compliance.

### Security baseline
* **OWASP Top 10**: addressed by RLS (A01 broken access), parameterized SQL (A03 injection), Supabase auth with bcrypt + MFA (A07 auth failures), Zod validation at every boundary (A08 software integrity), audit log + Sentry (A09 logging failures).
* **Secrets**: never in `VITE_` vars, never in commit history. Supabase secrets only. Rotated quarterly.
* **CSP**: `default-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self' {SUPABASE_URL} https://*.sentry.io; frame-ancestors 'none'` — set via Netlify headers.
* **CORS**: Supabase allows only the deployed Netlify domain + localhost:5173 (dev).
* **Dependency scanning**: `npm audit` + Renovate weekly; `dependabot` on edge functions.
* **Pentest cadence**: annual third-party pentest + continuous automated scanning (e.g., Snyk). Critical findings block release.
* **Data encryption**: Supabase Postgres — at rest via AWS KMS; in transit TLS 1.3. Attachments — Storage bucket encryption enabled.
* **Backups**: Supabase daily automated backups + 7-day PITR (Pro tier). Restore drill quarterly; RPO 24h, RTO 4h.

### Accessibility
* **Target**: WCAG 2.1 AA for every route and flow.
* **Enforcement**: `axe-core` runs in every Playwright test; any violation fails the test. `eslint-plugin-jsx-a11y` in lint.
* **Keyboard**: every interaction reachable without a mouse — especially the 20-column Progress grid (arrow-key navigation, Enter to open record detail).
* **Screen reader**: semantic HTML + ARIA landmarks; charts carry an accessible data table fallback.
* **Colour**: variance tokens (green/red) always paired with an icon or text sign — never colour-only.

### Browser support
* Evergreen Chromium, Firefox, Safari (last 2 major versions).
* No IE. Edge Chromium covered by Chromium.
* Mobile Safari + Android Chrome for the field-use path (Progress grid + milestone editor); full-feature parity is **not** a target — deliberately scoped to view + update, not setup/admin.

### Internationalisation (v1: English; v2-ready)
* All copy routed through `i18next` from day one, even while only `en` is shipped. Adding `es-MX` later is swapping locale files — no code changes.
* Number formatting via `Intl.NumberFormat` everywhere; the codebase contains **zero** raw `toFixed` / `toLocaleString` calls outside formatter utilities (enforced by eslint rule).
* Dates: ISO 8601 in storage; rendered via `Intl.DateTimeFormat` with the user's locale.
