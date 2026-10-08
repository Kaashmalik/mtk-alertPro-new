# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This file covers the **`mtk-alert-pro`** project — an AI CCTV security app. It is one app inside a larger multi-project monorepo (siblings like `InstalEase`, `mtk-agent`, `mtk-edu` live beside it and are unrelated); the repo root also holds many planning `.txt`/`.docx` files that are not code. Do your work inside `mtk-alert-pro/`.

## Commands

Package manager is **pnpm 9** (Node 20+). It's a pnpm workspace (`apps/*`, `packages/*`); run from the `mtk-alert-pro/` root unless noted.

```bash
pnpm install                 # install all workspaces
pnpm dev                     # start Metro (= pnpm --filter @mtk/mobile start)
pnpm android                 # expo run:android (builds a dev client)
pnpm typecheck               # tsc --noEmit across workspaces
pnpm lint                    # biome check .      (lint:fix to autofix)
pnpm format                  # biome format --write
pnpm supabase:generate       # regenerate packages/shared/src/database.types.ts from the linked DB
pnpm supabase:start | :stop | :reset
```

Tests (Jest, run from `apps/mobile/`):

```bash
pnpm test                                  # full suite (jest --forceExit)
pnpm test -- -t "farm suppresses animals"  # single test by name
pnpm test -- src/__tests__/features/detection/sceneProfiles.test.ts   # single file
pnpm test:watch
```

Builds (EAS; profiles defined in `eas.json`):

```bash
eas build -p android --profile development  # dev client (internal)
eas build -p android --profile preview      # installable APK (internal)
eas build -p android --profile production   # AAB for Play
```

## Critical: this app does NOT run in Expo Go

It uses native modules Expo Go doesn't ship (`react-native-google-mobile-ads`, `react-native-purchases`, `@tensorflow/tfjs-react-native`) plus custom config plugins and the New Architecture. Trying to open it in Expo Go is the most common "build error". Use a **development build** (`expo run:android` / EAS `development`) for local dev. The plugins in `apps/mobile/plugins/` (`withKotlinMetadataSkip`, `withExpoBundleEntry`) patch real EAS/Gradle build failures — don't remove them without understanding why they exist.

## Architecture (the parts that span files)

**Stack:** Expo SDK 54 / React Native 0.81, TypeScript, expo-router (file-based routing under `apps/mobile/src/app`), Zustand state, Supabase backend, Biome for lint/format. (Note: the README claims SDK 52 / ML Kit — that's stale; detection is TensorFlow.js and the app is on SDK 54.)

**Two-tier runtime — the single most important thing to understand:**
1. **The app** (`apps/mobile`) runs on-device.
2. **A media edge** (`server/` = MediaMTX + an Express API) is a *separate deployable* that pulls each camera's RTSP stream and transcodes it to HLS/WebRTC. The app reaches it via `EXPO_PUBLIC_MEDIA_SERVER_URL` (API, `:3001`) and `EXPO_PUBLIC_HLS_SERVER_URL` (`:8888`), defaulting to `localhost`. **Live view, snapshots, and recording do not work without this edge running and reachable** — cameras are LAN RTSP and a phone on cellular can't reach them directly. `src/lib/streaming/streamingService.ts` registers/unregisters camera paths on the edge; `src/lib/camera/` handles discovery, RTSP URL building, and connection testing.

**Detection runs on-device and only while the app is foregrounded.** `src/features/detection/`: `frameCaptureService` grabs frames from the stream, `detectionManager` runs the TensorFlow.js loop, `sceneProfiles.ts` defines per-use-case presets (Home/School/Shop/Farm/…) whose `shouldAlert()` gate decides what fires, and zone filters constrain regions. There is **no** 24/7 server-side detection yet (see `docs/REMOTE_MONITORING.md` for the design).

**Alerts → push pipeline:** a detection writes a row into the Supabase `alerts` table; a Database Webhook on `alerts` INSERT invokes the `supabase/functions/push-on-alert` edge function, which sends an Expo push to the device using `profiles.fcm_token`. The app registers that token on authenticated startup (`registerAndSavePushToken`). Android pushes target the `alerts-critical` notification channel — it must exist or Android drops them.

**State:** Zustand stores in `src/stores/` (`auth`, `camera`, `alert`, `settings`, `automation`, `subscription`), several persisted via AsyncStorage. Hooks like `useIsPremium`, `usePlanLimits` come from `subscriptionStore`.

**Backend & data:** Supabase (`src/lib/supabase/client.ts`). SQL migrations in `supabase/migrations/` (timestamp-prefixed). Generated DB types live in `packages/shared/src/database.types.ts` — **after changing schema, regenerate them** (`pnpm supabase:generate`) or hand-edit to match, or app typecheck will drift.

**Camera credentials are encrypted on-device** (`src/lib/crypto`); `initializeEncryption()` runs at startup before any credential read/write. The encryption key is loaded at runtime, not bundled.

## Conventions & gotchas

- **Path alias:** `@/` → `apps/mobile/src/`.
- **Subscriptions/roles are server-authoritative.** RLS revokes client UPDATE on `profiles.subscription_tier`, payment columns, and `is_admin`. Never try to grant premium or set admin from the client — it goes through `SECURITY DEFINER` RPCs (`confirm_payment`, `admin_confirm_payment`, `admin_set_subscription`), and admin checks use the `private.is_admin()` helper. Admin-only RPCs re-verify admin server-side.
- **Line endings / Biome:** the repo is committed with LF but Windows checks out CRLF (`core.autocrlf=true`), so `biome check` reports a formatting diff on nearly every file. This is environmental — do **not** mass-reformat the repo to "fix" it; only format files you actually changed.
- Scene detection modes are universal (not paywalled) by design; `isAdvancedSceneProfile()` returns false for all.

## Key docs

`docs/REMOTE_MONITORING.md` (away-from-home architecture + the server-side detection design), `docs/ADMIN.md` (admin role + RLS model), `docs/STORE_READINESS.md` (Play launch checklist), `docs/ASO_SEO.md`.
