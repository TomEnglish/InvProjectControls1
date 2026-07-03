-- Add EMU to the uom_code enum.
--
-- The client's QMR Site Work audit tab carries UOM 'EMU' (equivalent man
-- units) on the Temp Facilities line (COA 01000). First seen in the
-- "QMR Report Phase 2 - Unified v7" workbook during UAT of the QMR baseline
-- upload — the enum rejection failed the whole Site Work tab.
--
-- Spelling variants in the same workbook (LF. / CY. / EA. trailing periods,
-- TN for TONS) are handled by normalization in the import edge functions
-- (_shared/uom.ts), not by widening the enum — EMU is the only genuinely
-- new unit.

alter type projectcontrols.uom_code add value if not exists 'EMU';
