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

export const ReportsPage = () => (
  <StubPage
    title="Reports & Analytics"
    caption="Earned-value summary, by-discipline drill-down, CO log, and exports."
  />
);
