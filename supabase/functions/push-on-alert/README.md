# Push on Alert (Supabase Edge Function)

Sends an Expo push notification when a row lands in `public.alerts`.

## Deploy

```bash
supabase functions deploy push-on-alert --no-verify-jwt
supabase secrets set PUSH_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

`--no-verify-jwt` is required and is safe **because** of `PUSH_WEBHOOK_SECRET`:

- The function must use the service_role key to read `profiles.fcm_token`, and a
  Database Webhook cannot mint a user JWT.
- Auth is therefore the shared secret in the `x-webhook-secret` header, compared
  in constant time.
- The function **fails closed** (503) when the secret is unset, so a
  misconfigured deployment is loudly broken rather than quietly open.
- Without any check the endpoint is an open relay: anyone could POST
  `{"user_id": "<someone>", "type": "person"}` and push arbitrary text to a
  stranger's phone.

## Database webhook

Dashboard → Database → Webhooks → Create webhook:

| Field | Value |
| --- | --- |
| Table | `alerts` |
| Event | `INSERT` |
| Schema | `public` |
| Type | Database Hook |
| URL | `https://oweettvrcmywlystsjxa.supabase.co/functions/v1/push-on-alert` |
| HTTP method | `POST` |
| Header `x-webhook-secret` | the same `PUSH_WEBHOOK_SECRET` value |

Webhook payloads are validated before they are used: `user_id` and `camera_id`
must be UUIDs, `type` must be one of the six values in `alerts_type_check`, and
`confidence` is clamped to 0..1 before it reaches the Expo API.

## Client

The app stores its Expo push token in `profiles.fcm_token`
(`lib/notifications/service.ts`).

## Android channel

Pushes target the high-importance `alerts-critical` notification channel, which
the app creates at startup. If that channel is missing Android silently drops
the notification.