/**
 * Native RTSP bridge stub for Expo Dev Client (Phase 5).
 * When EXPO_PUBLIC_NATIVE_RTSP=1 and a VLC/native module is linked,
 * StreamSession can prefer this over MediaMTX for same-LAN viewing.
 *
 * MediaMTX remains required for remote view, snapshots, and recording.
 */

export interface NativeRtspCapabilities {
  available: boolean;
  reason?: string;
}

export function getNativeRtspCapabilities(): NativeRtspCapabilities {
  const enabled = process.env.EXPO_PUBLIC_NATIVE_RTSP === '1';
  if (!enabled) {
    return { available: false, reason: 'EXPO_PUBLIC_NATIVE_RTSP not enabled' };
  }

  try {
    // Optional peer dependency — only present in custom Dev Client builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-vlc-media-player');
    return { available: true };
  } catch {
    return {
      available: false,
      reason: 'react-native-vlc-media-player not linked — see docs/guides/NATIVE_LAN_RTSP.md',
    };
  }
}

/**
 * Placeholder play URL helper — returns null until native module is installed.
 */
export function resolveNativeRtspUrl(rtspUrl: string): string | null {
  const caps = getNativeRtspCapabilities();
  if (!caps.available) return null;
  return rtspUrl;
}
