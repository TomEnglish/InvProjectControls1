import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'accent' | 'outline' | 'success' | 'danger';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const base =
  'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

const variants: Record<Variant, string> = {
  primary:
    'text-white hover:brightness-110 bg-[color:var(--color-primary)] border border-[color:var(--color-primary)]',
  accent:
    'text-white hover:brightness-110 bg-[color:var(--color-accent)] border border-[color:var(--color-accent)]',
  outline:
    'bg-transparent border border-[color:var(--color-line)] text-[color:var(--color-text)] hover:bg-[color:var(--color-canvas)]',
  success:
    'text-white hover:brightness-110 bg-[color:var(--color-status-active)] border border-[color:var(--color-status-active)]',
  danger:
    'text-white hover:brightness-110 bg-[color:var(--color-variance-unfavourable)] border border-[color:var(--color-variance-unfavourable)]',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}
