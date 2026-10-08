/**
 * Supabase Edge Function: push-on-alert
 * Trigger: Database Webhook on public.alerts INSERT
 * Sends Expo push notifications using profiles.fcm_token
 *
 * Deploy: supabase functions deploy push-on-alert --no-verify-jwt
 * Secret: supabase secrets set PUSH_WEBHOOK_SECRET=<random>
 *
 * Why verify_jwt is off and a shared secret replaces it: a Database Webhook
 * cannot mint a user JWT, and this function has to run with the service_role key
 * to read profiles.fcm_token. Auth is therefore the shared secret in the
 * `x-webhook-secret` header, compared in constant time. Without it the endpoint
 * is an open relay: anyone could POST {"user_id": "<someone>", "type": "person"}
 * and push arbitrary text to a stranger's phone. Fails closed when the secret is
 * unset, so a misconfigured deployment is loudly broken rather than quietly open.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface AlertRow {
  id: string;
  camera_id: string | null;
  user_id: string;
  type: string;
  confidence: number | null;
  snapshot_url?: string | null;
  emergency_reason?: string | null;
}

/** Mirrors alerts_type_check in 20260927000000_emergency_alerts.sql. */
const ALERT_TYPES = new Set([
  'person',
  'vehicle',
  'face',
  'motion',
  'animal',
  'emergency',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Constant-time string compare so the secret cannot be recovered by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (!WEBHOOK_SECRET) {
    console.error(
      '[push-on-alert] PUSH_WEBHOOK_SECRET is not set — refusing to serve',
    );
    return json({ error: 'not_configured' }, 503);
  }

  const presented = req.headers.get('x-webhook-secret') ?? '';
  if (!safeEqual(presented, WEBHOOK_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const payload = await req.json();
    // Support both Database Webhook shape and direct invoke
    const record: AlertRow = payload.record ?? payload.new ?? payload;

    // Validate rather than trust: the payload decides whose phone gets a
    // notification, so every field that reaches the Expo API is checked here.
    if (
      !record?.user_id ||
      !UUID_RE.test(record.user_id) ||
      !record?.type ||
      !ALERT_TYPES.has(record.type) ||
      typeof record.id !== 'string'
    ) {
      return json({ error: 'invalid_alert_payload' }, 400);
    }
    if (record.camera_id != null && !UUID_RE.test(record.camera_id)) {
      return json({ error: 'invalid_alert_payload' }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('fcm_token, display_name')
      .eq('id', record.user_id)
      .single();

    if (profileError || !profile?.fcm_token) {
      return json({ ok: true, skipped: 'no_push_token' });
    }

    // camera_id is NULL for account-level SOS events.
    let cameraName = 'Camera';
    if (record.camera_id) {
      const { data: camera } = await supabase
        .from('cameras')
        .select('name')
        .eq('id', record.camera_id)
        .maybeSingle();
      if (camera?.name) cameraName = camera.name;
    }

    const isEmergency = record.type === 'emergency';
    const confidence =
      typeof record.confidence === 'number' &&
      Number.isFinite(record.confidence)
        ? Math.round(Math.min(Math.max(record.confidence, 0), 1) * 100)
        : 0;

    const label = record.type.charAt(0).toUpperCase() + record.type.slice(1);
    const body = isEmergency
      ? record.emergency_reason
        ? `SOS from ${profile.display_name || 'a device'} · ${record.emergency_reason}`
        : `SOS from ${profile.display_name || 'a device'}`
      : `${cameraName} · ${confidence}% confidence`;

    const message = {
      to: profile.fcm_token,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts-critical',
      title: isEmergency ? 'Emergency alert' : `${label} detected`,
      body,
      data: {
        alertId: record.id,
        cameraId: record.camera_id ?? null,
        type: record.type,
        snapshotUrl: record.snapshot_url || null,
      },
    };

    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const pushJson = await pushRes.json();

    if (!pushRes.ok) {
      console.error('[push-on-alert] Expo rejected the push', pushJson);
    }

    return json({ ok: true, expo: pushJson });
  } catch (error) {
    console.error('[push-on-alert] error', error);
    return json(
      { error: error instanceof Error ? error.message : 'unknown' },
      500,
    );
  }
});
