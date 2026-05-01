// admin-invite-user
//
// Sends a Supabase Auth invite email and pre-tags the new user with the
// projectcontrols metadata (`app`, `tenant_id`, `role`, `display_name`) so
// the on_auth_user_created_projectcontrols trigger creates the right
// app_users row when the auth.users insert lands.
//
// Authorization: caller must be an admin in their tenant. Verified by
// querying projectcontrols.app_users with the caller's JWT before
// service-role action runs.
//
// Deploy: `supabase functions deploy admin-invite-user`
// Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_SITE_URL          ← e.g. https://invenioprojectcontrols.netlify.app

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Role = 'super_admin' | 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

const ROLES: readonly Role[] = ['super_admin', 'admin', 'pm', 'pc_reviewer', 'editor', 'viewer'];
const ADMIN_GRANTABLE_ROLES: readonly Role[] = ['pm', 'pc_reviewer', 'editor', 'viewer'];

type InvitePayload = {
  email: string;
  role: Role;
  display_name?: string | null;
  /**
   * When true, skip the invite-by-email path and instead bind an existing
   * auth.users record into the caller's tenant via app_users upsert. The
   * frontend sends this only after the admin has confirmed the existing
   * account belongs to the right person.
   */
  bind_existing?: boolean;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SITE_URL = Deno.env.get('PUBLIC_SITE_URL');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json({ error: 'edge function misconfigured (missing env)' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing authorization' }, 401);
  }

  // 1. Validate the caller using their JWT — they must be an admin in their
  //    tenant. The schema-scoped client mirrors the frontend's setup.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  // Resolve auth.uid() from the JWT before querying app_users — without an
  // explicit id filter, RLS returns every user in the tenant and .single()
  // errors. With multiple admins this would always 403.
  const { data: userResult, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userResult?.user) {
    return json({ error: 'invalid or expired session', detail: userErr?.message }, 401);
  }
  const callerId = userResult.user.id;

  const { data: caller, error: callerErr } = await callerClient
    .from('app_users')
    .select('id, tenant_id, role')
    .eq('id', callerId)
    .maybeSingle();
  if (callerErr) {
    return json({ error: 'caller lookup failed', detail: callerErr.message }, 500);
  }
  if (!caller) return json({ error: 'caller not bound to a tenant' }, 403);
  if (caller.role !== 'admin' && caller.role !== 'super_admin') {
    return json({ error: `admin role required (you have ${caller.role})` }, 403);
  }

  // 2. Parse + validate payload.
  let body: InvitePayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const role = body.role;
  const displayName = body.display_name?.trim() || null;
  if (!email || !email.includes('@')) return json({ error: 'invalid email' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'invalid role' }, 400);
  if (caller.role === 'admin' && !ADMIN_GRANTABLE_ROLES.includes(role)) {
    return json({ error: `admin cannot grant role ${role}` }, 403);
  }

  // 3. Service-role client. db.schema is set so the bind-existing path can
  //    upsert into projectcontrols.app_users without an extra client.
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  // 3a. Bind path — colleague already has an auth.users account (e.g. from a
  //     sister Invenio app). The admin has already confirmed in the UI; we
  //     just need to upsert the app_users row pointing at the caller's
  //     tenant. No invite email is sent — the user signs in with their
  //     existing credentials.
  if (body.bind_existing) {
    // listUsers paginates; for pilot scale (<1k auth users across all
    // Invenio apps in the project) one page is enough.
    const { data: list, error: listErr } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) return json({ error: 'failed to list users', detail: listErr.message }, 500);
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) {
      return json({ error: 'no auth.users record matches that email' }, 404);
    }

    const { data: existingAppUser, error: existingAppUserErr } = await adminClient
      .from('app_users')
      .select('id, tenant_id, role')
      .eq('id', existing.id)
      .maybeSingle();
    if (existingAppUserErr) {
      return json({ error: existingAppUserErr.message }, 500);
    }
    if (existingAppUser && existingAppUser.tenant_id !== caller.tenant_id) {
      return json({ error: 'user already belongs to another tenant' }, 409);
    }
    if (
      caller.role === 'admin' &&
      (existingAppUser?.role === 'admin' || existingAppUser?.role === 'super_admin')
    ) {
      return json({ error: 'admin cannot modify another admin or super_admin' }, 403);
    }

    const { error: upsertErr } = await adminClient.from('app_users').upsert(
      {
        id: existing.id,
        tenant_id: caller.tenant_id,
        email,
        display_name: displayName,
        role,
        status: 'active',
      },
      { onConflict: 'id' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400);

    return json(
      { ok: true, bound: true, user_id: existing.id, email, role },
      200,
    );
  }

  // 3b. Standard invite — send the email, tagging metadata that
  //     handle_new_user() reads to bridge the auth.users row into
  //     projectcontrols.app_users.
  const redirectTo = SITE_URL ? `${SITE_URL}/accept-invite` : undefined;

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      app: 'projectcontrols',
      tenant_id: caller.tenant_id,
      role,
      display_name: displayName,
    },
  });
  if (error) {
    if (/already.*registered|already.*exists/i.test(error.message)) {
      // Signal the frontend to flip to the bind-existing confirmation prompt.
      // 200 (not 4xx) so supabase-js doesn't surface a generic error.
      return json({ exists: true, email }, 200);
    }
    return json({ error: error.message }, 400);
  }

  return json({ ok: true, user_id: data.user?.id ?? null, email }, 200);
});
