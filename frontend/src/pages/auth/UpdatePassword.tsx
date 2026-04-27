import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from './AuthLayout';

type Mode = 'recovery' | 'invite';

// Supabase's default email templates use the OTP/PKCE flow:
//   {{ .SiteURL }}/{path}?token_hash=…&type=recovery|invite|signup
// We exchange token_hash → session via verifyOtp, then let the user set a
// password. The legacy hash-fragment flow (#access_token=…) is also handled
// for backwards compatibility in case the email template ever gets reverted.
export function UpdatePasswordPage({ mode: forcedMode }: { mode?: Mode } = {}) {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState<boolean | null>(null);

  const otpType = searchParams.get('type');
  const mode: Mode =
    forcedMode ?? (otpType === 'invite' || otpType === 'signup' ? 'invite' : 'recovery');

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const tokenHash = searchParams.get('token_hash');

      if (tokenHash && otpType) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as 'recovery' | 'invite' | 'signup' | 'email_change' | 'magiclink',
        });
        if (!cancelled) setTokenReady(!otpError);
        return;
      }

      // Legacy implicit flow — Supabase auto-parses #access_token from the URL
      // hash on client init. Wait briefly for it to settle.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (!cancelled) setTokenReady(true);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          if (!cancelled) setTokenReady(true);
        }
      });
      const timeout = setTimeout(() => {
        if (!cancelled) setTokenReady(false);
      }, 4000);
      return () => {
        sub.subscription.unsubscribe();
        clearTimeout(timeout);
      };
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [searchParams, otpType]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    nav('/', { replace: true });
  };

  const title = mode === 'invite' ? 'Set your password' : 'Choose a new password';
  const subtitle =
    mode === 'invite'
      ? 'Welcome to Invenio ProjectControls. Pick a password to finish setting up your account.'
      : 'Enter a new password for your account.';

  if (tokenReady === false) {
    return (
      <AuthLayout
        title="Link expired or invalid"
        subtitle={
          mode === 'invite'
            ? 'This invite link has expired or already been used.'
            : 'This reset link has expired or already been used.'
        }
        footer={
          <Link to="/login" className="text-[color:var(--color-primary)] hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="text-sm text-[color:var(--color-text-muted)]">
          {mode === 'invite' ? (
            <>Ask your administrator to send a fresh invite.</>
          ) : (
            <>
              <Link to="/forgot-password" className="text-[color:var(--color-primary)] hover:underline">
                Request a new reset link
              </Link>
              .
            </>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <form onSubmit={onSubmit}>
        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1">
          New password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 mb-3 border border-[color:var(--color-line)] rounded-md text-sm bg-[color:var(--color-canvas)]"
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1">
          Confirm password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-2 mb-4 border border-[color:var(--color-line)] rounded-md text-sm bg-[color:var(--color-canvas)]"
        />

        {error && (
          <div className="text-xs text-[color:var(--color-status-pending-fg)] bg-[color:var(--color-status-pending-bg)] rounded-md px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || tokenReady !== true}
          className="w-full py-2 rounded-md text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}
        >
          {submitting
            ? 'Saving…'
            : tokenReady === null
              ? 'Verifying link…'
              : mode === 'invite'
                ? 'Set password & continue'
                : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  );
}
