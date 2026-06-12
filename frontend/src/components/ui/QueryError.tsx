import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

/**
 * Errors thrown by fetch/Supabase when the network itself is the problem.
 * Field staff on site Wi-Fi hit these constantly — surface them as a
 * connection problem rather than leaking "TypeError: Failed to fetch".
 */
const NETWORK_ERROR_RE =
  /failed to fetch|network\s?error|network request failed|load failed|fetch failed|timed? ?out/i;

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : error ? String(error) : '';
  if (!navigator.onLine || NETWORK_ERROR_RE.test(raw)) {
    return "We couldn't reach the server — you may be offline or on a weak connection.";
  }
  return raw || 'Something went wrong while loading this data.';
}

/**
 * Shared page-level query error state: human-readable message plus a Retry
 * button wired to refetch. Every page renders this (instead of an ad-hoc
 * toast) when a query fails, so recovery never requires a full page reload.
 */
export function QueryError({
  title = "Couldn't load this page",
  error,
  onRetry,
  className = '',
}: {
  title?: string;
  error?: unknown;
  /** Refetch the failed queries; may return a promise (e.g. query.refetch). */
  onRetry: () => unknown;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={`is-toast is-toast-danger ${className}`} role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="opacity-90 mt-0.5">{describeError(error)}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={retrying}
        onClick={handleRetry}
      >
        <RefreshCw size={14} className={retrying ? 'animate-spin' : undefined} />
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
