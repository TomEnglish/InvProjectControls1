# Progressive Pipe audit fixtures

These three single-worksheet workbooks match the locked Pipe baseline on
`DISCIPLINE + DWG + SPOOL_FR + SPEC + CODE` and use the live `PIPE-STD`
milestone weights. Upload them in order through the audit/progress upload,
using the suggested week-ending date for each file:

1. `good_pipe_audit_week_02_milestones.xlsx` — 2026-08-23
2. `good_pipe_audit_week_03_milestones.xlsx` — 2026-08-30
3. `good_pipe_audit_week_04_milestones.xlsx` — 2026-09-06

Each file contains the same five Pipe records, with progressively higher
milestone values. Expected record progress by upload:

| File | 120-DR-590-SHT01 | 120-DR-590-SHT02 | 120-DR-591-SHT01 | 120-DR-591-SHT02 | 120-DR-592-SHT01 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Week 02 | 10.0% | 7.0% | 1.0% | 0.5% | 2.3% |
| Week 03 | 32.5% | 15.0% | 3.5% | 1.0% | 7.0% |
| Week 04 | 57.5% | 32.5% | 10.0% | 3.5% | 15.0% |

The later upload should update the same baseline records and create a new
snapshot, so the Snapshots comparison view can show the progression.
