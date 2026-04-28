import type { ReactNode } from 'react';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`is-form-field ${className}`}>
      <label className="is-form-label">
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? (
        <span className="is-form-error">{error}</span>
      ) : (
        hint && <span className="is-form-helper">{hint}</span>
      )}
    </div>
  );
}

// Drop-in classes for raw inputs/selects/textareas. Prefer importing these
// over re-styling each field by hand.
export const inputClass = 'is-form-input';
export const selectClass = 'is-form-select';
export const textareaClass = 'is-form-textarea';
