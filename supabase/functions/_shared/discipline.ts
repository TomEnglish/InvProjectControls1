export type DisciplineReference = {
  id: string;
  discipline_code: string;
};

const DISCIPLINE_ALIASES: Record<string, string> = {
  site: 'SITE',
  'site work': 'SITE',
  civil: 'CIVIL',
  civ: 'CIVIL',
  foundations: 'FOUNDATIONS',
  foundation: 'FOUNDATIONS',
  steel: 'STEEL',
  pipe: 'PIPE',
  electrical: 'ELEC',
  elec: 'ELEC',
  mechanical: 'MECH',
  mech: 'MECH',
  instrumentation: 'INST',
  instrument: 'INST',
  inst: 'INST',
};

function disciplineCodes(value: string | null | undefined): string[] {
  const key = value?.trim().toLowerCase();
  if (!key) return [];

  const code = DISCIPLINE_ALIASES[key] ?? key.toUpperCase();
  // Foundations has historically been folded into Civil in some projects,
  // but projects that keep a dedicated Foundations discipline should still
  // receive the upload there.
  return code === 'FOUNDATIONS' ? ['FOUNDATIONS', 'CIVIL'] : [code];
}

/**
 * Resolve the progress_records.discipline_id for an imported row.
 *
 * Unified workbooks carry a row-level discipline label; single-discipline
 * queue uploads rely on the declared craft. A row label wins when the project
 * has that discipline, with the declared craft as a safe fallback.
 */
export function resolveDisciplineId(
  rowLabel: string | null | undefined,
  declaredDiscipline: string | null | undefined,
  disciplines: DisciplineReference[],
): string | null {
  const byCode = new Map(
    disciplines.map((d) => [d.discipline_code.trim().toUpperCase(), d.id]),
  );

  for (const value of [rowLabel, declaredDiscipline]) {
    for (const code of disciplineCodes(value)) {
      const id = byCode.get(code);
      if (id) return id;
    }
  }

  return null;
}
