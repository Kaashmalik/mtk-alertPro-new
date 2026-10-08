# Remote Monitoring — "away from home" architecture

This document explains exactly what happens when you are **away from home** with
your camera on your home network and a scene mode armed, what the app now does
end‑to‑end, and the one remaining piece you must run on a server for true 24/7
protection.

## The data flow

```
 Home LAN                         Your server / cloud                 Your phone (anywhere)
 ┌────────────┐   RTSP pull   ┌──────────────────────┐   HLS/WebRTC   ┌─────────────────┐
 │ IP camera  │ ────────────► │ MediaMTX + API edge  │ ─────────────► │  Live viewer    │
 │ rtsp://... │               │ (server/)            │                │  (CameraStream) │
 └────────────┘               └──────────────────────┘                └─────────────────┘
                                         │
                           alert row INSERT (Supabase)
                                         │
                              ┌──────────▼───────────┐   Expo push    ┌─────────────────┐
                              │ push-on-alert edge fn │ ─────────────► │ Push notification│
                              │ (supabase/functions)  │                │ (app closed OK) │
                              └───────────────────────┘                └─────────────────┘
```

Two independent paths:

1. **Live view** — the app plays the camera through the MediaMTX edge. Works from
   anywhere **as long as the edge is reachable from the internet** and can itself
   reach the camera.
2. **Alerts** — any `alerts` row inserted in Supabase fires the `push-on-alert`
   edge function, which sends an Expo push to the device. This reaches the phone
   **even when the app is closed.**

## What works after this change

- The app now **registers its Expo push token and saves it to `profiles.fcm_token`**
  on every authenticated launch (`registerAndSavePushToken` in `_layout.tsx`).
  Before this, the token was never stored, so `push-on-alert` always skipped with
  `no_push_token` and **no remote notification could ever arrive**.
- The Android **`alerts-critical` channel is now created** to match the channel id
  the edge function targets. Android 8+ silently drops a push to a non-existent
  channel, so without it remote alerts were invisible even if sent.
- **Background monitoring is now started** (`initializeBackgroundTasks`), so the
  camera-offline check actually runs on the OS schedule.

## Deploy checklist (what you run on the server)

1. **Media edge** (`server/`): deploy MediaMTX + the API with Docker Compose on a
   host reachable from the internet. Set `MEDIA_SERVER_PUBLIC_URL` to its public
   address. The edge must be able to reach each camera — either the host sits on
   the home LAN and is port‑forwarded, or the camera is exposed via DDNS.
2. **App config**: set `EXPO_PUBLIC_MEDIA_SERVER_URL` (API, `:3001`) and
   `EXPO_PUBLIC_HLS_SERVER_URL` (`:8888`) to the edge's public URLs, and
   `EXPO_PUBLIC_EAS_PROJECT_ID` to the EAS project id, then rebuild.
3. **Push function**: `supabase functions deploy push-on-alert`.
4. **Database webhook**: Supabase → Database → Webhooks → table `alerts`,
   event `INSERT`, POST to `.../functions/v1/push-on-alert` (see the function's
   README).
5. Verify: insert a test row into `alerts` for your user → the phone should buzz
   within a second or two, app open or closed.

## The remaining gap — 24/7 server‑side detection

Today, **object detection runs on the phone** (TensorFlow.js in
`features/detection`) and only while the app is foregrounded. That means alert
rows are created only when the app is open. For protection while the phone is
asleep in your pocket, detection has to run on the server that already holds the
stream:

**Recommended design (next PR / workstream):**
- Add a worker to `server/` that, per active+armed camera, pulls frames from the
  MediaMTX path (FFmpeg, as the snapshot route already does) on an interval.
- Run detection server‑side (ONNX Runtime / TensorFlow with a YOLO or COCO‑SSD
  model) against those frames, applying the same scene-profile rules
  (`shouldAlert`) and per‑camera zones.
- On a positive detection, insert an `alerts` row (with `snapshot_url`) using the
  Supabase service key. That single INSERT reuses the **existing** `push-on-alert`
  path above — no app change needed — and the row also shows up live via the
  realtime subscription the app already has.
- Respect each camera's armed state / scene profile stored in `detectionSettings`
  so the server honours the same "mode on" the user set in the app.

With that worker in place, "arm it from the app and leave" becomes fully real:
the server watches 24/7 and the phone is notified whether the app is open or not.
