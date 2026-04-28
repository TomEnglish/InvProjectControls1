import type { ReactNode } from 'react';

/**
 * Surface card — InvenioStyle .is-surface chrome (12px radius, 1px border, shadow-sm).
 * Default padding is 24px (matching the prototype's .card pattern).
 */
export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`is-surface ${padded ? 'p-6' : ''} ${className}`}>{children}</div>
  );
}

/**
 * Standard card header — eyebrow-style title with optional actions.
 * Pairs with Card padded=false when actions need flush border.
 */
export function CardHeader({
  eyebrow,
  title,
  caption,
  actions,
}: {
  eyebrow?: string;
  title: string;
  caption?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 mb-5 border-b border-[color:var(--color-line)]">
      <div className="min-w-0">
        {eyebrow && <div className="is-eyebrow mb-1.5">{eyebrow}</div>}
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        {caption && (
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">{caption}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
