/**
 * Post-purchase entitlement confirmation.
 *
 * The paywall previously returned immediately after a successful Play purchase,
 * so the user saw "Free" even though the webhook had (or was about to) grant
 * Pro. These lock the three outcomes: confirmed, still-pending, and aborted.
 */

import {
  type ConfirmOptions,
  confirmEntitlement,
} from '@/lib/subscription/confirmEntitlement';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

/** Build a readState that flips to the purchased tier after `flipAfter` reads. */
function makeState(flipAfter: number, tier = 'pro') {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    readState: () => {
      reads += 1;
      return reads > flipAfter
        ? { currentTier: tier, expiresAt: FUTURE }
        : { currentTier: 'free', expiresAt: null };
    },
  };
}

const noSleep = async () => {};

function base(over: Partial<ConfirmOptions>): ConfirmOptions {
  return {
    expectedTier: 'pro',
    timeoutMs: 5_000,
    intervalMs: 1,
    sleep: noSleep,
    ...over,
  };
}

describe('confirmEntitlement', () => {
  it('confirms as soon as the webhook grants the tier', async () => {
    const s = makeState(2);
    const out = await confirmEntitlement(base({ readState: s.readState }));
    expect(out).toEqual({ status: 'confirmed', tier: 'pro' });
  });

  it('confirms immediately when the tier is already active', async () => {
    const out = await confirmEntitlement(
      base({
        readState: () => ({ currentTier: 'pro', expiresAt: FUTURE }),
      }),
    );
    expect(out.status).toBe('confirmed');
  });

  it('reports pending when the webhook never arrives', async () => {
    const s = makeState(Number.MAX_SAFE_INTEGER);
    const out = await confirmEntitlement(
      base({ readState: s.readState, timeoutMs: 12 }),
    );
    expect(out).toEqual({ status: 'pending' });
  });

  it('does not treat a lapsed paid row as a success', async () => {
    // Regression guard: the whole fail-closed contract depends on this.
    const out = await confirmEntitlement(
      base({
        readState: () => ({ currentTier: 'pro', expiresAt: PAST }),
        timeoutMs: 12,
      }),
    );
    expect(out.status).toBe('pending');
  });

  it('accepts a higher tier than the one purchased', async () => {
    // The webhook may promote Business while a Pro purchase was still pending.
    const out = await confirmEntitlement(
      base({
        expectedTier: 'pro',
        readState: () => ({ currentTier: 'business', expiresAt: FUTURE }),
      }),
    );
    expect(out).toEqual({ status: 'confirmed', tier: 'business' });
  });

  it('returns cancelled when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await confirmEntitlement(
      base({
        readState: () => ({ currentTier: 'free', expiresAt: null }),
        signal: controller.signal,
        timeoutMs: 5_000,
      }),
    );
    expect(out).toEqual({ status: 'cancelled' });
  });

  it('refuses to confirm the free plan', async () => {
    const out = await confirmEntitlement(base({ expectedTier: 'free' }));
    expect(out.status).toBe('failed');
  });
});
