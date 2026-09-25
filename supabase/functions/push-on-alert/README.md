# Push on Alert (Supabase Edge Function)

## Deploy

```bash
supabase functions deploy push-on-alert
```

## Database webhook

In Supabase Dashboard → Database → Webhooks:

- Table: `alerts`
- Event: `INSERT`
- URL: `https://<project>.supabase.co/functions/v1/push-on-alert`
- HTTP method: POST
- Headers: `Authorization: Bearer <service_role_or_anon_as_configured>`

## Client

App stores Expo push token in `profiles.fcm_token` via existing notification registration.

## Android channel

Ensure a high-importance channel `alerts-critical` is created in the app notification setup.
