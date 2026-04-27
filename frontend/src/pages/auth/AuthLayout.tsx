import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--color-canvas)] p-4">
      <div className="w-[400px] max-w-full bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-6">
        <h1 className="text-lg font-semibold mb-1">{title}</h1>
        {subtitle && (
          <p className="text-xs text-[color:var(--color-text-muted)] mb-4">{subtitle}</p>
        )}
        {children}
        {footer && <div className="mt-4 text-xs text-center">{footer}</div>}
      </div>
    </div>
  );
}
