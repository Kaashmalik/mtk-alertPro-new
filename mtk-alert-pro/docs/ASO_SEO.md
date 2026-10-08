# ASO & SEO — store listing and discovery

For a mobile app, "SEO" is mostly **ASO** (App Store Optimization): the Play
listing's title, descriptions, and keywords drive search ranking. If you also
run a landing page, the web-SEO notes at the end apply.

## Title (30 chars max)

Lead with the brand, then the top keyword:

> `MTK AlertPro: CCTV AI Alerts`

## Short description (80 chars max)

One benefit-led sentence with a keyword — shown in search results:

> `Turn any IP/CCTV camera into a smart AI security alarm with instant alerts.`

## Full description (4000 chars) — structure

Google indexes this text, so weave keywords naturally (don't stuff). Suggested
skeleton:

1. **Hook (first 2 lines — shown before "read more"):** the core promise —
   watch your home/shop/farm from anywhere and get instant AI alerts.
2. **Key features** (bulleted, keyword-rich):
   - AI person/vehicle detection on your existing RTSP/ONVIF cameras
   - Scene modes: Home, School, Shop, Farm, Parking, Warehouse, Construction
   - Instant push alerts — even when the app is closed
   - Live view, snapshots, and clip recording
   - Detection zones, sensitivity, and quiet (silent) mode
   - Biometric app lock; encrypted camera credentials
3. **Who it's for:** homeowners, shops, schools, farms, small business.
4. **Compatibility:** Hikvision, Dahua, Reolink, Amcrest, TP-Link, generic
   ONVIF/RTSP.
5. **Trust:** privacy-first, credentials encrypted on-device.
6. **CTA:** download + upgrade to Pro.

## Primary keyword themes

`cctv app`, `ip camera viewer`, `rtsp viewer`, `onvif`, `security camera alerts`,
`ai motion detection`, `home security`, `nvr app`, `camera monitor`,
`intruder alert`. Place the strongest in title + short description (highest
weight), the rest in the full description.

## Localization

Translate the listing for your biggest markets (each locale is a separate
ranking surface). For a PKR-priced app, an Urdu listing is high-leverage.

## Ratings & reviews

Ratings are a top ranking factor. The app already integrates
`expo-store-review` — prompt after a *positive* moment (e.g. a successful camera
add or a confirmed alert), never on launch, and respect the once-per-version
limit.

## Web SEO (only if you run a landing page)

- Unique `<title>` + meta description per page; Open Graph tags for shareable
  cards.
- `SoftwareApplication` JSON-LD structured data (name, rating, price, screenshots).
- Fast, mobile-first, HTTPS; submit a sitemap to Search Console.
- Point `google-play` + `apple-itunes-app` smart-app-banner meta at the listing.
