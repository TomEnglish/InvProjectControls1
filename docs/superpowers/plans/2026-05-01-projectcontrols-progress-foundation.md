# ProjectControls Progress Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first executable merge slice: unified role gates, local project membership boundaries, and canonical progress table scaffolding in the ProjectControls app.

**Architecture:** ProjectControls remains the receiving codebase. Existing untracked Phase 1 migrations for `super_admin` and `project_members` are adopted, tested, and connected to frontend and edge-function role gates. A new canonical progress-table migration adds the destination tables that later ProgressTracker backfill and UI-port tasks will use.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Supabase Postgres/RLS/RPC, Supabase Edge Functions, pgTAP.

---

## File Structure

- Modify: `frontend/src/lib/queries.ts`
  - Add `super_admin` to `UserRole` and `roleRank`.
- Modify: `frontend/src/lib/role.test.ts`
  - Lock in `super_admin > admin` frontend role ordering.
- Modify: `frontend/src/components/projects/UsersCard.tsx`
  - Show super-admin labels and restrict tenant user management to `super_admin`.
  - Let `admin` manage lower roles only through server-approved RPC outcomes.
- Modify: `frontend/src/components/projects/InviteUserModal.tsx`
  - Prevent admins from inviting `admin` or `super_admin`; allow super-admin to invite any role.
- Modify: `supabase/functions/admin-invite-user/index.ts`
  - Validate caller hierarchy: super-admin may grant any role, admin may grant only `pm`, `pc_reviewer`, `editor`, `viewer`.
- Modify: `supabase/tests/rpc/role_gating.sql`
  - Update enum and function assertions for `super_admin`.
- Modify: `supabase/tests/rpc/mutating_rpcs.sql`
  - Update enum assertions for `super_admin`.
- Review/modify: `supabase/migrations/20260501000000_super_admin_enum.sql`
- Review/modify: `supabase/migrations/20260501000001_role_helpers_v2.sql`
- Review/modify: `supabase/migrations/20260501000002_project_members.sql`
- Review/modify: `supabase/migrations/20260501000003_extend_policies_super_admin.sql`
- Review/modify: `supabase/migrations/20260501000004_admin_set_user_role_v2.sql`
  - Existing untracked files; preserve intent, fix only defects found while testing.
- Create: `supabase/migrations/20260501000005_progress_canonical_tables.sql`
  - Add canonical progress destination tables.
- Create: `supabase/tests/rpc/progress_foundation.sql`
  - Assert canonical progress tables and key constraints exist.

---

### Task 1: Frontend Role Ladder

**Files:**
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/lib/role.test.ts`

- [ ] **Step 1: Write the failing role tests**

Replace `frontend/src/lib/role.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { hasRole } from './queries';

describe('hasRole', () => {
  it('lets super_admin pass every role gate', () => {
    expect(hasRole('super_admin', 'viewer')).toBe(true);
    expect(hasRole('super_admin', 'editor')).toBe(true);
    expect(hasRole('super_admin', 'pc_reviewer')).toBe(true);
    expect(hasRole('super_admin', 'pm')).toBe(true);
    expect(hasRole('super_admin', 'admin')).toBe(true);
    expect(hasRole('super_admin', 'super_admin')).toBe(true);
  });

  it('keeps admin below super_admin but above project execution roles', () => {
    expect(hasRole('admin', 'viewer')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('admin', 'pm')).toBe(true);
    expect(hasRole('admin', 'super_admin')).toBe(false);
  });

  it('blocks editor from PM-gated actions', () => {
    expect(hasRole('editor', 'pm')).toBe(false);
  });

  it('lets PM pass PC reviewer gate', () => {
    expect(hasRole('pm', 'pc_reviewer')).toBe(true);
    expect(hasRole('pm', 'editor')).toBe(true);
  });

  it('returns false for missing role', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm -w frontend run test -- src/lib/role.test.ts
```

Expected: FAIL because `super_admin` is not assignable to `UserRole` or is missing from `roleRank`.

- [ ] **Step 3: Add `super_admin` to the frontend role type and rank**

In `frontend/src/lib/queries.ts`, replace the role type and rank block with:

```ts
export type UserRole = 'super_admin' | 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';
```

```ts
const roleRank: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  pc_reviewer: 3,
  pm: 4,
  admin: 5,
  super_admin: 6,
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm -w frontend run test -- src/lib/role.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add frontend/src/lib/queries.ts frontend/src/lib/role.test.ts
git commit -m "feat: add frontend super admin role ladder"
```

---

### Task 2: Tenant User UI Gates

**Files:**
- Modify: `frontend/src/components/projects/UsersCard.tsx`
- Modify: `frontend/src/components/projects/InviteUserModal.tsx`

- [ ] **Step 1: Update the role label map in `UsersCard`**

Replace the `ROLE_LABEL` constant with:

```ts
const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  pm: 'PM',
  pc_reviewer: 'PC Reviewer',
  editor: 'Editor',
  viewer: 'Viewer',
};
```

- [ ] **Step 2: Restrict the tenant user management card to super-admins**

In `UsersCard`, replace:

```ts
const canEdit = hasRole(me?.role, 'admin');
```

with:

```ts
const canEdit = hasRole(me?.role, 'super_admin');
```

- [ ] **Step 3: Keep the select options complete for super-admins**

In the role `<select>`, keep:

```tsx
{(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
  <option key={r} value={r}>
    {ROLE_LABEL[r]}
  </option>
))}
```

This makes `super_admin` visible only because `canEdit` is already super-admin-only.

- [ ] **Step 4: Add caller role to `InviteUserModal`**

At the imports in `frontend/src/components/projects/InviteUserModal.tsx`, change:

```ts
import type { UserRole } from '@/lib/queries';
```

to:

```ts
import { hasRole, useCurrentUser, type UserRole } from '@/lib/queries';
```

- [ ] **Step 5: Expand and filter invite roles**

Replace the `ROLES` constant with:

```ts
const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: 'super_admin', label: 'Super Admin', hint: 'Tenant-wide governance and admin delegation.' },
  { value: 'admin', label: 'Admin', hint: 'Project admin when assigned to project membership.' },
  { value: 'pm', label: 'PM', hint: 'Approves change orders, closes periods, and manages project execution.' },
  { value: 'pc_reviewer', label: 'PC Reviewer', hint: 'Forwards or rejects change orders at the PC stage.' },
  { value: 'editor', label: 'Editor', hint: 'Updates progress records and submits change orders.' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only project access.' },
];
```

Inside `InviteUserModal`, immediately after state declarations, add:

```ts
const { data: me } = useCurrentUser();
const roleOptions = hasRole(me?.role, 'super_admin')
  ? ROLES
  : ROLES.filter((r) => r.value !== 'super_admin' && r.value !== 'admin');
```

Replace every `ROLES.find(...)` and `ROLES.map(...)` used for the select with `roleOptions.find(...)` and `roleOptions.map(...)`.

- [ ] **Step 6: Guard stale selected role**

Add this import:

```ts
import { useEffect, useState, type FormEvent } from 'react';
```

Replace the existing React import:

```ts
import { useState, type FormEvent } from 'react';
```

Add after `roleOptions`:

```ts
useEffect(() => {
  if (!roleOptions.some((option) => option.value === role)) {
    setRole('editor');
  }
}, [role, roleOptions]);
```

- [ ] **Step 7: Run frontend tests and typecheck**

Run:

```bash
npm -w frontend run test -- src/lib/role.test.ts
npm -w frontend run typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add frontend/src/components/projects/UsersCard.tsx frontend/src/components/projects/InviteUserModal.tsx
git commit -m "feat: gate tenant user management to super admin"
```

---

### Task 3: Edge Function Invite Hierarchy

**Files:**
- Modify: `supabase/functions/admin-invite-user/index.ts`

- [ ] **Step 1: Update the role type and allowed role list**

Replace:

```ts
type Role = 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

const ROLES: readonly Role[] = ['admin', 'pm', 'pc_reviewer', 'editor', 'viewer'];
```

with:

```ts
type Role = 'super_admin' | 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

const ROLES: readonly Role[] = ['super_admin', 'admin', 'pm', 'pc_reviewer', 'editor', 'viewer'];
const ADMIN_GRANTABLE_ROLES: readonly Role[] = ['pm', 'pc_reviewer', 'editor', 'viewer'];
```

- [ ] **Step 2: Replace caller authorization**

Replace:

```ts
if (caller.role !== 'admin') {
  return json({ error: `admin role required (you have ${caller.role})` }, 403);
}
```

with:

```ts
if (caller.role !== 'admin' && caller.role !== 'super_admin') {
  return json({ error: `admin role required (you have ${caller.role})` }, 403);
}
```

- [ ] **Step 3: Add grant hierarchy validation after payload role validation**

Immediately after:

```ts
if (!ROLES.includes(role)) return json({ error: 'invalid role' }, 400);
```

add:

```ts
if (caller.role === 'admin' && !ADMIN_GRANTABLE_ROLES.includes(role)) {
  return json({ error: `admin cannot grant role ${role}` }, 403);
}
```

- [ ] **Step 4: Run frontend typecheck**

Run:

```bash
npm -w frontend run typecheck
```

Expected: PASS. The edge function is Deno code and is not included in the frontend typecheck, but this command verifies shared app types still compile after role changes.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add supabase/functions/admin-invite-user/index.ts
git commit -m "feat: enforce invite role hierarchy"
```

---

### Task 4: SQL Role Test Updates

**Files:**
- Modify: `supabase/tests/rpc/role_gating.sql`
- Modify: `supabase/tests/rpc/mutating_rpcs.sql`

- [ ] **Step 1: Update `role_gating.sql` plan count**

Replace:

```sql
select plan(6);
```

with:

```sql
select plan(8);
```

- [ ] **Step 2: Update enum assertion in `role_gating.sql`**

Replace the five-role `set_eq` assertion with:

```sql
select set_eq(
  $$ select unnest(enum_range(null::projectcontrols.user_role))::text $$,
  $$ values ('super_admin'), ('admin'), ('pm'), ('pc_reviewer'), ('editor'), ('viewer') $$,
  'user_role enum has the six expected values'
);
```

- [ ] **Step 3: Add function checks in `role_gating.sql`**

After the `current_user_role` function check, add:

```sql
select has_function('projectcontrols', 'is_super_admin',
  'is_super_admin function exists');
select has_function('projectcontrols', 'assert_role_for_project',
  array['projectcontrols.user_role', 'uuid'],
  'assert_role_for_project function exists');
```

- [ ] **Step 4: Update enum assertion in `mutating_rpcs.sql`**

Replace the final five-role `set_eq` assertion with:

```sql
select set_eq(
  $$ select unnest(enum_range(null::projectcontrols.user_role))::text $$,
  $$ values ('super_admin'), ('admin'), ('pm'), ('pc_reviewer'), ('editor'), ('viewer') $$,
  'user_role enum has the six expected values'
);
```

Keep `select plan(38);` unchanged because the number of assertions does not change in `mutating_rpcs.sql`.

- [ ] **Step 5: Run database tests**

Run:

```bash
supabase test db
```

Expected: PASS after the Phase 1 migrations are applied by the test harness.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add supabase/tests/rpc/role_gating.sql supabase/tests/rpc/mutating_rpcs.sql
git commit -m "test: cover super admin role gates"
```

---

### Task 5: Review Existing Phase 1 Migrations

**Files:**
- Review/modify: `supabase/migrations/20260501000000_super_admin_enum.sql`
- Review/modify: `supabase/migrations/20260501000001_role_helpers_v2.sql`
- Review/modify: `supabase/migrations/20260501000002_project_members.sql`
- Review/modify: `supabase/migrations/20260501000003_extend_policies_super_admin.sql`
- Review/modify: `supabase/migrations/20260501000004_admin_set_user_role_v2.sql`

- [ ] **Step 1: Inspect migrations for this required behavior**

Confirm the migrations contain these exact behavioral outcomes:

```text
20260501000000_super_admin_enum.sql:
- Adds 'super_admin' to projectcontrols.user_role.

20260501000001_role_helpers_v2.sql:
- assert_role ranks super_admin above admin.
- is_super_admin exists.
- assert_role_for_project enforces project_members for non-super-admins.

20260501000002_project_members.sql:
- project_members has tenant_id, project_id, user_id, project_role, added_by.
- super_admin can manage all project memberships.
- admin can manage only projects where they are a member.
- admin cannot grant admin or super_admin project_role.

20260501000003_extend_policies_super_admin.sql:
- app_users write policies prevent admin self-promotion.
- super_admin has tenant/global write access where admin previously did.

20260501000004_admin_set_user_role_v2.sql:
- super_admin can set any role.
- admin can set only roles below admin.
- admin cannot modify admin or super_admin users.
- no caller can change their own role.
```

- [ ] **Step 2: Run database reset**

Run:

```bash
supabase db reset
```

Expected: PASS. If it fails, fix only the failing migration and re-run.

- [ ] **Step 3: Run database tests**

Run:

```bash
supabase test db
```

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add supabase/migrations/20260501000000_super_admin_enum.sql \
  supabase/migrations/20260501000001_role_helpers_v2.sql \
  supabase/migrations/20260501000002_project_members.sql \
  supabase/migrations/20260501000003_extend_policies_super_admin.sql \
  supabase/migrations/20260501000004_admin_set_user_role_v2.sql
git commit -m "feat: add super admin and project membership gates"
```

---

### Task 6: Canonical Progress Table Migration

**Files:**
- Create: `supabase/migrations/20260501000005_progress_canonical_tables.sql`
- Create: `supabase/tests/rpc/progress_foundation.sql`

- [ ] **Step 1: Write the failing table-shape test**

Create `supabase/tests/rpc/progress_foundation.sql`:

```sql
begin;

select plan(30);

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

select * from finish();

rollback;
```

- [ ] **Step 2: Run the new database test and verify it fails**

Run:

```bash
supabase test db
```

Expected: FAIL because the canonical progress tables do not exist.

- [ ] **Step 3: Add the canonical table migration**

Create `supabase/migrations/20260501000005_progress_canonical_tables.sql`:

```sql
-- Phase 2.1: Canonical progress tables for the merged ProjectControls +
-- ProgressTracker product. These are destination tables for upcoming
-- ProgressTracker backfill and UI port work.

alter table projectcontrols.projects
  add column if not exists qty_rollup_mode text not null default 'hours_weighted'
    check (qty_rollup_mode in ('hours_weighted', 'equal', 'custom'));

create table projectcontrols.iwps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iwps_unique unique (project_id, name)
);
create index on projectcontrols.iwps(tenant_id);
create index on projectcontrols.iwps(project_id);
create index on projectcontrols.iwps(discipline_id);
alter table projectcontrols.iwps enable row level security;

create table projectcontrols.progress_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  iwp_id uuid references projectcontrols.iwps(id) on delete set null,
  source_record_id uuid,
  source_type text not null default 'manual',
  source_filename text,
  record_no int,
  source_row int,
  dwg text,
  rev text,
  description text not null,
  uom projectcontrols.uom_code not null default 'EA',
  budget_qty numeric(14, 3),
  actual_qty numeric(14, 3),
  earned_qty numeric(14, 3) generated always as (
    case when budget_qty is null then null else budget_qty * percent_complete / 100.0 end
  ) stored,
  budget_hrs numeric(14, 3) not null default 0 check (budget_hrs >= 0),
  actual_hrs numeric(14, 3) not null default 0 check (actual_hrs >= 0),
  earned_hrs numeric(14, 3) generated always as (budget_hrs * percent_complete / 100.0) stored,
  percent_complete numeric(5, 2) not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  status projectcontrols.record_status not null default 'active',
  foreman_user_id uuid references projectcontrols.app_users(id) on delete set null,
  foreman_name text,
  attr_type text,
  attr_size text,
  attr_spec text,
  line_area text,
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_records_record_no_unique unique (project_id, record_no),
  constraint progress_records_source_unique unique (project_id, source_type, source_record_id)
);
create index on projectcontrols.progress_records(tenant_id);
create index on projectcontrols.progress_records(project_id);
create index on projectcontrols.progress_records(discipline_id);
create index on projectcontrols.progress_records(iwp_id);
create index on projectcontrols.progress_records(project_id, foreman_user_id);
create index on projectcontrols.progress_records(project_id, foreman_name);
create index on projectcontrols.progress_records(project_id, line_area);
alter table projectcontrols.progress_records enable row level security;

create table projectcontrols.progress_record_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  progress_record_id uuid not null references projectcontrols.progress_records(id) on delete cascade,
  roc_milestone_id uuid references projectcontrols.roc_milestones(id) on delete set null,
  seq smallint not null check (seq between 1 and 8),
  label text,
  value numeric(5, 2) not null default 0 check (value >= 0 and value <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  constraint prm_unique unique (progress_record_id, seq)
);
create index on projectcontrols.progress_record_milestones(tenant_id);
create index on projectcontrols.progress_record_milestones(progress_record_id);
alter table projectcontrols.progress_record_milestones enable row level security;

create table projectcontrols.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  kind text not null default 'weekly' check (kind in ('weekly', 'baseline_first_audit')),
  snapshot_date date not null default current_date,
  week_ending date,
  label text not null,
  total_budget_hrs numeric(14, 3),
  total_earned_hrs numeric(14, 3),
  total_actual_hrs numeric(14, 3),
  cpi numeric(12, 4),
  spi numeric(12, 4),
  composite_pct_qty numeric(8, 4),
  source_filename text,
  uploaded_by uuid references projectcontrols.app_users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index progress_snapshots_one_first_audit_per_project
  on projectcontrols.progress_snapshots(project_id)
  where kind = 'baseline_first_audit';
create index on projectcontrols.progress_snapshots(tenant_id);
create index on projectcontrols.progress_snapshots(project_id);
alter table projectcontrols.progress_snapshots enable row level security;

create table projectcontrols.progress_snapshot_items (
  snapshot_id uuid not null references projectcontrols.progress_snapshots(id) on delete cascade,
  progress_record_id uuid not null references projectcontrols.progress_records(id) on delete restrict,
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  percent_complete numeric(5, 2),
  earned_hrs numeric(14, 3),
  earned_qty numeric(14, 3),
  actual_hrs numeric(14, 3),
  actual_qty numeric(14, 3),
  primary key (snapshot_id, progress_record_id)
);
create index on projectcontrols.progress_snapshot_items(tenant_id);
create index on projectcontrols.progress_snapshot_items(project_id);
create index on projectcontrols.progress_snapshot_items(progress_record_id);
alter table projectcontrols.progress_snapshot_items enable row level security;

create table projectcontrols.project_discipline_weights (
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid not null references projectcontrols.project_disciplines(id) on delete cascade,
  weight numeric(8, 6) not null check (weight >= 0 and weight <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  primary key (project_id, discipline_id)
);
create index on projectcontrols.project_discipline_weights(tenant_id);
alter table projectcontrols.project_discipline_weights enable row level security;

create table projectcontrols.foreman_aliases (
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  name text not null,
  user_id uuid not null references projectcontrols.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  primary key (tenant_id, name)
);
create index on projectcontrols.foreman_aliases(user_id);
alter table projectcontrols.foreman_aliases enable row level security;

create policy "iwps_tenant_read" on projectcontrols.iwps
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "iwps_project_write" on projectcontrols.iwps
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm')
  );

create policy "progress_records_tenant_read" on projectcontrols.progress_records
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "progress_records_editor_write" on projectcontrols.progress_records
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "prm_tenant_read" on projectcontrols.progress_record_milestones
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "prm_editor_write" on projectcontrols.progress_record_milestones
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "progress_snapshots_tenant_read" on projectcontrols.progress_snapshots
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "progress_snapshots_pm_write" on projectcontrols.progress_snapshots
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

create policy "psi_tenant_read" on projectcontrols.progress_snapshot_items
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "psi_pm_write" on projectcontrols.progress_snapshot_items
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

create policy "pdw_tenant_read" on projectcontrols.project_discipline_weights
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "pdw_admin_write" on projectcontrols.project_discipline_weights
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  );

create policy "foreman_aliases_tenant_read" on projectcontrols.foreman_aliases
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "foreman_aliases_admin_write" on projectcontrols.foreman_aliases
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  );
```

- [ ] **Step 4: Run database reset and tests**

Run:

```bash
supabase db reset
supabase test db
```

Expected: both PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add supabase/migrations/20260501000005_progress_canonical_tables.sql supabase/tests/rpc/progress_foundation.sql
git commit -m "feat: add canonical progress tables"
```

---

### Task 7: Final Verification For Foundation Slice

**Files:**
- No code edits.

- [ ] **Step 1: Run frontend unit tests**

Run:

```bash
npm -w frontend run test
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
npm -w frontend run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Supabase reset and tests**

Run:

```bash
supabase db reset
supabase test db
```

Expected: both PASS.

- [ ] **Step 5: Confirm git state contains only intended work**

Run:

```bash
git status --short
```

Expected: only intentionally uncommitted files remain. The design spec commit already exists; do not revert user-created files.

---

## Self-Review Notes

- This plan intentionally covers the first implementation slice only. The ProgressTracker data backfill, import-function rewrite, route/UI port, and final retirement of public tables should be separate plans because they touch independent surfaces and are easier to verify in smaller batches.
- The existing `scripts/phase1-pt-backfill/01-discovery.sql` stays read-only in this slice. Data backfill begins only after discovery output confirms source data shape and the first `super_admin` user.
- The canonical progress tables are added before UI porting so later tasks have stable targets.
