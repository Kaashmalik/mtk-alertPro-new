# MTK AlertPro — Master Plan (2026)

Research-backed: benchmarks from RevenueCat's *State of Subscription Apps 2026*
(115,000 apps / $16B revenue), Ring / Arlo / Reolink / Nest / Canary / SimpliSafe /
Avigilon feature and pricing analysis, and 2026 smart-home direction (Matter 1.5,
on-device AI, HomeKit Secure Video).

Every item below is grounded in an **audit of this codebase**, not a generic wish
list. Items marked **[have]** already work and only need surfacing; **[partial]**
exists but is under-built; **[missing]** does not exist.

---

## Where we actually stand

**Shipped and verified**
- Real server-side quota enforcement (cameras, automations, Red Alert) — DB triggers, verified by live inserts
- Plan-aware stream quality, cloud storage cap, alert retention, face recognition
- Play purchase → RevenueCat webhook → service-role RPC → entitlement (deployed, E2E verified)
- Paywall with plan comparison, monthly/annual + computed savings, restore, legal
- Camera connection diagnostics with a **live relay health check**
- 33 test suites / 474 tests green, tsc 0, eslint 0 errors

**The honest gap**

| Market-standard capability | Status here |
|---|---|
| Person / vehicle / animal detection | **[have]** |
| Activity zones drawn on the feed | **[have]** (Pro) |
| Red Alert mode | **[have]** (Pro) |
| Cloud storage + retention | **[have]** (Pro/Business) |
| **Free trial** | **[missing]** ← biggest proven lever |
| **Package detection** | **[missing]** |
| **Two-way audio / talkback** | **[missing]** |
| **Siren / deterrent** | **[missing]** (only an alarm sound) |
| **People counting & analytics** | **[missing]** (no event table) |
| **Heatmaps / activity insights** | **[missing]** |
| **Multi-user / shared household** | **[missing]** |
| **Multi-site / camera groups** | **[missing]** |
| **Rich notifications with actions** | **[missing]** (Ring's "respond without opening") |
| **API keys surface** | **[partial]** `hasAPIAccess` advertised, no UI |
| **No-subscription / local-storage wedge** | **[missing]** (Reolink's whole positioning) |
| Smart-home (HomeKit / Matter) | **[missing]** |

> ### 🚨 Billing integrity issue — found and FIXED
> The plans were **selling features that did not exist**. Every one of these is
> a refund, chargeback and Play-policy risk:
>
> | Was advertised | Reality |
> |---|---|
> | Business: People Counting, Multi-User Management, Custom Integrations, "SLA Guaranteed Uptime", Advanced AI Analytics | none built |
> | Business: "4K (1080p)" | capped at 1080p |
> | Pro: "HD/4K Stream Quality" | capped at 720p |
> | Pro/Business: "Priority Support" | no support-tier system |
> | Comparison: "API access" for Business | flag set, but **no UI to create a key** |
> | Comparison: "Face recognition" | `hasFaceRecognition` is `false` on every tier |
> | Upgrade prompt: "Multi-location support", "HD/4K streaming" | not built / capped at 720p |
>
> All plan copy and the comparison table now list only what ships. The
> `hasAPIAccess` / `hasPrioritySupport` / `hasFaceRecognition` flags remain in
> `PLAN_LIMITS` as schema and re-enter the UI only when the feature ships.
> `pricing.test.ts` now **fails the build** if an unimplemented entitlement is
> advertised again, or if advertised stream quality drifts from the enforced
> ceiling.
>
> **Related gap — found and FIXED:** ads were not gated by tier at all. The ad
> SDK's own gate (`adMobService.shouldShowAds()` → `!isPremiumUser`) already
> existed and both banners and interstitials route through it, but
> `setPremiumStatus()` **was never called from anywhere in the app** — so paying
> Pro/Business subscribers were still served ads. Added `hasAdFree` to
> `PLAN_LIMITS` and a reactive `useAdEntitlementSync()` mounted at the root, so
> banners, interstitials and app-open ads are all covered by construction and a
> purchase, restore, downgrade or expiry all re-evaluate. Covered by
> `useAdEntitlement.test.ts`. Ad-free is now a real, advertised Pro perk.

---

# Priority 0 — Money (do first)

RevenueCat 2026: **89.4% of trial starts happen on install day**, and the first
paywall impression decides most revenue. Median D35 download→paid: **hard paywall
10.7% vs freemium 2.1% (5×)**. Hard paywalls also generate **8× revenue per
install at day 60** ($3.09 vs $0.38) with statistically identical 12-month
retention (27% vs 28%).

### P0.1 Free trial (17–32 days) — **[missing]**
Trials of **17–32 days convert 70% better than 3-day** (42.5% vs 25.5%), yet 46%
of apps ship ≤4-day trials. We have **no trial at all**.
- Add a free-trial phase to the Pro annual/monthly SKUs (Play billing period +
  `freeTrial` in RevenueCat)
- Trial length **21 days** (inside the high-converting band, and long enough to
  actually experience detection working)
- Trial state must be **server-side**: `apply_play_subscription` already accepts
  an expiry, so a trial is the same code path with a future expiry
- Show trial terms explicitly on the paywall (Play + consumer-protection rules)

### P0.2 Contextual paywall funnel — **[partial]**
Today the paywall is one static screen. Best practice is a paywall **system**:
- **First camera added** → soft prompt (they just proved they want it)
- **Camera limit hit** → hard paywall (highest-intent moment)
- **Storage >80%** → usage prompt
- **Trial ending at day ~18** → winback offer
- Deep-link support so push/email can open a specific paywall
- Log which trigger opened it (the `analytics` module already exists)

### P0.3 Honest gating (the "10-7-3 rule")
Currently ~90% of value is on Free (person/vehicle/animal AI detection is free).
Research says gate ~70% behind the paywall, keep ~10% free, reserve ~20% for
power users. **Without this, Pro has nothing worth paying for.**
Move to Pro: animal detection, push notifications, 30-day history, HD quality.
Keep on Free: 2 cameras, 7-day history, SD quality, person/vehicle.
Ad-free is now live on Pro (see the fix above) — the cheapest perceptible
upgrade in the app.

### P0.4 Annual-first with value reinforcement
Annual = lower churn but ~**72% cancel in Year 1** (worsened from 56%).
- Default the toggle to **Annual** (already done) and show real savings (done)
- **Value reinforcement in week 1**, not month 11: usage stats, "you've had X
  alerts", feature-discovery nudges
- Push at the renewal window with a "keep Pro" offer

### P0.5 Winback
- Day 3 / 7 / 14 post-cancel push + deep link to a winback paywall
- Discounted first month instead of a free trial (pulls in users who would
  cancel immediately and pollute the signal ad platforms use)

---

# Priority 1 — Product parity (table stakes)

These are the features every top-tier app has. Their absence is why a user would
pick a competitor.

### P1.1 Package detection — **[deferred, and deliberately so]**
Arlo/Nest/Ring all lead with package alerts, so the demand is real. But **COCO has
no parcel class** — the nearest labels are `backpack` (24), `handbag` (26) and
`suitcase` (28). Mapping those to "package delivered" would fire on anyone
walking past with a rucksack, which is exactly the alert fatigue that kills
retention in this category. Options, in order of honesty:
1. Train a small parcel-specific model (real fix, real cost), or
2. Ship `suitcase` only, paired with a **stationary-object heuristic** (object
   present in N consecutive frames, not overlapping a person box) — plausible but
   low recall, so treat as a Pro extra, not a headline feature, and
3. Do nothing yet and lead with **animal detection** instead, which the existing
   COCO model already supports accurately and which is currently given away free.

Recommendation: do (3) now, revisit when a parcel model is available. The
`detection_events` table deliberately omits `'package'` from its type CHECK for
this reason.

### P1.2 Two-way audio / talkback **[missing]**
Every competitor has it. The relay (MediaMTX) already terminates RTSP, so this is
a publish path. Pro feature, with a mic-level permission and a clear privacy note.

### P1.3 Siren / deterrent **[missing]**
Ring's core "scare them off" interaction. We have alarm sounds; a *camera-side*
deterrent (via relay) is different. Pro feature.

### P1.4 `detection_events` table → analytics **[migration written, not yet applied]**
Today an alert is a row, and `alerts` is trimmed to 7–30 days, so **there is no
durable event history to analyse** — which is why people counting, heatmaps and
insights are impossible today.
`supabase/migrations/20261001000100_detection_events.sql` adds a raw,
non-deduplicated event stream (camera, zone, type, kind, confidence, normalized
bounding box, `occurred_at`) with RLS limited to the owning user, immutable rows,
and indexes for the three real query shapes (user+time, camera+time,
user+type+time). `kind` already carries `zone_enter`/`zone_exit` so line-crossing
can be built on it later. Follow-ups: apply it, wire the detection path to
insert, then add a scheduled prune — this is a high-volume table and its
retention policy is deliberately deferred until real volume is known.
This one table unlocks:
- People counting & footfall (Business)
- Activity heatmaps over time
- "Busiest hour / day" insights
- False-positive review → retune sensitivity

### P1.5 Rich notifications with actions **[missing]**
Ring's differentiator: acknowledge / snooze / open live view **without opening the
app**. Uses the existing notification service. Directly reduces alert fatigue,
which is the #1 complaint in reviews of this category.

### P1.6 Multi-user / shared household **[missing]**
Every serious product has it (Guardian, SimpliSafe). Needs an `households` +
`household_members` model and per-camera permission. This is also the hook for
Business.

### P1.7 API keys surface **[partial]**
`hasAPIAccess` is enforced but there is **no UI to create a key**. Build a Business
keys screen: create, name, scope, last-used, revoke. Until then remove API Access
from the comparison table.

---

# Priority 2 — Differentiation (why pick *us*)

### P2.1 The no-lock-in / local-first wedge **[missing]**
**Reolink's entire 2026 positioning** is: AI detection, custom zones and local
recording with **no mandatory subscription** — and it wins on value because
everyone else locks basic features behind a plan. We already store recordings
locally. Market it: "your footage stays on your device", with cloud as opt-in.
This is our cheapest real moat and it directly pressures Arlo/Ring's pricing.

### P2.2 Works-with-any-camera (already a strength, unmarketed)
RTSP + ONVIF + no hardware lock-in (45 ONVIF references already in the codebase)
vs Arlo's closed cloud. Market the compatibility list explicitly.

### P2.3 Analytics & insights (builds on P1.4)
Weekly security digest, busiest zones, unusual-hours activity, missed-delivery
patterns. Business tier. This is what "Advanced AI Analytics" *should* mean — and
it becomes true rather than advertised.

### P2.4 Multi-site / camera groups (Business)
Groups, floorplans, per-site health. Standard for SMB.

### P2.5 Privacy-first mode **[partial]**
On-device AI is a 2026 theme (Anker's local AI hub, HKSV). We already run
TensorFlow.js **on-device** — lead with it: "detection runs on your phone; we
never see your video." Add a verifiable privacy page + a strict "no cloud unless
you opt in" mode.

---

# Priority 3 — Reach (later)

### P3.1 Smart home: HomeKit / Matter
2026 direction (Matter 1.5; HKSV is the prestige integration). High effort, high
ceiling. Best done via a bridge on the relay, not in the app.

### P3.2 Wearables & voice
WatchOS complications, Android Wear, and "Alexa, show me my front door" — feeds
directly from existing live view.

### P3.3 Vehicle / license-plate recognition
Milesight/Avigilon-class. A real Business upsell, but a large model + on-device
cost. Only after P1.4 exists.

---

# Sequencing (recommended)

| Sprint | Content | Why first |
|---|---|---|
| **S1** | P0.3 gating rebalance · P2.1 privacy positioning copy | Biggest revenue delta, lowest effort |
| **S2** | P0.2 contextual paywalls + trigger analytics · P0.5 winback | Compounding conversion gains |
| **S3** | Apply P1.4 + wire event inserts · animal detection as the Pro gate | Table stakes + unlocks analytics |
| **S4** | P1.5 rich notifications · P1.2 two-way audio · P1.3 siren | Table stakes |
| **S5** | P1.6 multi-user · P1.7 API keys · P2.3 insights | Business tier becomes real |
| **S6** | P0.4 annual retention · P2.4 multi-site | Monetisation depth |
| **S7** | P3.1 smart home | Reach |

**Rules for every sprint**
1. A feature may not be advertised until it ships. `pricing.test.ts` now enforces
   the parts of this that are mechanically checkable (unimplemented
   entitlements, quality drift) — review the rest by hand.
2. Every entitlement change lands in `PLAN_LIMITS` **and** the DB trigger in the
   same commit, with a test pinning them together (the automation-quota mismatch
   we hit proved the failure mode).
3. Every feature ships with an empty state, an error state, and a11y labels.
4. Gate on: tsc 0 · `eslint src` 0 errors · full suite green · no leaked handles.
   (Lint `src`, not `.` — the Expo config/plugins are Node files and legitimately
   use `require`.)

---

# Blockers outside the code

| Blocker | Owner | Impact |
|---|---|---|
| `20261001000100_detection_events.sql` not yet applied | You / next deploy | Analytics groundwork is inert until applied |
| RevenueCat dashboard not yet pointed at the webhook | You | **No purchase can ever grant premium.** Backend is live and verified. |
| Play product IDs (`pro_monthly`, `business_monthly`) | You | Products must exist to be sold |
| Release upload keystore | You | Debug-signed APK cannot be uploaded to Play |
| AdMob production unit IDs + UMP | You | Test ads = invalid traffic; UMP is required for EEA/UK |
| Real privacy/terms URLs | You | Play rejects the listing if they 404 |
| Supabase PAT rotation | You | The token in `.env` was exposed and is now expired |
