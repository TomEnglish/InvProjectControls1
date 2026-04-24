import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
      'Copy .env.example → .env and fill in values from `supabase start`.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    // All ProjectControls tables, views, and RPCs live in the `projectcontrols`
    // schema (isolated from the sister app sharing this Supabase project).
    schema: 'projectcontrols',
  },
});
