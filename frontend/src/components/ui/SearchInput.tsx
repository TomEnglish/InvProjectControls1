import type { RefObject } from 'react';
import { Search } from 'lucide-react';
import { inputClass } from '@/components/ui/FormField';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Pixel width for the field wrapper, or any CSS width string. */
  width?: number | string;
  size?: 'md' | 'sm';
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function SearchInput({
  value,
  onChange,
  placeholder,
  width,
  size = 'md',
  className = '',
  inputRef,
}: Props) {
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <div
      className={`is-search-wrap ${size === 'sm' ? 'is-search-sm' : ''} ${className}`.trim()}
      style={width != null ? { width } : undefined}
    >
      <Search size={iconSize} className="is-search-icon" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className={inputClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
