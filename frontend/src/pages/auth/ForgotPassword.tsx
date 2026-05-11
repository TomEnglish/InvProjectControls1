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
      redirectTo: `${window.location.origin}/reset-password`,
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
        eyebrow="Password reset"
        title="Check your email"
        subtitle="If an account exists for that address, a reset link is on its way. The link expires in one hour."
        footer={
          <Link to="/login" className="text-[color:var(--color-primary)] font-medium hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="is-toast is-toast-info">
          Didn't get it? Check your spam folder, or{' '}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="font-semibold underline underline-offset-2 hover:no-underline"
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
      eyebrow="Password reset"
      title="Forgot your password?"
      subtitle="Enter your email and we'll send a link to set a new one."
      footer={
        <Link to="/login" className="text-[color:var(--color-primary)] font-medium hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="is-form-field">
          <label htmlFor="forgot-email" className="is-form-label">Email</label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="is-form-input"
          />
        </div>

        {error && <div className="is-toast is-toast-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="is-btn is-btn-primary w-full mt-2"
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
