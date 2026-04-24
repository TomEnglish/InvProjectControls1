import type { ReactNode } from 'react';

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <label className="text-[11px] font-semibold text-[color:var(--color-text-muted)] uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
      {hint && <span className="text-[11px] text-[color:var(--color-text-muted)] mt-1">{hint}</span>}
    </div>
  );
}

export const inputClass =
  'px-3 py-2 border border-[color:var(--color-line)] rounded-md text-sm bg-[color:var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/30';
