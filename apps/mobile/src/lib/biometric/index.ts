import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Keys for secure storage
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const BIOMETRIC_USER_KEY = 'biometric_user_email';

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  userEmail?: string;
}

export interface BiometricCapability {
  available: boolean;
  biometricType: 'fingerprint' | 'facial' | 'iris' | 'none';
  enrolled: boolean;
}

/**
 * Check if biometric authentication is available on the device
 */
export async function checkBiometricCapability(): Promise<BiometricCapability> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    
    let biometricType: BiometricCapability['biometricType'] = 'none';
    
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = 'fingerprint';
    } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = 'facial';
    } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      biometricType = 'iris';
    }
    
    return {
      available: hasHardware,
      biometricType,
      enrolled: isEnrolled,
    };
  } catch (error) {
    console.error('Biometric capability check error:', error);
    return {
      available: false,
      biometricType: 'none',
      enrolled: false,
    };
  }
}

/**
 * Authenticate using biometrics
 */
export async function authenticateWithBiometric(
  promptMessage: string = 'Authenticate to continue'
): Promise<BiometricAuthResult> {
  try {
    const capability = await checkBiometricCapability();
    
    if (!capability.available || !capability.enrolled) {
      return {
        success: false,
        error: 'Biometric authentication not available',
      };
    }
    
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      fallbackLabel: 'Use PIN',
    });
    
    if (result.success) {
      // Get stored user email
      const userEmail = await SecureStore.getItemAsync(BIOMETRIC_USER_KEY);
      return {
        success: true,
        userEmail: userEmail || undefined,
      };
    }
    
    const isCancel = result.error === 'user_cancel' || 
                     result.error === 'system_cancel' || 
                     result.error === 'app_cancel' ||
                     result.error === 'user_fallback';

    return {
      success: false,
      error: isCancel ? 'User canceled' : (result.error || 'Authentication failed'),
    };
  } catch (error) {
    console.warn('Biometric authentication notice:', error);
    const msg = error instanceof Error ? error.message : 'Authentication failed';
    const isCancel = msg.toLowerCase().includes('cancel');
    return {
      success: false,
      error: isCancel ? 'User canceled' : msg,
    };
  }
}

/**
 * Enable biometric authentication for a user
 */
export async function enableBiometricAuth(userEmail: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return false;
    }
    
    const capability = await checkBiometricCapability();
    if (!capability.available || !capability.enrolled) {
      return false;
    }
    
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
    await SecureStore.setItemAsync(BIOMETRIC_USER_KEY, userEmail);
    return true;
  } catch (error) {
    console.error('Enable biometric error:', error);
    return false;
  }
}

/**
 * Disable biometric authentication
 */
export async function disableBiometricAuth(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return false;
    }
    
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_USER_KEY);
    return true;
  } catch (error) {
    console.error('Disable biometric error:', error);
    return false;
  }
}

/**
 * Check if biometric authentication is enabled for the app
 */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return false;
    }
    
    const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return enabled === 'true';
  } catch (error) {
    console.error('Check biometric enabled error:', error);
    return false;
  }
}

/**
 * Get the stored user email for biometric auth
 */
export async function getBiometricUserEmail(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return null;
    }
    
    return await SecureStore.getItemAsync(BIOMETRIC_USER_KEY);
  } catch (error) {
    console.error('Get biometric user error:', error);
    return null;
  }
}

/**
 * Guard for sensitive, non-reversible actions (purchases, account deletion,
 * credential changes).
 *
 * Re-authenticates only when the user opted into biometric login. A user who
 * has not enabled biometrics is NOT blocked here - the app lock is the control
 * that protects them, and silently requiring biometrics they never set up would
 * lock them out of their own account.
 *
 * @returns true when the action may proceed.
 */
export async function requireBiometric(actionLabel = 'continue'): Promise<boolean> {
  if (Platform.OS === 'web') return true;

  let enabled = false;
  try {
    enabled = await isBiometricEnabled();
  } catch {
    return true;
  }
  if (!enabled) return true;

  const result = await authenticateWithBiometric(`Confirm to ${actionLabel}`);
  return result.success;
}
