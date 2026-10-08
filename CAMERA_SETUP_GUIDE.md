# Connecting your first camera (step by step)

Cameras do **not** connect directly from the phone. Your phone cannot open an
RTSP stream itself, so the app uses a small **relay** (a server on your own
computer) to sit between the phone and the camera and turn the RTSP feed into
a stream the phone can play.

The chain is:

```
Phone (this app)  ──HTTP──▶  Camera Relay (server/api, port 3001)
                                     │
                                     └──RTSP──▶  Your IP camera (192.168.x.x:554)
                                     │
                                     └──▶  MediaMTX (port 9997 API / 8888 HLS)
```

There are two things to get right, and almost every "it won't connect" problem is
one of them:

1. **The relay is running and reachable from the phone's network.**
2. **The app is told where the relay is** (`EXPO_PUBLIC_MEDIA_SERVER_URL`).

---

## Step 0 — Get the pieces

You need on the computer that is on the **same Wi‑Fi as the phone and camera**:

- **Node.js 18+**
- **MediaMTX** (free, from `github.com/bluenviron/mediamtx/releases`) — it
  converts the camera's RTSP into HLS for the app
- This repo (the MTK AlertPro code)

---

## Step 1 — Start MediaMTX

In a terminal, from wherever you unzipped it:

```bash
mediamtx
```

You should see it bind to its default ports. Leave it running.

---

## Step 2 — Start the camera relay (server/api)

In a terminal, from the repo's `server/api` folder:

```bash
npm install
npm run dev
```

It listens on **http://localhost:3001**. Leave it running.

Confirm it's alive:

```bash
curl http://localhost:3001/health
```

You should get a JSON response. If you don't, the relay didn't start — check the
terminal for errors.

---

## Step 3 — Tell the app where the relay is (the important part)

The app needs the relay's address **as seen from the phone**, which is your
computer's **LAN IP** — *not* `localhost` (that points at the phone itself).

1. Find your computer's LAN IP. On **Windows** open PowerShell and run:
   ```powershell
   ipconfig
   ```
   Look for `IPv4 Address` on your Wi‑Fi adapter — it looks like
   `192.168.1.23`.

2. Set it in `apps/mobile/.env`:
   ```bash
   EXPO_PUBLIC_MEDIA_SERVER_URL=http://192.168.1.23:3001
   EXPO_PUBLIC_HLS_SERVER_URL=http://192.168.1.23:8888
   ```
   (Replace `192.168.1.23` with your own.)

3. **Rebuild / reload the app** so the new value is baked in:
   ```bash
   cd apps/mobile
   npx expo start        # then reload the app
   ```

> If you add the camera to a **release APK**, you must rebuild the APK after
> changing this value. It is compiled into the app.

---

## Step 4 — Add the camera in the app

1. Open **Cameras → Add Camera**.
2. Choose a brand (optional) and let the app build the URL, or enter it
   yourself:
   ```
   rtsp://<username>:<password>@<camera-ip>:554/stream
   ```
   Common defaults: username `admin`, password `admin` or the one printed on the
   camera. Port is often `554` (sometimes `8554`).
3. Tap **Test Connection**.
   - ✅ **Connected** — great, tap **Save**.
   - If it fails, the app now shows a specific reason and fix (see below).

---

## If it says "not connected" — what each message means

The app classifies the failure for you. Match the headline:

| Message | What it means | What to do |
|---|---|---|
| **No camera relay configured** | `EXPO_PUBLIC_MEDIA_SERVER_URL` is not set. | Do Steps 2–3. Nothing will ever connect until this is set. |
| **Camera not responding** | The relay couldn't reach the camera. | Phone **and** computer **and** camera on the same Wi‑Fi. Camera powered on. Try the IP/port. |
| **Camera rejected the username or password** | Wrong credentials. | Re-enter the exact camera username/password. |
| **Check the camera URL** / **Check the IP address** | The URL format is wrong. | Use the `rtsp://user:pass@ip:port/stream` shape. |
| **Media server could not start the stream** | MediaMTX isn't running or is misconfigured. | Make sure `mediamtx` is still running (Step 1). |

---

## Quick self-checks (in order)

Run these on the **computer**:

```bash
# 1. Relay is up?
curl http://localhost:3001/health

# 2. MediaMTX API is up?
curl http://localhost:9997/v3/paths/list

# 3. The camera itself is reachable from this computer?
#    (install ffmpeg first, or use VLC's "Open Network Stream")
ffplay -rtsp_transport tcp rtsp://admin:admin@192.168.1.50:554/stream
```

- If **#3** fails, the problem is the camera/credentials/network — not the app.
- If **#3** works but the app doesn't, it's almost always the LAN IP in
  `EXPO_PUBLIC_MEDIA_SERVER_URL`.

---

## Common mistakes

- **Using `localhost` in the app's env** — on a phone this points at the phone,
  not your computer. Always use the computer's LAN IP.
- **Phone on mobile data / different Wi‑Fi than the camera** — the relay (on your
  computer) must be able to reach the camera, and the phone must reach the relay.
- **Forgetting to rebuild after changing `.env`** — the value is compiled in.
- **Camera not on the same subnet** — some office/guest Wi‑Fi isolates clients
  (client isolation). Use a normal home/office network, or a phone hotspot that
  the computer also joins.
- **Wrong stream path** — it is usually `/stream`, but some cameras use
  `/live` or `/h264`. Check the camera's own web page for the exact RTSP URL.

---

## Once it's working

- **Live view** uses the relay to convert RTSP → HLS; expect a second or two of
  buffering on first open.
- **Recording** and **AI detection** also go through the relay, so it must stay
  running while you use those features.
- Detection models download the first time; a brief pause on first alert is
  normal.
