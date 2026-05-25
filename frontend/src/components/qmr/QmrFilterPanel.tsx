import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Option = { value: string; label: string };

type Props = {
  craftOptions: Option[];
  descriptionOptions: Option[];
  craftFilter: Set<string>;
  descriptionFilter: Set<string>;
  onCraftChange: (next: Set<string>) => void;
  onDescriptionChange: (next: Set<string>) => void;
  onClear: () => void;
  filtersActive: boolean;
  visibleCraftCount: number;
  totalCraftCount: number;
};

function CheckboxSection({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-2">
        {title}
      </div>
      <div
        className="rounded-md border border-[color:var(--color-line)] overflow-y-auto"
        style={{ maxHeight: 220 }}
      >
        {options.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[color:var(--color-text-muted)]">No options</p>
        ) : (
          options.map((o) => (
            <label
              key={o.value}
              className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[color:var(--color-raised)] border-b border-[color:var(--color-line)] last:border-b-0"
              style={{ fontSize: 12 }}
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span className="leading-snug">{o.label}</span>
            </label>
          ))
        )}
      </div>
      <p className="text-[10px] text-[color:var(--color-text-muted)] mt-1.5">
        {selected.size === 0 ? 'All shown' : `${selected.size} selected`}
      </p>
    </div>
  );
}

/** Side-panel craft + description toggles — Sandra's legacy QMR checkbox layout. */
export function QmrFilterPanel({
  craftOptions,
  descriptionOptions,
  craftFilter,
  descriptionFilter,
  onCraftChange,
  onDescriptionChange,
  onClear,
  filtersActive,
  visibleCraftCount,
  totalCraftCount,
}: Props) {
  return (
    <aside className="is-no-print is-surface p-4 w-72 shrink-0 self-start sticky top-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <div className="is-eyebrow mb-0.5">Show rows</div>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Uncheck to hide crafts or account codes from the table and exports.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <CheckboxSection
          title="Craft"
          options={craftOptions}
          selected={craftFilter}
          onChange={onCraftChange}
        />
        <CheckboxSection
          title="Description"
          options={descriptionOptions}
          selected={descriptionFilter}
          onChange={onDescriptionChange}
        />
      </div>

      {filtersActive && (
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={onClear} className="justify-start">
            <X size={14} /> Clear filters
          </Button>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Showing {visibleCraftCount} of {totalCraftCount} craft
            {totalCraftCount === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </aside>
  );
}
