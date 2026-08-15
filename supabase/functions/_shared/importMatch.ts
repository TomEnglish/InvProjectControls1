export type ImportedRecordIdentity = {
  disciplineId: string | null;
  sourceRow: number | null;
  dwg: string | null | undefined;
  tagNo: string | null | undefined;
  spoolFr: string | null | undefined;
  attrSpec: string | null | undefined;
};

export type ExistingProgressRecord = {
  id: string;
  discipline_id: string | null;
  source_row: number | null;
  dwg: string | null;
  tag_no: string | null;
  spool_fr: string | null;
  attr_spec: string | null;
  source_type: string;
};

export type BaselineMatchIssue = {
  row: number;
  code: "missing_identity" | "unmatched" | "ambiguous" | "duplicate";
  message: string;
};

export type BaselineMatchResult = {
  ids: Array<string | null>;
  issues: BaselineMatchIssue[];
};

function normalized(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

/**
 * The row number is a source reference only. The stable project identity is
 * discipline + drawing + specification + a discipline-specific item id.
 * Pipe uses SPOOL_FR; tagged disciplines use TAG_NO when no spool is present.
 */
function baselineIdentityKey(
  identity: ImportedRecordIdentity,
): string | null {
  const discipline = normalized(identity.disciplineId);
  const dwg = normalized(identity.dwg);
  const spec = normalized(identity.attrSpec);
  const spool = normalized(identity.spoolFr);
  const tag = normalized(identity.tagNo);
  if (!discipline || !dwg || !spec) return null;
  if (spool) return `${discipline}|${dwg}|${spec}|spool|${spool}`;
  if (tag) return `${discipline}|${dwg}|${spec}|tag|${tag}`;
  return null;
}

function existingIdentity(record: ExistingProgressRecord): ImportedRecordIdentity {
  return {
    disciplineId: record.discipline_id,
    sourceRow: record.source_row,
    dwg: record.dwg,
    tagNo: record.tag_no,
    spoolFr: record.spool_fr,
    attrSpec: record.attr_spec,
  };
}

/**
 * Match an audit or actual-hours row to exactly one locked-baseline record.
 * No source-row fallback, cross-discipline match, imported-row match, or
 * ambiguous match is allowed.
 */
export function matchBaselineRecords(
  incoming: ImportedRecordIdentity[],
  existing: ExistingProgressRecord[],
): BaselineMatchResult {
  const baseline = existing.filter((record) => record.source_type === "baseline");
  const byKey = new Map<string, ExistingProgressRecord[]>();
  for (const record of baseline) {
    const key = baselineIdentityKey(existingIdentity(record));
    if (!key) continue;
    const candidates = byKey.get(key) ?? [];
    candidates.push(record);
    byKey.set(key, candidates);
  }

  const ids = Array<string | null>(incoming.length).fill(null);
  const issues: BaselineMatchIssue[] = [];
  const seenIncoming = new Set<string>();
  const claimed = new Set<string>();

  incoming.forEach((identity, index) => {
    const row = index + 1;
    const key = baselineIdentityKey(identity);
    if (!key) {
      issues.push({
        row,
        code: "missing_identity",
        message: `Row ${row}: DISCIPLINE, DWG, SPEC, and either SPOOL_FR or TAG_NO are required for baseline matching.`,
      });
      return;
    }
    if (seenIncoming.has(key)) {
      issues.push({
        row,
        code: "duplicate",
        message: `Row ${row}: the audit file repeats a baseline identity key.`,
      });
      return;
    }
    seenIncoming.add(key);

    const candidates = byKey.get(key) ?? [];
    if (candidates.length === 0) {
      issues.push({
        row,
        code: "unmatched",
        message: `Row ${row}: no matching locked-baseline record was found.`,
      });
      return;
    }
    if (candidates.length > 1) {
      issues.push({
        row,
        code: "ambiguous",
        message: `Row ${row}: more than one locked-baseline record has the same identity key.`,
      });
      return;
    }

    const match = candidates[0]!;
    if (claimed.has(match.id)) {
      issues.push({
        row,
        code: "duplicate",
        message: `Row ${row}: the baseline record is already matched by another upload row.`,
      });
      return;
    }
    claimed.add(match.id);
    ids[index] = match.id;
  });

  return { ids, issues };
}
