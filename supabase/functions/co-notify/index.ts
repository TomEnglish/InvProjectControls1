// co-notify
//
// Sends notification emails for change-order state transitions:
//   submitted → all PC reviewers in the tenant
//   pc_reviewed → all PMs
//   approved | rejected → the originator (created_by)
//
// Architecture spec calls for a Postgres trigger on change_order_events to
// invoke this function. For pilot, the frontend fires it after the
// co_pc_review / co_approve / co_submit mutations succeed (fire-and-forget).
// Trigger-based invocation can be added later once Database Webhooks are
// configured.
//
// Failure here MUST NOT block the calling RPC's success — return 200 with
// `{ ok: false, reason }` rather than throwing on configuration gaps.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        ← optional. If unset, function logs intent and 200s.
//   NOTIFY_FROM_EMAIL     ← e.g. controls@invenio.app (must be DKIM/SPF/DMARC verified)
//   PUBLIC_SITE_URL       ← e.g. https://invenioprojectcontrols.netlify.app
//
// Deploy: `supabase functions deploy co-notify`

import { createClient } from 'jsr:@supabase/supabase-js@2';

type EventKind = 'submitted' | 'pc_reviewed' | 'approved' | 'rejected' | 'reopened';

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

async function sendEmail(opts: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

const eventCopy: Record<EventKind, { subject: (n: string) => string; lead: (n: string) => string }> = {
  submitted: {
    subject: (n) => `[Invenio] CO ${n} submitted — PC review needed`,
    lead: (n) => `Change order ${n} has been submitted and is pending Project Controls review.`,
  },
  pc_reviewed: {
    subject: (n) => `[Invenio] CO ${n} forwarded — PM approval needed`,
    lead: (n) => `Change order ${n} has been reviewed by Project Controls and is pending PM approval.`,
  },
  approved: {
    subject: (n) => `[Invenio] CO ${n} approved`,
    lead: (n) =>
      `Your change order ${n} has been approved. The Current Budget will reflect the impact immediately.`,
  },
  rejected: {
    subject: (n) => `[Invenio] CO ${n} rejected`,
    lead: (n) =>
      `Your change order ${n} has been rejected. See the rejection reason and approval timeline in the app.`,
  },
  reopened: {
    subject: (n) => `[Invenio] CO ${n} re-opened`,
    lead: (n) => `Change order ${n} has been re-opened and is back in pending status.`,
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const FROM_EMAIL = Deno.env.get('NOTIFY_FROM_EMAIL') ?? 'controls@invenio.app';
  const SITE_URL = Deno.env.get('PUBLIC_SITE_URL');

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, reason: 'edge function misconfigured' }, 200);
  }

  let body: { co_id?: string; event?: EventKind };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalid json' }, 200);
  }
  if (!body.co_id || !body.event) return json({ ok: false, reason: 'co_id and event required' }, 200);

  // Service-role client — needs to read across the tenant boundary to
  // gather recipient emails. Trigger-fired callers don't have a JWT, so
  // we authoritatively look up tenant from the CO row itself.
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  const { data: co, error: coErr } = await adminClient
    .from('change_orders')
    .select('id, tenant_id, project_id, co_number, description, status, qty_change, uom, hrs_impact, created_by, requested_by, rejection_reason')
    .eq('id', body.co_id)
    .maybeSingle();
  if (coErr || !co) return json({ ok: false, reason: 'co not found' }, 200);

  const { data: project } = await adminClient
    .from('projects')
    .select('project_code, name')
    .eq('id', co.project_id)
    .maybeSingle();

  // Decide recipients based on event.
  let recipientRoles: string[] = [];
  let directRecipientId: string | null = null;
  switch (body.event) {
    case 'submitted':
      recipientRoles = ['pc_reviewer', 'pm', 'admin'];
      break;
    case 'pc_reviewed':
      recipientRoles = ['pm', 'admin'];
      break;
    case 'approved':
    case 'rejected':
    case 'reopened':
      directRecipientId = co.created_by;
      break;
  }

  let recipients: { email: string }[] = [];
  if (directRecipientId) {
    const { data } = await adminClient
      .from('app_users')
      .select('email')
      .eq('id', directRecipientId)
      .maybeSingle();
    if (data?.email) recipients.push({ email: data.email });
  } else if (recipientRoles.length > 0) {
    const { data } = await adminClient
      .from('app_users')
      .select('email')
      .eq('tenant_id', co.tenant_id)
      .in('role', recipientRoles);
    recipients = (data ?? []).filter((r) => r.email);
  }

  if (recipients.length === 0) {
    return json({ ok: false, reason: 'no recipients' }, 200);
  }

  const copy = eventCopy[body.event];
  const subject = copy.subject(co.co_number);
  const lead = copy.lead(co.co_number);
  const projectLabel = project ? `${project.project_code} — ${project.name}` : '';
  const link = SITE_URL ? `${SITE_URL}/changes` : '';
  const rejectionLine = body.event === 'rejected' && co.rejection_reason
    ? `\nReason: ${co.rejection_reason}\n`
    : '';

  const text = [
    lead,
    '',
    projectLabel,
    `Description: ${co.description}`,
    `Quantity: ${co.qty_change} ${co.uom}`,
    `Hours impact: ${co.hrs_impact}`,
    rejectionLine,
    link ? `Open in app: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;color:#1e293b;background:#f8fafc;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
        <div style="font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#0369a1">Invenio ProjectControls</div>
        <h2 style="margin:8px 0 16px;font-size:20px;font-weight:700">${subject}</h2>
        <p style="margin:0 0 12px;font-size:15px">${lead}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
          ${projectLabel ? `<tr><td style="padding:6px 0;color:#64748b">Project</td><td style="padding:6px 0"><strong>${projectLabel}</strong></td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#64748b">CO</td><td style="padding:6px 0;font-family:'JetBrains Mono',ui-monospace,monospace"><strong>${co.co_number}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Description</td><td style="padding:6px 0">${co.description}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Quantity</td><td style="padding:6px 0;font-family:'JetBrains Mono',ui-monospace,monospace">${co.qty_change} ${co.uom}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Hours impact</td><td style="padding:6px 0;font-family:'JetBrains Mono',ui-monospace,monospace">${co.hrs_impact}</td></tr>
          ${body.event === 'rejected' && co.rejection_reason ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Reason</td><td style="padding:6px 0;color:#dc2626">${co.rejection_reason}</td></tr>` : ''}
        </table>
        ${link ? `<a href="${link}" style="display:inline-block;background:#0369a1;color:#fff;padding:10px 20px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px">Open in app →</a>` : ''}
      </div>
    </div>
  `;

  if (!RESEND_API_KEY) {
    // Log-only mode — useful in local dev or while DNS is being set up.
    console.log('[co-notify] RESEND_API_KEY unset, intent:', {
      event: body.event,
      co_number: co.co_number,
      to: recipients.map((r) => r.email),
      subject,
    });
    return json({ ok: true, mode: 'log-only', recipients: recipients.length });
  }

  const result = await sendEmail({
    apiKey: RESEND_API_KEY,
    from: FROM_EMAIL,
    to: recipients.map((r) => r.email),
    subject,
    html,
    text,
  });

  if (!result.ok) {
    console.warn('[co-notify] resend failed:', result.error);
    return json({ ok: false, reason: result.error }, 200);
  }

  return json({ ok: true, recipients: recipients.length });
});
