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
      eyebrow="Account access"
      title="Pending organisation assignment"
      subtitle="Your account isn't bound to an organisation yet."
    >
      <div className="grid gap-4">
        <div className="is-toast is-toast-info">
          Signed in as <span className="font-semibold">{user?.email}</span>. An administrator
          needs to attach you to a tenant before you can use ProjectControls.
        </div>

        <p className="text-sm text-[color:var(--color-text-muted)] leading-relaxed">
          If you believe this is a mistake, ask the admin who invited you to re-issue the invite.
        </p>

        <button type="button" onClick={onSignOut} className="is-btn is-btn-outline w-full mt-2">
          Sign out
        </button>
      </div>
    </AuthLayout>
  );
}
