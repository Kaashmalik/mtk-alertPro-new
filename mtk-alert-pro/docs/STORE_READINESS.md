# Play Store readiness & launch checklist

A pragmatic, Play-policy-aligned checklist to take MTK AlertPro from a working
build to a published, compliant listing. Grouped by what blocks review vs what
improves ranking.

## 1. Build & signing (blocks release)

- [ ] Build the release bundle: `eas build -p android --profile production`
      (produces an **AAB** for Play; the `preview` profile makes an installable
      APK for sideload testing). **Expo Go cannot run this app** — it has native
      modules (ads, purchases, TF native). Use a dev build for local testing.
- [ ] `app.json` `android.package` = `com.mtk.alertpro` and `version` bumped;
      `eas.json` already auto-increments `versionCode`.
- [ ] Play App Signing enabled (default for new apps).
- [ ] `expo-build-properties` targets `targetSdkVersion 36` — meets the current
      Play target-API requirement.

## 2. Ads configuration (blocks policy / revenue)

- [ ] Replace the **test** AdMob app IDs in `app.json` →
      `react-native-google-mobile-ads` (`androidAppId`/`iosAppId`,
      currently `ca-app-pub-3940256099942544~...`) with your real app IDs.
- [ ] Set production ad **unit** IDs via the `EXPO_PUBLIC_ADMOB_*` env vars
      (see `.env.example`). Until set, the app safely serves Google **test**
      ads — never ship live ads before AdMob review, and never click your own
      live ads (policy strike).
- [ ] UMP consent flow is wired (`consentManager`) — keep it; it gates
      personalised ads for EEA/UK users (required).
- [ ] App-ads.txt / AdMob account linked to the Play listing.

## 3. Data safety & privacy (blocks review)

- [ ] Publish a **privacy policy** at a public URL (see `docs/PRIVACY_POLICY.md`
      as a starting template — have it reviewed; it is not legal advice) and add
      the URL in Play Console → App content.
- [ ] Complete the **Data safety** form. This app collects/uses:
      - Account: email, display name (Supabase auth) — *account management*.
      - Camera RTSP URLs + credentials — stored **encrypted**; declare as app
        functionality, not shared.
      - Push token (`fcm_token`) — *app functionality* (alerts).
      - Approximate advertising ID — *advertising* (AdMob); user can reset/opt
        out (UMP).
      - Crash/diagnostics (Sentry, if enabled) — *analytics*.
      - Photos/videos written to the gallery are **on-device**, user-initiated.
- [ ] Declare the foreground use of **camera** and **microphone** (mic only for
      the optional custom-alarm recording — already reflected in the iOS
      `NSMicrophoneUsageDescription`).

## 4. Permissions review (blocks review — justify each)

The `android.permissions` in `app.json`, with the user-facing justification Play
expects:

| Permission | Why |
|---|---|
| INTERNET / ACCESS_NETWORK_STATE / ACCESS_WIFI_STATE | Connect to cameras + media edge; show connectivity |
| POST_NOTIFICATIONS | Security + camera-offline alerts |
| CAMERA | QR pairing + scanning a camera's setup code |
| RECORD_AUDIO | **Only** when the user records a custom alarm sound |
| USE_BIOMETRIC / USE_FINGERPRINT | Optional biometric app lock |
| READ_MEDIA_IMAGES / READ_MEDIA_VIDEO / READ_MEDIA_VISUAL_USER_SELECTED | Save/review clips & snapshots |
| VIBRATE / WAKE_LOCK | Alert haptics; keep the stream alive while viewing |

- [ ] Remove any permission a feature no longer uses before submitting.

## 5. Store listing assets

- [ ] App icon 512×512, feature graphic 1024×500.
- [ ] 2–8 phone screenshots (dashboard, live view, alerts, scene modes).
- [ ] Short (80 char) + full (4000 char) description — see `docs/ASO_SEO.md`.
- [ ] Content rating questionnaire, category = **Tools** (or House & Home).
- [ ] Contact email + website.

## 6. Pre-launch quality

- [ ] `pnpm typecheck` clean, `pnpm -r test` green.
- [ ] Run Play **Pre-launch report** (internal testing track) to catch crashes
      on real devices across API levels.
- [ ] Verify the away-from-home path end-to-end (see `docs/REMOTE_MONITORING.md`).
- [ ] Test on a low-end device — the TF detection + live stream are the
      heaviest paths.

## 7. Release rollout

- [ ] Internal testing → Closed testing (required: 12 testers / 14 days for new
      personal developer accounts) → Production staged rollout (e.g. 10%).
