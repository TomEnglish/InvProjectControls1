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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--hero-gradient)' }}>
      <div className="w-[400px] max-w-full">
        <div className="is-surface p-8" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="text-center pb-5 mb-5 border-b border-[color:var(--color-line)]">
            <img src="/brand/invenio-technologies-logo.png" alt="Invenio Technologies" className="theme-logo-light h-12 w-auto mx-auto mb-3" />
            <img src="/brand/invenio-technologies-logo-light.png" alt="" aria-hidden="true" className="theme-logo-dark h-12 w-auto mx-auto mb-3" />
            <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
            {eyebrow && <div className="text-[13px] text-[color:var(--color-text-muted)] mt-0.5">{eyebrow}</div>}
          </div>
          {subtitle && (
            <p className="text-sm text-[color:var(--color-text-muted)] mb-5 leading-relaxed">
              {subtitle}
            </p>
          )}
          <div>{children}</div>
        </div>

        {footer && (
          <div className="mt-5 text-center text-sm text-white/85 [&_a]:text-white [&_a]:underline">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
