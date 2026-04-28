import { Construction } from 'lucide-react';

function StubPage({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="is-surface is-empty">
      <div className="is-empty-icon">
        <Construction size={28} />
      </div>
      <div className="is-empty-title">{title}</div>
      <p className="is-empty-caption">{caption}</p>
      <p className="text-xs text-[color:var(--color-text-subtle)] mt-2">
        Wired into routing, RLS, and auth — module implementation is in flight.
      </p>
    </div>
  );
}

export const CoaPage = () => (
  <StubPage
    title="COA & Unit Rates"
    caption="Cost codes and unit-rate library for the tenant. Edit rates in place; bulk-import from the COA report; track base × PF adjustments."
  />
);

export const RocPage = () => (
  <StubPage
    title="Rules of Credit"
    caption="Eight-milestone earned-value templates per discipline. Edit weights inline — total must equal 100%."
  />
);

export const BudgetPage = () => (
  <StubPage
    title="Budget & Baseline"
    caption="Original / current / forecast budget side-by-side. Lock the baseline once setup is complete."
  />
);

export const ReportsPage = () => (
  <StubPage
    title="Reports & Analytics"
    caption="Earned-value summary, by-discipline drill-down, CO log, and exports."
  />
);
