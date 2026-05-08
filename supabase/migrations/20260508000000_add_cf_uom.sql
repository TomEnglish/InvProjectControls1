-- Add CF (cubic feet) to the uom_code enum.
--
-- Industry-standard COA codes for epoxy and non-shrink grout (04620, 04630)
-- use CF as the canonical unit of measure. The existing enum already covers
-- LF, CY, EA, TONS, SF, HR, LS — CF was missing.
--
-- Postgres requires `ALTER TYPE ... ADD VALUE` to commit before the new
-- value can be used; the COA seed referencing 'CF' lives in the next
-- migration file (20260508000001_seed_industry_coa_codes.sql) so each runs
-- as its own transaction.

alter type projectcontrols.uom_code add value if not exists 'CF';
