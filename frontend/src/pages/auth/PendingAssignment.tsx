import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from './AuthLayout';

export function PendingAssignmentPage() {
  const nav = useNavigate();
  const { user } = useAuth();

  const onSignOut = async () => {
    await supabase.auth.signOut();
    nav('/login', { replace: true });
  };

  return (
    <AuthLayout
      title="Pending organisation assignment"
      subtitle="Your account isn't bound to an organisation yet."
    >
      <div className="text-sm text-[color:var(--color-text-muted)] space-y-3">
        <p>
          Signed in as <span className="font-medium text-[color:var(--color-text)]">{user?.email}</span>.
          An administrator needs to attach you to a tenant before you can use ProjectControls.
        </p>
        <p>If you believe this is a mistake, ask the admin who invited you to re-issue the invite.</p>
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="mt-5 w-full py-2 rounded-md text-sm font-medium border border-[color:var(--color-line)] hover:bg-[color:var(--color-canvas)]"
      >
        Sign out
      </button>
    </AuthLayout>
  );
}
