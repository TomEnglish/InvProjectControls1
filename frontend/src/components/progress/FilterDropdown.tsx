import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { inputClass } from '@/components/ui/FormField';

type Option = { value: string; label: string };

type Props = {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
};

export function FilterDropdown({ label, options, selected, onChange, searchable = true }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const visible = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  const count = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={inputClass}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          paddingRight: 28,
          minWidth: 0,
          background: count > 0 ? 'var(--color-primary-soft)' : undefined,
          color: count > 0 ? 'var(--color-primary)' : undefined,
          borderColor: count > 0 ? 'var(--color-primary)' : undefined,
        }}
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="is-chip is-chip-primary" style={{ padding: '1px 6px', fontSize: 11 }}>
            {count}
          </span>
        )}
        <ChevronDown
          size={14}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 rounded-md border bg-[color:var(--color-surface)] shadow-lg"
          style={{
            borderColor: 'var(--color-line)',
            minWidth: 220,
            maxWidth: 320,
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {searchable && options.length > 8 && (
            <div className="p-2 border-b border-[color:var(--color-line)]">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
                />
                <input
                  className={`${inputClass} pl-7`}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}

          <div className="overflow-y-auto" style={{ flex: 1, maxHeight: 240 }}>
            {visible.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[color:var(--color-text-muted)] text-center">
                No options
              </div>
            ) : (
              visible.map((o) => {
                const checked = selected.has(o.value);
                return (
                  <label
                    key={o.value}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[color:var(--color-raised)]"
                    style={{ fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.value)}
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                );
              })
            )}
          </div>

          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-raised)] border-t border-[color:var(--color-line)] text-left flex items-center gap-1.5"
            >
              <X size={12} /> Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
