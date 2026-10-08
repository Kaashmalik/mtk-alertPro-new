/**
 * Pricing presentation for the paywall.
 *
 * The store's SUBSCRIPTION_PLANS only carried a single `price` with
 * `period: 'monthly'`, so the paywall could not offer an annual option, show
 * what the user saves, or display a per-month equivalent. Google Play requires
 * the actual charged amount and the billing period to be shown before purchase,
 * so this is a compliance requirement as well as good conversion practice.
 *
 * Annual prices are deliberately modelled here (2 months free) and NOT fetched:
 * until the RevenueCat products are configured there is no server source of
 * truth, and the webhook has yet to exist. `PRICING_ENTRIES` is the single place
 * to replace with real product IDs and prices.
 */

import type { SubscriptionTier } from '@/lib/subscription/planLimits';

export type BillingPeriod = 'monthly' | 'annual';

/** Months charged per period. */
const MONTHS_PER_PERIOD: Record<BillingPeriod, number> = {
  monthly: 1,
  annual: 12,
};

/** Discount applied to the annual price, as a multiplier. */
const ANNUAL_DISCOUNT = 10 / 12; // 2 months free

export interface PricingEntry {
  tier: SubscriptionTier;
  /** Price charged for one month. */
  monthlyPrice: number;
  /** Price charged for the whole year (already discounted). */
  annualPrice: number;
  currency: string;
}

/**
 * Single source of truth for plan prices.
 *
 * `monthlyPrice` is the base; the annual price is derived so the two can never
 * drift apart.
 */
export const PRICING_ENTRIES: Record<SubscriptionTier, PricingEntry> = {
  free: { tier: 'free', monthlyPrice: 0, annualPrice: 0, currency: 'PKR' },
  pro: {
    tier: 'pro',
    monthlyPrice: 500,
    annualPrice: Math.round(500 * ANNUAL_DISCOUNT * 12),
    currency: 'PKR',
  },
  business: {
    tier: 'business',
    monthlyPrice: 1500,
    annualPrice: Math.round(1500 * ANNUAL_DISCOUNT * 12),
    currency: 'PKR',
  },
};

export function getPrice(
  tier: SubscriptionTier,
  period: BillingPeriod,
): number {
  const entry = PRICING_ENTRIES[tier];
  if (!entry) return 0;
  return period === 'annual' ? entry.annualPrice : entry.monthlyPrice;
}

/** The per-month equivalent, which is what the paywall displays. */
export function getMonthlyEquivalent(
  tier: SubscriptionTier,
  period: BillingPeriod,
): number {
  const entry = PRICING_ENTRIES[tier];
  if (!entry) return 0;
  if (period === 'monthly') return entry.monthlyPrice;
  return Math.round(entry.annualPrice / MONTHS_PER_PERIOD.annual);
}

/** Absolute currency saved by choosing annual over twelve monthly payments. */
export function getAnnualSavings(tier: SubscriptionTier): number {
  const entry = PRICING_ENTRIES[tier];
  if (!entry || entry.monthlyPrice === 0) return 0;
  const fullYear = entry.monthlyPrice * MONTHS_PER_PERIOD.annual;
  return fullYear - entry.annualPrice;
}

/** Percentage saved by annual billing, rounded for display ("Save 17%"). */
export function getAnnualSavingsPercent(tier: SubscriptionTier): number {
  const entry = PRICING_ENTRIES[tier];
  if (!entry || entry.monthlyPrice === 0) return 0;
  const fullYear = entry.monthlyPrice * MONTHS_PER_PERIOD.annual;
  return Math.round(((fullYear - entry.annualPrice) / fullYear) * 100);
}

/** "PKR 500" — currency code first, which is clearer than a bare "Rs.". */
export function formatPrice(amount: number, currency: string): string {
  if (amount === 0) return 'Free';
  return `${currency} ${amount.toLocaleString('en-PK')}`;
}

/** "per month" / "per month, billed annually" for the price caption. */
export function periodCaption(period: BillingPeriod): string {
  return period === 'annual' ? '/mo, billed annually' : '/mo';
}
