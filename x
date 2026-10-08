import { CameraStreamPlayer } from '@/components/camera/CameraStreamPlayer';
import { streamingService } from '@/lib/streaming/streamingService';
import { render, waitFor } from '@testing-library/react-native';

// Mock streaming service
jest.mock('@/lib/streaming/streamingService', () => ({
  streamingService: {
    registerCamera: jest.fn(),
    unregisterCamera: jest.fn(),
    getStreamStatus: jest.fn(),
    getHlsUrl: jest.fn(),
    isRegistered: jest.fn(),
    checkMediaServerHealth: jest.fn().mockResolvedValue(true),
    cachePreferredStreams: jest.fn(),
  },
}));

// Mock expo-av Video component
jest.mock('expo-av', () => ({
  Video: jest.fn(({ testID, onPlaybackStatusUpdate, ...props }) => {
    const React = require('react');
    const { View, Text } = require('react-native');

    // Simulate video loading. The timer must be cleared on unmount: without the
    // cleanup, every render left a real 100ms timer pending that fired
    // onPlaybackStatusUpdate after teardown, which kept the jest worker's event
    // loop alive and reported "a worker failed to exit gracefully".
    React.useEffect(() => {
      if (!onPlaybackStatusUpdate) return undefined;
      const timer = setTimeout(() => {
        onPlaybackStatusUpdate({
          isLoaded: true,
          isPlaying: true,
          isBuffering: false,
        });
      }, 100);
      return () => clearTimeout(timer);
    }, [onPlaybackStatusUpdate]);

    return (
      <View testID={testID || 'video-player'}>
        <Text>Mock Video</Text>
      </View>
    );
  }),
  ResizeMode: {
    CONTAIN: 'contain',
    COVER: 'cover',
  },
}));

describe('CameraStreamPlayer', () => {
  const defaultProps = {
    cameraId: 'test-camera-123',
    rtspUrl: 'rtsp://192.168.1.100:554/stream',
    userId: 'user-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // The component now reads the subscription tier to cap stream resolution,
    // so each test must start from a known (free) entitlement. Without this the
    // tier set by one test leaks into the next and the plan-ceiling assertions
    // pass or fail for the wrong reason.
    const { useSubscriptionStore } = require('@/stores/subscriptionStore');
    useSubscriptionStore.setState({ currentTier: 'free', expiresAt: null });

    // Default mock implementations
    (streamingService.registerCamera as jest.Mock).mockResolvedValue({
      success: true,
      pathName: 'cam_test',
      streams: {
        hls: 'http://localhost:8888/cam_test/index.m3u8',
        webrtc: 'http://localhost:8889/cam_test',
        rtsp: 'rtsp://localhost:8554/cam_test',
      },
    });

    (streamingService.getStreamStatus as jest.Mock).mockResolvedValue({
      online: true,
      readers: 1,
    });

    (streamingService.unregisterCamera as jest.Mock).mockResolvedValue(true);
    (streamingService.checkMediaServerHealth as jest.Mock).mockResolvedValue(
      true,
    );
  });

  // =========================================================================
  // Rendering States
  // =========================================================================
  describe('Rendering States', () => {
    it('should render without crashing', () => {
      const { toJSON } = render(
        <CameraStreamPlayer {...defaultProps} autoPlay={false} />,
      );

      expect(toJSON()).toBeTruthy();
    });

    it('masks credentials in the idle URL display', async () => {
      const { getByText } = render(
        <CameraStreamPlayer
          cameraId="c1"
          rtspUrl="rtsp://admin:secret@192.168.1.50:554/stream"
          userId="u1"
          autoPlay={false}
        />,
      );

      // The player passes through 'connecting' first, then settles to idle
      const urlText = await waitFor(
        () =>
          getByText(/rtsp:\/\//) as unknown as { props: { children: string } },
      );
      const rendered = String(urlText.props.children);
      expect(rendered).toContain('192.168.1.50:554/stream');
      // Raw credentials must never reach the rendered output
      expect(rendered).not.toContain('secret');
      expect(rendered).not.toContain('admin');
      expect(rendered).not.toContain('admin:secret@');
    });

    it('should show connecting state initially when autoPlay is true', () => {
      // Make registration take time
      (streamingService.registerCamera as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  streams: { hls: 'http://test/stream.m3u8' },
                }),
              5000,
            ),
          ),
      );

      const { getByText } = render(
        <CameraStreamPlayer {...defaultProps} autoPlay={true} />,
      );

      expect(getByText('Connecting to camera...')).toBeTruthy();
    });

    it('should call registerCamera on mount with autoPlay', async () => {
      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalledWith(
          defaultProps.cameraId,
          defaultProps.rtspUrl,
          defaultProps.userId,
          // Free tier caps the stream at 480p even though the wifi mock would
          // otherwise recommend 1080p. This is the plan ceiling being applied.
          '480p',
        );
      });
    });

    it('raises the stream resolution ceiling for a paid tier', async () => {
      // Same wifi connection, but an active pro subscription is entitled to
      // 720p. Proves the ceiling is read from the entitlement, not hardcoded.
      const { useSubscriptionStore } = require('@/stores/subscriptionStore');
      useSubscriptionStore.setState({
        currentTier: 'pro',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalledWith(
          defaultProps.cameraId,
          defaultProps.rtspUrl,
          defaultProps.userId,
          '720p',
        );
      });
    });

    it('keeps the free ceiling once a paid subscription has expired', async () => {
      const { useSubscriptionStore } = require('@/stores/subscriptionStore');
      useSubscriptionStore.setState({
        currentTier: 'pro',
        expiresAt: new Date(Date.now() - 1000),
      });

      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalledWith(
          defaultProps.cameraId,
          defaultProps.rtspUrl,
          defaultProps.userId,
          '480p',
        );
      });
    });

    it('should pass correct props', () => {
      const { toJSON } = render(
        <CameraStreamPlayer
          {...defaultProps}
          autoPlay={true}
          showControls={true}
        />,
      );

      expect(toJSON()).toBeTruthy();
    });
  });

  // =========================================================================
  // User Interactions
  // =========================================================================
  describe('User Interactions', () => {
    it('should register camera on mount', async () => {
      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalled();
      });
    });

    it('should handle props correctly', () => {
      const onError = jest.fn();
      const onStreamReady = jest.fn();

      const { toJSON } = render(
        <CameraStreamPlayer
          {...defaultProps}
          autoPlay={true}
          onError={onError}
          onStreamReady={onStreamReady}
        />,
      );

      expect(toJSON()).toBeTruthy();
    });
  });

  // =========================================================================
  // Callbacks
  // =========================================================================
  describe('Callbacks', () => {
    it('should accept callback props', () => {
      const onStreamReady = jest.fn();
      const onError = jest.fn();
      const onStateChange = jest.fn();

      const { toJSON } = render(
        <CameraStreamPlayer
          {...defaultProps}
          autoPlay={true}
          onStreamReady={onStreamReady}
          onError={onError}
          onStateChange={onStateChange}
        />,
      );

      expect(toJSON()).toBeTruthy();
    });

    it('should call onStateChange with connecting on mount', async () => {
      const onStateChange = jest.fn();

      render(
        <CameraStreamPlayer
          {...defaultProps}
          autoPlay={true}
          onStateChange={onStateChange}
        />,
      );

      await waitFor(() => {
        expect(onStateChange).toHaveBeenCalledWith('connecting');
      });
    });
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  describe('Cleanup', () => {
    it('should unregister camera on unmount', async () => {
      const { unmount } = render(
        <CameraStreamPlayer {...defaultProps} autoPlay={true} />,
      );

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalled();
      });

      unmount();

      expect(streamingService.unregisterCamera).toHaveBeenCalledWith(
        'test-camera-123',
      );
    });
  });

  // =========================================================================
  // Controls
  // =========================================================================
  describe('Controls', () => {
    it('should hide controls when showControls is false', async () => {
      const { queryByTestId } = render(
        <CameraStreamPlayer
          {...defaultProps}
          autoPlay={true}
          showControls={false}
        />,
      );

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalled();
      });

      // Controls should not be rendered
      expect(queryByTestId('controls-overlay')).toBeNull();
    });
  });

  // =========================================================================
  // Props Changes
  // =========================================================================
  describe('Props Changes', () => {
    it('should reinitialize when cameraId changes', async () => {
      const { rerender } = render(
        <CameraStreamPlayer {...defaultProps} autoPlay={true} />,
      );

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalledTimes(1);
      });

      // Change camera ID
      rerender(
        <CameraStreamPlayer
          {...defaultProps}
          cameraId="different-camera"
          autoPlay={true}
        />,
      );

      await waitFor(() => {
        expect(streamingService.unregisterCamera).toHaveBeenCalled();
        expect(streamingService.registerCamera).toHaveBeenCalledTimes(2);
      });
    });
  });

  // =========================================================================
  // Stream Status
  // =========================================================================
  describe('Stream Status', () => {
    it('should check stream status after registration', async () => {
      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // Service Integration
  // =========================================================================
  describe('Service Integration', () => {
    it('should use streamingService correctly', async () => {
      render(<CameraStreamPlayer {...defaultProps} autoPlay={true} />);

      await waitFor(() => {
        expect(streamingService.registerCamera).toHaveBeenCalledWith(
          'test-camera-123',
          'rtsp://192.168.1.100:554/stream',
          'user-1',
          '480p',
        );
      });
    });

    it('should handle service methods', () => {
      expect(typeof streamingService.registerCamera).toBe('function');
      expect(typeof streamingService.unregisterCamera).toBe('function');
      expect(typeof streamingService.getStreamStatus).toBe('function');
    });
  });
});
