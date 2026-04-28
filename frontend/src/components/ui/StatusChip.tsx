type StatusKind = 'active' | 'draft' | 'locked' | 'closed' | 'pending' | 'approved' | 'rejected';

// Map domain statuses onto the InvenioStyle .is-chip-* tonal classes.
const variant: Record<StatusKind, string> = {
  active: 'is-chip-success',
  draft: 'is-chip-warn',
  locked: 'is-chip-info',
  closed: 'is-chip-neutral',
  pending: 'is-chip-danger',
  approved: 'is-chip-success',
  rejected: 'is-chip-danger',
};

export function StatusChip({ kind }: { kind: StatusKind | string }) {
  const cls = variant[kind as StatusKind] ?? 'is-chip-neutral';
  return <span className={`is-chip ${cls} capitalize`}>{kind}</span>;
}
