/**
 * Set a new password (password-reset landing).
 *
 * Reached from the recovery email: `mtkalertpro://reset-password`. The link
 * carries a recovery token that `supabase-js` picks up automatically, so by the
 * time this screen renders the user already has a recovery session. All that is
 * left is to write the new password and drop them back into the app.
 */

import { supabase } from '@/lib/supabase/client';
import { designSystem } from '@/theme/design-system';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

/** Supabase rejects anything shorter, so catch it before the round-trip. */
const MIN_PASSWORD_LENGTH = 8;

function scorePassword(value: string): { label: string; met: boolean }[] {
  return [
    {
      label: 'At least 8 characters',
      met: value.length >= MIN_PASSWORD_LENGTH,
    },
    { label: 'Contains a number', met: /\d/.test(value) },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(value) },
  ];
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  // Present so a link opened with ?code=... still lands here; the recovery
  // token itself is consumed by the client, not read by this screen.
  useLocalSearchParams<{ code?: string }>();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasRecoverySession(!!data.session);
    });
    return () => {
      active = false;
    };
  }, []);

  const checks = scorePassword(password);
  const strongEnough = checks.every((c) => c.met);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const submit = async () => {
    if (!strongEnough) {
      Alert.alert(
        'Password too weak',
        'Please meet all the requirements below.',
      );
      return;
    }
    if (!passwordsMatch) {
      Alert.alert(
        'Passwords do not match',
        'Re-type the new password so both entries are identical.',
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      Alert.alert('Could not update password', error.message);
      return;
    }

    setDone(true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace('/login')}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={designSystem.colors.text.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {done ? (
          <>
            <ShieldCheck size={56} color={designSystem.colors.status.success} />
            <Text style={styles.title}>Password updated</Text>
            <Text style={styles.subtitle}>
              You are signed in with your new password. Continue to your
              dashboard.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.replace('/')}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <KeyRound size={44} color={designSystem.colors.primary[400]} />
            <Text style={styles.title}>Choose a new password</Text>
            <Text style={styles.subtitle}>
              Pick something you do not use elsewhere. You will stay signed in
              on this device.
            </Text>

            {hasRecoverySession === false && (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  This screen needs to be opened from the reset link in your
                  email. Request a new link from the sign-in screen if this one
                  has expired.
                </Text>
              </View>
            )}

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="New password"
              placeholderTextColor={designSystem.colors.text.tertiary}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              accessibilityLabel="New password"
            />

            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={designSystem.colors.text.tertiary}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              accessibilityLabel="Confirm new password"
            />

            <View style={styles.checks}>
              {checks.map((check) => (
                <Text
                  key={check.label}
                  style={[
                    styles.check,
                    check.met ? styles.checkMet : styles.checkUnmet,
                  ]}
                >
                  {check.met ? '✓' : '○'} {check.label}
                </Text>
              ))}
              {confirmPassword.length > 0 && !passwordsMatch && (
                <Text style={[styles.check, styles.checkUnmet]}>
                  ○ Passwords match
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!strongEnough || !passwordsMatch || saving) && styles.disabled,
              ]}
              onPress={submit}
              disabled={!strongEnough || !passwordsMatch || saving}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.primaryButtonText}>Update password</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  header: {
    paddingHorizontal: designSystem.spacing.lg,
    paddingTop: designSystem.spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designSystem.colors.background.secondary,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    padding: designSystem.spacing.xl,
    gap: designSystem.spacing.md,
  },
  title: {
    color: designSystem.colors.text.primary,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: designSystem.colors.text.secondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: designSystem.spacing.sm,
  },
  notice: {
    padding: designSystem.spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.30)',
  },
  noticeText: {
    color: '#FCD34D',
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    backgroundColor: designSystem.colors.background.secondary,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
    borderRadius: 12,
    paddingHorizontal: designSystem.spacing.md,
    paddingVertical: 14,
    color: designSystem.colors.text.primary,
    fontSize: 15,
  },
  checks: {
    gap: 6,
    marginVertical: designSystem.spacing.xs,
  },
  check: { fontSize: 13 },
  checkMet: { color: designSystem.colors.status.success },
  checkUnmet: { color: designSystem.colors.text.tertiary },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: designSystem.colors.primary[500],
    marginTop: designSystem.spacing.sm,
  },
  primaryButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: { opacity: 0.5 },
});
