/**
 * Subscription Store
 *
 * Manages subscription state, plan limits, and payment handling
 * with proper backend synchronization
 */

import { adMobService } from '@/lib/ads/adMobService';
import {
  PLAN_LIMITS,
  type PlanLimits,
  type SubscriptionTier,
  // Aliased: the store exposes its own `canAddCamera` action.
  canAddCamera as canAddCameraLimit,
  getPlanLimits,
  isPaidTier,
  isTierActive,
  normalizeTier,
  remainingCameras,
} from '@/lib/subscription/planLimits';
import { supabase } from '@/lib/supabase/client';
import { logError } from '@/lib/utils/errorHandler';
import { useCameraStore } from '@/stores/cameraStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Re-exported so existing `from '@/stores/subscriptionStore'` imports keep
// working. The definitions now live in lib/subscription/planLimits.
export type { SubscriptionTier, PlanLimits };

// ============================================================================
// Types
// ============================================================================

export interface SubscriptionPlan {
  id: SubscriptionTier;
  name: string;
  price: number;
  currency: string;
  period: 'monthly' | 'yearly';
  features: string[];
  limits: PlanLimits;
  popular?: boolean;
}

export interface SubscriptionState {
  // Current subscription info
  currentTier: SubscriptionTier;
  expiresAt: Date | null;
  isActive: boolean;

  // Plan details
  plans: SubscriptionPlan[];
  currentPlan: SubscriptionPlan | null;

  // Usage tracking
  usage: {
    camerasUsed: number;
    storageUsedGB: number;
    alertsThisMonth: number;
  };

  // Loading states
  isLoading: boolean;
  isUpgrading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  checkFeatureAccess: (feature: keyof PlanLimits) => boolean;
  canAddCamera: () => boolean;
  getRemainingCameras: () => number;
  getUpgradeUrl: (planId: SubscriptionTier) => string;
  requestUpgrade: (
    planId: SubscriptionTier,
  ) => Promise<{ success: boolean; message: string }>;
  updateUsage: (usage: Partial<SubscriptionState['usage']>) => void;
  clearError: () => void;
}

// ============================================================================
// Plan Definitions
// ============================================================================

const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'PKR',
    period: 'monthly',
    features: [
      `${PLAN_LIMITS.free.maxCameras} Cameras`,
      'Person, Vehicle & Animal Detection',
      'Home, Farm & Shop scene modes',
      `${PLAN_LIMITS.free.maxAlertHistory}-Day Alert History`,
      'SD (480p) Stream Quality',
      'Push Notifications',
      'Help Center & Community Support',
    ],
    limits: PLAN_LIMITS.free,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 500,
    currency: 'PKR',
    period: 'monthly',
    popular: true,
    features: [
      'Unlimited Cameras',
      'Person, Vehicle & Animal Detection',
      'All scene modes (Parking, Warehouse, School…)',
      `${PLAN_LIMITS.pro.maxAlertHistory}-Day Alert History`,
      'Push + Email Notifications',
      // Pro is capped at HD (720p) by PLAN_LIMITS.streamQuality and enforced in
      // resolveEffectiveQuality. Claiming 4K here contradicted the entitlement.
      'HD (720p) Stream Quality',
      `${PLAN_LIMITS.pro.maxCloudStorageGB}GB Cloud Storage`,
      'Red Alert Mode',
      'Custom Detection Zones',
      'Ad-free experience',
    ],
    limits: PLAN_LIMITS.pro,
  },
  {
    id: 'business',
    name: 'Business',
    price: 1500,
    currency: 'PKR',
    period: 'monthly',
    // Only features the app actually delivers. This list previously advertised
    // People Counting, Multi-User Management, Custom Integrations and "SLA
    // Guaranteed Uptime" — none of which were implemented, so the plan was
    // selling imaginary entitlements (a refund/chargeback and Play policy risk).
    // Unbuilt features belong in the roadmap, not on a customer's receipt.
    features: [
      'Unlimited Cameras',
      'Full HD (1080p) Stream Quality',
      'All scene detection profiles',
      'Unlimited Alert History',
      'Unlimited Cloud Storage',
      'Custom Detection Zones',
      'Red Alert Mode',
      'Ad-free experience',
    ],
    limits: PLAN_LIMITS.business,
  },
];

// ============================================================================
// Store Implementation
// ============================================================================

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentTier: 'free',
      expiresAt: null,
      isActive: true,
      plans: SUBSCRIPTION_PLANS,
      currentPlan: SUBSCRIPTION_PLANS[0],
      usage: {
        camerasUsed: 0,
        storageUsedGB: 0,
        alertsThisMonth: 0,
      },
      isLoading: false,
      isUpgrading: false,
      error: null,

      // Initialize subscription from backend
      initialize: async () => {
        set({ isLoading: true, error: null });

        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user) {
            set({ isLoading: false });
            return;
          }

          // Fetch subscription from profiles table
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('subscription_tier, subscription_expires_at')
            .eq('id', user.id)
            .single();

          if (profileError) {
            throw profileError;
          }

          // An unrecognised tier must not grant paid benefits. Previously the
          // raw column value was cast straight to SubscriptionTier, so any
          // unexpected value flowed into every entitlement check.
          const rawTier = profile?.subscription_tier;
          const tier = normalizeTier(rawTier);
          const expiresAt = profile?.subscription_expires_at
            ? new Date(profile.subscription_expires_at)
            : null;

          // A paid tier past its expiry is downgraded immediately rather than
          // persisting until the user next opens the paywall.
          const effectiveTier = isTierActive(tier, expiresAt) ? tier : 'free';

          const currentPlan =
            SUBSCRIPTION_PLANS.find((p) => p.id === effectiveTier) ??
            SUBSCRIPTION_PLANS[0];

          // Fetch usage stats
          const { count: cameraCount } = await supabase
            .from('cameras')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

          // Prefer the higher of the server count and the local list. If the
          // count query failed (offline) the server value is 0, and reporting
          // 0 would advertise free slots the user does not actually have. The
          // authoritative check in cameraStore.addCamera is unaffected either
          // way.
          const localCount = useCameraStore.getState().cameras.length;

          set({
            currentTier: effectiveTier,
            expiresAt,
            isActive: effectiveTier !== 'free' || !isPaidTier(tier),
            currentPlan,
            usage: {
              ...get().usage,
              camerasUsed: Math.max(cameraCount ?? 0, localCount),
            },
            isLoading: false,
          });
        } catch (error: any) {
          logError(error, 'SubscriptionStore.initialize');
          set({
            isLoading: false,
            error: error.message || 'Failed to load subscription',
          });
        }
      },

      // Refresh subscription status
      refreshSubscription: async () => {
        await get().initialize();
      },

      // Check if user has access to a feature.
      // Delegates to the shared table so the UI and the enforcement layer can
      // never disagree, and applies the expiry check so a lapsed subscription
      // immediately reports no access.
      checkFeatureAccess: (feature) => {
        const { currentTier, expiresAt } = get();
        const tier = isTierActive(currentTier, expiresAt)
          ? currentTier
          : 'free';
        const value = getPlanLimits(tier)[feature];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        return true;
      },

      // Check if user can add another camera.
      // Display hint only. cameraStore.addCamera performs the authoritative,
      // server-counted check - this must never be treated as enforcement.
      canAddCamera: () => {
        const { currentTier, expiresAt, usage } = get();
        const tier = isTierActive(currentTier, expiresAt)
          ? currentTier
          : 'free';
        return canAddCameraLimit(tier, usage.camerasUsed);
      },

      // Get remaining camera slots
      getRemainingCameras: () => {
        const { currentTier, expiresAt, usage } = get();
        const tier = isTierActive(currentTier, expiresAt)
          ? currentTier
          : 'free';
        return remainingCameras(tier, usage.camerasUsed);
      },

      // Get WhatsApp upgrade URL
      getUpgradeUrl: (planId: SubscriptionTier) => {
        const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
        if (!plan) return '';

        const WHATSAPP_NUMBER = '923038111297';
        const message = encodeURIComponent(
          `Hi, I want to upgrade to MTK AlertPro ${plan.name} plan (Rs. ${plan.price}/month). Please guide me.`,
        );

        return `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
      },

      // Request upgrade (opens WhatsApp or payment flow)
      requestUpgrade: async (planId: SubscriptionTier) => {
        set({ isUpgrading: true, error: null });

        try {
          const { currentTier } = get();

          if (planId === currentTier) {
            return { success: false, message: 'You are already on this plan' };
          }

          if (planId === 'free') {
            // Downgrade goes through a SECURITY DEFINER RPC: the RLS hardening
            // migration revoked column-level UPDATE on subscription fields, so a
            // direct .update() on profiles is rejected by Postgres.
            const { data, error } = await supabase.rpc(
              'downgrade_subscription',
            );

            if (error) {
              set({ isUpgrading: false, error: error.message });
              return {
                success: false,
                message: `Downgrade failed: ${error.message}`,
              };
            }

            const result = data as { success?: boolean; error?: string } | null;
            if (!result?.success) {
              const reason = result?.error ?? 'Unknown error';
              set({ isUpgrading: false, error: reason });
              return { success: false, message: `Downgrade failed: ${reason}` };
            }

            await get().initialize();
            set({ isUpgrading: false });
            return { success: true, message: 'Downgraded to Free plan' };
          }

          // For paid plans, return WhatsApp URL
          const url = get().getUpgradeUrl(planId);

          set({ isUpgrading: false });
          return {
            success: true,
            message: 'Opening WhatsApp for upgrade',
            url,
          } as any;
        } catch (error: any) {
          logError(error, 'SubscriptionStore.requestUpgrade');
          set({
            isUpgrading: false,
            error: error.message || 'Upgrade request failed',
          });
          return { success: false, message: error.message };
        }
      },

      // Update usage stats
      updateUsage: (usage) => {
        set((state) => ({
          usage: { ...state.usage, ...usage },
        }));
      },

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: 'subscription-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        currentTier: state.currentTier,
        expiresAt: state.expiresAt,
        usage: state.usage,
      }),
      // JSON storage has no reviver, so a persisted Date comes back as an ISO
      // string and `expiresAt` silently stops being a Date. Revive it here so
      // every consumer can trust the declared type.
      merge: (persisted, current) => {
        const saved = persisted as Partial<SubscriptionState> | undefined;
        const raw = saved?.expiresAt;
        const expiresAt =
          raw instanceof Date
            ? raw
            : typeof raw === 'string' || typeof raw === 'number'
              ? new Date(raw)
              : null;

        return {
          ...current,
          ...saved,
          expiresAt:
            expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        };
      },
    },
  ),
);

// ============================================================================
// Helper Hooks
// ============================================================================
// Usage Wiring
// ============================================================================

/**
 * Keep the camera quota hint in sync with the real camera list.
 *
 * `usage.camerasUsed` was previously only written by initialize(), so after
 * adding or removing a camera the "N of M" counter and the add-camera gate
 * stayed at their bootstrap values for the rest of the session. A single
 * subscription keeps one source of truth without scattering updateUsage()
 * calls across every camera mutation path.
 *
 * This is a display hint only. cameraStore.addCamera re-checks the quota with a
 * server-side count, so enforcement does not depend on this being correct.
 *
 * A plain subscribe + local diff is used rather than the selector overload,
 * which would require adding subscribeWithSelector to cameraStore.
 */
let lastKnownCameraCount = useCameraStore.getState().cameras.length;
if (lastKnownCameraCount !== 0) {
  useSubscriptionStore
    .getState()
    .updateUsage({ camerasUsed: lastKnownCameraCount });
}

useCameraStore.subscribe((state) => {
  if (state.cameras.length === lastKnownCameraCount) return;
  lastKnownCameraCount = state.cameras.length;
  useSubscriptionStore
    .getState()
    .updateUsage({ camerasUsed: lastKnownCameraCount });
});

/**
 * Ad suppression tracks the same expiry-aware rule as feature gating.
 * `setPremiumStatus` is a plain setter with no caller, so premium users were
 * still served ads until (unless) something else happened to reset it.
 */
let lastKnownAdFree = false;
const syncAdEntitlement = () => {
  const { currentTier, expiresAt } = useSubscriptionStore.getState();
  const adFree = isTierActive(currentTier, expiresAt);
  if (adFree === lastKnownAdFree) return;
  lastKnownAdFree = adFree;
  adMobService.setPremiumStatus(adFree);
};
syncAdEntitlement();
useSubscriptionStore.subscribe(syncAdEntitlement);

// Ad suppression only refreshed on a store change, so a plan that expired
// mid-session kept suppressing ads. Re-check at the expiry boundary and on
// foreground, matching useIsPremium.
if (typeof AppState !== 'undefined') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') syncAdEntitlement();
  });

  useSubscriptionStore.subscribe((state) => {
    const remaining = state.expiresAt
      ? state.expiresAt.getTime() - Date.now()
      : null;
    if (
      remaining !== null &&
      remaining > 0 &&
      remaining <= 24 * 60 * 60 * 1000
    ) {
      setTimeout(syncAdEntitlement, remaining + 1000);
    }
  });
}

// ============================================================================

/**
 * Re-render premium consumers when a subscription lapses mid-session.
 *
 * isTierActive() is a pure function of the clock, but the memoised result only
 * recomputed when tier/expiresAt changed. A user whose plan expired while the
 * app sat open kept every paid feature -- and kept ad suppression -- until some
 * unrelated store write happened. Ticking at the expiry boundary closes that.
 */
function useExpiryBoundary(expiresAt: Date | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return undefined;
    const remaining = expiresAt.getTime() - Date.now();
    // Already past, or so far out that a timer is not worth holding open; the
    // re-check on next focus covers those.
    if (remaining <= 0 || remaining > MAX_EXPIRY_TIMER_MS) return undefined;

    const timer = setTimeout(() => setNow(Date.now()), remaining + 1000);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return now;
}

/** ~24.8 days; setTimeout overflows past this on some platforms. */
const MAX_EXPIRY_TIMER_MS = 24 * 60 * 60 * 1000;

export const useIsPremium = () => {
  const tier = useSubscriptionStore((state) => state.currentTier);
  const expiresAt = useSubscriptionStore((state) => state.expiresAt);
  // Expiry-aware. Previously this only compared the tier string, so an expired
  // subscription kept granting paid features until initialize() happened to
  // run again. The persisted tier is a render hint; initialize() on bootstrap
  // re-verifies it against the server.
  const now = useExpiryBoundary(expiresAt);
  return useMemo(
    () => isTierActive(tier, expiresAt, now),
    [tier, expiresAt, now],
  );
};

export const usePlanLimits = () => {
  const currentTier = useSubscriptionStore((state) => state.currentTier);
  const expiresAt = useSubscriptionStore((state) => state.expiresAt);
  // Resolve through the shared table so the UI can never disagree with the
  // enforcement layer about what a tier includes.
  return useMemo(() => {
    if (isTierActive(currentTier, expiresAt)) {
      return getPlanLimits(currentTier);
    }
    return getPlanLimits('free');
  }, [currentTier, expiresAt]);
};
