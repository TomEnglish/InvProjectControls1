import { test, expect } from '@playwright/test';

/**
 * Smoke E2E — the absolute minimum that proves the deploy isn't broken:
 *
 *   1. Login form renders
 *   2. Wrong password shows an error
 *   3. Right password lands on the dashboard
 *   4. Sidebar nav routes don't crash (every module page mounts)
 *
 * Reads SMOKE_EMAIL + SMOKE_PASSWORD from env. Skip the auth tests when
 * unset so this still runs in CI without prod creds.
 */

const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const hasCredentials = !!(email && password);

test.describe('Login surface', () => {
  test('login page renders the form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('forgot-password link navigates', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: /forgot/i })).toBeVisible();
  });

  test('wrong password shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Supabase returns "Invalid login credentials"
    await expect(page.getByText(/invalid login credentials|invalid|wrong/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Authenticated app', () => {
  test.skip(!hasCredentials, 'Set SMOKE_EMAIL and SMOKE_PASSWORD to run.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait for the topbar's project selector to render — proves the
    // dashboard mounted past AuthGuard + AppShell.
    await expect(page.getByRole('combobox', { name: /current project/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('dashboard mounts with project selector', async ({ page }) => {
    // Page header is "Dashboard" via the route's handle.title
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('every sidebar route mounts without crashing', async ({ page }) => {
    const routes = [
      { name: 'Project Setup', heading: /project setup/i },
      { name: 'COA & Unit Rates', heading: /coa|cost code/i },
      { name: 'Rules of Credit', heading: /rules of credit|roc/i },
      { name: 'Budget & Baseline', heading: /budget/i },
      { name: 'Progress & EV', heading: /progress/i },
      { name: 'Change Mgmt', heading: /change/i },
      { name: 'Reports', heading: /report/i },
    ];
    for (const r of routes) {
      await page.getByRole('link', { name: r.name }).click();
      await expect(page.getByRole('heading', { name: r.heading })).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test('sign out returns to login', async ({ page }) => {
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });
});
