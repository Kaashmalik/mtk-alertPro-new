/**
 * 🔒 SECURE: Camera permission handling
 *
 * Features:
 * - Platform-specific permission requests
 * - Graceful fallback when denied
 * - Background permission monitoring
 * - User-friendly error messages
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { PermissionStatus as RnPermissionStatus } from 'react-native-permissions';

let request: any;
let PERMISSIONS: any;
let RESULTS: any;
let check: any;
let openSettings: any;

if (Platform.OS !== 'web') {
  try {
    const rnPermissions = require('react-native-permissions');
    request = rnPermissions.request;
    PERMISSIONS = rnPermissions.PERMISSIONS;
    RESULTS = rnPermissions.RESULTS;
    check = rnPermissions.check;
    openSettings = rnPermissions.openSettings;
  } catch (_e) {
    console.log('[Permissions] react-native-permissions not available');
  }
} else {
  RESULTS = { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' };
  PERMISSIONS = { IOS: {}, ANDROID: {} };
  check = async () => RESULTS.GRANTED;
  request = async () => RESULTS.GRANTED;
  openSettings = async () => {};
}
import { logError } from '@/lib/utils/errorHandler';

// ============================================================================
// Types
// ============================================================================

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable'
  | 'checking';

export interface CameraPermissionsState {
  status: PermissionStatus;
  canUseCamera: boolean;
  error: string | null;
  isChecking: boolean;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * 🔒 SECURE: Camera permission hook with platform-specific handling
 */
export function useCameraPermissions(): CameraPermissionsState & {
  requestPermission: () => Promise<boolean>;
  openSettings: () => Promise<void>;
} {
  const [state, setState] = useState<CameraPermissionsState>({
    status: 'checking',
    canUseCamera: false,
    error: null,
    isChecking: true,
  });

  // 🔒 SECURITY: Check initial permission status
  useEffect(() => {
    checkInitialPermissions();
  }, []);

  const checkInitialPermissions = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isChecking: true }));

      if (Platform.OS === 'ios') {
        const result = await check(PERMISSIONS.IOS.CAMERA);

        setState({
          status:
            result === RESULTS.GRANTED
              ? 'granted'
              : result === RESULTS.DENIED
                ? 'denied'
                : result === RESULTS.BLOCKED
                  ? 'blocked'
                  : 'unavailable',
          canUseCamera: result === RESULTS.GRANTED,
          error:
            result === RESULTS.GRANTED
              ? null
              : result === RESULTS.DENIED
                ? 'Camera access was denied. Please grant permission in Settings.'
                : result === RESULTS.BLOCKED
                  ? 'Camera access is blocked. Please enable in Settings.'
                  : 'Camera is not available on this device.',
          isChecking: false,
        });
      } else {
        // Android
        const result = await check(PERMISSIONS.ANDROID.CAMERA);

        setState({
          status:
            result === RESULTS.GRANTED
              ? 'granted'
              : result === RESULTS.DENIED
                ? 'denied'
                : result === RESULTS.BLOCKED
                  ? 'blocked'
                  : 'unavailable',
          canUseCamera: result === RESULTS.GRANTED,
          error:
            result === RESULTS.GRANTED
              ? null
              : result === RESULTS.DENIED
                ? 'Camera access was denied. Please grant permission in Settings.'
                : result === RESULTS.BLOCKED
                  ? 'Camera access is blocked. Please enable in Settings.'
                  : 'Camera is not available on this device.',
          isChecking: false,
        });
      }
    } catch (error) {
      logError(error, 'useCameraPermissions.checkInitialPermissions');
      setState({
        status: 'unavailable',
        canUseCamera: false,
        error: 'Failed to check camera permissions',
        isChecking: false,
      });
    }
  }, []);

  // 🔒 USER FRIENDLY: Request camera permission with proper UI
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      setState((prev) => ({ ...prev, isChecking: true }));

      let result: RnPermissionStatus;

      if (Platform.OS === 'ios') {
        result = await request(PERMISSIONS.IOS.CAMERA);
      } else {
        result = await request(PERMISSIONS.ANDROID.CAMERA);
      }

      const granted = result === RESULTS.GRANTED;

      setState({
        status: granted
          ? 'granted'
          : result === RESULTS.DENIED
            ? 'denied'
            : result === RESULTS.BLOCKED
              ? 'blocked'
              : 'unavailable',
        canUseCamera: granted,
        error: granted
          ? null
          : result === RESULTS.DENIED
            ? 'Camera access was denied. Please grant permission in Settings.'
            : result === RESULTS.BLOCKED
              ? 'Camera access is blocked. Please enable in Settings.'
              : 'Camera is not available on this device.',
        isChecking: false,
      });

      // 🔒 USER FRIENDLY: Show alert if permission denied
      if (
        !granted &&
        (result === RESULTS.DENIED || result === RESULTS.BLOCKED)
      ) {
        Alert.alert(
          'Camera Permission Required',
          'MTK AlertPro needs camera access to test camera connectivity and stream video. Without camera permission, some features will not work.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {},
            },
            {
              text: 'Open Settings',
              onPress: () => openAppSettings(),
            },
          ],
        );
      }

      return granted;
    } catch (error) {
      logError(error, 'useCameraPermissions.requestPermission');
      setState({
        status: 'unavailable',
        canUseCamera: false,
        error: 'Failed to request camera permissions',
        isChecking: false,
      });
      return false;
    }
  }, []);

  // 🔒 HELPER: Open app settings
  const openAppSettings = useCallback(async () => {
    try {
      await openSettings();
    } catch (error) {
      logError(error, 'useCameraPermissions.openSettings');

      // Fallback: Open settings manually
      if (Platform.OS === 'ios') {
        Alert.alert(
          'Open Settings',
          'Please open Settings manually: Settings > Privacy > Camera',
          [{ text: 'OK', onPress: () => {} }],
        );
      } else {
        Alert.alert(
          'Open Settings',
          'Please open Settings manually: Settings > Apps > MTK AlertPro > Permissions',
          [{ text: 'OK', onPress: () => {} }],
        );
      }
    }
  }, []);

  return {
    ...state,
    requestPermission,
    // Returned directly rather than re-wrapped in a local `openSettings`.
    // A local const of the same name shadows the module-level native binding
    // for the whole hook body, so openAppSettings() ended up calling the
    // wrapper, which called openAppSettings() again -- infinite recursion, and
    // the real native openSettings() was never reached.
    openSettings: openAppSettings,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * 🔒 SECURITY: Check if camera permission is granted
 */
export async function checkCameraPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      const result = await check(PERMISSIONS.IOS.CAMERA);
      return result === RESULTS.GRANTED;
    }
    const result = await check(PERMISSIONS.ANDROID.CAMERA);
    return result === RESULTS.GRANTED;
  } catch (error) {
    logError(error, 'checkCameraPermission');
    return false;
  }
}

/**
 * 🔒 SECURITY: Request camera permission with optional rationale
 */
export async function requestCameraPermission(
  rationale?: string,
): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      return (await request(PERMISSIONS.IOS.CAMERA)) === RESULTS.GRANTED;
    }
    // Android requires a rationale object, not a string
    const rationaleObj = rationale
      ? {
          title: 'Camera Permission',
          message: rationale,
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        }
      : undefined;
    return (
      (await request(PERMISSIONS.ANDROID.CAMERA, rationaleObj)) ===
      RESULTS.GRANTED
    );
  } catch (error) {
    logError(error, 'requestCameraPermission');
    return false;
  }
}
