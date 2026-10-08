import { LoadingScreen } from '@/components/ui';
import { useAuthStore } from '@/stores';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

export default function Index() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
        setOnboardingComplete(value === 'true');
      } catch (error) {
        console.warn('Failed to check onboarding status:', error);
        setOnboardingComplete(true); // Assume complete on error
      } finally {
        setCheckingOnboarding(false);
      }
    };

    checkOnboarding();
  }, []);

  // Show loading while checking onboarding status
  if (checkingOnboarding) {
    return <LoadingScreen />;
  }

  // Show onboarding for first-time users
  if (!onboardingComplete) {
    return <Redirect href="/onboarding" />;
  }

  // Redirect based on auth state
  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
