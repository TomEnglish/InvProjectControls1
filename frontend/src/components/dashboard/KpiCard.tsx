import type { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  tone?: 'neutral' | 'favourable' | 'unfavourable';
};

const chipClass: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'is-chip-neutral',
  favourable: 'is-chip-success',
  unfavourable: 'is-chip-danger',
};

/**
 * Stat tile per InvenioStyle prototype §04 Patterns: uppercase eyebrow,
 * 32px value, optional delta chip.
 */
export function KpiCard({ label, value, subtext, tone = 'neutral' }: Props) {
  return (
    <div className="is-surface is-stat-card">
      <div className="is-stat-label">{label}</div>
      <div className="is-stat-value">{value}</div>
      {subtext && <span className={`is-chip ${chipClass[tone]} self-start`}>{subtext}</span>}
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="is-surface is-stat-card">
      <div className="is-skeleton sm" style={{ width: '40%' }} />
      <div className="is-skeleton lg" style={{ height: 28, width: '60%' }} />
      <div className="is-skeleton sm" style={{ width: '50%' }} />
    </div>
  );
}
