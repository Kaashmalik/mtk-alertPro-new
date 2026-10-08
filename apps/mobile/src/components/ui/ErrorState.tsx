/**
 * Error / retry state.
 *
 * The codebase had `EmptyState` (defined, never rendered) and no error state at
 * all: a failed Supabase query on the Cameras or Alerts tab rendered the same
 * view as "you have none", so a user with a live account and a dead network
 * could not tell the difference and had nothing to tap. This is the
 * counterpart to EmptyState, and `EmptyState`'s sibling in intent.
 */

import {
  AlertTriangle,
  Lock,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react-native';
import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { borderRadius, colors, fontSize, spacing } from '@/lib/theme';

export type ErrorStateKind =
  | 'network'
  | 'generic'
  | 'permission'
  | 'auth'
  | 'quota';

export interface ErrorStateProps {
  /** Drives the icon and the default copy. */
  kind?: ErrorStateKind;
  title?: string;
  message?: string;
  /** Rendered as the primary button. Omit to hide it. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Rendered as a secondary action, e.g. "Sign in" or "Upgrade". */
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
  style?: object;
}

const CONFIG: Record<
  ErrorStateKind,
  { icon: React.ReactNode; defaultTitle: string; defaultMessage: string }
> = {
  network: {
    icon: <WifiOff size={40} color={colors.status.warning} />,
    defaultTitle: "Can't reach the server",
    defaultMessage:
      'Check your internet connection and try again. Your settings are saved on this device.',
  },
  generic: {
    icon: <AlertTriangle size={40} color={colors.status.error} />,
    defaultTitle: 'Something went wrong',
    defaultMessage:
      'We could not load this right now. Pull down or try again in a moment.',
  },
  permission: {
    icon: <ShieldAlert size={40} color={colors.status.warning} />,
    defaultTitle: 'Permission needed',
    defaultMessage:
      'This feature needs an extra permission before it can continue.',
  },
  auth: {
    icon: <Lock size={40} color={colors.status.warning} />,
    defaultTitle: 'Please sign in again',
    defaultMessage:
      'Your session expired. Sign in to pick up where you left off.',
  },
  quota: {
    icon: <AlertTriangle size={40} color={colors.status.warning} />,
    defaultTitle: 'Limit reached',
    defaultMessage: 'You have used everything included in your current plan.',
  },
};

export function ErrorState({
  kind = 'generic',
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  secondaryLabel,
  onSecondary,
  compact = false,
  style,
}: ErrorStateProps) {
  const config = CONFIG[kind] ?? CONFIG.generic;

  return (
    <View
      style={[styles.container, compact && styles.containerCompact, style]}
      accessibilityRole="alert"
      // A failed load is otherwise silent for a screen-reader user: the screen
      // simply swaps content with no announcement.
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${title ?? config.defaultTitle}. ${message ?? config.defaultMessage}`}
    >
      <View style={styles.iconWrapper}>{config.icon}</View>

      <Text style={styles.title}>{title ?? config.defaultTitle}</Text>
      <Text style={styles.message}>{message ?? config.defaultMessage}</Text>

      {(onRetry || (secondaryLabel && onSecondary)) && (
        <View style={styles.actions}>
          {onRetry && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onRetry}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={retryLabel}
            >
              <RefreshCw size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{retryLabel}</Text>
            </TouchableOpacity>
          )}
          {secondaryLabel && onSecondary && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onSecondary}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={secondaryLabel}
            >
              <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  containerCompact: {
    paddingVertical: spacing.xl,
  },
  iconWrapper: {
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  secondaryButtonText: {
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
