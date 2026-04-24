import type { ReactNode } from 'react';

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[color:var(--color-line)]">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="h-[300px] relative">{children}</div>
    </div>
  );
}

export function ChartCardSkeleton({ title }: { title: string }) {
  return (
    <ChartCard title={title}>
      <div className="w-full h-full bg-[color:var(--color-canvas)] rounded animate-pulse" />
    </ChartCard>
  );
}
