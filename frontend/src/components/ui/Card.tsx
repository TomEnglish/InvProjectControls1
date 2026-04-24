import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 mb-4 border-b border-[color:var(--color-line)]">
      <h3 className="text-sm font-semibold">{title}</h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
