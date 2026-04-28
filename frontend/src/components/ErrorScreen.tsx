import { AlertTriangle } from 'lucide-react';

export function ErrorScreen({ error, reset }: { error: unknown; reset: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--color-canvas)] p-6">
      <div className="is-surface p-8 max-w-[480px] w-full text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] mb-4">
          <AlertTriangle size={24} />
        </div>
        <h1 className="text-lg font-bold mb-2">Something went wrong</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] leading-relaxed mb-4">
          The error has been logged. Try reloading; if it keeps happening, please share the
          message below with support.
        </p>
        <pre className="text-xs font-mono p-3 rounded-md bg-[color:var(--color-raised)] border border-[color:var(--color-line)] text-left overflow-auto whitespace-pre-wrap break-words mb-5">
          {message}
        </pre>
        <button
          type="button"
          className="is-btn is-btn-primary w-full justify-center"
          onClick={() => {
            reset();
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
