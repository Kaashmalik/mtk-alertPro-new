/**
 * Supabase Edge Function: push-on-alert
 * Trigger: Database Webhook on public.alerts INSERT
 * Sends Expo push notifications using profiles.fcm_token
 *
 * Deploy: supabase functions deploy push-on-alert
 * Secret: EXPO_ACCESS_TOKEN (optional) — not required for Expo push API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface AlertRow {
  id: string;
  camera_id: string;
  user_id: string;
  type: string;
  confidence: number;
  snapshot_url?: string | null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
      });
    }

    const payload = await req.json();
    // Support both Database Webhook shape and direct invoke
    const record: AlertRow = payload.record || payload.new || payload;

    if (!record?.user_id || !record?.type) {
      return new Response(JSON.stringify({ error: 'Invalid alert payload' }), {
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('fcm_token, display_name')
      .eq('id', record.user_id)
      .single();

    if (profileError || !profile?.fcm_token) {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'no_push_token' }),
        { status: 200 },
      );
    }

    const { data: camera } = await supabase
      .from('cameras')
      .select('name')
      .eq('id', record.camera_id)
      .maybeSingle();

    const cameraName = camera?.name || 'Camera';
    const label = record.type.charAt(0).toUpperCase() + record.type.slice(1);
    const conf = Math.round((record.confidence || 0) * 100);

    const message = {
      to: profile.fcm_token,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts-critical',
      title: `${label} detected`,
      body: `${cameraName} · ${conf}% confidence`,
      data: {
        alertId: record.id,
        cameraId: record.camera_id,
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

    return new Response(JSON.stringify({ ok: true, expo: pushJson }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('push-on-alert error', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown',
      }),
      { status: 500 },
    );
  }
});
