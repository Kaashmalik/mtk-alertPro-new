/**
 * Plan limits — the single source of truth for subscription entitlements.
 *
 * Previously limits were defined in four places that disagreed:
 *   - subscriptionStore.SUBSCRIPTION_PLANS (marketing copy)
 *   - cameraStore.addCamera  `{ free: 2, pro: 100, business: 100 }`
 *   - the `subscription_features` table (never read by any code)
 *   - subscriptionService.getUpgradePrompt (a third feature vocabulary)
 *
 * Everything now resolves through this module. Three rules are enforced here
 * rather than at each call site:
 *
 *   1. Fail CLOSED. An unrecognised or tampered tier is normalised to 'free',
 *      so it receives the free quota (2 cameras, sd, no zones) instead of paid
 *      entitlements. This is the fix for a real fail-OPEN bug: the old check
 *      was `cameras.length >= limits[tier]`, and for an unknown tier
 *      `limits[tier]` is undefined, so the comparison was always false and any
 *      number of cameras was allowed.
 *   2. Expiry. `isTierActive` requires a non-expired subscription, so a stale
 *      cached tier stops granting benefits the moment it lapses instead of
 *      persisting until the paywall is opened.
 *   3. Server verification. Quota checks are enforced against a server-side
 *      count at the mutation site, not against local state.
 *
 * @module lib/subscription/planLimits
 */

export type SubscriptionTier = 'free' | 'pro' | 'business';

export type StreamQuality = 'sd' | 'hd' | '4k';

export interface PlanLimits {
  maxCameras: number;
  /** Alert history retention in days. */
  maxAlertHistory: number;
  maxCloudStorageGB: number;
  hasAIDetection: boolean;
  hasFaceRecognition: boolean;
  hasCustomZones: boolean;
  /** Sold as a Pro bullet in the paywall, so it has to be enforced. */
  hasRedAlertMode: boolean;
  hasAdvancedSceneProfiles: boolean;
  hasPrioritySupport: boolean;
  hasAPIAccess: boolean;
  /**
   * Premium plans must not show ads. The ad SDK's own gate is
   * `adMobService.shouldShowAds()`, so this flag is pushed into
   * `setPremiumStatus()` rather than checked per screen -- that way banners,
   * interstitials and app-open ads are all covered by construction.
   */
  hasAdFree: boolean;
  streamQuality: StreamQuality;
}

/**
 * Automations are a real, separately-metered feature but were never listed in
 * any plan. The limit is defined here so the paywall and the store agree.
 */
export const MAX_AUTOMATIONS: Record<SubscriptionTier, number> = {
  free: 3,
  pro: 50,
  business: Number.POSITIVE_INFINITY,
};

/** Concurrent live streams. Protects battery and upstream bandwidth. */
export const MAX_CONCURRENT_STREAMS: Record<SubscriptionTier, number> = {
  free: 1,
  pro: 4,
  business: 9,
};

export const PLAN_LIMITS: Record<SubscriptionTier, PlanLimits> = {
  free: {
    maxCameras: 2,
    maxAlertHistory: 7,
    maxCloudStorageGB: 1,
    hasAIDetection: true,
    hasFaceRecognition: false,
    hasCustomZones: false,
    hasRedAlertMode: false,
    hasAdvancedSceneProfiles: false,
    hasPrioritySupport: false,
    hasAPIAccess: false,
    hasAdFree: false,
    streamQuality: 'sd',
  },
  pro: {
    maxCameras: Number.POSITIVE_INFINITY,
    maxAlertHistory: 30,
    maxCloudStorageGB: 100,
    hasAIDetection: true,
    hasFaceRecognition: true,
    hasCustomZones: true,
    hasRedAlertMode: true,
    hasAdvancedSceneProfiles: true,
    hasPrioritySupport: true,
    hasAPIAccess: false,
    hasAdFree: true,
    streamQuality: 'hd',
  },
  business: {
    maxCameras: Number.POSITIVE_INFINITY,
    maxAlertHistory: Number.POSITIVE_INFINITY,
    maxCloudStorageGB: Number.POSITIVE_INFINITY,
    hasAIDetection: true,
    hasFaceRecognition: true,
    hasCustomZones: true,
    hasRedAlertMode: true,
    hasAdvancedSceneProfiles: true,
    hasPrioritySupport: true,
    hasAPIAccess: true,
    hasAdFree: true,
    streamQuality: '4k',
  },
};

/**
 * Coerce an untrusted tier value (DB row, API payload, AsyncStorage cache) into
 * a known tier. Anything unrecognised becomes 'free'.
 */
export function normalizeTier(value: unknown): SubscriptionTier {
  return value === 'pro' || value === 'business' || value === 'free'
    ? value
    : 'free';
}

export function getPlanLimits(tier: unknown): PlanLimits {
  return PLAN_LIMITS[normalizeTier(tier)];
}

export function isPaidTier(tier: unknown): boolean {
  const t = normalizeTier(tier);
  return t === 'pro' || t === 'business';
}

/**
 * Whether a tier currently grants paid benefits.
 *
 * An expired paid subscription resolves to false immediately, so a cached
 * "pro" tier cannot outlive the subscription itself.
 *
 * A paid tier with *no* recorded expiry is treated as inactive. That is a
 * deliberate change: the module's stated doctrine is to fail closed, and
 * `confirm_payment` always writes an expiry, so a NULL expiry on a paid tier
 * means the row was hand-edited or a webhook partially applied. Fail-open here
 * granted unlimited premium with no end date. If a genuine lifetime grant is
 * ever needed, give it an explicit far-future expiry or a dedicated flag rather
 * than relying on the absence of one.
 */
export function isTierActive(
  tier: unknown,
  expiresAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!isPaidTier(tier)) return false;
  if (!expiresAt) return false;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now;
}

/**
 * Whether a boolean feature is included in the plan.
 *
 * Typed to the boolean subset of PlanLimits so a numeric limit is not
 * accidentally treated as an entitlement.
 */
export type BooleanFeature = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

export function canUseFeature(tier: unknown, feature: BooleanFeature): boolean {
  return getPlanLimits(tier)[feature];
}

/**
 * Server-verified entitlement check for code paths outside a React tree
 * (automation scheduling, camera quotas).
 *
 * Reads the profile directly rather than trusting the persisted store, and
 * applies expiry, so a lapsed subscription cannot keep a paid capability.
 * Fails closed: any error resolves to "not entitled".
 */
export async function hasFeatureAccess(
  feature: BooleanFeature,
): Promise<boolean> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_expires_at')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profile) return false;

    const tier = normalizeTier(profile.subscription_tier);
    const expiresAt = profile.subscription_expires_at ?? null;
    const effective = isTierActive(tier, expiresAt) ? tier : 'free';

    return canUseFeature(effective, feature);
  } catch (error) {
    console.warn(
      '[planLimits] entitlement check failed, denying access:',
      error,
    );
    return false;
  }
}

/**
 * Whether another camera may be added.
 *
 * @param tier - Current subscription tier
 * @param currentCount - Authoritative camera count, ideally counted server-side
 */
export function canAddCamera(tier: unknown, currentCount: number): boolean {
  const limit = getPlanLimits(tier).maxCameras;
  return currentCount < limit;
}

export function remainingCameras(tier: unknown, currentCount: number): number {
  const limit = getPlanLimits(tier).maxCameras;
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - currentCount);
}

export function canCreateAutomation(
  tier: unknown,
  currentCount: number,
): boolean {
  return currentCount < MAX_AUTOMATIONS[normalizeTier(tier)];
}

/**
 * Stream quality ceiling. Callers must clamp a requested quality to this.
 */
export function maxStreamQuality(tier: unknown): StreamQuality {
  return getPlanLimits(tier).streamQuality;
}

const QUALITY_ORDER: StreamQuality[] = ['sd', 'hd', '4k'];

/** Clamp a requested stream quality down to what the plan allows. */
export function clampStreamQuality(
  tier: unknown,
  requested: StreamQuality,
): StreamQuality {
  const max = QUALITY_ORDER.indexOf(maxStreamQuality(tier));
  const ask = QUALITY_ORDER.indexOf(requested);
  if (ask === -1) return maxStreamQuality(tier);
  return QUALITY_ORDER[Math.min(ask, max)];
}

/** Concrete pixel heights a stream can be requested at, lowest first. */
const RESOLUTION_ORDER = ['360p', '480p', '720p', '1080p'] as const;
export type StreamResolution = (typeof RESOLUTION_ORDER)[number];

const RESOLUTION_TO_TIER_QUALITY: Record<StreamResolution, StreamQuality> = {
  '360p': 'sd',
  '480p': 'sd',
  '720p': 'hd',
  '1080p': '4k',
};

/** Highest concrete resolution permitted by the plan's stream-quality ceiling. */
export function maxResolutionForTier(tier: unknown): StreamResolution {
  const ceiling = maxStreamQuality(tier);
  let best: StreamResolution = '360p';
  for (const res of RESOLUTION_ORDER) {
    if (
      QUALITY_ORDER.indexOf(RESOLUTION_TO_TIER_QUALITY[res]) <=
      QUALITY_ORDER.indexOf(ceiling)
    ) {
      best = res;
    }
  }
  return best;
}

/**
 * The resolution a stream should actually run at.
 *
 * The network heuristic (useNetworkStatus.getRecommendedQuality) decides what the
 * connection can sustain; the plan decides what the user is entitled to. The
 * lower of the two wins. clampStreamQuality() existed but had no call sites, so
 * the plan's streamQuality limit was advertised on the paywall while nothing
 * ever applied it and a free user could pull 1080p.
 */
export function resolveEffectiveQuality(
  tier: unknown,
  recommended: StreamResolution,
): StreamResolution {
  const ceiling = maxResolutionForTier(tier);
  // Take the lower of the two by resolution index. Clamping to the coarse
  // StreamQuality first and re-expanding would upgrade a low recommendation:
  // '360p' -> 'sd' -> back to '480p', which is higher than what was asked for.
  const ceilingIndex = RESOLUTION_ORDER.indexOf(ceiling);
  const requestedIndex = RESOLUTION_ORDER.indexOf(recommended);
  if (requestedIndex === -1) return ceiling;
  return RESOLUTION_ORDER[Math.min(requestedIndex, ceilingIndex)];
}

/**
 * Human-readable limit message for a quota error.
 */
export function describeCameraLimit(tier: unknown): string {
  const limits = getPlanLimits(tier);
  if (limits.maxCameras === Number.POSITIVE_INFINITY)
    return 'Unlimited cameras';
  return `Camera limit reached (${limits.maxCameras}). Upgrade for more cameras.`;
}

// ============================================================================
// Paywall comparison model
// ============================================================================

/** One row of the plan-comparison table. */
export interface ComparisonRow {
  key: string;
  label: string;
  /** Rendered value per tier. `true`/`false` become a tick/cross. */
  values: Record<SubscriptionTier, string | boolean>;
}

const unlimited = 'Unlimited';

function storageLabel(gb: number): string {
  return gb === Number.POSITIVE_INFINITY ? unlimited : `${gb} GB`;
}

function historyLabel(days: number): string {
  return days === Number.POSITIVE_INFINITY ? unlimited : `${days} days`;
}

function cameraLabel(count: number): string {
  return count === Number.POSITIVE_INFINITY ? unlimited : `${count}`;
}

/**
 * The comparison rows rendered by the paywall.
 *
 * Derived from PLAN_LIMITS rather than hand-written, so the table can never
 * advertise a limit the enforcement layer does not actually apply — which is
 * exactly the class of bug this codebase had (a "30-day history" claim with a
 * hardcoded 100-row fetch).
 */
export const PLAN_COMPARISON: ComparisonRow[] = [
  {
    key: 'cameras',
    label: 'Cameras',
    values: {
      free: cameraLabel(PLAN_LIMITS.free.maxCameras),
      pro: cameraLabel(PLAN_LIMITS.pro.maxCameras),
      business: cameraLabel(PLAN_LIMITS.business.maxCameras),
    },
  },
  {
    key: 'quality',
    label: 'Stream quality',
    values: {
      free:
        PLAN_LIMITS.free.streamQuality === 'sd'
          ? 'SD (480p)'
          : PLAN_LIMITS.free.streamQuality,
      pro:
        PLAN_LIMITS.pro.streamQuality === 'hd'
          ? 'HD (720p)'
          : PLAN_LIMITS.pro.streamQuality,
      // Business is capped at 1080p by resolveEffectiveQuality. This used to read
      // "4K (1080p)", which advertised 4K while delivering 1080p.
      business: 'Full HD (1080p)',
    },
  },
  {
    key: 'history',
    label: 'Alert history',
    values: {
      free: historyLabel(PLAN_LIMITS.free.maxAlertHistory),
      pro: historyLabel(PLAN_LIMITS.pro.maxAlertHistory),
      business: unlimited,
    },
  },
  {
    key: 'storage',
    label: 'Cloud storage',
    values: {
      free: storageLabel(PLAN_LIMITS.free.maxCloudStorageGB),
      pro: storageLabel(PLAN_LIMITS.pro.maxCloudStorageGB),
      business: unlimited,
    },
  },
  {
    key: 'detection',
    label: 'AI detection',
    values: { free: true, pro: true, business: true },
  },
  {
    key: 'zones',
    label: 'Custom detection zones',
    values: {
      free: PLAN_LIMITS.free.hasCustomZones,
      pro: PLAN_LIMITS.pro.hasCustomZones,
      business: PLAN_LIMITS.business.hasCustomZones,
    },
  },
  {
    key: 'redAlert',
    label: 'Red Alert mode',
    values: {
      free: PLAN_LIMITS.free.hasRedAlertMode,
      pro: PLAN_LIMITS.pro.hasRedAlertMode,
      business: PLAN_LIMITS.business.hasRedAlertMode,
    },
  },
  {
    key: 'scenes',
    label: 'Advanced scenes',
    values: {
      free: PLAN_LIMITS.free.hasAdvancedSceneProfiles,
      pro: PLAN_LIMITS.pro.hasAdvancedSceneProfiles,
      business: PLAN_LIMITS.business.hasAdvancedSceneProfiles,
    },
  },
  {
    key: 'faceRecognition',
    label: 'Face recognition',
    values: {
      free: PLAN_LIMITS.free.hasFaceRecognition,
      pro: PLAN_LIMITS.pro.hasFaceRecognition,
      business: PLAN_LIMITS.business.hasFaceRecognition,
    },
  },
  {
    key: 'adFree',
    label: 'Ad-free experience',
    values: {
      free: PLAN_LIMITS.free.hasAdFree,
      pro: PLAN_LIMITS.pro.hasAdFree,
      business: PLAN_LIMITS.business.hasAdFree,
    },
  },
  // Intentionally not advertised:
  // - Priority support: no support-tier system exists.
  // - API access: hasAPIAccess is true for Business but there is no UI to create
  //   or manage a key, so the entitlement cannot actually be used.
  // The flags stay in PLAN_LIMITS as schema and re-enter this table when the
  // matching feature ships.
];

/** Comparison rows where `to` is strictly better than `from`. */
export function planUpgrades(from: unknown, to: unknown): ComparisonRow[] {
  const a = normalizeTier(from);
  const b = normalizeTier(to);
  return PLAN_COMPARISON.filter((row) =>
    isBetterValue(row.values[b], row.values[a]),
  );
}

function isBetterValue(
  next: string | boolean,
  prev: string | boolean,
): boolean {
  if (prev === true) return false;
  if (typeof next === 'boolean') return next === true;
  if (typeof prev === 'boolean') return true;
  if (next === unlimited) return prev !== unlimited;
  if (prev === unlimited) return false;

  // Compare the first number in each label so "HD (720p)" > "SD (480p)" works.
  // When neither side has a number (two opaque labels), treat a change as an
  // improvement only if we can rank them; otherwise assume it is not, so a
  // downgrade never claims to add something.
  const n = extractNumber(next);
  const p = extractNumber(prev);
  if (n === null && p === null) return false;
  if (p === null) return true;
  if (n === null) return false;
  return n > p;
}

function extractNumber(label: string): number | null {
  const m = label.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : null;
}
