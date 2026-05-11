import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from './auth/AuthLayout';

export function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    nav(from, { replace: true });
  };

  return (
    <AuthLayout
      eyebrow="ProjectControls"
      title="Sign in to your account"
      subtitle="Earned value, baselines, and change orders — under control."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="is-form-field">
          <label htmlFor="login-email" className="is-form-label">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="is-form-input"
          />
        </div>

        <div className="is-form-field">
          <div className="flex items-baseline justify-between">
            <label htmlFor="login-password" className="is-form-label">Password</label>
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-[color:var(--color-primary)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="is-form-input"
          />
        </div>

        {error && <div className="is-toast is-toast-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="is-btn is-btn-primary w-full mt-2"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
