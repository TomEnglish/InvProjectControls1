import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

type Props = {
  value: number;
  /** For CPI/SPI, neutral target is 1.0; for SV/CV, neutral is 0. */
  neutral?: number;
  /** Display formatter; default: 3dp for ratios, sign+int for variances */
  format?: (v: number) => string;
  /** Ratio mode (CPI/SPI): no arrow — chip conveys performance, not a signed value. */
  variant?: 'variance' | 'ratio';
};

export function VarianceCell({ value, neutral = 0, format, variant = 'variance' }: Props) {
  if (variant === 'ratio') {
    const onTarget = value >= neutral;
    const display = format ? format(value) : value.toFixed(3);
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[color:var(--color-text)]">
        <span>{display}</span>
        <span
          className={`is-chip ${onTarget ? 'is-chip-success' : 'is-chip-warn'}`}
          style={{ padding: '1px 6px', fontSize: 10, height: 18, display: 'inline-flex', alignItems: 'center' }}
        >
          {onTarget ? 'On target' : 'Below target'}
        </span>
      </span>
    );
  }

  const delta = value - neutral;
  const kind = delta > 0 ? 'favourable' : delta < 0 ? 'unfavourable' : 'neutral';
  const color =
    kind === 'favourable'
      ? 'var(--color-variance-favourable)'
      : kind === 'unfavourable'
      ? 'var(--color-variance-unfavourable)'
      : 'var(--color-variance-neutral)';
  const Icon = kind === 'favourable' ? ArrowUp : kind === 'unfavourable' ? ArrowDown : Minus;
  const display = format
    ? format(value)
    : Math.abs(neutral) < 0.0001
    ? `${value >= 0 ? '+' : ''}${Math.round(value)}`
    : value.toFixed(3);
  return (
    <span className="inline-flex items-center gap-1 font-mono" style={{ color }}>
      <Icon size={12} aria-hidden />
      {display}
    </span>
  );
}
