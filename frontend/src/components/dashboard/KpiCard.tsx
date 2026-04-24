import type { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  tone?: 'neutral' | 'favourable' | 'unfavourable';
};

const toneColor: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'var(--color-text-muted)',
  favourable: 'var(--color-variance-favourable)',
  unfavourable: 'var(--color-variance-unfavourable)',
};

export function KpiCard({ label, value, subtext, tone = 'neutral' }: Props) {
  return (
    <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5 text-center">
      <div className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)] mt-1">
        {label}
      </div>
      {subtext && (
        <div className="text-xs mt-1.5" style={{ color: toneColor[tone] }}>
          {subtext}
        </div>
      )}
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5">
      <div className="h-8 bg-[color:var(--color-canvas)] rounded w-24 mx-auto animate-pulse" />
      <div className="h-3 bg-[color:var(--color-canvas)] rounded w-32 mx-auto mt-3 animate-pulse" />
    </div>
  );
}
