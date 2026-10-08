/**
 * Enhanced Subscription Screen
 *
 * Professional pricing page with multiple payment options
 */

import { SkeletonSubscriptionCard } from '@/components/ui';
import { requireBiometric } from '@/lib/biometric';
import {
  hapticPrimaryAction,
  hapticSelection,
  hapticSuccess,
} from '@/lib/haptics';
import { type PaymentProvider, subscriptionService } from '@/lib/subscription';
import { confirmEntitlement } from '@/lib/subscription/confirmEntitlement';
import { PLAN_COMPARISON, planUpgrades } from '@/lib/subscription/planLimits';
import {
  type BillingPeriod,
  PRICING_ENTRIES,
  formatPrice,
  getAnnualSavings,
  getAnnualSavingsPercent,
  getMonthlyEquivalent,
  periodCaption,
} from '@/lib/subscription/pricing';
import {
  borderRadius,
  colors,
  fontSize,
  palette,
  shadows,
  spacing,
} from '@/lib/theme';
import { useAuthStore } from '@/stores';
import {
  type SubscriptionTier,
  useIsPremium,
  useSubscriptionStore,
} from '@/stores/subscriptionStore';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router } from 'expo-router';
import {
  AlertCircle,
  ArrowLeft,
  Building,
  Check,
  CreditCard,
  Crown,
  Lock,
  MessageCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Legal URLs surfaced on the paywall. Google Play requires both. */
const PRIVACY_POLICY_URL = 'https://kaashmalik.github.io/mtk-alertpro/privacy';
const TERMS_URL = 'https://kaashmalik.github.io/mtk-alertpro/terms';

// ============================================================================
// Component
// ============================================================================

export default function SubscriptionScreen() {
  const {
    currentTier,
    plans,
    isLoading,
    expiresAt,
    initialize,
    usage,
    requestUpgrade,
  } = useSubscriptionStore();
  const user = useAuthStore((state) => state.user);
  const isPremium = useIsPremium();

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionTier>('pro');
  const [selectedProvider, setSelectedProvider] =
    useState<PaymentProvider['id']>('whatsapp');
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  // Billing period shown on the paywall. Annual is the default because it is
  // both the better deal and the higher-value order; the savings are computed
  // from PRICING_ENTRIES rather than hardcoded so the badge can't lie.
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('annual');
  const [showComparison, setShowComparison] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  // Post-purchase entitlement state, so the user is never left staring at a
  // paywall that still says "Free" after paying.
  const [confirmation, setConfirmation] = useState<
    'checking' | 'pending' | 'done' | null
  >(null);

  // "What you get" for the selected plan, so an upgrade decision is explicit.
  const upgrades = planUpgrades(currentTier, selectedPlan);
  const selectedPricing = PRICING_ENTRIES[selectedPlan];
  const annualSavingsPct = getAnnualSavingsPercent(selectedPlan);

  // Play Billing availability is only known after subscriptionService.initialize()
  // finishes, so the provider list has to be state rather than a render-time read.
  const [paymentProviders, setPaymentProviders] = useState<PaymentProvider[]>(
    () => subscriptionService.getAvailableProviders(),
  );
  const daysUntilExpiry = subscriptionService.getDaysUntilExpiry(expiresAt);
  const showExpiryWarning =
    subscriptionService.shouldShowExpiryWarning(expiresAt);

  const syncProviders = useCallback(() => {
    const providers = subscriptionService.getAvailableProviders();
    setPaymentProviders(providers);
    // Google Play Billing is the primary method whenever it is configured.
    // Only fall back to WhatsApp when the Play path is unavailable (no RevenueCat
    // key, not signed in, or the device has no Play Services).
    setSelectedProvider((current) => {
      if (!providers.some((p) => p.id === current)) {
        return providers[0]?.id ?? current;
      }
      if (providers.some((p) => p.id === 'google_play')) {
        return 'google_play';
      }
      return current;
    });
  }, []);

  useEffect(() => {
    // `initialize()` is idempotent and guards with `this.initialized`, so this
    // is cheap even when the app bootstrap already ran it. Awaiting it here
    // guarantees the provider list reflects resolved Play Billing
    // availability by the time the paywall renders.
    void (async () => {
      try {
        await subscriptionService.initialize();
      } catch (error) {
        console.error('[Subscription] init failed:', error);
      } finally {
        syncProviders();
      }
    })();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [syncProviders, fadeAnim]);

  useEffect(() => {
    syncProviders();
  }, [syncProviders]);

  const onRefresh = useCallback(() => {
    initialize();
  }, [initialize]);

  /**
   * Restore purchases.
   *
   * Required by Google Play for any app with in-app purchases, and it had no
   * caller anywhere in the app — a reinstalled user with a live subscription
   * was shown the paywall with no way to recover their plan.
   */
  const handleRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      const { restorePurchases } = await import('@/lib/profile/profileService');
      const result = await restorePurchases();
      if (result.restored) {
        hapticSuccess();
        await initialize();
        Alert.alert(
          'Purchases restored',
          `Your ${result.tier ?? ''} plan is active again.`.trim(),
        );
      } else {
        Alert.alert(
          'Nothing to restore',
          'We could not find an active subscription on this account.',
        );
      }
    } catch (error) {
      Alert.alert(
        'Restore failed',
        error instanceof Error ? error.message : 'Please try again later.',
      );
    } finally {
      setIsRestoring(false);
    }
  }, [initialize]);

  const handlePlanSelect = (planId: SubscriptionTier) => {
    hapticSelection();
    setSelectedPlan(planId);
    if (planId !== 'free' && planId !== currentTier) {
      setShowPaymentOptions(true);
      return;
    }

    // Selecting Free while on a paid plan is a downgrade, not a no-op. It
    // previously just closed the payment sheet and silently did nothing,
    // because requestUpgrade() had no caller anywhere in the app.
    if (planId === 'free' && currentTier !== 'free') {
      Alert.alert(
        'Cancel your plan?',
        `You will move back to the Free plan and lose Pro features. Your current period stays active until ${expiresAt ? new Date(expiresAt).toLocaleDateString() : 'it ends'}.`,
        [
          { text: 'Keep my plan', style: 'cancel' },
          {
            text: 'Downgrade',
            style: 'destructive',
            onPress: async () => {
              const result = await requestUpgrade('free');
              if (result.success) {
                await initialize();
                setShowPaymentOptions(false);
              } else {
                Alert.alert('Downgrade failed', result.message);
              }
            },
          },
        ],
      );
      return;
    }

    setShowPaymentOptions(false);
  };

  const handlePayment = async () => {
    if (!user?.email) return;

    // Money is about to move. If the user has biometrics enabled, make them
    // prove it before the purchase sheet opens.
    const confirmed = await requireBiometric('confirm your purchase');
    if (!confirmed) {
      Alert.alert('Cancelled', 'Purchase was not started.');
      return;
    }

    hapticPrimaryAction();
    setIsProcessing(true);

    const plan = plans.find((p) => p.id === selectedPlan);
    if (!plan) return;

    const result = await subscriptionService.initiatePayment({
      planId: selectedPlan,
      userId: user.id,
      email: user.email,
      provider: selectedProvider,
      amount: plan.price,
      currency: plan.currency,
    });

    setIsProcessing(false);

    if (result.success) {
      hapticSuccess();

      // The tier is granted server-side by the RevenueCat webhook, so it lands
      // a moment after this returns. Wait for it rather than dropping the user
      // back onto a paywall that still says "Free" — otherwise a successful
      // purchase looks exactly like a failed one.
      if (selectedProvider === 'google_play') {
        setShowPaymentOptions(false);
        setConfirmation('checking');
        const outcome = await confirmEntitlement({
          expectedTier: selectedPlan,
        });
        await initialize();

        if (outcome.status === 'confirmed') {
          setConfirmation('done');
          setShowPaymentOptions(false);
          Alert.alert(
            'Payment complete',
            `Your ${outcome.tier} plan is now active. Thank you!`,
          );
        } else if (outcome.status === 'pending') {
          setConfirmation('pending');
          Alert.alert(
            'Payment received — confirming',
            'Your purchase went through. It can take up to a minute to activate.\n\n' +
              'Your plan will switch on by itself shortly. If it does not, use ' +
              '"Restore purchases" below or contact support with your receipt.',
          );
        } else {
          setConfirmation(null);
        }
      }
    } else if (result.message) {
      Alert.alert('Payment not completed', result.message);
    }
  };

  const getProviderIcon = (providerId: PaymentProvider['id']) => {
    switch (providerId) {
      case 'google_play':
        return <Play size={20} color="#34A853" />;
      case 'whatsapp':
        return <MessageCircle size={20} color="#25D366" />;
      case 'easypaisa':
        return <Smartphone size={20} color="#00A651" />;
      case 'jazzcash':
        return <CreditCard size={20} color="#ED1C24" />;
      case 'bank':
        return <Building size={20} color={colors.text.secondary} />;
      default:
        return <CreditCard size={20} color={colors.text.secondary} />;
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.loadingContainer}>
          <SkeletonSubscriptionCard />
          <SkeletonSubscriptionCard />
          <SkeletonSubscriptionCard />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={colors.bg.primary}
        />

        {/* Header */}
        <LinearGradient
          colors={['#1A1F2E', colors.bg.primary]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backButton}
              >
                <ArrowLeft size={24} color={colors.text.primary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Subscription</Text>
              <View style={{ width: 44 }} />
            </View>
          </SafeAreaView>
        </LinearGradient>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={onRefresh}
              tintColor={palette.red[500]}
            />
          }
        >
          {/* Post-purchase confirmation */}
          {confirmation && (
            <View
              style={[
                styles.confirmBanner,
                confirmation === 'done' && styles.confirmBannerDone,
              ]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              {confirmation === 'done' ? (
                <Check size={20} color={colors.status.success} />
              ) : (
                <ActivityIndicator
                  color={colors.status.info ?? colors.brand.primary}
                />
              )}
              <View style={styles.expiryContent}>
                <Text style={styles.confirmTitle}>
                  {confirmation === 'checking' && 'Confirming your purchase…'}
                  {confirmation === 'pending' && 'Payment received'}
                  {confirmation === 'done' && 'Your plan is active'}
                </Text>
                <Text style={styles.confirmSub}>
                  {confirmation === 'checking' &&
                    'Verifying with the store. This usually takes a few seconds.'}
                  {confirmation === 'pending' &&
                    'Still confirming. Your plan will switch on automatically — you can close this screen.'}
                  {confirmation === 'done' &&
                    'All paid features are now unlocked on this account.'}
                </Text>
              </View>
            </View>
          )}

          {/* Expiry Warning */}
          {showExpiryWarning && (
            <View style={styles.expiryWarning}>
              <AlertCircle size={20} color={colors.status.warning} />
              <View style={styles.expiryContent}>
                <Text style={styles.expiryTitle}>
                  Subscription expires in {daysUntilExpiry} days
                </Text>
                <Text style={styles.expirySubtitle}>
                  Renew now to avoid interruption
                </Text>
              </View>
            </View>
          )}

          {/* Current Plan Status */}
          {isPremium && (
            <View style={styles.currentPlanCard}>
              <View style={styles.currentPlanHeader}>
                <Crown size={24} color={palette.amber[500]} />
                <View style={styles.currentPlanInfo}>
                  <Text style={styles.currentPlanLabel}>Current Plan</Text>
                  <Text style={styles.currentPlanName}>
                    {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
                  </Text>
                </View>
              </View>
              <View style={styles.usageStats}>
                <View style={styles.usageStat}>
                  <Text style={styles.usageValue}>{usage.camerasUsed}</Text>
                  <Text style={styles.usageLabel}>Cameras</Text>
                </View>
                <View style={styles.usageDivider} />
                <View style={styles.usageStat}>
                  <Text style={styles.usageValue}>{usage.alertsThisMonth}</Text>
                  <Text style={styles.usageLabel}>Alerts</Text>
                </View>
                <View style={styles.usageDivider} />
                <View style={styles.usageStat}>
                  <Text style={styles.usageValue}>{usage.storageUsedGB}GB</Text>
                  <Text style={styles.usageLabel}>Storage</Text>
                </View>
              </View>
            </View>
          )}

          {/* Hero Section */}
          <Animated.View style={[styles.heroSection, { opacity: fadeAnim }]}>
            <View style={styles.crownContainer}>
              <LinearGradient
                colors={[palette.amber[500], palette.amber[600]]}
                style={styles.crownGradient}
              >
                <Crown size={32} color="white" />
              </LinearGradient>
            </View>
            <Text style={styles.heroTitle}>Choose Your Plan</Text>
            <Text style={styles.heroSubtitle}>
              Unlock premium features with our affordable plans
            </Text>
          </Animated.View>

          {/* Billing period toggle */}
          <View style={styles.periodToggle}>
            <TouchableOpacity
              style={[
                styles.periodOption,
                billingPeriod === 'monthly' && styles.periodOptionActive,
              ]}
              onPress={() => {
                hapticSelection();
                setBillingPeriod('monthly');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: billingPeriod === 'monthly' }}
            >
              <Text
                style={[
                  styles.periodText,
                  billingPeriod === 'monthly' && styles.periodTextActive,
                ]}
              >
                Monthly
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.periodOption,
                billingPeriod === 'annual' && styles.periodOptionActive,
              ]}
              onPress={() => {
                hapticSelection();
                setBillingPeriod('annual');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: billingPeriod === 'annual' }}
            >
              <Text
                style={[
                  styles.periodText,
                  billingPeriod === 'annual' && styles.periodTextActive,
                ]}
              >
                Annual
              </Text>
              {annualSavingsPct > 0 && (
                <View style={styles.savingsPill}>
                  <Text style={styles.savingsPillText}>
                    Save {annualSavingsPct}%
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Plan Cards */}
          <View style={styles.planCards}>
            {plans.map((plan) => {
              const isCurrentPlan = plan.id === currentTier;
              const isSelected = plan.id === selectedPlan;

              return (
                <TouchableOpacity
                  key={plan.id}
                  activeOpacity={0.9}
                  onPress={() => handlePlanSelect(plan.id)}
                  style={[
                    styles.planCard,
                    plan.popular && styles.planCardPopular,
                    isSelected && styles.planCardSelected,
                    isCurrentPlan && styles.planCardCurrent,
                  ]}
                >
                  {plan.popular && (
                    <LinearGradient
                      colors={[palette.red[500], palette.red[600]]}
                      style={styles.popularBadge}
                    >
                      <Sparkles size={12} color="white" />
                      <Text style={styles.popularText}>RECOMMENDED</Text>
                    </LinearGradient>
                  )}

                  {isCurrentPlan && (
                    <View style={styles.currentBadge}>
                      <Check size={12} color={colors.status.success} />
                      <Text style={styles.currentText}>ACTIVE</Text>
                    </View>
                  )}

                  <View style={styles.planHeader}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <View style={styles.priceContainer}>
                      <Text
                        style={[
                          styles.planPrice,
                          plan.popular && { color: palette.red[500] },
                          plan.id === 'business' && {
                            color: palette.amber[500],
                          },
                        ]}
                      >
                        {formatPrice(
                          getMonthlyEquivalent(plan.id, billingPeriod),
                          PRICING_ENTRIES[plan.id].currency,
                        )}
                      </Text>
                      {getMonthlyEquivalent(plan.id, billingPeriod) > 0 && (
                        <Text style={styles.period}>
                          {periodCaption(billingPeriod)}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.featuresList}>
                    {plan.features.slice(0, 5).map((feature) => (
                      <View key={feature} style={styles.featureRow}>
                        <View
                          style={[
                            styles.checkIcon,
                            { backgroundColor: colors.status.successBg },
                          ]}
                        >
                          <Check size={12} color={colors.status.success} />
                        </View>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                    {plan.features.length > 5 && (
                      <Text style={styles.moreFeatures}>
                        +{plan.features.length - 5} more features
                      </Text>
                    )}
                  </View>

                  <View
                    style={[
                      styles.selectionIndicator,
                      isSelected && styles.selectionIndicatorActive,
                    ]}
                  >
                    {isSelected && <Check size={16} color="white" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Payment Options */}
          {showPaymentOptions && (
            <Animated.View
              style={[styles.paymentSection, { opacity: fadeAnim }]}
            >
              <Text style={styles.paymentTitle}>Payment Method</Text>

              <View style={styles.paymentOptions}>
                {paymentProviders.map((provider) => (
                  <TouchableOpacity
                    key={provider.id}
                    activeOpacity={0.8}
                    onPress={() => {
                      hapticSelection();
                      setSelectedProvider(provider.id);
                    }}
                    style={[
                      styles.paymentOption,
                      selectedProvider === provider.id &&
                        styles.paymentOptionSelected,
                    ]}
                  >
                    {getProviderIcon(provider.id)}
                    <View style={styles.paymentInfo}>
                      <Text style={styles.paymentName}>{provider.name}</Text>
                      <Text style={styles.paymentDesc}>
                        {provider.description}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.radioButton,
                        selectedProvider === provider.id &&
                          styles.radioButtonSelected,
                      ]}
                    >
                      {selectedProvider === provider.id && (
                        <View style={styles.radioInner} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[
                  styles.payButton,
                  isProcessing && styles.payButtonDisabled,
                ]}
                onPress={handlePayment}
                disabled={isProcessing}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={[palette.red[500], palette.red[600]]}
                  style={styles.payButtonGradient}
                >
                  {isProcessing ? (
                    <Text style={styles.payButtonText}>Processing...</Text>
                  ) : (
                    <>
                      <Text style={styles.payButtonText}>
                        Continue to Payment
                      </Text>
                      <Text style={styles.payButtonPrice}>
                        {billingPeriod === 'annual'
                          ? `${formatPrice(PRICING_ENTRIES[selectedPlan].annualPrice, selectedPricing.currency)} billed annually`
                          : `${formatPrice(PRICING_ENTRIES[selectedPlan].monthlyPrice, selectedPricing.currency)}/mo`}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Plan comparison — driven by PLAN_COMPARISON so it cannot advertise
              a limit the enforcement layer doesn't actually apply. */}
          <TouchableOpacity
            style={styles.compareToggle}
            onPress={() => {
              hapticSelection();
              setShowComparison((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: showComparison }}
          >
            <Text style={styles.compareToggleText}>
              {showComparison ? 'Hide comparison' : 'Compare all plans'}
            </Text>
            <Text style={styles.compareToggleChevron}>
              {showComparison ? '−' : '+'}
            </Text>
          </TouchableOpacity>

          {showComparison && (
            <View style={styles.compareTable}>
              <View style={[styles.compareRow, styles.compareHeaderRow]}>
                <Text style={[styles.compareLabel, styles.compareHeaderText]}>
                  Feature
                </Text>
                <Text style={[styles.compareValue, styles.compareHeaderText]}>
                  Free
                </Text>
                <Text
                  style={[
                    styles.compareValue,
                    styles.compareHeaderText,
                    styles.compareValueAccent,
                  ]}
                >
                  Pro
                </Text>
                <Text style={[styles.compareValue, styles.compareHeaderText]}>
                  Business
                </Text>
              </View>
              {PLAN_COMPARISON.map((row) => (
                <View key={row.key} style={styles.compareRow}>
                  <Text style={styles.compareLabel} numberOfLines={2}>
                    {row.label}
                  </Text>
                  {(['free', 'pro', 'business'] as const).map((tier) => {
                    const v = row.values[tier];
                    const isTick = v === true;
                    const isCross = v === false;
                    return (
                      <Text
                        key={tier}
                        style={[
                          styles.compareValue,
                          tier === 'pro' && styles.compareValueAccent,
                          isCross && styles.compareValueMuted,
                        ]}
                      >
                        {isTick ? '✓' : isCross ? '—' : v}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {/* What upgrading actually adds — makes the price legible as value. */}
          {upgrades.length > 0 && selectedPlan !== currentTier && (
            <View style={styles.upgradeSummary}>
              <Text style={styles.upgradeSummaryTitle}>
                {currentTier === 'free' ? 'Upgrade to ' : 'Switch to '}
                {selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}{' '}
                and get:
              </Text>
              {upgrades.map((row) => (
                <View key={row.key} style={styles.featureRow}>
                  <View
                    style={[
                      styles.checkIcon,
                      { backgroundColor: colors.status.successBg },
                    ]}
                  >
                    <Check size={12} color={colors.status.success} />
                  </View>
                  <Text style={styles.featureText}>{row.label}</Text>
                </View>
              ))}
              {billingPeriod === 'annual' &&
                getAnnualSavings(selectedPlan) > 0 && (
                  <Text style={styles.upgradeSummarySavings}>
                    You save{' '}
                    {formatPrice(
                      getAnnualSavings(selectedPlan),
                      selectedPricing.currency,
                    )}{' '}
                    by paying annually.
                  </Text>
                )}
            </View>
          )}

          {/* Restore purchases — required by Google Play; had no caller. */}
          <TouchableOpacity
            style={styles.restoreButton}
            onPress={handleRestore}
            disabled={isRestoring}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            <RotateCcw size={16} color={colors.text.secondary} />
            <Text style={styles.restoreText}>
              {isRestoring ? 'Restoring…' : 'Restore purchases'}
            </Text>
          </TouchableOpacity>

          {/* Footer — legal + trust. The previous "500+ Users / 4.8 Rating"
              badges were unverifiable claims and a Play policy risk. */}
          <View style={styles.footer}>
            <View style={styles.trustBadges}>
              <View style={styles.trustBadge}>
                <ShieldCheck size={16} color={colors.text.secondary} />
                <Text style={styles.trustText}>Secure checkout</Text>
              </View>
              <View style={styles.trustBadge}>
                <Lock size={16} color={colors.text.secondary} />
                <Text style={styles.trustText}>Encrypted data</Text>
              </View>
            </View>
            <Text style={styles.footerText}>
              Cancel anytime • No hidden fees
            </Text>
            <View style={styles.legalRow}>
              <TouchableOpacity
                onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                accessibilityRole="link"
              >
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={styles.legalSeparator}>•</Text>
              <TouchableOpacity
                onPress={() => Linking.openURL(TERMS_URL)}
                accessibilityRole="link"
              >
                <Text style={styles.legalLink}>Terms of Service</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.legalNote}>
              Subscriptions renew automatically unless cancelled at least 24
              hours before the end of the current period. Manage or cancel in
              your store account settings.
            </Text>
          </View>
        </ScrollView>
      </View>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  loadingContainer: { flex: 1, padding: spacing.lg },
  headerGradient: { paddingBottom: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text.primary,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: spacing['6xl'] },
  expiryWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.status.warningBg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  expiryContent: { flex: 1 },
  expiryTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.status.warning,
  },
  expirySubtitle: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  currentPlanCard: {
    backgroundColor: colors.bg.secondary,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  currentPlanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  currentPlanInfo: { marginLeft: spacing.md },
  currentPlanLabel: { fontSize: fontSize.xs, color: colors.text.secondary },
  currentPlanName: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text.primary,
  },
  usageStats: { flexDirection: 'row', justifyContent: 'space-around' },
  usageStat: { alignItems: 'center' },
  usageValue: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text.primary,
  },
  usageLabel: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  usageDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border.default,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  crownContainer: { marginBottom: spacing.lg },
  crownGradient: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
  heroTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  planCards: { paddingHorizontal: spacing.lg, gap: spacing.md },
  planCard: {
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius['2xl'],
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  planCardPopular: { borderColor: palette.red[500] },
  planCardSelected: {
    borderColor: palette.red[500],
    backgroundColor: colors.bg.tertiary,
  },
  planCardCurrent: { borderColor: colors.status.success },
  popularBadge: {
    position: 'absolute',
    top: -12,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  popularText: { fontSize: fontSize.xs, fontWeight: '700', color: 'white' },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.status.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  currentText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.status.success,
  },
  planHeader: { marginBottom: spacing.lg },
  planName: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  priceContainer: { flexDirection: 'row', alignItems: 'baseline' },
  currency: {
    fontSize: fontSize.lg,
    color: colors.text.secondary,
    marginRight: spacing.xs,
  },
  planPrice: {
    fontSize: fontSize['4xl'],
    fontWeight: '700',
    color: colors.text.primary,
  },
  period: {
    fontSize: fontSize.base,
    color: colors.text.secondary,
    marginLeft: spacing.xs,
  },
  featuresList: { gap: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center' },
  checkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  featureText: { fontSize: fontSize.sm, color: colors.text.primary, flex: 1 },
  moreFeatures: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginLeft: 28,
  },
  selectionIndicator: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionIndicatorActive: {
    borderColor: palette.red[500],
    backgroundColor: palette.red[500],
  },
  paymentSection: { paddingHorizontal: spacing.lg, marginTop: spacing.xxl },
  paymentTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  paymentOptions: { gap: spacing.sm },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  paymentOptionSelected: {
    borderColor: palette.red[500],
    backgroundColor: colors.bg.tertiary,
  },
  paymentInfo: { flex: 1, marginLeft: spacing.md },
  paymentName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text.primary,
  },
  paymentDesc: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: { borderColor: palette.red[500] },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.red[500],
  },
  payButton: {
    marginTop: spacing.lg,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadows.lg,
  },
  payButtonDisabled: { opacity: 0.7 },
  payButtonGradient: { alignItems: 'center', paddingVertical: spacing.lg },
  payButtonText: { fontSize: fontSize.lg, fontWeight: '600', color: 'white' },
  payButtonPrice: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  trustBadges: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.lg,
  },
  trustBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  trustText: { fontSize: fontSize.xs, color: colors.text.secondary },
  footer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },

  // --- Post-purchase confirmation --------------------------------------------
  confirmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg.secondary,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  confirmBannerDone: {
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  confirmTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.text.primary,
  },
  confirmSub: {
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },

  // --- Billing period toggle -------------------------------------------------
  periodToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.full,
    padding: 4,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    gap: 4,
  },
  periodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
  },
  periodOptionActive: { backgroundColor: palette.red[600] },
  periodText: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  periodTextActive: { color: '#FFFFFF' },
  savingsPill: {
    marginLeft: spacing.xs,
    backgroundColor: colors.status.successBg,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  savingsPillText: {
    fontSize: fontSize.xs,
    color: colors.status.success,
    fontWeight: '700',
  },

  // --- Comparison table -----------------------------------------------------
  compareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  compareToggleText: {
    fontSize: fontSize.sm,
    color: palette.red[400],
    fontWeight: '600',
  },
  compareToggleChevron: {
    fontSize: fontSize.lg,
    color: palette.red[400],
    fontWeight: '700',
  },
  compareTable: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  compareHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  compareLabel: {
    flex: 2,
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginRight: spacing.xs,
  },
  compareValue: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text.primary,
    textAlign: 'center',
    fontWeight: '500',
  },
  compareHeaderText: { fontWeight: '700', color: colors.text.secondary },
  compareValueAccent: { color: palette.red[400], fontWeight: '700' },
  compareValueMuted: { color: colors.text.muted },

  // --- Upgrade summary ------------------------------------------------------
  upgradeSummary: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    gap: spacing.xs,
  },
  upgradeSummaryTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  upgradeSummarySavings: {
    fontSize: fontSize.xs,
    color: colors.status.success,
    marginTop: spacing.xs,
    fontWeight: '600',
  },

  // --- Restore --------------------------------------------------------------
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginVertical: spacing.lg,
  },
  restoreText: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    fontWeight: '600',
  },

  // --- Legal ----------------------------------------------------------------
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  legalLink: {
    fontSize: fontSize.xs,
    color: palette.red[400],
    fontWeight: '600',
  },
  legalSeparator: {
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  legalNote: {
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 16,
  },
});
