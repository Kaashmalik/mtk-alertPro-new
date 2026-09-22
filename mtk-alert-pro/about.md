# MTK AlertPro

## Project Name / Title

**MTK AlertPro** — Smart Alerts, Safer Homes

## Short Description

MTK AlertPro is an AI-powered mobile security app that transforms any IP camera into an intelligent surveillance system with on-device person and vehicle detection, instant push notifications, and alarm integration. Built for homeowners and small businesses who need affordable, privacy-first security monitoring.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React Native 0.76 + Expo SDK 52 |
| **Language** | TypeScript 5.6 |
| **State Management** | Zustand 5 + TanStack Query 5 |
| **Styling** | NativeWind 4 (Tailwind CSS) |
| **Navigation** | Expo Router 4 |
| **Backend / BaaS** | Supabase (Auth, PostgreSQL, Storage, Realtime) |
| **AI / ML** | TensorFlow.js + SSD MobileNet V2 (on-device inference) |
| **Notifications** | Expo Notifications + Firebase Cloud Messaging |
| **Payments** | RevenueCat |
| **Monorepo** | pnpm workspaces |
| **Linting / Formatting** | Biome |
| **Testing** | Jest + React Native Testing Library |
| **CI/CD** | EAS Build (Expo Application Services) |

## Live URL

Not deployed (mobile app — Android APK preview build available via EAS)

## GitHub Repo

[https://github.com/Kaashmalik/mtk-alert-pro](https://github.com/Kaashmalik/mtk-alert-pro)

## Key Highlights / Features

1. **On-Device AI Detection** — Runs TensorFlow.js with SSD MobileNet V2 directly on the phone for real-time person and vehicle detection. No cloud processing means zero latency on inference and complete data privacy.

2. **Smart Alert System with Alarm Integration** — Instant push notifications with configurable cooldowns, alarm sound playback (with red alert mode), vibration patterns, and per-camera detection settings (person/vehicle toggles, sensitivity thresholds). < 2 second end-to-end alert latency.

3. **Universal IP Camera Compatibility** — Connects to 80%+ of IP cameras via RTSP/HTTP streams with frame capture service, automatic reconnection, and offline camera caching via AsyncStorage.

4. **Privacy-First Architecture** — All AI processing happens on-device; no video frames or detection data leave the phone. Camera credentials are encrypted in memory. Supabase Row Level Security (RLS) protects all user data at the database layer.
