# What happens after you pay (subscription lifecycle)

This explains exactly what the app does after a payment, so you know what to
expect and how long each step takes. It also explains the "why" behind a few
things that look unusual from the outside.

---

## The short version

```
1. You tap Subscribe
2. Google Play takes the payment
3. The app records the purchase as PENDING  (seconds)
4. RevenueCat notifies our server          (a few seconds)
5. Our server activates your plan          (seconds)
6. The app detects it and unlocks Pro      (a few seconds)

Total: usually under 10 seconds.
```

The app now **waits for step 6 and tells you** "Confirming your purchase…"
instead of dropping you back on a screen that still says Free.

---

## Step by step

### 1. You subscribe
Choose a plan, tap **Continue to Payment**, confirm with biometrics if enabled,
and Google Play's own payment sheet opens. The plan you pick is charged by
Google — the app never sees your card.

### 2. The app records a *pending* purchase
The app writes a row to the `subscriptions` table with status `pending`, and
`profiles.subscription_tier` is **left alone**.

> **Why not just unlock Pro immediately?**
> Because any code running on a phone can be tampered with. If the app could
> write its own `subscription_tier`, a modified app could grant itself Pro for
> free. The database explicitly refuses that. A purchase is only promoted
> after the store (Google) confirms it to our server.

### 3. Google tells RevenueCat
Google Play notifies RevenueCat that the purchase succeeded. This happens
without the app doing anything.

### 4. RevenueCat calls our server (the webhook)
RevenueCat sends a signed event to our server, which checks it is really from
RevenueCat and then activates your plan in the database.

If anything about the event is unexpected (an unknown product, a missing
expiry date), the server **refuses** it and writes it to the logs rather than
guessing. That is deliberate: a paid customer who is not being served should be
visible immediately, not silently lost.

### 5. Your account is upgraded
Our server sets your plan tier and the expiry date taken **from the store**
(so a yearly plan really gets a year, not a month), and records the purchase for
your records.

### 6. The app unlocks Pro
The app polls your account every couple of seconds for up to ~45 seconds. As
soon as the plan is active you see:

> **Your plan is active — All paid features are now unlocked on this account.**

and ads stop, your limits lift, and Pro-only features (custom zones, Red Alert,
higher stream quality, more storage, longer alert history) become available.

---

## If activation takes longer than a minute

Occasionally the confirmation is delayed (store outage, or the webhook was
temporarily unavailable). If you are still on Free after a minute:

1. Tap **Restore purchases** on the Subscription screen. This re-checks with
   the store and re-activates anything you are already entitled to.
2. If that does not help, contact support **with your order/receipt**. Because
   the purchase is recorded against your account, it can be activated manually
   — you will not be charged twice.

> You are never charged twice. The store is the source of truth for whether you
> paid; the app simply mirrors it.

---

## Renewals, cancellations and expiry

| Event | What happens | How to manage |
|---|---|---|
| **Auto-renews** | On the renewal date the store charges you and sends a `RENEWAL` event; the server extends your expiry automatically. Nothing to do. | Turn off auto-renew any time. |
| **You cancel** | You keep access until the end of the period you already paid for, then it lapses. Cancelling does **not** refund the remaining time. | Play Store → your subscription → Cancel. |
| **It lapses** | At the end of the paid period the account returns to Free automatically. Your cameras and settings are kept — you just lose the Pro limits until you subscribe again. | Nothing. |
| **Payment fails** | The store attempts retries. If it keeps failing the plan lapses. | Update your payment method in the Play Store. |

You can also **downgrade to Free yourself** from the Subscription screen at any
time — you keep Pro until the end of the period you already paid for.

---

## Frequently asked

**Why does the app not show Pro instantly?**
Because the store has to confirm the payment first (see step 2). This usually
takes a few seconds and the app now waits for it and tells you.

**I was charged but nothing changed.**
Tap **Restore purchases** first. If that does not work, contact support with
your receipt — the purchase is on record and can be activated for you.

**Can I get a refund?**
Refunds are handled by Google Play, not by this app. Request a refund through
the Play Store (your purchase → ⋮ → Request a refund). Cancelling a renewal
stops future charges but does not refund the current period.

**Does upgrading mid-period lose my remaining time?**
No. If you upgrade before a period ends, your expiry is extended — it is never
shortened.

**Is my payment information safe?**
Yes. Payment is handled entirely by Google Play. The app never receives or
stores your card details.

**What happens to my cameras if I lapse back to Free?**
Your cameras, recordings and settings are kept. You simply cannot add more than
the Free allowance (2 cameras) until you subscribe again.
