import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  caption,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  caption?: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="is-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="is-modal"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3>{title}</h3>
            {caption && (
              <p className="text-sm text-[color:var(--color-text-muted)] mt-1">{caption}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-m-1 p-1 rounded-md text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-raised)] hover:text-[color:var(--color-text)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
