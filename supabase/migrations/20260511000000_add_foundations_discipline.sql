-- Add FOUNDATIONS to the discipline_code enum.
--
-- The senior SME's Unified Audit Workbook (2026-05-11) treats Foundations as
-- the 7th first-class discipline, distinct from Civil. Our enum was created
-- in 0001_init.sql with the six original disciplines; this migration adds
-- the seventh.
--
-- Postgres requires `ALTER TYPE ... ADD VALUE` to commit before the new
-- value can be used downstream — the work_types seed (which references
-- 'FOUNDATIONS') lives in the next migration file (20260511000001) so each
-- runs in its own transaction.

alter type projectcontrols.discipline_code add value if not exists 'FOUNDATIONS';
