import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If an account exists for that address, a reset link is on its way."
        footer={
          <Link to="/login" className="text-[color:var(--color-primary)] hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="text-sm text-[color:var(--color-text-muted)]">
          The link expires in 1 hour. Didn't get it? Check spam, or{' '}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="text-[color:var(--color-primary)] hover:underline"
          >
            try again
          </button>
          .
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link to="/login" className="text-[color:var(--color-primary)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit}>
        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 mb-4 border border-[color:var(--color-line)] rounded-md text-sm bg-[color:var(--color-canvas)]"
        />

        {error && (
          <div className="text-xs text-[color:var(--color-status-pending-fg)] bg-[color:var(--color-status-pending-bg)] rounded-md px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 rounded-md text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
