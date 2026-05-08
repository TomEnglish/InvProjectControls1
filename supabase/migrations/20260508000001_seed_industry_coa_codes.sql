-- Replace the demo/made-up COA codes with industry-standard codes.
--
-- Source: Sandra Lee, "Craft Unit Rates.xlsx" (ProgressDocs/ReferenceTable/).
-- Per the 2026-05-05 UAT feedback, the existing seed used placeholder primes
-- 100/200/300/400/500/600 with invented codes (101, 201, 301, …). Sandra
-- needs the real CSI-style 5-digit codes she uses in the field so the COA
-- library matches what she'd find in any audit file (see the seven
-- *audit.xlsx in ProgressDocs/InputExamples/).
--
-- Convention: pf_adj = 1.19 (the productivity factor Sandra's audit Sheet1
-- panels use across all disciplines). base_rate is therefore source / 1.19
-- so the generated pf_rate column reproduces the spreadsheet's U/R column.
-- Codes for which Sandra didn't supply a rate get base_rate = 0; admins
-- can fill those in via the COA modal once a real rate is available.
--
-- For codes with multiple sub-variants (Iron framing XLGHT/LGT/MED/HVY,
-- precast basin SMALL/LARGE, etc.) we keep one canonical row at a SPECIFIC
-- sub-variant rate from the source xlsx — never a synthetic average — so
-- every pf_rate in this seed reproduces a value that appears verbatim in
-- the spreadsheet. Per-record variants are tracked via progress_record
-- attributes (attr_size, attr_type), not at the COA library level. Where
-- the variant choice is non-obvious it's annotated in the description so
-- admins can see which specific row of Sandra's xlsx the rate came from.
--
-- Variant choices for codes with multiple source rows:
--   01940: under-24" rate (0.5 LF) — small specialty pipe is the common case
--   01950: SMALL basin rate (49 EA) — large basin is per-CY in practice
--   05210: MEDIUM framing (18.02 TN) — modal weight class
--   05220: MEDIUM piperack (18.948 TN) — modal weight class
--   05230: STAIR / GRATE / LADDER variant (31.471 TN) — 3 of 7 sub-types share this rate
--   08332: standard 3-10" rate (10 LF) — bath-tub area variant excluded
--   09420: 3/C #2 cable (0.055 LF) — most common feeder size
--   10110: Field Mounted Inst panel rate (14.47 EA) — from the audit Sheet1 summary
--   10210: Control valves panel rate (16.6 EA)
--   10220: Level gauges panel rate (15.2 EA)
--   10410: Analytical systems panel rate (76.37 EA)
--   10420: Gas detection panel rate (10.46 EA)

-- One-shot replacement: drop the placeholder primes (100..600) the seed
-- script previously installed, then upsert the canonical set. project_coa_codes
-- ON DELETE CASCADE removes any per-project picks that referenced the old
-- codes (acceptable — the picks pointed at fabricated codes nobody outside
-- internal demo would have selected).
delete from projectcontrols.coa_codes
where prime in ('100', '200', '300', '400', '500', '600');

-- Per-tenant upsert. Loop over every tenant so the seed applies to existing
-- demo / UAT tenants without depending on a specific tenant_id, and so that
-- re-running the migration is a no-op on tenants that already have these
-- codes. New tenants created post-migration get the canonical set via
-- scripts/seed/index.ts.
do $$
declare
  t_id uuid;
  rec record;
begin
  for t_id in select id from projectcontrols.tenants loop
    for rec in select * from (values
      ('01', '01',    'Sitework',                                            null, 1, 'EA',   0.0000,  1.0000),
      ('01', '01000', 'Temporary Facilities',                                '01', 2, 'EA',   0.0000,  1.1900),
      ('01', '01410', 'Mass Excavation',                                     '01', 2, 'CY',   0.0924,  1.1900),
      ('01', '01420', 'Mass Backfill',                                       '01', 2, 'CY',   0.0840,  1.1900),
      ('01', '01440', 'Flowable Backfill',                                   '01', 2, 'CY',   1.2605,  1.1900),
      ('01', '01450', 'Excavation and Backfill for UG Piping',               '01', 2, 'CY',   0.3109,  1.1900),
      ('01', '01510', 'Ditches',                                             '01', 2, 'CY',   0.0504,  1.1900),
      ('01', '01530', 'Crushed Rock',                                        '01', 2, 'CY',   0.0672,  1.1900),
      ('01', '01940', 'Specialty Pipe (24" and under)',                      '01', 2, 'LF',   0.4202,  1.1900),
      ('01', '01950', 'U/G Precast Basins (SMALL)',                          '01', 2, 'EA',  41.1765,  1.1900),

      ('04', '04',    'Civil / Concrete',                                    null, 1, 'EA',   0.0000,  1.0000),
      ('04', '04110', 'FDN 0-10 CY',                                         '04', 2, 'CY',  17.8151,  1.1900),
      ('04', '04120', 'FDN 10-20 CY',                                        '04', 2, 'CY',   7.3950,  1.1900),
      ('04', '04130', 'FDN 30-200 CY',                                       '04', 2, 'CY',   5.7143,  1.1900),
      ('04', '04150', 'FDN Greater than 200 CY',                             '04', 2, 'CY',   5.1261,  1.1900),
      ('04', '04210', 'Concrete Area Paving',                                '04', 2, 'CY',   5.5966,  1.1900),
      ('04', '04220', 'Concrete Roads',                                      '04', 2, 'CY',   4.5378,  1.1900),
      ('04', '04500', 'Cast in Walled Structures',                           '04', 2, 'CY',  18.9076,  1.1900),
      ('04', '04620', 'Epoxy',                                               '04', 2, 'CF',   6.4706,  1.1900),
      ('04', '04630', 'Non-Shrink Grout',                                    '04', 2, 'CF',   4.7899,  1.1900),
      ('04', '04700', 'Seal Slabs',                                          '04', 2, 'CY',   1.2605,  1.1900),

      ('05', '05',    'Iron / Structural Steel',                             null, 1, 'EA',   0.0000,  1.0000),
      ('05', '05210', 'Erection (Major Structural Framing)',                 '05', 2, 'TONS', 15.1429, 1.1900),
      ('05', '05220', 'Erect Piperacks Conduit and/or Cable Tray',           '05', 2, 'TONS', 15.9227, 1.1900),
      ('05', '05230', 'Erection (Miscellaneous Steel — Stair/Grate/Ladder)', '05', 2, 'TONS', 26.4462, 1.1900),
      ('05', '05240', 'Erection (Structural Specialties)',                   '05', 2, 'TONS',  0.0000, 1.1900),

      ('07', '07',    'Mechanical',                                          null, 1, 'EA',   0.0000,  1.0000),
      ('07', '07110', 'Heat Transfer Equipment',                             '07', 2, 'EA',   0.0000,  1.1900),
      ('07', '07120', 'Pressure Vessels and Tanks',                          '07', 2, 'EA',  10.0000,  1.1900),
      ('07', '07130', 'Compressors, Expanders',                              '07', 2, 'EA',  80.6723,  1.1900),
      ('07', '07140', 'Pumps and Drive',                                     '07', 2, 'EA', 123.5294,  1.1900),
      ('07', '07150', 'Misc. Rotating Equipment',                            '07', 2, 'EA',  30.0000,  1.1900),
      ('07', '07160', 'Filters',                                             '07', 2, 'EA',  40.3361,  1.1900),
      ('07', '07185', 'Cooling Towers',                                      '07', 2, 'EA', 120.0000,  1.1900),
      ('07', '07410', 'Turbine / Generator',                                 '07', 2, 'EA',  40.0000,  1.1900),

      ('08', '08',    'Pipe',                                                null, 1, 'EA',   0.0000,  1.0000),
      ('08', '08111', 'Carbon Steel Pipe 2.5" and under (Shop)',             '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08112', 'Carbon Steel Pipe 3" to 10" (Shop)',                  '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08113', 'Carbon Steel Pipe 12" and over (Shop)',               '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08121', 'Alloy Pipe 2.5" and under (Shop)',                    '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08122', 'Alloy Pipe 3" to 10" (Shop)',                         '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08123', 'Alloy Pipe 12" and over (Shop)',                      '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08211', 'Carbon Steel Field Run Pipe 2.5" and under',          '08', 2, 'LF',   2.4118,  1.1900),
      ('08', '08212', 'Carbon Steel Field Run Pipe 3" to 10"',               '08', 2, 'LF',   2.1092,  1.1900),
      ('08', '08213', 'Carbon Steel Field Run Pipe 12" and over',            '08', 2, 'LF',   3.3992,  1.1900),
      ('08', '08221', 'Stainless Steel Alloy Field Run Pipe 2.5" and under', '08', 2, 'LF',   2.8655,  1.1900),
      ('08', '08222', 'Stainless Steel Alloy Field Run Pipe 3" to 10"',      '08', 2, 'LF',   2.6218,  1.1900),
      ('08', '08223', 'Stainless Steel Alloy Field Run Pipe 12" and over',   '08', 2, 'LF',  10.1513,  1.1900),
      ('08', '08311', 'Underground CS Pipe 2.5" and Under',                  '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08312', 'Underground CS Pipe 3" to 10"',                       '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08313', 'Underground CS Pipe 12" and Over',                    '08', 2, 'LF',   0.0000,  1.1900),
      ('08', '08331', 'UG Specialty Material Pipe 2.5" and under',           '08', 2, 'LF',   3.6134,  1.1900),
      ('08', '08332', 'U/G Specialty Material Pipe 3"-10"',                  '08', 2, 'LF',   8.4034,  1.1900),
      ('08', '08333', 'UG Specialty Material Pipe 12" and over (HDPE)',      '08', 2, 'LF',   2.8714,  1.1900),

      ('09', '09',    'Electrical',                                          null, 1, 'EA',   0.0000,  1.0000),
      ('09', '09100', 'Grounding',                                           '09', 2, 'LF',   0.2269,  1.1900),
      ('09', '09210', 'Underground Ductbank',                                '09', 2, 'LF',   0.0000,  1.1900),
      ('09', '09220', 'Underground Conduit',                                 '09', 2, 'LF',   0.5294,  1.1900),
      ('09', '09310', 'Aboveground Conduit',                                 '09', 2, 'LF',   1.2437,  1.1900),
      ('09', '09320', 'Cable Tray Systems',                                  '09', 2, 'LF',   0.5126,  1.1900),
      ('09', '09340', 'Junction Boxes, Pull Boxes, Terminal Boxes',          '09', 2, 'EA',  36.9672,  1.1900),
      ('09', '09420', 'Wire and Cable Installation (3/C #2 reference rate)', '09', 2, 'LF',   0.0462,  1.1900),
      ('09', '09450', 'Fiber Optic Cable',                                   '09', 2, 'LF',   0.0235,  1.1900),
      ('09', '09520', 'Oil Filled Transformers',                             '09', 2, 'EA',   0.0000,  1.1900),
      ('09', '09530', 'Breaker Panels',                                      '09', 2, 'EA',   0.0000,  1.1900),
      ('09', '09550', 'Motor Control Centers',                               '09', 2, 'EA',  80.0000,  1.1900),
      ('09', '09610', 'Lighting Fixtures',                                   '09', 2, 'EA',   0.0000,  1.1900),
      ('09', '09620', 'Power and Control Devices',                           '09', 2, 'EA',   0.0000,  1.1900),
      ('09', '09750', 'Poles, Towers',                                       '09', 2, 'EA',   0.0000,  1.1900),

      ('10', '10',    'Instrumentation',                                     null, 1, 'EA',   0.0000,  1.0000),
      ('10', '10110', 'Field Mounted Instrument Devices',                    '10', 2, 'EA',  12.1597,  1.1900),
      ('10', '10210', 'Control Valves and Power Operators',                  '10', 2, 'EA',  13.9496,  1.1900),
      ('10', '10220', 'Level Gauges & Sight Glasses',                        '10', 2, 'EA',  12.7731,  1.1900),
      ('10', '10410', 'Analytical Systems',                                  '10', 2, 'EA',  64.1765,  1.1900),
      ('10', '10420', 'Gas Detection Systems',                               '10', 2, 'EA',   8.7899,  1.1900),
      ('10', '10520', 'Pneumatic Tubing',                                    '10', 2, 'LF',   0.0000,  1.1900),
      ('10', '10550', 'Inst. Threaded Air Supply Lateral',                   '10', 2, 'LF',   0.9748,  1.1900),
      ('10', '10600', 'Control Panels and Panel Mounted Inst.',              '10', 2, 'EA',   0.0000,  1.1900),
      ('10', '10820', 'Check-Out and Testing',                               '10', 2, 'EA',   2.8143,  1.1900),
      ('10', '10830', 'Final Calibration and Loop Check',                    '10', 2, 'EA',   2.7059,  1.1900)
    ) as v(prime, code, description, parent, level, uom, base_rate, pf_adj)
    loop
      insert into projectcontrols.coa_codes (
        tenant_id, prime, code, description, parent, level, uom, base_rate, pf_adj
      )
      values (
        t_id, rec.prime, rec.code, rec.description, rec.parent,
        rec.level::smallint, rec.uom::projectcontrols.uom_code,
        rec.base_rate::numeric(10, 4), rec.pf_adj::numeric(6, 4)
      )
      on conflict (tenant_id, code) do update set
        prime       = excluded.prime,
        description = excluded.description,
        parent      = excluded.parent,
        level       = excluded.level,
        uom         = excluded.uom,
        base_rate   = excluded.base_rate,
        pf_adj      = excluded.pf_adj,
        updated_at  = now();
    end loop;
  end loop;
end$$;
