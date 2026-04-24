import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

type Props = {
  value: number;
  /** For CPI/SPI, neutral target is 1.0; for SV/CV, neutral is 0. */
  neutral?: number;
  /** Display formatter; default: 3dp for ratios, sign+int for variances */
  format?: (v: number) => string;
};

export function VarianceCell({ value, neutral = 0, format }: Props) {
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
