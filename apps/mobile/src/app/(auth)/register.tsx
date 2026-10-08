import { Button, Input } from '@/components/ui';
import { useAuthStore } from '@/stores';
import { designSystem } from '@/theme/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { ArrowLeft, Lock, Mail, Shield, User } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  type TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

const registerSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Full name is required')
      .min(2, 'Name must be at least 2 characters'),
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Please enter a valid email address'),
    password: z
      .string()
      .min(1, 'Password is required')
      .min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterScreen() {
  const signUpWithEmail = useAuthStore((state) => state.signUpWithEmail);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (data: RegisterForm) => {
    if (isSubmitting) return; // Prevent double submission

    setError(null);
    setIsSubmitting(true);

    try {
      await signUpWithEmail(data.email, data.password, data.name);

      // Show success and navigate to login
      Alert.alert(
        'Account Created! 🎉',
        'Please check your email to verify your account before signing in.',
        [
          {
            text: 'Go to Login',
            onPress: () => {
              router.replace('/(auth)/login');
            },
          },
        ],
        { cancelable: false },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Registration failed';
      setError(message);

      // Show specific error messages
      if (message.includes('already registered')) {
        Alert.alert(
          'Account Exists',
          'This email is already registered. Please sign in instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign In', onPress: () => router.replace('/(auth)/login') },
          ],
        );
      } else {
        Alert.alert('Registration Failed', message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={designSystem.colors.background.primary}
      />

      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={24} color={designSystem.colors.text.primary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        >
          {/* Logo */}
          <Animated.View
            entering={FadeInDown.duration(600)}
            style={styles.logoSection}
          >
            <View style={styles.logoContainer}>
              <Shield size={36} color="white" />
            </View>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Join MTK AlertPro today</Text>
          </Animated.View>

          {/* Form */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(600)}
            style={styles.form}
          >
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={nameInputRef}
                  label="Full Name"
                  placeholder="Enter your name"
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => emailInputRef.current?.focus()}
                  leftIcon={
                    <User size={20} color={designSystem.colors.text.muted} />
                  }
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.name?.message}
                />
              )}
            />

            <View style={styles.inputSpacer} />

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={emailInputRef}
                  label="Email"
                  placeholder="Enter your email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  leftIcon={
                    <Mail size={20} color={designSystem.colors.text.muted} />
                  }
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />

            <View style={styles.inputSpacer} />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={passwordInputRef}
                  label="Password"
                  placeholder="Create a password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() =>
                    confirmPasswordInputRef.current?.focus()
                  }
                  leftIcon={
                    <Lock size={20} color={designSystem.colors.text.muted} />
                  }
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />

            <View style={styles.inputSpacer} />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={confirmPasswordInputRef}
                  label="Confirm Password"
                  placeholder="Confirm your password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit(onSubmit)}
                  leftIcon={
                    <Lock size={20} color={designSystem.colors.text.muted} />
                  }
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.confirmPassword?.message}
                />
              )}
            />
          </Animated.View>

          {error && (
            <Animated.View entering={FadeInDown} style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </Animated.View>
          )}

          <Button
            style={styles.submitButton}
            onPress={handleSubmit(onSubmit)}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            Create Account
          </Button>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.signinLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  header: {
    paddingHorizontal: designSystem.spacing.lg,
    paddingTop: designSystem.spacing.xs,
    paddingBottom: designSystem.spacing.xs,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: designSystem.spacing.xxl,
    paddingTop: designSystem.spacing.sm,
    paddingBottom: designSystem.spacing.xxxl,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: designSystem.spacing.xl,
  },
  logoContainer: {
    width: 72,
    height: 72,
    backgroundColor: designSystem.colors.primary[500],
    borderRadius: designSystem.layout.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: designSystem.spacing.md,
    ...designSystem.shadows.glow.primary,
  },
  title: {
    fontSize: designSystem.typography.size.xxl,
    fontWeight: '700',
    color: designSystem.colors.text.primary,
    marginBottom: designSystem.spacing.xs,
  },
  subtitle: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.secondary,
  },
  form: {
    marginBottom: designSystem.spacing.lg,
  },
  inputSpacer: {
    height: designSystem.spacing.md,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: designSystem.layout.radius.md,
    padding: designSystem.spacing.md,
    marginBottom: designSystem.spacing.lg,
  },
  errorText: {
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.status.danger,
    textAlign: 'center',
  },
  submitButton: {
    marginTop: designSystem.spacing.md,
  },
  signinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: designSystem.spacing.xxl,
  },
  signinText: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.secondary,
  },
  signinLink: {
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.primary[500],
    fontWeight: '600',
  },
});
