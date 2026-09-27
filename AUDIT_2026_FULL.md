# MTK AlertPro — Full Audit (2026)

**Date:** 2026-09-25 · **Scope:** `apps/mobile` (Expo SDK 52 / RN 0.76), `server/`, `supabase/`
**Method:** static code review, cross-verified against source. Build checks run locally.

## Build status

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ pass (both packages) |
| `pnpm test` | ✅ 347 tests / 22 suites pass (but "worker failed to exit gracefully" — timer leaks) |
| `pnpm lint` | ❌ **518 errors, 169 warnings** across 203 files |

---

## Verdict

The engineering scaffolding is genuinely good — a real design system file, a real Zustand store layer, 347 passing tests, RLS enabled, offline queues, RLS-hardening migrations. But the audit found **8 release blockers**. Three of them mean the app **cannot ship on Google Play today**, and one is an active data breach.

The pattern across all findings: **features are advertised in the paywall but the implementation behind them is missing, stubbed, or broken.** The AI detection likely never runs. There is no emergency button. Custom alarm audio is synthesized, not user-supplied. The paid "custom zones" feature has no editor UI. Meanwhile billing happens over WhatsApp, which Play forbids.

---

## CRITICAL — blocks release

### C1. Supabase `service_role` key shipped inside the app bundle
`apps/mobile/.env:3` — `EXPO_PUBLIC_SUPABASE_ANON_KEY` is **not an anon key**. I decoded the JWT:

```json
{"iss":"supabase","ref":"oweettvrcmywlystsjxa","role":"service_role","exp":2105662080}
```

`EXPO_PUBLIC_*` is inlined into the JS bundle at build time, and `apps/mobile/.easignore` **does not exclude `.env`**, so the file is uploaded to EAS too. Anyone with the APK gets a service_role key that **bypasses all RLS** on every user's cameras, RTSP URLs, alerts, and profiles.

Also exposed: `sbp_ca2390...` Supabase PAT (`.env:21`) and `EXPO_PUBLIC_ENCRYPTION_KEY` (`.env:17`) — camera passwords encrypted with a bundle-resident key are trivially decryptable.

**Fix (do this first):** rotate the service_role key and the PAT; issue a real `anon` key; move the encryption key to `expo-secure-store`; add `.env*` to `apps/mobile/.easignore`.

### C2. Target SDK 34 — uploads are rejected outright
`app.json:72` (`targetSdkVersion: 34`), mirrored in `android/gradle.properties:71` and `android/build.gradle:8`. Since **2026-08-31** Google requires **API 36** for new apps and updates. That deadline has passed. `compileSdkVersion` is 35.

**Fix:** 36 in all three files.

### C3. `.easignore` excludes every app asset — the build will fail
`apps/mobile/.easignore:83,85,94,102` exclude `*.jpg`, `*.png`, `*.mp3`, `assets/sounds/`.
But `app.json:7,12,31,60,88` references `./assets/icon.png`, `splash.png`, `adaptive-icon.png`, `notification-icon.png`, `favicon.png`, and the `expo-notifications` plugin needs `alert.mp3`. **All of them exist locally and all of them get stripped from the EAS upload.**

**Fix:** delete those four `.easignore` lines. (Also `assets/splash.png` is actually JPEG data — see `expo-doctor-report.txt`.)

### C4. Off-Play payment for in-app digital subscription
`subscriptionService.ts:63,244-353` sells Pro/Business via **WhatsApp, EasyPaisa, JazzCash, and a bank IBAN**, surfaced as a payment-method picker in `subscription.tsx:304-361`. Google Play's payments policy requires Play Billing for digital goods in a Play-distributed app. This is a rejection/removal risk.

Worse, **there is no purchase→entitlement automation at all**: `confirm_payment` is locked to `service_role` (`20260923150000_rls_subscription_hardening.sql:28-31`) and nothing calls it. A paying customer gets nothing until someone edits the database by hand.

**Fix:** integrate `react-native-purchases` (RevenueCat) with real product IDs, and have a webhook/RTDN call `confirm_payment`. Until then, remove the in-app payment UI.

### C5. No privacy policy URL anywhere
Not in `app.json`, not in Settings, nowhere in `src`. The only mention is a link in `supabase/email-templates/confirm-signup.html:197`. Play requires a working privacy policy URL for any app that serves ads or collects data — which this one does.

Note: `docs/PHASE_3_PRODUCTION_READINESS_REPORT.md:183` claims "Privacy Policy ✅ Published and linked in app". **That claim is false.**

**Fix:** publish the policy, link it from Settings and the purchase screen, submit Data safety + account-deletion URLs in Play Console.

### C6. "Face Recognition" is a fabricated bounding box
`detectionService.ts:330-347` — for every person above threshold, the code computes a geometric region *inside* the person box and pushes it as a `face` detection. There is no face model. `faceDetector.ts:1-32` documents this: *"Upper-body person crop is treated as face only when person confidence is high."*

But the app sells it: `subscriptionService.ts:454-465` advertises *"Identify known individuals"*, *"Create a face database"*, *"Get alerts for unknown faces"* as a **paid Pro feature**, and `cameras/[id].tsx:482-488` shows a "Face Recognition" toggle.

This is both a Play deceptive-behaviour risk and a double-alert bug: `person` and `face` have **identical thresholds (0.6)** (`detectionService.ts:30,32`), so line 331's condition is always true. Enabling face detection fires **two alerts and uploads the same snapshot twice** per person.

**Fix:** delete the face claims and the toggle, or ship real face enrollment. Do not sell it as-is.

### C7. AI detection probably never runs
`detectionService.ts:26` sets `inputSize: 320`. TFHub's `ssd_mobilenet_v2` takes **300×300** and expects input in **[-1,1]**, but line 245 does `resized.div(255.0)` → `[0,1]`, with no `sub(1)`. Line 290 also hardcodes the output order `[boxes, classes, scores, numDetections]`.

Separately, the model is loaded **from a remote URL at runtime** (`detectionService.ts:79`) with an 8s timeout. Offline or on a bad network → `isFallbackMode = true` → detection silently degrades to a **motion detector that operates on base64 characters and file size** (`motionDetector`), so a moving shadow passes.

`index.tsx:272-273` tells users *"On-device AI actively monitoring"* while this is the actual state. `backgroundTasks.ts:46` admits detection is **foreground-only**.

**Fix:** bundle the model locally, correct input size + normalization, verify the output signature, and either implement a real background service or reword the claim.

### C8. No emergency button exists
You asked specifically about an emergency button that rings an alarm. **It does not exist.** Grepping the whole repo for SOS/panic/emergency returns only:
- `alarm-sounds.tsx:64` — an `sos` *vibration pattern*
- `alarmService.ts:23` — a sound named "Emergency"

There is no SOS trigger, no arm/disarm state, no panic UI, and no way to broadcast a distress alert to family members. This is arguably the single most-requested feature in this category and it is absent.

---

## HIGH

### H1. Free tier is not enforced — it is UI decoration
Four disagreeing sources of truth:
- `subscriptionStore.ts:82-177` (paywall copy: free = 2 cameras)
- `cameraStore.ts:424` — `{ free: 2, pro: 100, business: 100 }` — **Pro is 100, not "unlimited"** as the paywall claims, and the error message still says "unlimited"
- `supabase/migrations/20241214000000:52-72` — a `subscription_features` table that **no app code ever reads**
- `subscriptionService.ts:452-527` — a third feature vocabulary using different key names

Real bypasses:
- **Face toggle is ungated** (`cameras/[id].tsx:145-159` → `toggleDetection`, no tier check) despite the "PRO" badge
- **Automation limit is UI-only** — `automations.tsx:45` blocks at 3, `automationStore.createAutomation:145-172` never checks, and `/settings/automations/create` is a directly routable screen
- **Alert-history limit (7 days) is never enforced** — `alertStore.ts:45-50` fetches the last 100 rows with no date filter
- **Storage limits (1GB/100GB) and SD-only stream quality are never enforced** — `settingsStore.ts:35` lets free users pick 1080p
- **The tier itself is read from tamperable AsyncStorage** — `useIsPremium` (`subscriptionStore.ts:380-383`) reads `currentTier` from a persisted zustand store. Editing the local JSON to `"business"` unlocks everything.
- `cameraStore.ts:426` is **fail-open**: `limits[tier]` is `undefined` for any unrecognised tier, and `n >= undefined` is `false`

**Fix:** single `PLAN_LIMITS` module; verify tier from `profiles` server-side; enforce every limit in Postgres triggers, not in the UI.

### H2. Ads non-functional in release, and shown to paying users
- Prod ad unit IDs in `adMobService.ts:18-39` are literal placeholders (`ca-app-pub-XXXXXXXXXX/...`) — truthy, so the test-unit fallback never fires
- `app.json:110-111` AdMob **App IDs are Google's own test IDs** (`ca-app-pub-3940256099942544~...`)
- `adMobService.setPremiumStatus()` is **never called anywhere** → `isPremiumUser` stays `false` → **Pro and Business subscribers still see ads**
- **GDPR/UMP consent is collected then ignored**: `BannerAd.tsx:31` and `InterstitialAd.tsx:33` hardcode `requestNonPersonalizedAdsOnly: false`; `consentManager.hasConsent()` is never called; on consent error it fails open and ads still initialize
- The interstitial can cover the Alerts tab while the user is triaging an active alarm, and the trigger `unreadCount % 3 === 0` (`alerts.tsx:42`) fires an ad when `unreadCount` is 0

### H3. No push notifications work on Android 13+
`registerForPushNotifications` (`notifications/service.ts:18-32`) is **never called anywhere** — grep returns only its own definition. So `POST_NOTIFICATIONS` is never requested at runtime and the high-priority `alerts` channel (created inside that dead function) is never registered. On Android 13/14/15 **users receive no security alerts at all**.

### H4. Alarm audio is synthesized, and plays at volume²
There are no real alarm audio files — `soundGenerator.ts` synthesizes tones at runtime. `alarmService.ts:107` bakes `volume` into the PCM **and** line 111 passes `volume` to the player → effective gain is `volume²`. At the 0.8 default the alarm plays at **0.64**.

`playAlarm` has no in-flight guard (`:100` awaits `stopAlarm()`, then creates a new player, then assigns `this.sound`), so two overlapping calls **orphan an `Audio.Sound` that keeps playing**.

**Custom audio: not supported.** `alarm-sounds.tsx` offers 6 fixed presets and a preview button. There is no "choose your own file" and no recording.

`alarmService.ts:117,127,143` calls `Vibration.vibrate()` with **no check of the user's vibration setting** — only the realtime path checks it (`alertStore.ts:240`).

### H5. Fingerprint is wired to login only — no app lock
`expo-local-authentication` works, and there is a login button and a Settings toggle. But `settingsStore.ts:38-40` defines `autoLock` / `autoLockTimeout` that **nothing ever reads**, and `_layout.tsx:253-269` only re-inits stores on AppState change. There is **no lock overlay** — for a security app, camera credentials stay visible in the app switcher indefinitely. Purchases (`subscription.tsx:92`) and account deletion (`profile/edit.tsx:131`) require no re-auth.

### H6. Two live theme systems, brand colour split, dark mode is a no-op
- `theme/design-system.ts` (blue accent) and `lib/theme/colors.ts` (red accent) both ship and both are used
- The **tab bar is red** (`(tabs)/_layout.tsx:22`) while **every primary CTA is blue** — they never agree
- `app.json:9` declares `userInterfaceStyle: "automatic"` but **nothing reads `useColorScheme()`** (0 matches); the "Dark Mode" switch in `settings.tsx:179` writes to a store field nothing consumes
- **115 hardcoded hex literals** in screens; NativeWind is installed with a `tailwind.config.js` but has **0 `className=` usages** — two styling stacks, one dead

### H7. Accessibility is effectively absent
**2 accessibility props in the entire app** (both in `Input.tsx:96-97`). No `accessibilityLabel` on any of the ~60 pressables, no `accessibilityState` on toggles, no font-scaling support (`allowFontScaling` = 0 matches). Six custom back buttons are bare 24×24 icons with no `hitSlop` (below the 44dp minimum). Muted text `#64748B` on `#0F172A` is **3.8:1** and `#475569` on `#12151E` is **2.5:1** — both fail WCAG AA 4.5:1, and both are used for real body text.

### H8. Tab bar drops the bottom safe-area inset
`(tabs)/_layout.tsx:14-21` sets a fixed `height: 70`. React Navigation applies `insets.bottom` **before** `tabBarStyle`, so the fixed height wins and the **34pt iOS home indicator is covered**. `useWindowDimensions()` is used **0 times**; there are **12 module-level `Dimensions.get('window')` captures** that go stale on rotation, split-screen, and tablets. `LiveCameraGrid.tsx:13` hardcodes 2 columns at any width, so tiles become ~450px on a tablet.

### H9. 12 module-level `Dimensions.get` + orientation locked to portrait
`app.json:6` `orientation: portrait`, `app.json:17` `supportsTablet: false`. For a security app with a live 2×2 mosaic, a tablet/landscape layout is expected in 2026.

### H10. Swipe-to-dismiss on Home deletes nothing
`AlertCard.tsx:65-70` always animates the card off-screen, but only calls `onDismiss` if the prop exists. Home (`(tabs)/index.tsx:439-446`) doesn't pass it → the alert **visually flies away but stays in the store and reappears**. No accessible alternative to the gesture.

### H11. MJPEG candidate storm — worst-behaved path in the codebase
`mjpegService.ts` holds 9 `SNAPSHOT_PATH_TEMPLATES`, and `resolveFrameUrl:282-297` sweeps **21 candidate URLs serially** (~63s worst case) on a strictly serial `for` loop. On a failed frame fetch, `tick:364` sets `frameUrl = null` with the comment *"force re-resolve next tick"* — so the **entire 21-candidate sweep re-runs for every dropped frame**, with no backoff and no caching.

### H12. MJPEG idle screen leaks the camera URL with credentials
`MjpegStreamPlayer.tsx:124-126` renders `{url}` raw on the tap-to-start screen. Camera credentials appear on-screen (and in screenshots/screen recordings).

### H13. Base64 round-trip on the JS thread, every frame
`detectionService.ts:232-236` reads a local JPEG as a base64 **string**, then synchronously base64-**decodes** it back to bytes — ~1.3MB of string allocation per frame, per camera, before `decodeJpeg` even starts.

### H14. Frame-capture pile-up
`frameCaptureService.ts:155-174` runs a `setInterval` with an `async` body and **no in-flight guard**. Failed downloads (`:106-113`) return `null` on non-200 without deleting the partial file, so every failure still consumes a cache entry.

### H15. Unused sensitive permissions
`RECORD_AUDIO` (`app.json:39`) — **zero microphone usage** in the app. `FOREGROUND_SERVICE` (`:45`) — **no service exists**. `READ_MEDIA_AUDIO` (`:55`) — unused. Plus duplicate declarations (`:40/50`, `:42/53`, `:43/54`) and no `maxSdkVersion` on storage perms. `SYSTEM_ALERT_WINDOW` sits in the checked-in `AndroidManifest.xml:16` — a Play-restricted permission, and it is **not** in `app.json`, so prebuild will drop it, meaning the checked-in manifest and the real build disagree.

---

## MEDIUM / LOW

- **Payment can hang forever** — `subscription.tsx:96` sets `isProcessing` then early-returns at `:99` without resetting; `initiatePayment` has no try/catch. Failures (`result.success === false`) produce **no message at all**.
- **Interstitial covers the alarm triage screen** — `alerts.tsx:39-46`; trigger uses a stale closure and `0 % 3 === 0`.
- **Expired subscriptions keep working** — `initialize()` is only called from `subscription.tsx:69-80`, so benefits persist until the user opens that screen.
- **RLS hardening left false-success code** — `subscriptionStore.ts:322-332` updates `subscription_tier`, ignores the error, and reports "Downgraded to Free plan".
- **`confirm_payment` trusts a client-written amount** — `payment_requests` is inserted client-side with client-chosen `plan_id` and `amount`; no server price table. Grant yourself Business for `amount = 0.01`.
- **Unverifiable trust badges** — `"Secure"`, `"500+ Users"`, `"4.8 Rating"` (`subscription.tsx:364-378`) with no backing.
- **Two different WhatsApp pay numbers** — `subscriptionService.ts:63` vs `subscriptionStore.ts:299`.
- **Entire gating component suite is dead** — `FeatureGate`, `UpgradePrompt`, `UsageLimitWarning`, `InlineUpgradeCTA`, `PremiumBadge` have **zero usages**. The generic gate can also never upsell: `UpgradePrompt.tsx:213` passes `PlanLimits` keys into a lookup keyed by different names, so it silently renders nothing.
- **Face toggles and profile switches bypass tier checks** (`cameras/[id].tsx:161-169` `applyProfile` has no check).
- **Vibration-pattern picker is cosmetic** — `alarm-sounds.tsx:317-343` writes nothing to the store; `alarmService` uses its own hardcoded patterns.
- **Loading states rendered as "all clear"** — `alerts.tsx:74-83` shows "No Alerts" while loading; `(tabs)/index.tsx:421-431` shows "**Surveillance Perimeter Clear**" before data arrives (implies the property is safe when it isn't). `cameras/[id].tsx:123` renders `null` → blank black screen. `automations.tsx:19` destructures `isLoading` and never uses it.
- **No error states** on Alerts, Automations, or Recordings (console-only).
- **KeyboardAvoidingView only on auth screens** — missing on `profile/edit`, `profile/change-password`, `cameras/add`, `help`, and the camera-settings modal, so the submit action hides under the keyboard.
- **`settings/automations.tsx` has no back button** — root stack is `headerShown: false` and that screen defines no `Stack.Screen` header. Users are stranded.
- **`SkeletonLoader.tsx:66`** — `parseFloat("60%")` → 60 **pixels**.
- **`pruned/`** — a full duplicate app tree including `node_modules` and a `.env`, git-ignored but a drift and secret-handling liability.
- **~30 dead monetization/background/consent functions** with zero callers; `backgroundTasks.ts` is entirely unreachable.
- **`server/api/src/index.ts:605-637`** — unauthenticated path-traversal **existence + size oracle** (content is not exfiltrated — `express.static` still blocks it). `:629` hardcodes `absoluteUrl` to `localhost`.
- **Certificate pinning is a no-op** — `certificatePinning.ts:299-313` is a TODO, pins are `'AAAA…'` placeholders, and **the module is never imported**.
- **`push-on-alert` edge function has no signature verification** — anyone can POST a crafted payload and push notifications to arbitrary users.
- **`playAlarm` overlap** leaks an `Audio.Sound` per call (see H4).
- **Realtime alerts silently dropped** — `alertStore.ts:223-225`: if the camera isn't in the local store yet (cold start), `detectionTypeEnabled` is `undefined` → **no alarm and no vibration for a genuine person detection**.
- **Motion "laundering"** — `detectionManager.ts:357-360` sends a fabricated `person` detection while the event type stays `motion`, so the notification reads "Motion Detected" but the alarm system thinks a person was found.
- **Dedup race** — `alertStore.ts:189` uses an 8s window vs `:202` a 15s window, with different `createdAt` sources; a slow upload fails both.
- **Skeleton/timing leak** — Jest reports "worker failed to exit gracefully"; active timers are not unref'd.
- **Portrait-lock is forbidden by API 36** on ≥600dp screens, so C2's bump interacts with `app.json:6`.
- **Package name divergence** — `com.mtk.alertpro` (`app.json:29`) vs `com.mtkalertpro.app` (root `app.json:9`), with different EAS project IDs. Building from the repo root ships a **different applicationId**.
- **`eas submit` will fail** — `eas.json:56` points at `./google-service-account.json`, which does not exist.
- **Local release builds are debug-signed** — `android/app/build.gradle:109-112` uses `signingConfigs.debug` for release. Only EAS output is safe.

---

## Documented claims that are false

| Claim | Reality |
|---|---|
| `AUDIT_REPORT_2026.md:410-412` — "Critical: 0, High: 0" | 8 critical, 15+ high |
| `AUDIT_REPORT_2026.md:449` — "production-ready" | Target SDK 34 alone blocks upload |
| `AUDIT_REPORT_2026.md:357` — "All API calls use HTTPS" | `AndroidManifest.xml:29` enables cleartext; `client.ts:79,105` falls back to AsyncStorage for >2KB |
| `PHASE_3_PRODUCTION_READINESS_REPORT.md:183` — "Privacy Policy published and linked" | No URL anywhere in the app |
| `PHASE_3_PRODUCTION_READINESS_REPORT.md:200` — "screenshots prepared" | No listing assets in repo |
| `README.md:16,19` — "On-device AI", "no false alarms" | Remote model load; motion fallback on base64 chars |
| `README.md:96-98` — Free 48h history, Pro unlimited cameras | 7 days; 100 cameras |

---

## Fix order

**Day 1 (security):** C1 rotate keys · C3 fix `.easignore` · remove `RECORD_AUDIO`/`FOREGROUND_SERVICE`/`READ_MEDIA_AUDIO`

**Day 2 (unblock build):** C2 target SDK 36 · real AdMob IDs · `./google-service-account.json` · unify package name

**Week 1 (truth + trust):** C6 un-sell face recognition · C7 fix or reword AI detection · C8 build the emergency button · C5 privacy policy · C4 Play Billing

**Week 2 (integrity):** H1 one `PLAN_LIMITS` + server enforcement · H2 consent + ad gating · H3 notification permission · H4 real audio files + volume fix

**Week 3–4 (quality):** H5 app lock · H6 one theme + wire dark mode · H7 accessibility baseline · H8 safe-area fix · H10–H14 streaming/detection fixes · clear the 518 lint errors

---

## What works well

- Genuinely solid: 347 passing tests, clean typecheck, Zustand store architecture with proper separation
- **RLS is enabled on all four core tables** with per-user policies (`initial_schema.sql:63-126`)
- Two real security-hardening migrations exist: `20260922000000_strip_rtsp_credentials.sql` and `20260923150000_rls_subscription_hardening.sql` — the second correctly revoked client-side self-upgrade escalation
- `cameraStore.addCamera` **encrypts passwords before persisting** and guards against double-encryption (`:434-439`)
- Credentials are masked in the UI (`CameraStreamPlayer` idle URL) and there's a passing test for it
- Offline write queue, network-status hook, and camera cache all exist and are tested
- AdMob has a correct null-safe platform proxy for Expo Go, sane frequency caps, and no banner in live view
- UMP consent is requested *before* ad init — correct ordering, just never enforced
- RLS correctly prevents `payment_requests` forgery beyond `status='pending'`
- No overlay/accessibility-service abuse, no `MANAGE_EXTERNAL_STORAGE`, no `QUERY_ALL_PACKAGES`
