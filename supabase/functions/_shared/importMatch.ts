export type ImportedRecordIdentity = {
  disciplineId: string | null;
  sourceRow: number | null;
  dwg: string | null | undefined;
  tagNo: string | null | undefined;
  spoolFr: string | null | undefined;
};

export type ExistingProgressRecord = {
  id: string;
  discipline_id: string | null;
  source_row: number | null;
  dwg: string | null;
  tag_no: string | null;
  spool_fr: string | null;
  source_type: string;
};

function normalized(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

function identityKeys(identity: ImportedRecordIdentity): string[] {
  const discipline = normalized(identity.disciplineId);
  if (!discipline) return [];
  const keys: string[] = [];
  const sourceRow = normalized(identity.sourceRow);
  const dwg = normalized(identity.dwg);
  const tagNo = normalized(identity.tagNo);
  const spoolFr = normalized(identity.spoolFr);
  if (sourceRow) keys.push(`${discipline}|source-row|${sourceRow}`);
  if (dwg) keys.push(`${discipline}|dwg|${dwg}`);
  if (tagNo) keys.push(`${discipline}|tag|${tagNo}`);
  if (spoolFr) keys.push(`${discipline}|spool|${spoolFr}`);
  return keys;
}

function existingIdentity(
  record: ExistingProgressRecord,
): ImportedRecordIdentity {
  return {
    disciplineId: record.discipline_id,
    sourceRow: record.source_row,
    dwg: record.dwg,
    tagNo: record.tag_no,
    spoolFr: record.spool_fr,
  };
}

/**
 * Match a weekly upload row to one existing project record without allowing
 * cross-discipline matches or ambiguous identifiers. Baseline rows win over
 * previously imported rows when a project contains legacy duplicates.
 */
export function matchImportedRecords(
  incoming: ImportedRecordIdentity[],
  existing: ExistingProgressRecord[],
): Array<string | null> {
  const ordered = existing.slice().sort((a, b) => {
    const sourceRank = (source: string) => (source === "baseline" ? 0 : 1);
    return sourceRank(a.source_type) - sourceRank(b.source_type);
  });
  const byKey = new Map<string, ExistingProgressRecord[]>();
  for (const record of ordered) {
    for (const key of identityKeys(existingIdentity(record))) {
      const candidates = byKey.get(key) ?? [];
      candidates.push(record);
      byKey.set(key, candidates);
    }
  }

  const claimed = new Set<string>();
  return incoming.map((identity) => {
    for (const key of identityKeys(identity)) {
      const candidates = (byKey.get(key) ?? []).filter((record) =>
        !claimed.has(record.id)
      );
      const baselineCandidates = candidates.filter((record) =>
        record.source_type === "baseline"
      );
      const usableCandidates = baselineCandidates.length === 1
        ? baselineCandidates
        : candidates;
      if (usableCandidates.length !== 1) continue;
      const match = usableCandidates[0]!;
      claimed.add(match.id);
      return match.id;
    }
    return null;
  });
}
