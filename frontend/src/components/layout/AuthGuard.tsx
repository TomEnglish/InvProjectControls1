import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/queries';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const { data: appUser, isLoading: appUserLoading } = useCurrentUser();

  if (loading || (session && appUserLoading)) {
    return (
      <div className="flex items-center justify-center h-screen text-[color:var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated but not bound to a tenant — handle_new_user hasn't run, or the
  // user signed up outside the projectcontrols invite flow.
  if (!appUser) {
    return <Navigate to="/pending-assignment" replace />;
  }

  return <>{children}</>;
}
