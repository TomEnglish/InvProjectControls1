import type { ReactNode } from 'react';

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--color-canvas)] p-6">
      <div className="w-[420px] max-w-full">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <img src="/brand/invenio-mark.svg" alt="" className="w-9 h-9 dark:hidden" />
          <img src="/brand/invenio-mark-dark.svg" alt="" className="w-9 h-9 hidden dark:block" />
          <div className="text-base font-extrabold text-[color:var(--color-primary)] tracking-tight">
            Invenio
          </div>
        </div>

        <div className="is-surface p-7">
          {eyebrow && <div className="is-eyebrow mb-2">{eyebrow}</div>}
          <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-[15px] text-[color:var(--color-text-muted)] mt-2 leading-relaxed">
              {subtitle}
            </p>
          )}
          <div className="mt-6">{children}</div>
        </div>

        {footer && (
          <div className="mt-5 text-center text-sm text-[color:var(--color-text-muted)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
