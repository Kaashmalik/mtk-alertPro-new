/**
 * Email confirmation landing page.
 *
 * Why this exists
 * ---------------
 * Supabase sends the confirmation email with a link built from the project's
 * Site URL. For a mobile-only project that default is usually `localhost`, so
 * tapping the link on a phone led nowhere. This route is the destination the
 * email points at instead, and it is what makes the flow feel intentional
 * rather than broken: the link opens a real page, explains what happened, and
 * hands the user back into the app.
 *
 * It handles three entry shapes:
 *  - `?token_hash=...&type=email`  the recommended Supabase email template.
 *    Works from any browser and does not depend on the client that started the
 *    flow, which is why it is preferred over the PKCE `?code=` variant.
 *  - `?code=...`                   PKCE handoff, exchanged in place.
 *  - `?error=...&error_description=...` a link that Supabase refused to mint.
 *
 * Required Supabase dashboard configuration (Auth -> URL Configuration):
 *  - Site URL      : the https origin that serves this page
 *  - Redirect URLs : `<origin>/auth/confirm` and `mtkalertpro://auth/confirm`
 * and in Auth -> Email Templates -> "Confirm signup":
 *  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
 */

import { supabase } from '@/lib/supabase/client';
import { designSystem } from '@/theme/design-system';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/** Must match the "scheme" in app.json. */
const APP_SCHEME = 'mtkalertpro';

type Status = 'verifying' | 'success' | 'error' | 'needsPassword';

const EMAIL_OTP_TYPES = [
  'signup',
  'invite',
  'magiclink',
  'email',
  'email_change',
] as const;

function isEmailOtpType(
  value: unknown,
): value is (typeof EMAIL_OTP_TYPES)[number] {
  return (
    typeof value === 'string' &&
    (EMAIL_OTP_TYPES as readonly string[]).includes(value)
  );
}

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    token_hash?: string;
    type?: string;
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('Verifying your email address…');
  // Guards against React 18 StrictMode double-invoking the effect, which would
  // burn the single-use token and report a spurious failure.
  const attempted = useRef(false);

  const verify = useCallback(async () => {
    // A link Supabase itself rejected (expired, already used, wrong type).
    if (params.error || params.error_description) {
      setStatus('error');
      setMessage(
        decodeURIComponent(
          params.error_description ??
            params.error ??
            'This link is no longer valid.',
        ),
      );
      return;
    }

    // PKCE handoff: the verifier lives in this browser session's storage.
    if (params.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        setStatus('error');
        setMessage(error.message);
        return;
      }
      setStatus('success');
      setMessage('Your email is confirmed. Taking you into the app…');
      return;
    }

    if (!params.token_hash) {
      setStatus('error');
      setMessage('This confirmation link is missing its verification token.');
      return;
    }

    if (params.type === 'recovery') {
      // The link only proves the mailbox; the password still has to be set.
      setStatus('needsPassword');
      setMessage('Your email is confirmed. Choose a new password to finish.');
      return;
    }

    const type = isEmailOtpType(params.type) ? params.type : 'email';
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type,
    });
    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    setStatus('success');
    setMessage('Your email is confirmed. Taking you into the app…');
  }, [params]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void verify();
  }, [verify]);

  const openApp = useCallback(() => {
    const target = `${APP_SCHEME}://`;
    if (Platform.OS === 'web') {
      void Linking.openURL(target).catch(() => {
        /* App not installed: the page already confirmed the account. */
      });
      return;
    }
    router.replace('/');
  }, [router]);

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => {
        if (Platform.OS === 'web') {
          // On the web the user may not have the app; offer the hand-off
          // instead of silently navigating to a route that has no meaning here.
          return;
        }
        router.replace('/');
      }, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status, router]);

  const isBusy = status === 'verifying';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      <View style={styles.card}>
        {isBusy && (
          <ActivityIndicator
            size="large"
            color={designSystem.colors.primary[400]}
          />
        )}

        {!isBusy && status === 'success' && (
          <CheckCircle2 size={56} color={designSystem.colors.status.success} />
        )}
        {!isBusy && status === 'error' && <XCircle size={56} color="#F87171" />}
        {!isBusy && status === 'needsPassword' && (
          <MailCheck size={56} color={designSystem.colors.status.success} />
        )}

        <Text style={styles.title}>
          {isBusy
            ? 'Confirming your email'
            : status === 'success'
              ? 'Email confirmed'
              : status === 'needsPassword'
                ? 'Email confirmed'
                : 'We could not confirm this link'}
        </Text>

        <Text style={styles.body}>{message}</Text>

        {status === 'success' && Platform.OS === 'web' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={openApp}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Open MTK AlertPro</Text>
          </TouchableOpacity>
        )}

        {status === 'needsPassword' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace('/forgot-password')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Set a new password</Text>
          </TouchableOpacity>
        )}

        {status === 'error' && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace('/login')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Back to sign in</Text>
          </TouchableOpacity>
        )}

        {status === 'success' && Platform.OS === 'web' && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={openApp}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>
              I have the app installed
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.footnote}>
        MTK AlertPro · Secure authentication by Supabase
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: designSystem.spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: designSystem.spacing.md,
    padding: designSystem.spacing.xl,
    borderRadius: 20,
    backgroundColor: designSystem.colors.background.secondary,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
  },
  title: {
    color: designSystem.colors.text.primary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: designSystem.colors.text.secondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: designSystem.spacing.sm,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: designSystem.colors.primary[500],
  },
  primaryButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: designSystem.colors.border.default,
  },
  secondaryButtonText: {
    color: designSystem.colors.text.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  footnote: {
    position: 'absolute',
    bottom: designSystem.spacing.xl,
    color: designSystem.colors.text.tertiary,
    fontSize: 12,
  },
});
