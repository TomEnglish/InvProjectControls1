import type { ReactNode } from 'react';

export function ChartCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="is-surface p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {caption && (
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{caption}</p>
        )}
      </div>
      <div className="h-[300px] relative">{children}</div>
    </div>
  );
}

export function ChartCardSkeleton({ title }: { title: string }) {
  return (
    <ChartCard title={title}>
      <div className="w-full h-full is-skeleton" style={{ height: '100%' }} />
    </ChartCard>
  );
}
