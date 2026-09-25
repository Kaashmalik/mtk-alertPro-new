# Launch Go / No-Go Checklist (Phase 6)

Hardware QA against real cameras before Play Store submit.

## Must pass

- [ ] RTSP live view shows **real** camera (no sample video) when media edge is up
- [ ] Media edge down shows honest **Server Offline** UI
- [ ] HTTP/MJPEG camera previews without media edge
- [ ] Arm → person detection → local siren + alert row (&lt; 3s on LAN)
- [ ] Push received when app backgrounded (Expo token + edge function deployed)
- [ ] Free tier capped at 2 cameras
- [ ] Pro unlocks zones / face toggle / ad-free
- [ ] Automations flip Red Alert on schedule
- [ ] Recording start/stop + download works
- [ ] Credentials never appear in logs or error toasts

## Camera brands to verify

- [ ] Hikvision
- [ ] Reolink
- [ ] TP-Link / Tapo (RTSP if enabled)
- [ ] Generic ONVIF discovery on LAN

## Store

- [ ] EAS production AAB signed
- [ ] Privacy policy covers on-device AI + encrypted credentials
- [ ] Screenshots match ops-dark UI
- [ ] AdMob / RevenueCat production IDs (or WhatsApp pay documented for PK)

## Deploy

```bash
# Media edge
pnpm --filter @mtk/api start

# Edge push
supabase functions deploy push-on-alert
# Configure Database Webhook: alerts INSERT → push-on-alert
```
