/**
 * Pricing + plan-comparison model tests.
 *
 * The paywall's comparison table and annual savings are derived from
 * PLAN_LIMITS / PRICING_ENTRIES rather than hand-written, precisely so the
 * marketing copy cannot drift from what the enforcement layer applies.
 */

import {
  PLAN_COMPARISON,
  PLAN_LIMITS,
  planUpgrades,
} from '@/lib/subscription/planLimits';
import {
  PRICING_ENTRIES,
  formatPrice,
  getAnnualSavings,
  getAnnualSavingsPercent,
  getMonthlyEquivalent,
  getPrice,
  periodCaption,
} from '@/lib/subscription/pricing';

describe('pricing model', () => {
  it('charges nothing on free regardless of period', () => {
    expect(getPrice('free', 'monthly')).toBe(0);
    expect(getPrice('free', 'annual')).toBe(0);
    expect(getMonthlyEquivalent('free', 'annual')).toBe(0);
    expect(getAnnualSavings('free')).toBe(0);
    expect(getAnnualSavingsPercent('free')).toBe(0);
  });

  it('discounts annual billing versus twelve monthly payments', () => {
    const pro = PRICING_ENTRIES.pro;
    const fullYear = pro.monthlyPrice * 12;
    expect(pro.annualPrice).toBeLessThan(fullYear);
    expect(getAnnualSavings('pro')).toBe(fullYear - pro.annualPrice);
    expect(getAnnualSavings('pro')).toBeGreaterThan(0);
  });

  it('reports the annual saving as a percentage', () => {
    const pct = getAnnualSavingsPercent('pro');
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
    // "2 months free" is ~17%
    expect(pct).toBe(17);
  });

  it('keeps the annual per-month figure below the monthly price', () => {
    expect(getMonthlyEquivalent('pro', 'annual')).toBeLessThan(
      PRICING_ENTRIES.pro.monthlyPrice,
    );
    expect(getMonthlyEquivalent('pro', 'monthly')).toBe(
      PRICING_ENTRIES.pro.monthlyPrice,
    );
  });

  it('prices business above pro', () => {
    expect(PRICING_ENTRIES.business.monthlyPrice).toBeGreaterThan(
      PRICING_ENTRIES.pro.monthlyPrice,
    );
  });

  it('formats zero as Free and other amounts with the currency', () => {
    expect(formatPrice(0, 'PKR')).toBe('Free');
    expect(formatPrice(500, 'PKR')).toContain('500');
    expect(formatPrice(500, 'PKR')).toContain('PKR');
  });

  it('states the billing period so the charged amount is unambiguous', () => {
    expect(periodCaption('monthly')).toBe('/mo');
    expect(periodCaption('annual')).toContain('billed annually');
  });
});

describe('plan comparison table', () => {
  it('has a value for every tier on every row', () => {
    for (const row of PLAN_COMPARISON) {
      for (const tier of ['free', 'pro', 'business'] as const) {
        expect(row.values[tier]).toBeDefined();
      }
    }
  });

  it('reflects the enforced camera limit, not a marketing number', () => {
    const cameras = PLAN_COMPARISON.find((r) => r.key === 'cameras');
    expect(cameras?.values.free).toBe(String(PLAN_LIMITS.free.maxCameras));
  });

  it('reflects the enforced alert-history limit', () => {
    const history = PLAN_COMPARISON.find((r) => r.key === 'history');
    expect(history?.values.free).toContain(
      String(PLAN_LIMITS.free.maxAlertHistory),
    );
  });

  it('marks Red Alert as a paid-only feature, matching hasRedAlertMode', () => {
    const redAlert = PLAN_COMPARISON.find((r) => r.key === 'redAlert');
    expect(redAlert?.values.free).toBe(PLAN_LIMITS.free.hasRedAlertMode);
    expect(redAlert?.values.pro).toBe(PLAN_LIMITS.pro.hasRedAlertMode);
    // Free must not advertise a feature the DB trigger rejects.
    expect(PLAN_LIMITS.free.hasRedAlertMode).toBe(false);
  });

  it('withholds unimplemented entitlements from the comparison table', () => {
    // There is no UI to create or manage an API key, so Business must not be
    // advertised as having "API access" even though the schema flag is set.
    // Priority support has no support-tier backend either. Advertising these
    // is a false claim. Face recognition is now a real entitlement and is
    // advertised.
    const keys = PLAN_COMPARISON.map((r) => r.key);
    expect(keys).not.toContain('api');
    expect(keys).not.toContain('support');
    expect(keys).toContain('faceRecognition');

    // The flags stay in the schema so the features can be wired up later.
    expect(PLAN_LIMITS.business.hasAPIAccess).toBe(true);
    expect(PLAN_LIMITS.free.hasFaceRecognition).toBe(false);
    expect(PLAN_LIMITS.pro.hasFaceRecognition).toBe(true);
  });

  it('advertises stream quality that matches the enforced ceiling', () => {
    const quality = PLAN_COMPARISON.find((r) => r.key === 'quality');
    // Business delivers 1080p; claiming 4K here would overstate the entitlement.
    expect(quality?.values.business).toBe('Full HD (1080p)');
    expect(quality?.values.pro).toBe('HD (720p)');
    expect(quality?.values.free).toBe('SD (480p)');
  });
});

describe('planUpgrades', () => {
  it('lists what a free user gains moving to pro', () => {
    const rows = planUpgrades('free', 'pro');
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('cameras');
    expect(keys).toContain('redAlert');
    expect(keys).toContain('zones');
    expect(keys).toContain('history');
    expect(keys).toContain('storage');
  });

  it('does not list features the user already has', () => {
    // Free already has AI detection, so upgrading should not claim it.
    const rows = planUpgrades('free', 'pro');
    expect(rows.find((r) => r.key === 'detection')).toBeUndefined();
  });

  it('returns nothing when downgrading or staying level', () => {
    expect(planUpgrades('pro', 'free')).toEqual([]);
    expect(planUpgrades('pro', 'pro')).toEqual([]);
  });

  it('treats an unknown source tier as free', () => {
    const rows = planUpgrades('enterprise', 'pro');
    expect(rows.length).toBeGreaterThan(0);
  });
});
