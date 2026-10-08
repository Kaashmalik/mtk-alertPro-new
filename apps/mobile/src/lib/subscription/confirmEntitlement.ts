/**
 * Post-purchase entitlement confirmation.
 *
 * The Play purchase path is deliberately split in two:
 *
 *   1. The app records a PENDING purchase and returns immediately.
 *   2. RevenueCat's webhook reaches our Edge Function, which calls the
 *      service-role-only apply_play_subscription() RPC to promote the tier.
 *
 * That split exists for a good reason — a client must never be able to grant
 * itself premium, so the app cannot write subscription_tier. But it means the
 * entitlement lands *asynchronously*, usually a second or two after the purchase
 * sheet closes.
 *
 * Without waiting for it, the user pays, sees the paywall close, still sees
 * "Free", and reasonably concludes the app took their money. That is the single
 * biggest source of "I paid but nothing happened" tickets and refund requests.
 *
 * This polls the profile until the expected tier appears, with a bounded
 * timeout, and reports what happened so the UI can be honest either way.
 */

import { isTierActive, normalizeTier } from '@/lib/subscription/planLimits';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

export type ConfirmationOutcome =
  | { status: 'confirmed'; tier: string }
  | { status: 'pending' }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

export interface ConfirmOptions {
  /** Tier the user just bought. */
  expectedTier: string;
  /** Total time to keep checking. */
  timeoutMs?: number;
  /** Gap between checks. */
  intervalMs?: number;
  /** Injectable for tests. */
  readState?: () => { currentTier: string; expiresAt: Date | null };
  /** Injectable for tests; resolves when the wait is over (or aborted). */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_INTERVAL_MS = 2_500;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll until `expectedTier` is active, or the timeout expires.
 *
 * "Active" uses the same expiry-aware rule as the rest of the app, so a lapsed
 * row is never mistaken for a successful purchase.
 */
export async function confirmEntitlement({
  expectedTier,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  readState,
  sleep = defaultSleep,
  signal,
}: ConfirmOptions): Promise<ConfirmationOutcome> {
  const expected = normalizeTier(expectedTier);
  if (expected === 'free') {
    return {
      status: 'failed',
      message: 'Nothing to confirm for the free plan',
    };
  }

  const read =
    readState ??
    (() => {
      const { currentTier, expiresAt } = useSubscriptionStore.getState();
      return { currentTier, expiresAt };
    });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { status: 'cancelled' };

    const { currentTier, expiresAt } = read();

    // Any *active* paid tier confirms the purchase. Comparing it to the exact
    // tier purchased would report failure for a legitimate case: the webhook
    // may promote Business while a Pro purchase was still pending.
    if (isTierActive(currentTier, expiresAt)) {
      return { status: 'confirmed', tier: normalizeTier(currentTier) };
    }

    // Refresh from the server each round so the poll is not reading a stale
    // in-memory copy. Failures are ignored: the loop is the retry.
    try {
      await useSubscriptionStore.getState().initialize();
    } catch {
      // keep polling
    }

    const after = read();
    if (isTierActive(after.currentTier, after.expiresAt)) {
      return { status: 'confirmed', tier: normalizeTier(after.currentTier) };
    }

    await sleep(intervalMs);
  }

  if (signal?.aborted) return { status: 'cancelled' };
  return { status: 'pending' };
}
