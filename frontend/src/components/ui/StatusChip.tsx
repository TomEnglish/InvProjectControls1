type StatusKind = 'active' | 'draft' | 'locked' | 'closed' | 'pending' | 'approved' | 'rejected';

const styles: Record<StatusKind, { bg: string; fg: string }> = {
  active: { bg: 'var(--color-status-active-bg)', fg: 'var(--color-status-active-fg)' },
  draft: { bg: 'var(--color-status-draft-bg)', fg: 'var(--color-status-draft-fg)' },
  locked: { bg: 'var(--color-status-locked-bg)', fg: 'var(--color-status-locked-fg)' },
  closed: { bg: 'var(--color-status-closed-bg)', fg: 'var(--color-status-closed-fg)' },
  pending: { bg: 'var(--color-status-pending-bg)', fg: 'var(--color-status-pending-fg)' },
  approved: { bg: 'var(--color-status-approved-bg)', fg: 'var(--color-status-approved-fg)' },
  rejected: { bg: 'var(--color-status-pending-bg)', fg: 'var(--color-status-pending-fg)' },
};

export function StatusChip({ kind }: { kind: StatusKind | string }) {
  const style = styles[kind as StatusKind] ?? styles.closed;
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: style.bg, color: style.fg }}
    >
      {kind}
    </span>
  );
}
