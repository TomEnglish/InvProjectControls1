import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';

type Props = {
  accept: string;
  onFile: (file: File | null) => void;
  selected?: File | null;
  label?: string;
  hint?: string;
};

/**
 * A clickable drop zone for file uploads. Replaces the bare <input type="file">
 * with a target the user can either click OR drag a file onto. Accessibility:
 * the input is still a real <input>, just visually hidden, so keyboard /
 * screen-reader flows work the same as before.
 *
 * Used by /progress/upload (weekly progress) and the Project Setup baseline
 * card. The two flows have different validation but identical UX for picking
 * the file.
 */
export function FileDropzone({
  accept,
  onFile,
  selected,
  label = 'Drag a file here or click to browse',
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const stopAndPrevent = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragEnter = (e: DragEvent) => {
    stopAndPrevent(e);
    if (e.dataTransfer.items.length > 0) setDragging(true);
  };

  const onDragOver = (e: DragEvent) => {
    stopAndPrevent(e);
    // Stay in "dragging" state while the file hovers.
  };

  const onDragLeave = (e: DragEvent) => {
    stopAndPrevent(e);
    // Only flip off when the cursor leaves the root, not when it crosses
    // an inner child element.
    if (e.currentTarget === e.target) setDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    stopAndPrevent(e);
    setDragging(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) onFile(f);
  };

  const clear = () => {
    onFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="w-full rounded-md border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer"
        style={{
          padding: '20px',
          borderColor: dragging
            ? 'var(--color-primary)'
            : 'var(--color-line-strong)',
          background: dragging
            ? 'var(--color-primary-soft)'
            : 'var(--color-raised)',
          color: dragging ? 'var(--color-primary)' : 'var(--color-text-muted)',
          minHeight: 90,
        }}
      >
        {selected ? (
          <>
            <FileText size={20} />
            <div className="text-sm font-medium text-[color:var(--color-text)]">
              {selected.name}
            </div>
            <div className="text-xs">
              {(selected.size / 1024).toFixed(1)} KB — click to replace, or drop another file
            </div>
          </>
        ) : (
          <>
            <UploadCloud size={20} />
            <div className="text-sm font-medium">{label}</div>
            {hint && <div className="text-xs">{hint}</div>}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </button>
      {selected && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-variance-unfavourable)] transition-colors"
        >
          <X size={12} /> Clear selection
        </button>
      )}
    </div>
  );
}
