import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  caption,
  children,
  width = 560,
  dirty = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  caption?: string;
  children: ReactNode;
  width?: number;
  /**
   * When true, Escape / backdrop / X close paths ask for confirmation before
   * discarding — pass the form's "has the user typed anything" state so a
   * stray click can't wipe a half-filled modal.
   */
  dirty?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Keep the latest values in refs so the keydown listener and focus-restore
  // effect don't need to re-subscribe every render.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
    onCloseRef.current();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Initial focus on open; restore focus to the opener on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialog).focus();
    }
    return () => previouslyFocused?.focus?.();
  }, [open]);

  // Escape to close (dirty-guarded) + a minimal Tab focus trap so keyboard
  // users can't tab out behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = dialog.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="is-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="is-modal"
        style={{ maxWidth: width }}
        tabIndex={-1}
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
            onClick={requestClose}
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
