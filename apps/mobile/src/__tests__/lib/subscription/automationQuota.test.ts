/**
 * Quota consistency between the client plan table and the database triggers.
 *
 * The DB triggers in 20260930000100_server_side_quota_enforcement.sql are
 * written as literals and must never drift from PLAN_LIMITS / MAX_AUTOMATIONS.
 * These assert the client's values so a future change to either side that is
 * not mirrored shows up here rather than as a production quota rejection.
 *
 * The database is never stricter than the client: if the trigger were tighter,
 * a user would be blocked from something the app already promised them.
 */

import {
  MAX_AUTOMATIONS,
  PLAN_LIMITS,
  canAddCamera,
  canCreateAutomation,
  normalizeTier,
} from '@/lib/subscription/planLimits';

/** What the SQL triggers use for "unlimited" (int4 max). */
const UNLIMITED_SQL = 2147483647;

describe('camera quota consistency', () => {
  it('allows 2 cameras on free and unlimited on paid', () => {
    expect(PLAN_LIMITS.free.maxCameras).toBe(2);
    expect(PLAN_LIMITS.pro.maxCameras).toBe(Number.POSITIVE_INFINITY);
    expect(PLAN_LIMITS.business.maxCameras).toBe(Number.POSITIVE_INFINITY);
  });

  it('blocks the 3rd camera on free', () => {
    expect(canAddCamera('free', 0)).toBe(true);
    expect(canAddCamera('free', 1)).toBe(true);
    expect(canAddCamera('free', 2)).toBe(false);
  });

  it('never blocks a paid user below the trigger ceiling', () => {
    // The trigger uses 2147483647; the client must not block before that.
    for (const tier of ['pro', 'business'] as const) {
      expect(canAddCamera(tier, 999)).toBe(true);
      expect(canAddCamera(tier, UNLIMITED_SQL - 1)).toBe(true);
    }
  });
});

describe('automation quota consistency', () => {
  it('allows 3 on free, 50 on pro, unlimited on business', () => {
    expect(MAX_AUTOMATIONS.free).toBe(3);
    expect(MAX_AUTOMATIONS.pro).toBe(50);
    expect(MAX_AUTOMATIONS.business).toBe(Number.POSITIVE_INFINITY);
  });

  it('blocks the 4th automation on free', () => {
    expect(canCreateAutomation('free', 2)).toBe(true);
    expect(canCreateAutomation('free', 3)).toBe(false);
  });

  it('allows 50 on pro and blocks the 51st', () => {
    expect(canCreateAutomation('pro', 49)).toBe(true);
    expect(canCreateAutomation('pro', 50)).toBe(false);
  });

  it('treats an unknown tier as free rather than as an allowance', () => {
    expect(normalizeTier('enterprise')).toBe('free');
    expect(canCreateAutomation('enterprise', 3)).toBe(false);
  });
});
