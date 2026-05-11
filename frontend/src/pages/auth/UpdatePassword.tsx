import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
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
    // Recovery/invite tokens are scoped sessions; the user_id stays the same
    // but app-side data may have been bootstrapped between attempts (e.g. an
    // app_users row added). Drop everything so the dashboard re-fetches clean.
    qc.clear();
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
        eyebrow={mode === 'invite' ? 'Invite' : 'Password reset'}
        title="Link expired or invalid"
        subtitle={
          mode === 'invite'
            ? 'This invite link has expired or already been used. Ask your administrator to send a fresh one.'
            : 'This reset link has expired or already been used.'
        }
        footer={
          <Link to="/login" className="text-[color:var(--color-primary)] font-medium hover:underline">
            Back to sign in
          </Link>
        }
      >
        {mode !== 'invite' && (
          <Link to="/forgot-password" className="is-btn is-btn-secondary w-full">
            Request a new reset link
          </Link>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow={mode === 'invite' ? 'Welcome' : 'Password reset'}
      title={title}
      subtitle={subtitle}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="is-form-field">
          <label htmlFor="update-password-new" className="is-form-label">New password</label>
          <input
            id="update-password-new"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="is-form-input"
          />
          <span className="is-form-helper">At least 8 characters.</span>
        </div>

        <div className="is-form-field">
          <label htmlFor="update-password-confirm" className="is-form-label">Confirm password</label>
          <input
            id="update-password-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="is-form-input"
          />
        </div>

        {error && <div className="is-toast is-toast-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting || tokenReady !== true}
          className="is-btn is-btn-primary w-full mt-2"
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
