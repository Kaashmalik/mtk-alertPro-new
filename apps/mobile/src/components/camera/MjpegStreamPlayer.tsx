/**
 * MJPEG / Snapshot stream player
 * Renders polled JPEG frames from an HTTP camera stream.
 * Used as the display path for http(s) camera URLs (no native RTSP/MJPEG dep).
 *
 * @module components/camera/MjpegStreamPlayer
 */

import { cameraMediaService } from '@/lib/camera/cameraMediaService';
import {
  type MjpegStream,
  type MjpegStreamState,
  createMjpegStream,
} from '@/lib/camera/mjpegService';
import { borderRadius, colors, fontSize, spacing } from '@/lib/theme';
import { Camera, Play, RefreshCw, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface MjpegStreamPlayerProps {
  /** HTTP(MJPEG/snapshot) stream URL */
  url: string;
  cameraName?: string;
  autoPlay?: boolean;
  fps?: number;
  username?: string;
  password?: string;
  onError?: (error: string) => void;
  onStateChange?: (state: string) => void;
}

type PlayerState = 'idle' | 'connecting' | 'playing' | 'error';

export function MjpegStreamPlayer({
  url,
  cameraName = 'Camera',
  autoPlay = true,
  fps = 2,
  username,
  password,
  onError,
  onStateChange,
}: MjpegStreamPlayerProps) {
  const streamRef = useRef<MjpegStream | null>(null);
  const containerRef = useRef<View>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [streamState, setStreamState] = useState<MjpegStreamState>({
    status: 'idle',
    frame: null,
  });

  const updateState = useCallback(
    (next: PlayerState, error?: string) => {
      setPlayerState(next);
      onStateChange?.(next);
      if (next === 'error' && error) {
        onError?.(error);
      }
    },
    [onError, onStateChange],
  );

  const startStream = useCallback(() => {
    if (!streamRef.current) {
      streamRef.current = createMjpegStream({ url, fps, username, password });
      streamRef.current.subscribe((state) => {
        setStreamState(state);
        if (state.status === 'live' && state.frame) {
          updateState('playing');
        } else if (state.status === 'error') {
          updateState('error', state.error);
        } else if (state.status === 'loading') {
          updateState('connecting');
        }
      });
    }
    updateState('connecting');
    streamRef.current.start();
  }, [url, fps, username, password, updateState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only or stable store refs
  useEffect(() => {
    if (autoPlay) {
      startStream();
    }
    return () => {
      streamRef.current?.stop();
      streamRef.current = null;
    };
    // Restart only when URL/credentials change
  }, [url, username, password]);

  const handleRetry = () => {
    streamRef.current?.restart();
    updateState('connecting');
  };

  const handleStart = () => {
    startStream();
  };

  const handleScreenshot = async () => {
    const success = await cameraMediaService.captureAndSaveToGallery(
      containerRef,
      cameraName,
    );
    if (!success) {
      // Fallback: no-op if capture failed
    }
  };

  // --- Idle ---
  if (playerState === 'idle' && !autoPlay) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.centerOverlay} onPress={handleStart}>
          <View style={styles.playButtonLarge}>
            <Play size={48} color="white" fill="white" />
          </View>
          <Text style={styles.idleText}>Tap to start stream</Text>
          <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
            {url}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Connecting ---
  if (playerState === 'connecting') {
    return (
      <View style={styles.container}>
        <View style={styles.centerOverlay}>
          <ActivityIndicator size="large" color={colors.brand.red} />
          <Text style={styles.connectingText}>Connecting to camera…</Text>
          <Text style={styles.connectingSubtext}>
            Locating snapshot endpoint
          </Text>
        </View>
      </View>
    );
  }

  // --- Error ---
  if (playerState === 'error' && !streamState.frame) {
    return (
      <View style={styles.container}>
        <View style={styles.centerOverlay}>
          <WifiOff size={56} color={colors.status.error} />
          <Text style={styles.errorTitle}>Stream Unavailable</Text>
          <Text style={styles.errorText}>
            {streamState.error || 'Unable to load frames from camera.'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <RefreshCw size={20} color="white" />
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Playing (or recovering while a last frame is held) ---
  return (
    <View ref={containerRef} style={styles.container} collapsable={false}>
      {streamState.frame ? (
        <Image
          source={{ uri: streamState.frame.uri }}
          style={styles.image}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.centerOverlay}>
          <ActivityIndicator size="large" color={colors.brand.red} />
          <Text style={styles.connectingText}>Loading first frame…</Text>
        </View>
      )}

      {/* LIVE badge */}
      <View style={styles.liveIndicator}>
        <View
          style={[
            styles.liveDot,
            {
              backgroundColor:
                streamState.status === 'live'
                  ? colors.status.success
                  : colors.status.error,
            },
          ]}
        />
        <Text style={styles.liveText}>
          {streamState.status === 'live' ? 'LIVE' : 'WAITING'}
        </Text>
      </View>

      {/* Top-right actions */}
      <View style={styles.topActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleScreenshot}
          accessibilityRole="button"
          accessibilityLabel="Take screenshot"
        >
          <Camera size={18} color="white" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Reconnect stream"
          accessibilityHint="Retries the camera connection"
        >
          <RefreshCw size={18} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: borderRadius.lg,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: spacing.xxl,
  },
  playButtonLarge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  idleText: {
    color: 'white',
    fontSize: fontSize.lg,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  urlText: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
    maxWidth: '80%',
    textAlign: 'center',
  },
  connectingText: {
    color: 'white',
    fontSize: fontSize.lg,
    fontWeight: '500',
    marginTop: spacing.lg,
  },
  connectingSubtext: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  errorTitle: {
    color: colors.status.error,
    fontSize: fontSize.xl,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.text.secondary,
    fontSize: fontSize.base,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand.red,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  retryButtonText: {
    color: 'white',
    fontSize: fontSize.base,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  liveIndicator: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  liveText: {
    color: 'white',
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  topActions: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
});

export default MjpegStreamPlayer;
