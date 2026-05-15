-- A20 Wave 1 — add `clerk` to the user_role enum.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to commit before downstream
-- migrations can reference the new value, so this file contains only the
-- enum extension. The rank-ladder update (assert_role v3) and the policy
-- migrations that admit clerk land in subsequent files.
--
-- Slot in the ladder: viewer < clerk < editor < pc_reviewer < pm < admin <
-- super_admin. Clerks have read access to records (same as viewer) plus a
-- narrow INSERT right on upload_queue for the (project, craft) pairs they
-- own. They cannot write to progress_records, snapshots, or any other
-- live table.

alter type projectcontrols.user_role add value if not exists 'clerk';
