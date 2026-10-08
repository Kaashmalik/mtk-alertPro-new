/**
 * Admin console
 *
 * Reachable only by users flagged `is_admin` in the database. The screen checks
 * admin status on mount and renders a locked state otherwise, but security does
 * not depend on that check ??? every action calls a SECURITY DEFINER RPC that
 * re-verifies admin server-side, so a user who force-navigates here can still
 * do nothing.
 *
 * Capabilities:
 *   - Review and approve/reject pending manual payment requests.
 *   - Manually grant or revoke a subscription tier for a user id.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { ArrowLeft, ShieldCheck, Lock, Check, X, Crown, RefreshCw } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { designSystem } from '@/theme/design-system';
import { useAuthStore } from '@/stores';
import { hapticNotification } from '@/lib/haptics';
import {
  fetchIsAdmin,
  listPendingPayments,
  approvePayment,
  rejectPayment,
  setSubscription,
  type PendingPayment,
  type SubscriptionTier,
} from '@/lib/admin/adminService';

const TIERS: SubscriptionTier[] = ['free', 'pro', 'business'];

export default function AdminScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual subscription controls
  const [targetUserId, setTargetUserId] = useState('');
  const [tier, setTier] = useState<SubscriptionTier>('pro');
  const [months, setMonths] = useState('1');
  const [savingSub, setSavingSub] = useState(false);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      setPayments(await listPendingPayments());
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to load payments');
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) {
        setChecking(false);
        return;
      }
      const admin = await fetchIsAdmin(userId);
      if (!active) return;
      setIsAdmin(admin);
      setChecking(false);
      if (admin) void loadPayments();
    })();
    return () => {
      active = false;
    };
  }, [userId, loadPayments]);

  const handleApprove = async (p: PendingPayment) => {
    setBusyId(p.id);
    try {
      await approvePayment(p.id);
      hapticNotification();
      setPayments((prev) => prev.filter((x) => x.id !== p.id));
    } catch (error) {
      Alert.alert('Approve failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = (p: PendingPayment) => {
    Alert.alert('Reject payment', `Reject ${p.planId} request for ${p.amount} ${p.currency}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setBusyId(p.id);
          try {
            await rejectPayment(p.id, 'Rejected by admin');
            setPayments((prev) => prev.filter((x) => x.id !== p.id));
          } catch (error) {
            Alert.alert('Reject failed', error instanceof Error ? error.message : 'Unknown error');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handleSetSubscription = async () => {
    const id = targetUserId.trim();
    if (!id) {
      Alert.alert('Missing user', 'Enter the user id to update.');
      return;
    }
    const m = Math.max(1, parseInt(months, 10) || 1);
    setSavingSub(true);
    try {
      await setSubscription(id, tier, m);
      hapticNotification();
      Alert.alert('Done', `Set ${id.slice(0, 8)}??? to ${tier}${tier === 'free' ? '' : ` for ${m} month(s)`}.`);
      setTargetUserId('');
    } catch (error) {
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSavingSub(false);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: 'Admin',
        headerStyle: { backgroundColor: designSystem.colors.background.secondary },
        headerTintColor: designSystem.colors.text.primary,
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
            <ArrowLeft size={24} color={designSystem.colors.text.primary} />
          </TouchableOpacity>
        ),
      }}
    />
  );

  if (checking) {
    return (
      <>
        {header}
        <SafeAreaView style={styles.center} edges={['bottom']}>
          <ActivityIndicator size="large" color={designSystem.colors.primary[500]} />
        </SafeAreaView>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        {header}
        <SafeAreaView style={styles.center} edges={['bottom']}>
          <Lock size={48} color={designSystem.colors.text.muted} />
          <Text style={styles.lockedTitle}>Admins only</Text>
          <Text style={styles.lockedText}>
            This area is restricted to administrator accounts.
          </Text>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      {header}
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={designSystem.colors.background.primary} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInDown.duration(500)} style={styles.badgeRow}>
            <ShieldCheck size={20} color={designSystem.colors.status.success} />
            <Text style={styles.badgeText}>Administrator</Text>
          </Animated.View>

          {/* Pending payments */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Pending payments</Text>
            <TouchableOpacity onPress={loadPayments} disabled={loadingPayments}>
              <RefreshCw size={18} color={designSystem.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {loadingPayments ? (
            <ActivityIndicator color={designSystem.colors.primary[500]} style={{ marginVertical: 24 }} />
          ) : payments.length === 0 ? (
            <Text style={styles.emptyText}>No pending payment requests.</Text>
          ) : (
            payments.map((p) => (
              <Animated.View key={p.id} entering={FadeInDown.duration(400)} style={styles.card}>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>
                    {p.planId.toUpperCase()} ?? {p.amount} {p.currency}
                  </Text>
                  <Text style={styles.cardSub}>
                    {p.provider} ?? user {p.userId.slice(0, 8)}???
                  </Text>
                  <Text style={styles.cardMeta}>{new Date(p.createdAt).toLocaleString()}</Text>
                  {p.notes ? <Text style={styles.cardNotes}>{p.notes}</Text> : null}
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.iconBtn, styles.approveBtn]}
                    onPress={() => handleApprove(p)}
                    disabled={busyId === p.id}
                  >
                    {busyId === p.id ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Check size={18} color="white" />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconBtn, styles.rejectBtn]}
                    onPress={() => handleReject(p)}
                    disabled={busyId === p.id}
                  >
                    <X size={18} color="white" />
                  </TouchableOpacity>
                </View>
              </Animated.View>
            ))
          )}

          {/* Manual subscription control */}
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Set subscription</Text>
          <Text style={styles.helpText}>
            Manually grant or revoke a tier for a user (comp, refund, support). The
            change is applied via an admin-guarded database function.
          </Text>

          <Text style={styles.label}>User id</Text>
          <TextInput
            style={styles.input}
            placeholder="uuid of the user"
            placeholderTextColor={designSystem.colors.text.muted}
            value={targetUserId}
            onChangeText={setTargetUserId}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Tier</Text>
          <View style={styles.tierRow}>
            {TIERS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tierChip, tier === t && styles.tierChipActive]}
                onPress={() => setTier(t)}
              >
                {t !== 'free' && (
                  <Crown
                    size={14}
                    color={tier === t ? 'white' : designSystem.colors.status.warning}
                  />
                )}
                <Text style={[styles.tierChipText, tier === t && styles.tierChipTextActive]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tier !== 'free' && (
            <>
              <Text style={styles.label}>Months</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                placeholderTextColor={designSystem.colors.text.muted}
                value={months}
                onChangeText={setMonths}
                keyboardType="numeric"
              />
            </>
          )}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSetSubscription}
            disabled={savingSub}
          >
            {savingSub ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryBtnText}>Apply subscription change</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: designSystem.colors.background.primary },
  center: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  scroll: { padding: 20, paddingBottom: 48 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  badgeText: { color: designSystem.colors.status.success, fontWeight: '700', fontSize: 14 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { color: designSystem.colors.text.primary, fontSize: 18, fontWeight: '700' },
  emptyText: { color: designSystem.colors.text.muted, fontSize: 14, marginVertical: 16 },
  helpText: {
    color: designSystem.colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardBody: { flex: 1 },
  cardTitle: { color: designSystem.colors.text.primary, fontSize: 15, fontWeight: '700' },
  cardSub: { color: designSystem.colors.text.secondary, fontSize: 13, marginTop: 2 },
  cardMeta: { color: designSystem.colors.text.muted, fontSize: 11, marginTop: 4 },
  cardNotes: { color: designSystem.colors.text.tertiary, fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: 8, marginLeft: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  approveBtn: { backgroundColor: designSystem.colors.status.success },
  rejectBtn: { backgroundColor: designSystem.colors.status.danger },
  label: { color: designSystem.colors.text.secondary, fontSize: 13, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: designSystem.colors.background.tertiary,
    borderRadius: 12,
    padding: 14,
    color: designSystem.colors.text.primary,
    fontSize: 15,
  },
  tierRow: { flexDirection: 'row', gap: 8 },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: designSystem.colors.background.secondary,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
  },
  tierChipActive: {
    backgroundColor: designSystem.colors.primary[500],
    borderColor: designSystem.colors.primary[500],
  },
  tierChipText: { color: designSystem.colors.text.secondary, fontWeight: '600', textTransform: 'capitalize' },
  tierChipTextActive: { color: 'white' },
  lockedTitle: { color: designSystem.colors.text.primary, fontSize: 20, fontWeight: '700' },
  lockedText: { color: designSystem.colors.text.secondary, fontSize: 14, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: designSystem.colors.primary[500],
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
