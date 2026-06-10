type StatusKind =
  | 'active'
  | 'draft'
  | 'locked'
  | 'closed'
  | 'pending'
  | 'pc_reviewed'
  | 'approved'
  | 'rejected';

// Map domain statuses onto the InvenioStyle .is-chip-* tonal classes.
// `pending` is a normal workflow state, not a failure — warn (amber), never
// danger (red), so an awaiting-review CO doesn't read as an error.
const variant: Record<StatusKind, string> = {
  active: 'is-chip-success',
  draft: 'is-chip-warn',
  locked: 'is-chip-info',
  closed: 'is-chip-neutral',
  pending: 'is-chip-warn',
  pc_reviewed: 'is-chip-info',
  approved: 'is-chip-success',
  rejected: 'is-chip-danger',
};

export function StatusChip({ kind }: { kind: StatusKind | string }) {
  const cls = variant[kind as StatusKind] ?? 'is-chip-neutral';
  return <span className={`is-chip ${cls} capitalize`}>{kind.replace(/_/g, ' ')}</span>;
}
