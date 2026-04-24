import type { ReactNode } from 'react';

function StubPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Phase 0 stub. Wired into routing, RLS, and auth. Real content lands in the module's
        implementation phase (see <span className="font-mono">ARCHITECTURE.md §XV</span>).
      </p>
      {children}
    </div>
  );
}

export const CoaPage = () => <StubPage title="COA & Unit Rates" />;
export const RocPage = () => <StubPage title="Rules of Credit" />;
export const BudgetPage = () => <StubPage title="Budget & Baseline" />;
export const ReportsPage = () => <StubPage title="Reports & Analytics" />;
