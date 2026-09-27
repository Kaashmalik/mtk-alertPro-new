/**
 * Professional Subscription Service
 * 
 * Handles subscription management with multiple payment providers,
 * receipt validation, and proper backend synchronization
 */

import { Platform, Linking } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { logError, createAppError } from '@/lib/utils/errorHandler';
import { isTierActive, normalizeTier } from '@/lib/subscription/planLimits';
import type { SubscriptionTier } from '@/lib/subscription/planLimits';

// ============================================================================
// Types
// ============================================================================

export interface PaymentProvider {
  id: 'google_play' | 'whatsapp' | 'easypaisa' | 'jazzcash' | 'bank' | 'stripe';
  name: string;
  icon: string;
  available: boolean;
  description: string;
}

export interface PaymentRequest {
  planId: SubscriptionTier;
  userId: string;
  email: string;
  provider: PaymentProvider['id'];
  amount: number;
  currency: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  message: string;
  redirectUrl?: string;
}

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  isActive: boolean;
  expiresAt: Date | null;
  autoRenew: boolean;
  paymentMethod?: string;
  lastPaymentDate?: Date;
  nextBillingDate?: Date;
}

export interface UpgradePromptConfig {
  feature: string;
  requiredTier: SubscriptionTier;
  title: string;
  description: string;
  benefits: string[];
}

// ============================================================================
// Constants
// ============================================================================

const WHATSAPP_NUMBER = '923020718182';
const DEVELOPER_NAME = 'Muhammad Kashif';

const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: 'google_play',
    name: 'Google Play',
    icon: 'play-circle',
    // Availability is resolved at runtime from the RevenueCat offerings; this
    // default keeps the entry out of the list until then.
    available: false,
    description: 'Pay securely with Google Play',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: 'message-circle',
    available: true,
    description: 'Pay via WhatsApp - instant activation',
  },
  {
    id: 'easypaisa',
    name: 'EasyPaisa',
    icon: 'smartphone',
    available: true,
    description: 'Pay with your EasyPaisa account',
  },
  {
    id: 'jazzcash',
    name: 'JazzCash',
    icon: 'credit-card',
    available: true,
    description: 'Pay with JazzCash mobile wallet',
  },
  {
    id: 'bank',
    name: 'Bank Transfer',
    icon: 'building',
    available: true,
    description: 'Direct bank transfer',
  },
];

const PLAN_PRICES: Record<SubscriptionTier, { pkr: number; usd: number }> = {
  free: { pkr: 0, usd: 0 },
  pro: { pkr: 500, usd: 5 },
  business: { pkr: 1500, usd: 15 },
};

// ============================================================================
// Subscription Service Class
// ============================================================================

class SubscriptionService {
  private initialized = false;
  /** Resolved at runtime; false until RevenueCat reports real offerings. */
  private playBillingAvailable = false;

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Bring up Play Billing first so the provider list is correct. This is
      // fail-soft: without an API key the manual methods remain in charge.
      await this.initPlayBilling();

      // Validate subscription status on startup
      await this.validateSubscription();
      this.initialized = true;
      console.log('[SubscriptionService] Initialized');
    } catch (error: any) {
      logError(error, 'SubscriptionService.initialize');
    }
  }

  /**
   * Configure RevenueCat and cache whether Play Billing can be offered.
   */
  private async initPlayBilling(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { initRevenueCat, isPlayBillingAvailable } = await import('./revenueCat');

      const ok = await initRevenueCat(user?.id);
      if (!ok) return;

      this.playBillingAvailable = await isPlayBillingAvailable();
      console.log(`[SubscriptionService] Play Billing available: ${this.playBillingAvailable}`);
    } catch (error) {
      console.warn('[SubscriptionService] Play Billing init failed:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Payment Providers
  // ---------------------------------------------------------------------------

  getAvailableProviders(): PaymentProvider[] {
    return PAYMENT_PROVIDERS.filter(
      (p) => (p.id === 'google_play' ? this.playBillingAvailable : p.available)
    );
  }

  // ---------------------------------------------------------------------------
  // Subscription Validation
  // ---------------------------------------------------------------------------

  async validateSubscription(): Promise<SubscriptionStatus> {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return {
          tier: 'free',
          isActive: true,
          expiresAt: null,
          autoRenew: false,
        };
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_expires_at, subscription_auto_renew')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      // Fail closed: an unrecognised tier string resolves to 'free' rather
      // than being cast through to entitlement checks.
      const tier = normalizeTier(profile?.subscription_tier);
      const expiresAt = profile?.subscription_expires_at
        ? new Date(profile.subscription_expires_at)
        : null;

      // A paid tier past its expiry is not active.
      const isActive = isTierActive(tier, expiresAt);

      // If expired, downgrade to free
      if (!isActive && tier !== 'free') {
        await this.downgradeToFree(user.id);
        return {
          tier: 'free',
          isActive: true,
          expiresAt: null,
          autoRenew: false,
        };
      }

      return {
        tier: isActive ? tier : 'free',
        isActive,
        expiresAt,
        autoRenew: profile?.subscription_auto_renew || false,
      };
    } catch (error: any) {
      logError(error, 'SubscriptionService.validateSubscription');
      return {
        tier: 'free',
        isActive: true,
        expiresAt: null,
        autoRenew: false,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Payment Processing
  // ---------------------------------------------------------------------------

  async initiatePayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      console.log('[SubscriptionService] Initiating payment:', request);

      // Create payment record in database
      const { data: payment, error: dbError } = await supabase
        .from('payment_requests')
        .insert({
          user_id: request.userId,
          plan_id: request.planId,
          amount: request.amount,
          currency: request.currency,
          provider: request.provider,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        console.warn('[SubscriptionService] Failed to create payment record:', dbError);
      }

      // Route to appropriate payment handler
      switch (request.provider) {
        case 'google_play':
          return this.handleGooglePlayPayment(request, payment?.id);
        case 'whatsapp':
          return this.handleWhatsAppPayment(request, payment?.id);
        case 'easypaisa':
          return this.handleEasyPaisaPayment(request, payment?.id);
        case 'jazzcash':
          return this.handleJazzCashPayment(request, payment?.id);
        case 'bank':
          return this.handleBankTransfer(request, payment?.id);
        default:
          return this.handleWhatsAppPayment(request, payment?.id);
      }
    } catch (error: any) {
      logError(error, 'SubscriptionService.initiatePayment');
      return {
        success: false,
        message: error.message || 'Payment initiation failed',
      };
    }
  }

  /**
   * In-app purchase through Google Play via RevenueCat.
   *
   * On success the tier is applied to the backend profile so the entitlement
   * survives reinstall and syncs to other devices.
   */
  private async handleGooglePlayPayment(
    request: PaymentRequest,
    paymentId?: string
  ): Promise<PaymentResult> {
    // The store only sells the two paid plans; 'free' is not purchasable.
    const plan = request.planId as 'pro' | 'business';
    if (plan !== 'pro' && plan !== 'business') {
      return { success: false, message: 'This plan cannot be purchased' };
    }

    try {
      const { purchasePlan, recordPendingPurchase } = await import('./revenueCat');
      const result = await purchasePlan(plan);

      if (result.status === 'cancelled') {
        return { success: false, message: 'Purchase cancelled', transactionId: paymentId };
      }
      if (result.status === 'error') {
        return { success: false, message: result.message, transactionId: paymentId };
      }

      // Record the purchase for server-side verification. The client
      // deliberately does NOT promote the tier: writing profiles.subscription_tier
      // from the app is exactly what the RLS hardening revoked, and re-adding it
      // would let a tampered build grant itself premium.
      const queued = await recordPendingPurchase(
        request.userId,
        result.tier,
        result.transactionId
      );

      if (!queued) {
        return {
          success: false,
          message:
            'Purchase was made but could not be recorded. Please contact support with your receipt.',
          transactionId: result.transactionId,
        };
      }

      return {
        success: true,
        transactionId: result.transactionId,
        message: 'Purchase received. Your plan activates as soon as payment is verified.',
      };
    } catch (error: any) {
      logError(error, 'SubscriptionService.handleGooglePlayPayment');
      return {
        success: false,
        message: error?.message || 'Google Play purchase failed',
        transactionId: paymentId,
      };
    }
  }

  private async handleWhatsAppPayment(
    request: PaymentRequest,
    paymentId?: string
  ): Promise<PaymentResult> {
    const planName = request.planId.charAt(0).toUpperCase() + request.planId.slice(1);

    const message = encodeURIComponent(
      `🔐 *MTK AlertPro Subscription Request*\n\n` +
      `📧 Email: ${request.email}\n` +
      `📱 Plan: *${planName}*\n` +
      `💰 Amount: Rs. ${request.amount}/month\n` +
      `🆔 Ref: ${paymentId || 'N/A'}\n\n` +
      `Hi ${DEVELOPER_NAME}, I want to subscribe to MTK AlertPro ${planName} plan.\n` +
      `Please guide me through the payment process.`
    );

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;

    await Linking.openURL(url);

    return {
      success: true,
      transactionId: paymentId,
      message: 'Opening WhatsApp for payment',
      redirectUrl: url,
    };
  }

  private async handleEasyPaisaPayment(
    request: PaymentRequest,
    paymentId?: string
  ): Promise<PaymentResult> {
    // For EasyPaisa, show account details
    const message = encodeURIComponent(
      `🔐 *MTK AlertPro - EasyPaisa Payment*\n\n` +
      `Send Rs. ${request.amount} to:\n` +
      `📱 Account: 03020718182\n` +
      `👤 Name: ${DEVELOPER_NAME}\n\n` +
      `After payment, send screenshot with:\n` +
      `📧 Email: ${request.email}\n` +
      `📱 Plan: ${request.planId}\n` +
      `🆔 Ref: ${paymentId || 'N/A'}`
    );

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
    await Linking.openURL(url);

    return {
      success: true,
      transactionId: paymentId,
      message: 'Send payment to EasyPaisa account and share screenshot',
      redirectUrl: url,
    };
  }

  private async handleJazzCashPayment(
    request: PaymentRequest,
    paymentId?: string
  ): Promise<PaymentResult> {
    const message = encodeURIComponent(
      `🔐 *MTK AlertPro - JazzCash Payment*\n\n` +
      `Send Rs. ${request.amount} to:\n` +
      `📱 Account: 03020718182\n` +
      `👤 Name: ${DEVELOPER_NAME}\n\n` +
      `After payment, send screenshot with:\n` +
      `📧 Email: ${request.email}\n` +
      `📱 Plan: ${request.planId}\n` +
      `🆔 Ref: ${paymentId || 'N/A'}`
    );

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
    await Linking.openURL(url);

    return {
      success: true,
      transactionId: paymentId,
      message: 'Send payment to JazzCash account and share screenshot',
      redirectUrl: url,
    };
  }

  private async handleBankTransfer(
    request: PaymentRequest,
    paymentId?: string
  ): Promise<PaymentResult> {
    const message = encodeURIComponent(
      `🔐 *MTK AlertPro - Bank Transfer*\n\n` +
      `Transfer Rs. ${request.amount} to:\n` +
      `🏦 Bank: Meezan Bank\n` +
      `👤 Title: ${DEVELOPER_NAME}\n` +
      `📝 Account: 11330109676650\n` +
      `🆔 IBAN: PK26MEZN0011330109676650\n` +
      `🏢 Branch: BHUBTIAN BRANCH LHR\n` +
      `💳 Raast ID: 03020718182\n\n` +
      `After transfer, send receipt with:\n` +
      `📧 Email: ${request.email}\n` +
      `📱 Plan: ${request.planId}\n` +
      `🆔 Ref: ${paymentId || 'N/A'}`
    );

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
    await Linking.openURL(url);

    return {
      success: true,
      transactionId: paymentId,
      message: 'Bank details sent. Transfer and share receipt on WhatsApp.',
      redirectUrl: url,
    };
  }

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------
  //
  // NOTE: there is intentionally no client-side "activate" method.
  //
  // Promoting profiles.subscription_tier is a trusted-server job, performed by
  // the service_role-only `confirm_payment` RPC for manual payments and by a
  // RevenueCat webhook for Play purchases. rls_subscription_hardening.sql
  // revoked the client's column-level UPDATE on purpose; re-adding it here would
  // let anyone with a modified build grant themselves premium for free.

  /**
   * Drop the caller back to the free tier after their paid tier lapsed.
   *
   * Goes through the SECURITY DEFINER `downgrade_subscription()` RPC because
   * the RLS hardening migration revoked column-level UPDATE on the subscription
   * columns of `profiles`. The function is self-scoped, so it can only ever
   * affect the authenticated caller's own row.
   */
  async downgradeToFree(_userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('downgrade_subscription');
      if (error) throw error;

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? 'downgrade_subscription() reported failure');
      }

      console.log('[SubscriptionService] Downgraded current user to free');
      return true;
    } catch (error: any) {
      logError(error, 'SubscriptionService.downgradeToFree');
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Feature Gating
  // ---------------------------------------------------------------------------

  getUpgradePrompt(feature: string, currentTier: SubscriptionTier): UpgradePromptConfig | null {
    // NOTE: there is deliberately no 'face_recognition' entry. The current
    // "face" output is a geometric region derived from the person bounding box,
    // not a face model, so hasFaceRecognition is false on every tier and
    // upselling it would be a false claim. Re-add it only alongside a real
    // face identification model.
    const prompts: Record<string, UpgradePromptConfig> = {
      unlimited_cameras: {
        feature: 'unlimited_cameras',
        requiredTier: 'pro',
        title: 'Add More Cameras',
        description: 'Upgrade to Pro for unlimited camera connections.',
        benefits: [
          'Connect unlimited cameras',
          'Monitor your entire property',
          'Multi-location support',
          'HD/4K streaming',
        ],
      },
      custom_zones: {
        feature: 'custom_zones',
        requiredTier: 'pro',
        title: 'Custom Detection Zones',
        description: 'Define specific areas for motion detection.',
        benefits: [
          'Ignore non-essential areas',
          'Focus on entry points',
          'Reduce false alerts',
          'Multiple zones per camera',
        ],
      },
      api_access: {
        feature: 'api_access',
        requiredTier: 'business',
        title: 'API Access',
        description: 'Integrate MTK AlertPro with your own systems.',
        benefits: [
          'REST API access',
          'Webhook notifications',
          'Custom integrations',
          'Enterprise features',
        ],
      },
      priority_support: {
        feature: 'priority_support',
        requiredTier: 'pro',
        title: 'Priority Support',
        description: 'Get faster response times and dedicated assistance.',
        benefits: [
          'Response within minutes',
          'Direct phone support',
          'Priority issue resolution',
          'Setup assistance',
        ],
      },
    };

    const prompt = prompts[feature];
    if (!prompt) return null;

    // Check if upgrade is needed
    const tierOrder: SubscriptionTier[] = ['free', 'pro', 'business'];
    const currentIndex = tierOrder.indexOf(normalizeTier(currentTier));
    const requiredIndex = tierOrder.indexOf(prompt.requiredTier);

    if (currentIndex >= requiredIndex) return null;

    return prompt;
  }

  // ---------------------------------------------------------------------------
  // Pricing
  // ---------------------------------------------------------------------------

  getPlanPrice(tier: SubscriptionTier, currency: 'pkr' | 'usd' = 'pkr'): number {
    return PLAN_PRICES[tier]?.[currency] || 0;
  }

  formatPrice(amount: number, currency: string = 'PKR'): string {
    if (amount === 0) return 'Free';

    const formatter = new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    });

    return formatter.format(amount);
  }

  // ---------------------------------------------------------------------------
  // Expiration Warnings
  // ---------------------------------------------------------------------------

  getDaysUntilExpiry(expiresAt: Date | null): number | null {
    if (!expiresAt) return null;

    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  shouldShowExpiryWarning(expiresAt: Date | null): boolean {
    const days = this.getDaysUntilExpiry(expiresAt);
    return days !== null && days <= 7 && days > 0;
  }

  isExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return expiresAt < new Date();
  }
}

// ============================================================================
// Export Singleton
// ============================================================================

export const subscriptionService = new SubscriptionService();

