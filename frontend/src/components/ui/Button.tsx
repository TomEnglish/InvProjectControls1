import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary: 'is-btn-primary',
  secondary: 'is-btn-secondary',
  ghost: 'is-btn-ghost',
  danger: 'is-btn-danger',
  outline: 'is-btn-outline',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  type = 'button',
  ...rest
}: Props) {
  const sizeClass = size === 'sm' ? 'is-btn-sm' : '';
  return (
    <button
      type={type}
      {...rest}
      className={`is-btn ${variantClass[variant]} ${sizeClass} ${className}`}
    >
      {children}
    </button>
  );
}
