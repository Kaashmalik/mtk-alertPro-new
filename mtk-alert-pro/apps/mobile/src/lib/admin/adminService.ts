/**
 * Admin service
 *
 * Thin, typed wrapper over the admin RPCs and admin-readable tables added in
 * the `admin_roles` migration. Every privileged action is a SECURITY DEFINER
 * RPC that re-checks `private.is_admin()` server-side, so these helpers are
 * convenience only — a non-admin calling them gets `not_authorized` from the
 * database, never a client-side bypass.
 */

import { supabase } from '@/lib/supabase/client';

export type SubscriptionTier = 'free' | 'pro' | 'business';

export interface PendingPayment {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  paymentProofUrl: string | null;
  notes: string | null;
  createdAt: string;
}

interface RpcResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Whether the given user is flagged as an admin. Fails closed (false). */
export async function fetchIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();

  if (error) {
    console.warn('[admin] fetchIsAdmin failed:', error.message);
    return false;
  }
  return data?.is_admin === true;
}

/** Manual payment requests awaiting admin review, newest first. */
export async function listPendingPayments(): Promise<PendingPayment[]> {
  const { data, error } = await supabase
    .from('payment_requests')
    .select('id, user_id, plan_id, amount, currency, provider, status, payment_proof_url, notes, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    planId: r.plan_id,
    amount: Number(r.amount),
    currency: r.currency,
    provider: r.provider,
    status: r.status,
    paymentProofUrl: r.payment_proof_url,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

function unwrap(data: unknown): RpcResult {
  const result = (data ?? {}) as RpcResult;
  if (result.success === false) {
    throw new Error(result.error || 'Admin action failed');
  }
  return result;
}

/** Approve a pending manual payment and extend the user's subscription. */
export async function approvePayment(id: string, transactionId?: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('admin_confirm_payment', {
    p_payment_request_id: id,
    p_transaction_id: transactionId,
  });
  if (error) throw error;
  return unwrap(data);
}

/** Reject a pending payment with an optional reason. */
export async function rejectPayment(id: string, reason?: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('admin_reject_payment', {
    p_payment_request_id: id,
    p_reason: reason,
  });
  if (error) throw error;
  return unwrap(data);
}

/** Manually grant or revoke a subscription tier (comp / refund / support). */
export async function setSubscription(
  userId: string,
  tier: SubscriptionTier,
  months = 1
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('admin_set_subscription', {
    p_user_id: userId,
    p_tier: tier,
    p_months: months,
  });
  if (error) throw error;
  return unwrap(data);
}
