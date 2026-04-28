import * as Sentry from '@sentry/react';

/**
 * Initialise Sentry if VITE_SENTRY_DSN is configured. Gated so unset DSN
 * (local dev, preview deploys without Sentry config) doesn't fail loudly.
 *
 * Web Vitals + replays-on-error are enabled by default via the SDK; we don't
 * need a separate wiring step here.
 */
export function initObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.info('[observability] VITE_SENTRY_DSN unset — Sentry disabled');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Only capture replays for sessions that actually error — keeps
        // PII surface and bandwidth predictable.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // 10% of transactions traced. Bump in prod after we have a baseline.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Don't bury the local console in dev.
    enabled: !import.meta.env.DEV,
  });
}

/**
 * Attach the current authenticated user to Sentry events. Email is omitted
 * by default; we only ship `id` so support can correlate without PII.
 */
export function setSentryUser(user: { id: string } | null) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id });
}

export const ErrorBoundary = Sentry.ErrorBoundary;
