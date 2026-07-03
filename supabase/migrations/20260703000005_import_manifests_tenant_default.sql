-- import_manifests.tenant_id — default to the caller's tenant.
--
-- The QMR card inserts manifests client-side without tenant_id; the column
-- is NOT NULL with no default, so every insert failed the not-null check
-- and the card's non-fatal handling swallowed it (console.warn only).
-- Result: zero manifests captured during UAT and the Data Check page fell
-- back to the DB-only profile. Defaulting to current_tenant_id() matches
-- how RLS already scopes the row, and the insert policy's WITH CHECK still
-- verifies tenant + role.
--
-- created_by gets the same treatment so the audit trail fills itself in.

alter table projectcontrols.import_manifests
  alter column tenant_id set default projectcontrols.current_tenant_id();

alter table projectcontrols.import_manifests
  alter column created_by set default auth.uid();
