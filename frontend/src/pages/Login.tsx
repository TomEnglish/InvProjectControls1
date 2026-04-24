import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

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
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--color-canvas)]">
      <form
        onSubmit={onSubmit}
        className="w-[360px] bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-6"
      >
        <h1 className="text-lg font-semibold mb-1">Invenio ProjectControls</h1>
        <p className="text-xs text-[color:var(--color-text-muted)] mb-4">Sign in to continue</p>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 mb-3 border border-[color:var(--color-line)] rounded-md text-sm"
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 mb-4 border border-[color:var(--color-line)] rounded-md text-sm"
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
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
