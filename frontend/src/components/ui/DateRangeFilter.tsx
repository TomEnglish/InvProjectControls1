import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { inputClass } from '@/components/ui/FormField';

export type DateRange = {
  start: string | null; // ISO YYYY-MM-DD; null = no lower bound
  end: string | null;   // ISO YYYY-MM-DD; null = no upper bound
  label: string;        // human-readable preset name or "Custom"
};

export const ALL_TIME_RANGE: DateRange = { start: null, end: null, label: 'All time' };

type PresetId = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'custom';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day; // Sunday=0; week starts Sunday
  const out = new Date(d);
  out.setDate(d.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), 1);
  return out;
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function presetRange(id: PresetId): DateRange {
  const now = new Date();
  switch (id) {
    case 'all':
      return ALL_TIME_RANGE;
    case 'this_week': {
      const start = startOfWeek(now);
      return { start: isoDate(start), end: isoDate(now), label: 'This week' };
    }
    case 'last_week': {
      const thisStart = startOfWeek(now);
      const lastStart = new Date(thisStart);
      lastStart.setDate(thisStart.getDate() - 7);
      const lastEnd = new Date(thisStart);
      lastEnd.setDate(thisStart.getDate() - 1);
      return { start: isoDate(lastStart), end: isoDate(lastEnd), label: 'Last week' };
    }
    case 'this_month':
      return { start: isoDate(startOfMonth(now)), end: isoDate(now), label: 'This month' };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = endOfMonth(start);
      return { start: isoDate(start), end: isoDate(end), label: 'Last month' };
    }
    case 'this_quarter':
      return { start: isoDate(startOfQuarter(now)), end: isoDate(now), label: 'This quarter' };
    case 'custom':
      return { start: null, end: null, label: 'Custom' };
  }
}

const PRESET_BUTTONS: { id: PresetId; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
];

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [customStart, setCustomStart] = useState(value.start ?? '');
  const [customEnd, setCustomEnd] = useState(value.end ?? '');

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const applyPreset = (id: PresetId) => {
    if (id === 'custom') return;
    const r = presetRange(id);
    onChange(r);
    setCustomStart(r.start ?? '');
    setCustomEnd(r.end ?? '');
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customStart && !customEnd) return;
    onChange({
      start: customStart || null,
      end: customEnd || null,
      label: customStart && customEnd
        ? `${customStart} → ${customEnd}`
        : customStart
          ? `From ${customStart}`
          : `Until ${customEnd}`,
    });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={inputClass}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          paddingRight: 28,
          minWidth: 160,
        }}
        aria-label="Date range filter"
      >
        <Calendar size={14} />
        <span>{value.label}</span>
        <ChevronDown
          size={14}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 rounded-md border bg-[color:var(--color-surface)] shadow-lg p-3"
          style={{
            borderColor: 'var(--color-line)',
            minWidth: 280,
          }}
        >
          <div className="flex flex-col gap-1">
            {PRESET_BUTTONS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className="text-left px-2 py-1.5 text-xs rounded hover:bg-[color:var(--color-raised)] transition-colors"
                style={{
                  background: value.label === p.label ? 'var(--color-primary-soft)' : 'transparent',
                  color: value.label === p.label ? 'var(--color-primary)' : 'var(--color-text)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-[color:var(--color-line)]">
            <div className="text-[10px] uppercase tracking-wide font-bold text-[color:var(--color-text-muted)] mb-1.5">
              Custom range
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className={inputClass}
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Start date"
              />
              <span className="text-xs text-[color:var(--color-text-muted)]">→</span>
              <input
                type="date"
                className={inputClass}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="End date"
              />
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customStart && !customEnd}
              className="mt-2 w-full px-2 py-1.5 text-xs rounded-md border transition-colors"
              style={{
                borderColor: 'var(--color-line-strong)',
                background: 'var(--color-primary)',
                color: 'var(--color-text-inverse)',
                opacity: !customStart && !customEnd ? 0.5 : 1,
              }}
            >
              Apply custom
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Convenience: does the given ISO date string fall in the range? null bounds
// are treated as open-ended. Date-only comparison via lexicographic ordering
// works because YYYY-MM-DD is monotonic.
export function isInRange(isoDay: string | null, range: DateRange): boolean {
  if (!isoDay) return range.start === null && range.end === null;
  if (range.start && isoDay < range.start) return false;
  if (range.end && isoDay > range.end) return false;
  return true;
}
