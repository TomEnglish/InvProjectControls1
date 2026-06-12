import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { WifiOff } from 'lucide-react';

const subscribe = (onStoreChange: () => void) => onlineManager.subscribe(onStoreChange);

// onlineManager already tracks window online/offline events, but its initial
// value is optimistic (true) — AND it with navigator.onLine so a page opened
// while already offline shows the banner immediately.
const getSnapshot = () => onlineManager.isOnline() && navigator.onLine;

/**
 * Global connectivity banner for field staff on unreliable site connections.
 * Sticks just below the top bar so the offline state stays visible while
 * scrolling; queries refetch automatically on reconnect (refetchOnReconnect).
 */
export function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot);

  if (isOnline) return null;

  return (
    <div
      className="is-toast is-toast-warn sticky z-30 rounded-none border-x-0 items-center"
      style={{ top: 'var(--topbar-h)' }}
      role="status"
      aria-live="polite"
    >
      <WifiOff size={16} className="shrink-0" />
      <span>
        <span className="font-semibold">You're offline.</span> Data shown may be out of date —
        it will refresh automatically when the connection returns.
      </span>
    </div>
  );
}
