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
  hasAdvancedSceneProfiles: boolean;
  hasPrioritySupport: boolean;
  hasAPIAccess: boolean;
  streamQuality: StreamQuality;
}

/**
 * Automations are a real, separately-metered feature but were never listed in
 * any plan. The limit is defined here so the paywall and the store agree.
 */
export const MAX_AUTOMATIONS: Record<SubscriptionTier, number> = {
  free: 3,
  pro: 50,
  business: Infinity,
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
    hasAdvancedSceneProfiles: false,
    hasPrioritySupport: false,
    hasAPIAccess: false,
    streamQuality: 'sd',
  },
  pro: {
    maxCameras: Infinity,
    maxAlertHistory: 30,
    maxCloudStorageGB: 100,
    hasAIDetection: true,
    hasFaceRecognition: false,
    hasCustomZones: true,
    hasAdvancedSceneProfiles: true,
    hasPrioritySupport: true,
    hasAPIAccess: false,
    streamQuality: 'hd',
  },
  business: {
    maxCameras: Infinity,
    maxAlertHistory: Infinity,
    maxCloudStorageGB: Infinity,
    hasAIDetection: true,
    hasFaceRecognition: false,
    hasCustomZones: true,
    hasAdvancedSceneProfiles: true,
    hasPrioritySupport: true,
    hasAPIAccess: true,
    streamQuality: '4k',
  },
};

/**
 * Coerce an untrusted tier value (DB row, API payload, AsyncStorage cache) into
 * a known tier. Anything unrecognised becomes 'free'.
 */
export function normalizeTier(value: unknown): SubscriptionTier {
  return value === 'pro' || value === 'business' || value === 'free' ? value : 'free';
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
 */
export function isTierActive(tier: unknown, expiresAt: Date | string | null | undefined): boolean {
  if (!isPaidTier(tier)) return false;
  if (!expiresAt) {
    // No expiry recorded: treat as active. One-time/lifetime grants have no
    // expiry and revoking them would be a false downgrade.
    return true;
  }
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > Date.now();
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
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - currentCount);
}

export function canCreateAutomation(tier: unknown, currentCount: number): boolean {
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
export function clampStreamQuality(tier: unknown, requested: StreamQuality): StreamQuality {
  const max = QUALITY_ORDER.indexOf(maxStreamQuality(tier));
  const ask = QUALITY_ORDER.indexOf(requested);
  if (ask === -1) return maxStreamQuality(tier);
  return QUALITY_ORDER[Math.min(ask, max)];
}

/**
 * Human-readable limit message for a quota error.
 */
export function describeCameraLimit(tier: unknown): string {
  const limits = getPlanLimits(tier);
  if (limits.maxCameras === Infinity) return 'Unlimited cameras';
  return `Camera limit reached (${limits.maxCameras}). Upgrade for more cameras.`;
}
