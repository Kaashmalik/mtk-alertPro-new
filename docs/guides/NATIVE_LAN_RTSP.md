# Native LAN RTSP (Phase 5)

MTK AlertPro uses a **hybrid** model:

| Path | When | Requirement |
|------|------|-------------|
| HTTP / MJPEG | Same LAN, Expo Go friendly | None |
| MediaMTX → HLS / WebRTC | Remote view, AI snapshots, recording | Media edge online |
| Native RTSP (Dev Client) | Same LAN, zero media server for *viewing* | Custom Expo Dev Client |

## Dev Client native RTSP

1. Create a development build (not Expo Go):

```bash
cd apps/mobile
npx eas build --profile development --platform android
```

2. Add a native RTSP player module (choose one):
   - `react-native-vlc-media-player` (recommended for RTSP)
   - or custom FFmpeg kit module

3. Wire [`StreamSession`](../../apps/mobile/src/lib/streaming/streamSession.ts) to prefer:
   - native RTSP when `EXPO_PUBLIC_NATIVE_RTSP=1` and LAN reachable
   - else MediaMTX HLS

4. Keep MediaMTX required for:
   - FFmpeg snapshots (AI)
   - cloud recording download
   - remote (off-LAN) viewing

## Self-host MediaMTX

See [`server/README.md`](../../server/README.md). Typical NAS / Raspberry Pi:

```bash
docker compose -f server/docker-compose.yml up -d
```

Point `EXPO_PUBLIC_MEDIA_SERVER_URL` at `http://<nas-ip>:3001`.
