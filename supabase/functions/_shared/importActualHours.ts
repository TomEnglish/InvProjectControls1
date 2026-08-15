import { resolveDisciplineId, type DisciplineReference } from './discipline.ts';
import {
  matchBaselineRecords,
  type BaselineMatchIssue,
  type ExistingProgressRecord,
  type ImportedRecordIdentity,
} from './importMatch.ts';

export type ActualHoursImportItem = {
  discipline_label?: string;
  dwg?: string;
  tag_no?: string;
  spool_fr?: string;
  attr_spec?: string;
  hours: number;
};

export type ActualHoursIssue = BaselineMatchIssue | {
  row: number;
  code: 'invalid_hours';
  message: string;
};

export type ResolvedActualHourRow = {
  recordId: string;
  disciplineId: string;
  hours: number;
};

export type ActualHoursResolution = {
  rows: ResolvedActualHourRow[];
  issues: ActualHoursIssue[];
};

function isValidHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Resolve a parsed actual-hours workbook to locked-baseline records.
 *
 * This function intentionally prepares no partial write set. A caller must
 * reject the complete upload when any row has invalid hours or fails the
 * strict baseline identity match.
 */
export function resolveActualHoursRows(
  items: ActualHoursImportItem[],
  disciplines: DisciplineReference[],
  existing: ExistingProgressRecord[],
): ActualHoursResolution {
  const issues: ActualHoursIssue[] = [];
  const identities: ImportedRecordIdentity[] = items.map((item, index) => {
    if (!isValidHours(item.hours)) {
      issues.push({
        row: index + 1,
        code: 'invalid_hours',
        message: `Row ${index + 1}: ACTUAL_HRS must be a non-negative number.`,
      });
    }

    return {
      disciplineId: resolveDisciplineId(item.discipline_label, null, disciplines),
      sourceRow: null,
      dwg: item.dwg,
      tagNo: item.tag_no,
      spoolFr: item.spool_fr,
      attrSpec: item.attr_spec,
    };
  });

  const matches = matchBaselineRecords(identities, existing);
  issues.push(...matches.issues);
  if (issues.length > 0) return { rows: [], issues };

  const rows: ResolvedActualHourRow[] = [];
  for (let index = 0; index < items.length; index++) {
    const recordId = matches.ids[index];
    const disciplineId = identities[index]?.disciplineId;
    if (!recordId || !disciplineId) {
      // The matcher normally reports this, but keeping this guard makes the
      // resolved write contract safe if its implementation changes later.
      issues.push({
        row: index + 1,
        code: 'unmatched',
        message: `Row ${index + 1}: no baseline record could be resolved.`,
      });
      continue;
    }
    rows.push({ recordId, disciplineId, hours: items[index]!.hours });
  }

  return issues.length > 0 ? { rows: [], issues } : { rows, issues };
}
